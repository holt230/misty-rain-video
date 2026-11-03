import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const WORK_TTL = 24 * 60 * 60_000;
const PERSON_TTL = 7 * WORK_TTL;
const RETRY = 60_000;
const idPattern = /^\d{1,20}$/;
const clean = (value, limit = 240) => typeof value === 'string' || typeof value === 'number'
  ? String(value).replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').trim().slice(0, limit) : '';
const strings = (value, max = 16) => Array.isArray(value) ? [...new Set(value.map(item => clean(item)).filter(Boolean))].slice(0, max) : [];
export const catalogImageHost = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^[a-z0-9-]+\.doubanio\.com$/.test(url.hostname) && !url.port && !url.username && !url.password;
  } catch { return false; }
};
const photo = row => {
  const value = row?.avatar?.normal || row?.avatar?.large || (typeof row?.avatar === 'string' ? row.avatar : '') || row?.cover?.normal?.url || '';
  return catalogImageHost(value) ? value : '';
};
export function normalizeCredits(rows, role) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    const name = clean(row?.name, 100), id = clean(row?.id, 20);
    const key = idPattern.test(id) ? id : name;
    if (!name || seen.has(key)) return [];
    seen.add(key);
    const photoUrl = photo(row);
    return [{ id: idPattern.test(id) ? id : '', name, latinName: clean(row.latin_name, 160),
      role: clean(row.simple_character || row.character, 160) || role,
      avatar: idPattern.test(id) && photoUrl ? '/api/catalog/people/' + id + '/portrait' : '', photoUrl }];
  }).slice(0, 80);
}
export function normalizeComments(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    const id = clean(row?.id, 40), text = clean(row?.comment, 4000);
    if (!/^\d{1,30}$/.test(id) || !text || seen.has(id)) return [];
    seen.add(id);
    const rating = Number(row.rating?.value), votes = Number(row.vote_count);
    return [{ id, text, author: clean(row.user?.name, 100) || '豆瓣用户', createdAt: clean(row.create_time, 40),
      rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
      upvotes: Number.isFinite(votes) && votes >= 0 ? Math.floor(votes) : 0 }];
  }).slice(0, 10);
}
const publicCredits = rows => rows.map(({ photoUrl, ...person }) => person);
const sourceUrl = id => 'https://movie.douban.com/subject/' + id + '/';

/** Public subject/person metadata only. No account or cloud-drive credentials enter upstream requests. */
export class CatalogDetailsService {
  constructor(directory, { fetcher = fetch, now = Date.now } = {}) {
    this.directory = path.join(directory, 'details');
    this.peopleDirectory = path.join(directory, 'people');
    this.fetcher = fetcher;
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
    this.failures = new Map();
    this.active = 0;
    this.queue = [];
  }

