import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CatalogDetailsService, catalogImageHost } from './catalogDetails.js';

const CHANNELS = {
  tv: { type: 'tv', category: 'tv', tag: '热门', mediaCategory: 'tv' },
  movie: { type: 'movie', category: '热门', tag: '热门', mediaCategory: 'movie' },
  anime: { type: 'tv', category: 'tv', filter: 'tv_animation', tag: '日本动画', mediaCategory: 'anime' },
  variety: { type: 'tv', category: 'show', tag: '综艺', mediaCategory: 'variety' },
  new: { type: 'movie', category: '最新', tag: '最新', mediaCategory: 'movie' }
};
const TTL = 6 * 60 * 60_000;
const RETRY = 60_000;
const PAGE_SIZE = 24;
const MAX_PAGES = 50;
const pageKey = (channel, page, revision = '') => page === 1 ? channel : channel + '-' + revision + '-' + page;
const validatePage = (channel, page) => {
  if (!Object.hasOwn(CHANNELS, channel)) throw Object.assign(new Error('未知的影视频道'), { statusCode: 400 });
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGES) throw Object.assign(new Error('无效的目录分页'), { statusCode: 400 });
};
const changed = () => Object.assign(new Error('目录已有更新，请重新加载此频道后继续浏览'), { statusCode: 409, code: 'CATALOG_CHANGED' });
const clean = (value, length = 240) => String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, length);
const imageHost = catalogImageHost;

export function normalizeCatalog(rows, channel) {
  const config = CHANNELS[channel];
  const seen = new Set();
  return rows.flatMap(row => {
    const id = clean(row?.id, 30);
    const title = clean(row?.title, 160);
    if (row?.type && row.type !== config.type) return [];
    if (!/^\d{1,20}$/.test(id) || !title || seen.has(id)) return [];
    seen.add(id);
    const subtitle = clean(row.card_subtitle);
    const posterUrl = row.pic?.large || row.pic?.normal || row.cover || '';
    const rating = Number(row.rating?.value ?? row.rate);
    return [{
      id: 'douban:' + id, catalogId: 'douban:' + id, title,
      category: config.mediaCategory, tag: '', poster: '/api/catalog/posters/' + id,
      posterUrl: imageHost(posterUrl) ? posterUrl : '',
      year: subtitle.match(/^(?:19|20)\d{2}/)?.[0] || '',
      subtitle, desc: subtitle, status: clean(row.episodes_info, 60),
      rating: rating > 0 && rating <= 10 ? rating : undefined,
      sourceName: '豆瓣', sourceUrl: 'https://movie.douban.com/subject/' + id + '/'
    }];
  }).slice(0, PAGE_SIZE);
}

