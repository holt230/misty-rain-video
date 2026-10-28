import fs from 'node:fs';
import path from 'node:path';
import { isDiscoveryImageUrl } from './discoverySources.js';
import { ShareThumbnails } from './shareThumbnails.js';
import { CatalogDetailContent, normalizePhotos, normalizeComments, parseSubjectInfo } from './catalogDetailContent.js';

const validId = /^(douban|bangumi)-[1-9]\d{0,12}$/;
const text = (value, length = 300) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const list = values => Array.isArray(values) ? [...new Set(values.map(value => text(value)).filter(Boolean))].slice(0, 100) : [];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const imageUrl = (value, provider = 'douban') => isDiscoveryImageUrl(value, provider) ? value : '';
const error = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode });
const score = value => Number(value) > 0 && Number(value) <= 10 ? Number(value) : null;
const TTL = 6 * 3600_000, MAX_AGE = 7 * 86400_000;

export function normalizeDoubanDetails(core, modules = {}) {
  if (!/^[1-9]\d{0,12}$/.test(String(core?.id)) || !text(core.title) || !['movie', 'tv'].includes(core.type)) throw error('影片详情暂时不可用');
  const info = modules.info || {};
  const merge = (a, b) => list([...(a || []), ...(b || [])]);
  const genres = merge(core.genres, info.genres), id = `douban-${core.id}`, sourceUrl = `https://movie.douban.com/subject/${core.id}/`;
  const credits = new Map();
  const addCredit = (person, role) => {
    const name = text(person?.name, 100); if (!name) return;
    const existing = credits.get(name) || { name, role: '', imageUrl: '', url: '' };
    existing.role = [...new Set([existing.role, text(role, 150)].filter(Boolean))].join(' · ');
    existing.imageUrl ||= imageUrl(person.avatar?.large || person.avatar?.normal);
    if (/^[1-9]\d{0,12}$/.test(String(person.id))) existing.url = `https://movie.douban.com/celebrity/${person.id}/`;
    credits.set(name, existing);
  };
  for (const person of (modules.credits?.items || []).slice(0, 100)) addCredit(person, person.simple_character || person.category);
  for (const person of (core.directors || []).slice(0, 30)) if (!credits.has(person.name)) addCredit(person, '导演');
  for (const person of (core.actors || []).slice(0, 100)) if (!credits.has(person.name)) addCredit(person, '演员');
  for (const name of info.actors || []) if (!credits.has(name)) addCredit({ name }, '演员');
  for (const name of info.writers || []) if (!credits.get(name)?.role.includes('编剧')) addCredit({ name }, '编剧');
  const photos = normalizePhotos(modules.photos).slice(0, 6);
  return { id, provider: 'douban', subjectType: core.type, title: text(core.title, 120), originalTitle: text(core.original_title, 200),
    category: genres.includes('动画') ? 'anime' : genres.includes('真人秀') || genres.includes('脱口秀') ? 'variety' : core.type === 'tv' ? 'tv' : 'movie',
    year: text(String(core.year || ''), 4), rating: score(core.rating?.value), ratingCount: count(core.rating?.count),
    description: text(core.intro, 10000), subtitle: text(core.episodes_info, 100), imageUrl: imageUrl(core.pic?.large || core.pic?.normal || core.cover_url),
    sourceUrl, genres, countries: merge(core.countries, info.countries), languages: merge(core.languages, info.languages), premieres: merge(core.pubdate, info.premieres),
    durations: merge(core.durations, info.durations), aliases: merge(core.aka, info.aliases), writers: info.writers || [], imdb: info.imdb || '', episodeCount: count(core.episodes_count),
    directors: list((core.directors || []).map(person => person.name)), credits: [...credits.values()].slice(0, 120),
    creditCount: count(modules.credits?.total), photos, photoCount: count(modules.photos?.total),
    commentCount: count(core.comment_count), reviewCount: count(core.review_count),
    comments: normalizeComments(modules.comments).slice(0, 3),
    honors: list((core.honor_infos || []).map(item => `${text(item.title, 80)}${text(item.title).includes('榜') && count(item.rank) ? ` 第 ${item.rank} 名` : ''}`)),
    partial: ['credits', 'photos', 'comments', 'info'].some(key => !modules[key]) };
}