  async json(route) {
    if (this.active >= 3) await new Promise(resolve => this.queue.push(resolve));
    else this.active++;
    try {
      const response = await this.fetcher('https://m.douban.com/rexxar/api/v2/' + route, {
        redirect: 'error', signal: AbortSignal.timeout(8_000),
        headers: { Accept: 'application/json', 'User-Agent': 'MistyRainVideo/1.0', Referer: 'https://movie.douban.com/' }
      });
      if (!response.ok) throw new Error('资料源暂不可用');
      if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('资料过大');
      const reader = response.body.getReader(); let length = 0; const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('资料过大'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      const next = this.queue.shift(); if (next) next(); else this.active--;
    }
  }

  async write(directory, key, value) {
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, key + '.json');
    const temporary = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(value));
    await fs.rename(temporary, file);
  }

  async registerPeople(people) {
    await Promise.all(people.filter(person => person.id).map(person => this.write(this.peopleDirectory, person.id, {
      id: person.id, name: person.name, latinName: person.latinName, photoUrl: person.photoUrl
    })));
  }

  async personSeed(id) {
    if (!idPattern.test(id)) return null;
    try { const value = JSON.parse(await fs.readFile(path.join(this.peopleDirectory, id + '.json'), 'utf8')); return value.id === id ? value : null; }
    catch { return null; }
  }

  async cached(key, ttl, empty, load) {
    let snapshot = this.cache.get(key);
    if (!snapshot) {
      try {
        const disk = JSON.parse(await fs.readFile(path.join(this.directory, key + '.json'), 'utf8'));
        if (disk.version === 1 && disk.value && Number.isFinite(Date.parse(disk.updatedAt))) snapshot = disk;
      } catch { /* Cold loads fetch only the selected subject or person. */ }
    }
    const remember = value => {
      this.cache.delete(key); this.cache.set(key, value);
      while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value);
    };
    if (snapshot) remember(snapshot);
    const stale = !snapshot || this.now() - Date.parse(snapshot.updatedAt) >= (snapshot.partial ? RETRY : ttl);
    if (stale && (!this.failures.has(key) || this.now() - this.failures.get(key) >= RETRY)) {
      if (!this.pending.has(key)) {
        const previous = snapshot;
        const task = (async () => {
          try {
            const value = await load(previous?.value);
            if (!value) throw new Error('资料不可用');
            const { partial, ...data } = value;
            const next = { version: 1, value: data, partial: Boolean(partial), updatedAt: new Date(this.now()).toISOString() };
            await this.write(this.directory, key, next);
            remember(next); this.failures.delete(key);
          } catch {
            this.failures.set(key, this.now());
            while (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value);
          }
        })().finally(() => this.pending.delete(key));
        this.pending.set(key, task);
      }
      if (!snapshot) { await this.pending.get(key); snapshot = this.cache.get(key); }
    }
    return { ...(snapshot?.value || empty), updatedAt: snapshot?.updatedAt || '',
      stale: !snapshot || this.now() - Date.parse(snapshot.updatedAt) >= (snapshot.partial ? RETRY : ttl),
      refreshing: this.pending.has(key),
      message: this.failures.has(key) ? snapshot ? '资料源暂未更新，展示上次获取的资料' : '资料暂时无法加载，可以稍后重试' : snapshot?.partial ? '部分资料暂未获取，已展示可用内容' : '' };
  }

  async work(id, item, category) {
    if (!idPattern.test(id) || !item) throw Object.assign(new Error('未找到影片资料'), { statusCode: 404 });
    const kind = (item.category || category) === 'movie' ? 'movie' : 'tv';
    const empty = { catalogId: 'douban:' + id, title: item.title || '', summary: '', genres: [], countries: [], languages: [],
      releaseDates: [], durations: [], directors: [], actors: [], sourceName: '豆瓣', sourceUrl: sourceUrl(id) };
    return this.cached(kind + '-' + id, WORK_TTL, empty, async previous => {
      const [subject, credits] = await Promise.allSettled([this.json(kind + '/' + id), this.json(kind + '/' + id + '/celebrities')]);
      const row = subject.status === 'fulfilled' && String(subject.value?.id) === id ? subject.value : null;
      const cast = credits.status === 'fulfilled' && (!credits.value?.id || String(credits.value.id) === id)
        && (Array.isArray(credits.value?.actors) || Array.isArray(credits.value?.directors)) ? credits.value : null;
      if (!row && !cast) return null;
      const directors = normalizeCredits(cast?.directors || row?.directors, '导演');
      const actors = normalizeCredits(cast?.actors || row?.actors, '演员');
      await this.registerPeople([...directors, ...actors]);
      return { ...empty, ...previous, title: clean(row?.title, 160) || previous?.title || item.title || '',
        summary: clean(row?.intro, 12000) || previous?.summary || '', year: clean(row?.year, 20) || previous?.year || item.year || '',
        genres: row ? strings(row.genres) : previous?.genres || [], countries: row ? strings(row.countries) : previous?.countries || [],
        languages: row ? strings(row.languages) : previous?.languages || [], releaseDates: row ? strings(row.pubdate) : previous?.releaseDates || [],
        durations: row ? strings(row.durations) : previous?.durations || [],
        episodeCount: Number.isInteger(row?.episodes_count) && row.episodes_count > 0 ? row.episodes_count : previous?.episodeCount,
        directors: cast || !previous?.directors?.length ? publicCredits(directors) : previous.directors,
        actors: cast || !previous?.actors?.length ? publicCredits(actors) : previous.actors,
        partial: !row || !cast };
    });
  }

  async person(id) {
    const seed = await this.personSeed(id);
    if (!seed) throw Object.assign(new Error('未找到人物资料'), { statusCode: 404 });
    const empty = { id, name: seed.name, latinName: seed.latinName || '', description: '', info: [],
      avatar: catalogImageHost(seed.photoUrl) ? '/api/catalog/people/' + id + '/portrait' : '',
      sourceUrl: 'https://movie.douban.com/celebrity/' + id + '/', sourceName: '豆瓣' };
    return this.cached('person-' + id, PERSON_TTL, empty, async () => {
      const row = await this.json('celebrity/' + id);
      const name = clean(row.title || row.name, 100);
      if (!name || name !== seed.name) throw new Error('人物资料不匹配');
      const info = (Array.isArray(row.extra?.info) ? row.extra.info : []).filter(value => Array.isArray(value) && value.length >= 2)
        .map(([label, value]) => ({ label: clean(label, 40), value: clean(value, 500) })).filter(value => value.label && value.value).slice(0, 16);
      return { ...empty, name, latinName: clean(row.latin_title, 160) || seed.latinName || '',
        description: clean(row.intro || row.extra?.intro || row.extra?.short_info, 8000), info };
    });
  }

  async comments(id, item, category, start = 0) {
    if (!idPattern.test(id) || !item) throw Object.assign(new Error('未找到影片资料'), { statusCode: 404 });
    if (!Number.isInteger(start) || start < 0 || start > 90 || start % 10 !== 0) throw Object.assign(new Error('无效的短评分页'), { statusCode: 400 });
    const kind = (item.category || category) === 'movie' ? 'movie' : 'tv';
    const empty = { catalogId: 'douban:' + id, start, total: 0, items: [], hasMore: false, sourceName: '豆瓣', sourceUrl: sourceUrl(id) + 'comments' };
    return this.cached('comments-' + kind + '-' + id + '-' + start, 15 * 60_000, empty, async () => {
      const row = await this.json(kind + '/' + id + '/interests?count=10&start=' + start + '&order_by=hot');
      if (!Array.isArray(row.interests) || (row.start !== undefined && Number(row.start) !== start)) throw new Error('短评资料不可用');
      const items = normalizeComments(row.interests);
      const total = Number.isSafeInteger(row.total) && row.total >= 0 ? row.total : start + items.length;
      return { ...empty, items, total, hasMore: row.interests.length >= 10 && start + 10 < total && start < 90 };
    });
  }
}