/** Public metadata is shared; no user credentials, library or playback state enter this cache. */
export class CatalogService {
  constructor(dataDir, { fetcher = fetch, now = Date.now } = {}) {
    this.directory = path.join(dataDir, 'catalog');
    this.fetcher = fetcher;
    this.now = now;
    this.feeds = new Map();
    this.pending = new Map();
    this.failures = new Map();
    this.images = new Map();
    this.details = new CatalogDetailsService(this.directory, { fetcher, now });
    this.ready = this.load();
  }

  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.mkdir(path.join(this.directory, 'works'), { recursive: true });
    await fs.mkdir(path.join(this.directory, 'pages'), { recursive: true });
    for (const channel of Object.keys(CHANNELS)) {
      try {
        const value = JSON.parse(await fs.readFile(path.join(this.directory, channel + '.json'), 'utf8'));
        if ([1, 2].includes(value.version) && Array.isArray(value.items) && Number.isFinite(Date.parse(value.updatedAt))) {
          this.feeds.set(channel, value);
        }
      } catch { /* First launch and invalid snapshots are refreshed on demand. */ }
    }
  }

  async json(url) {
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'MistyRainVideo/1.0', Referer: 'https://movie.douban.com/' },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) throw new Error('目录来源暂时不可用');
    return response.json();
  }

  async fetchPage(channel, page, provider) {
    const config = CHANNELS[channel];
    const start = (page - 1) * PAGE_SIZE;
    const fetchFrom = async source => {
      const params = source === 'primary'
        ? new URLSearchParams({ start: String(start), limit: String(PAGE_SIZE), category: config.category, sort: 'recommend' })
        : new URLSearchParams({ type: config.type, tag: config.tag, sort: 'recommend', page_limit: String(PAGE_SIZE), page_start: String(start) });
      if (source === 'primary' && config.filter) params.set('type', config.filter);
      const data = await this.json(source === 'primary'
        ? 'https://m.douban.com/rexxar/api/v2/subject/recent_hot/' + config.type + '?' + params
        : 'https://movie.douban.com/j/search_subjects?' + params);
      const rows = source === 'primary' ? data.items : data.subjects;
      if (!Array.isArray(rows)) throw new Error('目录数据无效');
      let items = normalizeCatalog(rows, channel);
      if ((rows.length && !items.length) || (page === 1 && !items.length && data.total !== 0)) throw new Error('目录为空');
      if (source === 'legacy' && channel === 'anime') items = items.map(item => ({ ...item, subtitle: item.subtitle || '日本动画 · 豆瓣分类' }));
      const total = Number.isSafeInteger(data.total) && data.total >= 0 ? data.total : undefined;
      return { items, source, total, hasMore: page < MAX_PAGES && rows.length >= PAGE_SIZE && (total === undefined || start + rows.length < total) };
    };
    if (provider) return fetchFrom(provider);
    try { return await fetchFrom('primary'); } catch { return fetchFrom('legacy'); }
  }

  async refresh(channel, page = 1) {
    validatePage(channel, page);
    const parent = this.feeds.get(channel);
    const revision = page > 1 ? parent?.revision : '';
    const key = pageKey(channel, page, revision);
    if (this.pending.has(key)) return this.pending.get(key);
    const task = (async () => {
      try {
        if (page > 1 && !parent?.source) throw new Error('目录尚未就绪');
        const result = await this.fetchPage(channel, page, page > 1 ? parent.source : undefined);
        if (page > 1 && this.feeds.get(channel)?.revision !== revision) throw changed();
        const { items } = result;
        if (page > 1 && items.length && items.every(item => parent.items.some(first => first.id === item.id))) result.hasMore = false;
        // Keep artwork addresses for films already saved by a user after they leave a popular feed.
        await Promise.all(items.map(item => fs.writeFile(path.join(this.directory, 'works', item.catalogId.slice(7) + '.json'), JSON.stringify({
          posterUrl: item.posterUrl, title: item.title, category: item.category, year: item.year
        }))));
        const feed = { version: 2, channel, page, ...result, updatedAt: new Date(this.now()).toISOString(),
          revision: revision || crypto.createHash('sha256').update(JSON.stringify([result.source, items.map(item => item.id)])).digest('hex').slice(0, 16) };
        const file = page === 1 ? path.join(this.directory, channel + '.json') : path.join(this.directory, 'pages', channel + '-' + page + '.json');
        const temporary = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
        await fs.writeFile(temporary, JSON.stringify(feed));
        await fs.rename(temporary, file);
        if (page > 1 && this.feeds.get(channel)?.revision !== revision) throw changed();
        this.feeds.set(key, feed);
        this.failures.delete(key);
        if (page === 1 && parent?.revision !== feed.revision) {
          for (const old of this.feeds.keys()) if (old.startsWith(channel + '-')) this.feeds.delete(old);
          for (const old of this.failures.keys()) if (old.startsWith(channel + '-')) this.failures.delete(old);
        }
      } catch {
        if (page === 1 || this.feeds.get(channel)?.revision === revision) this.failures.set(key, this.now());
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  async get(channel, page = 1, expectedRevision = '') {
    validatePage(channel, page);
    if (expectedRevision && !/^[a-f0-9]{16}$/.test(expectedRevision)) throw Object.assign(new Error('无效的目录版本'), { statusCode: 400 });
    await this.ready;
    let parent;
    if (page > 1) {
      await this.get(channel);
      if (!this.feeds.get(channel)?.source && this.pending.has(channel)) await this.pending.get(channel);
      parent = this.feeds.get(channel);
      if (!parent?.source) throw Object.assign(new Error('目录暂时无法更新，请稍后再试'), { statusCode: 503 });
      if (expectedRevision && parent.revision !== expectedRevision) throw changed();
    }
    const key = pageKey(channel, page, parent?.revision);
    if (page > 1 && !this.feeds.has(key)) {
      try {
        const disk = JSON.parse(await fs.readFile(path.join(this.directory, 'pages', channel + '-' + page + '.json'), 'utf8'));
        if (disk.version === 2 && disk.channel === channel && disk.page === page && disk.revision === parent.revision && Array.isArray(disk.items) && Number.isFinite(Date.parse(disk.updatedAt))) this.feeds.set(key, disk);
      } catch { /* Later pages load on demand. */ }
    }
    let cached = this.feeds.get(key);
    if (page > 1 && cached && cached.revision !== parent.revision) { this.feeds.delete(key); this.failures.delete(key); cached = undefined; }
    const stale = !cached || cached.version !== 2 || this.now() - Date.parse(cached.updatedAt) >= TTL;
    const failure = this.failures.get(key);
    if (stale && (failure === undefined || this.now() - failure >= RETRY)) {
      if (cached) void this.refresh(channel, page);
      else await this.refresh(channel, page);
    }
    if (page > 1 && this.feeds.get(channel)?.revision !== parent.revision) throw changed();
    const feed = this.feeds.get(key);
    return {
      channel, page, pageSize: PAGE_SIZE,
      items: (feed?.items || []).map(({ posterUrl, ...item }) => item),
      revision: feed?.revision || (feed ? crypto.createHash('sha256').update(feed.updatedAt).digest('hex').slice(0, 16) : ''), hasMore: feed?.hasMore ?? true, total: feed?.total,
      updatedAt: feed?.updatedAt || '',
      stale: !feed || feed.version !== 2 || this.now() - Date.parse(feed.updatedAt) >= TTL,
      refreshing: this.pending.has(key), loadError: !feed && this.failures.has(key),
      message: this.failures.has(key)
        ? feed ? '来源暂未更新，展示上次获取的内容' : '暂时无法获取此频道，请稍后重试，也可以直接搜索影片'
        : stale && cached ? '正在更新目录，先展示上次内容' : ''
    };
  }

  start() {
    const warm = async () => {
      for (const channel of Object.keys(CHANNELS)) await this.get(channel).catch(() => {});
    };
    this.startTimer = setTimeout(() => { void warm(); }, 5_000);
    this.startTimer.unref?.();
    this.timer = setInterval(() => { void warm(); }, TTL);
    this.timer.unref?.();
  }

  stop() { clearTimeout(this.startTimer); clearInterval(this.timer); }

  async workItem(id) {
    await this.ready;
    if (!/^\d{1,20}$/.test(id)) return null;
    let item = [...this.feeds.values()].flatMap(feed => feed.items).find(item => item.catalogId === 'douban:' + id);
    if (!item) {
      try { item = JSON.parse(await fs.readFile(path.join(this.directory, 'works', id + '.json'), 'utf8')); } catch { return null; }
    }
    return item || null;
  }

  async detail(id, category) { return this.details.work(id, await this.workItem(id), category); }
  async comments(id, category, start) { return this.details.comments(id, await this.workItem(id), category, start); }
  async person(id) { return this.details.person(id); }
  async portrait(id) { return this.image((await this.details.personSeed(id))?.photoUrl); }
  async poster(id) { return this.image((await this.workItem(id))?.posterUrl); }

  async image(url) {
    if (!imageHost(url)) return null;
    const key = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
    if (this.images.has(key)) return this.images.get(key);
    const file = path.join(this.directory, key + '.jpg');
    try {
      const buffer = await fs.readFile(file);
      return { buffer, contentType: 'image/jpeg' };
    } catch { /* Fetch only catalog-owned images; never accept a caller-provided URL. */ }
    while (this.images.size >= 4) await Promise.race(this.images.values());
    if (this.images.has(key)) return this.images.get(key);
    const task = (async () => {
      const response = await this.fetcher(url, {
        redirect: 'error',
        headers: { 'User-Agent': 'MistyRainVideo/1.0', Referer: 'https://movie.douban.com/', Accept: 'image/jpeg' },
        signal: AbortSignal.timeout(8_000)
      });
      const contentType = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || contentType !== 'image/jpeg' || !response.body) return null;
      if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) return null;
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 4 * 1024 * 1024) { await reader.cancel(); return null; }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const buffer = Buffer.concat(chunks);
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
      await fs.writeFile(file, buffer);
      // Artwork and portraits share a bounded cache, without evicting the image just written.
      const files = (await fs.readdir(this.directory)).filter(name => /^[a-f0-9]{32}\.jpg$/.test(name));
      if (files.length > 200) {
        const old = await Promise.all(files.filter(name => name !== key + '.jpg').map(async name => ({ name, time: (await fs.stat(path.join(this.directory, name)).catch(() => ({ mtimeMs: 0 }))).mtimeMs })));
        old.sort((a, b) => a.time - b.time);
        await Promise.all(old.slice(0, files.length - 200).map(({ name }) => fs.unlink(path.join(this.directory, name)).catch(() => {})));
      }
      return { buffer, contentType };
    })().catch(() => null).finally(() => this.images.delete(key));
    this.images.set(key, task);
    return task;
  }
}