export function normalizeBangumiDetails(core) {
  if (core?.type !== 2 || core.nsfw === true || !text(core.name) || !/^[1-9]\d{0,12}$/.test(String(core.id))) throw error('影片详情暂时不可用');
  const info = key => (core.infobox || []).find(item => item.key === key)?.value;
  const names = value => list(typeof value === 'string' ? value.split('、') : (value || []).map(item => typeof item === 'string' ? item : item.v));
  return { id: `bangumi-${core.id}`, provider: 'bangumi', title: text(core.name_cn || core.name, 120), originalTitle: text(core.name, 200),
    category: 'anime', writers: [], imdb: '', year: text(core.date, 4), rating: score(core.rating?.score), ratingCount: count(core.rating?.total),
    description: text(core.summary, 10000), subtitle: '', imageUrl: imageUrl(core.images?.large || core.images?.common, 'bangumi'),
    sourceUrl: `https://bgm.tv/subject/${core.id}`, genres: [], countries: [], languages: [], premieres: list([core.date]), durations: names(info('单集片长')),
    aliases: names(info('别名')), episodeCount: count(core.eps), directors: names(info('导演')),
    credits: [], creditCount: 0, photos: [], photoCount: 0, comments: [], commentCount: 0, reviewCount: 0, honors: [], partial: false };
}

/** Public provider metadata only. Requests are bounded, deduplicated and independent of netdisk searches. */
export class CatalogDetails {
  constructor({ dataDir, discovery, fetcher = fetch, now = Date.now, ttlMs = TTL }) {
    this.file = path.resolve(dataDir, 'catalog-details.json'); this.discovery = discovery; this.fetcher = fetcher; this.now = now; this.ttlMs = ttlMs;
    this.content = new CatalogDetailContent(this, { dataDir, now });
    this.cache = new Map(); this.pending = new Map(); this.failures = new Map(); this.images = new Map();
    this.assets = new ShareThumbnails((url, signal) => {
      const provider = isDiscoveryImageUrl(url, 'douban') ? 'douban' : isDiscoveryImageUrl(url, 'bangumi') ? 'bangumi' : '';
      if (!provider) throw error('图片不存在', 404);
      return fetcher(url, { signal, redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0', Referer: provider === 'douban' ? 'https://m.douban.com/' : 'https://bgm.tv/' } });
    }, now);
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version === 3) for (const entry of (saved.entries || []).slice(-100)) {
        if (validId.test(entry?.detail?.id) && entry.at > now() - MAX_AGE && Array.isArray(entry.detail.credits) && Array.isArray(entry.detail.photos)) this.cache.set(entry.detail.id, entry);
      }
    } catch { /* Cache is optional and rebuilt from public metadata. */ }
  }
  cachedPosterSource(id) {
    const entry = this.cache.get(id), detail = entry?.detail;
    // Reuse metadata already read for this exact subject; poster requests never search titles.
    if (!detail || detail.id !== id || this.now() - entry.at >= MAX_AGE || !isDiscoveryImageUrl(detail.imageUrl, detail.provider)) return undefined;
    return { id, provider: detail.provider, title: detail.title, imageUrl: detail.imageUrl };
  }
  async json(url, signal, allowSubjectRedirect = true) {
    const bangumi = url.startsWith('https://api.bgm.tv/');
    const response = await this.fetcher(url, { signal, redirect: 'manual', headers: { Accept: 'application/json',
      'User-Agent': bangumi ? 'MistyRainVideo/1.0 (https://github.com/Sicndu/misty-rain-video)' : 'Mozilla/5.0', Referer: bangumi ? 'https://bgm.tv/' : 'https://m.douban.com/' } });
    // Douban canonicalizes a television ID from /movie/:id to /tv/:id. Follow only that
    // exact same-subject API transition, never arbitrary redirects or security/login pages.
    const movieId = url.match(/^https:\/\/m\.douban\.com\/rexxar\/api\/v2\/movie\/([1-9]\d{0,12})$/)?.[1];
    const canonicalTv = movieId ? `https://m.douban.com/rexxar/api/v2/tv/${movieId}` : '';
    if (allowSubjectRedirect && canonicalTv && [301, 302, 303, 307, 308].includes(response.status)
      && new URL(response.headers.get('location') || '', url).href === canonicalTv) {
      await response.body?.cancel();
      return this.json(canonicalTv, signal, false);
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw error('影片详情暂时不可用', response.status === 404 ? 404 : 503); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw error('影片详情响应过大'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async subjectInfo(id, signal) {
    const response = await this.fetcher(`https://www.douban.com/doubanapp//h5/movie/${id}/desc`, {
      signal, redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw error('影片资料暂时不可用'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 512 * 1024) throw error('影片资料响应过大'); chunks.push(chunk); }
    const info = parseSubjectInfo(Buffer.concat(chunks).toString('utf8'));
    if (!Object.values(info).some(value => value.length)) throw error('影片资料暂时不可用');
    return info;
  }
  async fetchDetails(id) {
    const signal = AbortSignal.timeout(10_000), number = id.split('-')[1];
    if (id.startsWith('bangumi-')) return normalizeBangumiDetails(await this.json(`https://api.bgm.tv/v0/subjects/${number}`, signal));
    // This public endpoint resolves both film and television subjects; the returned type owns subsequent module URLs.
    const core = await this.json(`https://m.douban.com/rexxar/api/v2/movie/${number}`, AbortSignal.any([signal, AbortSignal.timeout(6000)]));
    if (String(core.id) !== number || !['movie', 'tv'].includes(core.type)) throw error('影片详情暂时不可用');
    const base = `https://m.douban.com/rexxar/api/v2/${core.type}/${number}`;
    const endpoints = { credits: '/credits', photos: '/photos?type=S&start=0&count=6', comments: '/interests?count=3&order_by=hot&start=0', info: '' };
    const modules = Object.fromEntries(await Promise.all(Object.entries(endpoints).map(async ([key, suffix]) => {
      try { const moduleSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]); return [key, key === 'info' ? await this.subjectInfo(number, moduleSignal) : await this.json(base + suffix, moduleSignal)]; } catch { return [key, null]; }
    })));
    return normalizeDoubanDetails(core, modules);
  }
  persist() {
    for (const [id, entry] of this.cache) if (this.now() - entry.at >= MAX_AGE) this.cache.delete(id);
    while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 3, entries: [...this.cache.values()] }), { mode: 0o600 });
      fs.renameSync(this.file + '.tmp', this.file);
    } catch { /* Read-only/full data volume must not make live details fail. */ }
  }
  async get(id) {
    if (!validId.test(id)) throw error('影片不存在', 404);
    const cached = this.cache.get(id), age = cached ? this.now() - cached.at : Infinity;
    if (age < (cached?.detail.partial ? 60_000 : this.ttlMs)) return this.publicDetail(cached.detail, false);
    if (this.pending.has(id)) return this.pending.get(id);
    if ((this.failures.get(id) || 0) > this.now()) {
      if (age < MAX_AGE) return this.publicDetail(cached.detail, true);
      throw error('详情暂时不可用，请稍后重试');
    }
    if (this.pending.size >= 4) {
      if (age < MAX_AGE) return this.publicDetail(cached.detail, true);
      throw error('详情加载较多，请稍后重试');
    }
    const task = this.fetchDetails(id).then(detail => {
      if (detail.id !== id) throw error('影片详情暂时不可用');
      this.cache.delete(id); this.cache.set(id, { at: this.now(), detail }); this.failures.delete(id); this.persist();
      return this.publicDetail(detail, false);
    }).catch(err => {
      for (const [key, until] of this.failures) if (until <= this.now()) this.failures.delete(key);
      if (this.failures.size >= 200) this.failures.delete(this.failures.keys().next().value);
      this.failures.set(id, this.now() + 60_000);
      if (age < MAX_AGE) return this.publicDetail(cached.detail, true);
      throw err?.statusCode ? err : error('详情暂时不可用，请稍后重试');
    }).finally(() => this.pending.delete(id));
    this.pending.set(id, task); return task;
  }
  image(url, provider) {
    if (!isDiscoveryImageUrl(url, provider)) return '';
    this.assets.cleanup();
    for (const [key, value] of this.images) if (value.until <= this.now() || !this.assets.entries.has(value.id)) this.images.delete(key);
    if (!this.images.has(url)) {
      while (this.images.size >= 1000) this.images.delete(this.images.keys().next().value);
      const id = this.assets.register(url, 'catalog').split('/').pop();
      this.images.set(url, { id, until: this.now() + 9 * 60_000 });
    }
    return `/api/catalog/detail-images/${this.images.get(url).id}`;
  }
  publicDetail(detail, stale) {
    const { id, provider, title, category, year, rating, ratingCount, subtitle, sourceUrl, genres, countries, imageUrl, aliases, originalTitle } = detail;
    this.discovery?.registerCatalogItems([{ id, provider, title, category, year, rating, ratingCount, subtitle, sourceUrl, genres, countries, imageUrl,
      aliases: list([...(aliases || []), originalTitle]), description: text(detail.description, 180) }]);
    const { imageUrl: posterUrl, credits, photos, ...rest } = detail;
    return { ...rest, stale, poster: this.image(posterUrl, detail.provider),
      credits: credits.map(({ imageUrl: url, ...person }) => ({ ...person, image: this.image(url, detail.provider) })),
      photos: photos.map(({ imageUrl: url, fullImageUrl, ...photo }) => ({ ...photo, image: this.image(url, detail.provider), fullImage: this.image(fullImageUrl, detail.provider) })) };
  }
}
