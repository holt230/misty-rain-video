import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const CHANNELS = {
  tv: { type: 'tv', category: 'tv', tag: '热门', mediaCategory: 'tv' },
  movie: { type: 'movie', category: '热门', tag: '热门', mediaCategory: 'movie' },
  anime: { type: 'tv', category: 'tv', filter: 'tv_animation', tag: '日本动画', mediaCategory: 'anime' },
  variety: { type: 'tv', category: 'show', tag: '综艺', mediaCategory: 'variety' },
  new: { type: 'movie', category: '最新', tag: '最新', mediaCategory: 'movie' }
};
const TTL = 6 * 60 * 60_000;
const RETRY = 60_000;
const clean = (value, length = 240) => String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, length);
const imageHost = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^[a-z0-9-]+\.doubanio\.com$/.test(url.hostname) && !url.port && !url.username && !url.password;
  } catch { return false; }
};

export function normalizeCatalog(rows, channel) {
  const config = CHANNELS[channel];
  const seen = new Set();
  return rows.flatMap(row => {
    const id = clean(row.id, 30);
    const title = clean(row.title, 160);
    if (row.type && row.type !== config.type) return [];
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
  }).slice(0, 24);
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
    this.ready = this.load();
  }

  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.mkdir(path.join(this.directory, 'works'), { recursive: true });
    for (const channel of Object.keys(CHANNELS)) {
      try {
        const value = JSON.parse(await fs.readFile(path.join(this.directory, channel + '.json'), 'utf8'));
        if (value.version === 1 && Array.isArray(value.items) && value.items.length && Number.isFinite(Date.parse(value.updatedAt))) {
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

  async refresh(channel) {
    if (this.pending.has(channel)) return this.pending.get(channel);
    const task = (async () => {
      const config = CHANNELS[channel];
      try {
        const params = new URLSearchParams({ start: '0', limit: '24', category: config.category, sort: 'recommend' });
        if (config.filter) params.set('type', config.filter);
        let items;
        try {
          const data = await this.json('https://m.douban.com/rexxar/api/v2/subject/recent_hot/' + config.type + '?' + params);
          items = normalizeCatalog(Array.isArray(data.items) ? data.items : [], channel);
          if (!items.length) throw new Error('目录为空');
        } catch {
          const params = new URLSearchParams({ type: config.type, tag: config.tag, sort: 'recommend', page_limit: '24', page_start: '0' });
          const data = await this.json('https://movie.douban.com/j/search_subjects?' + params);
          items = normalizeCatalog(Array.isArray(data.subjects) ? data.subjects : [], channel);
          // The legacy anime feed covers Japanese animation only; retain that provenance in the subtitle.
          if (channel === 'anime') items = items.map(item => ({ ...item, subtitle: item.subtitle || '日本动画 · 豆瓣分类' }));
        }
        if (!items.length) throw new Error('目录为空');
        // Keep artwork addresses for films already saved by a user after they leave a popular feed.
        await Promise.all(items.map(item => fs.writeFile(path.join(this.directory, 'works', item.catalogId.slice(7) + '.json'), JSON.stringify({ posterUrl: item.posterUrl }))));
        const feed = { version: 1, channel, items, updatedAt: new Date(this.now()).toISOString() };
        const file = path.join(this.directory, channel + '.json');
        await fs.writeFile(file + '.tmp', JSON.stringify(feed));
        await fs.rename(file + '.tmp', file);
        this.feeds.set(channel, feed);
        this.failures.delete(channel);
      } catch {
        this.failures.set(channel, this.now());
      }
    })().finally(() => this.pending.delete(channel));
    this.pending.set(channel, task);
    return task;
  }

  async get(channel) {
    if (!Object.hasOwn(CHANNELS, channel)) throw Object.assign(new Error('未知的影视频道'), { statusCode: 400 });
    await this.ready;
    const cached = this.feeds.get(channel);
    const stale = !cached || this.now() - Date.parse(cached.updatedAt) > TTL;
    const failure = this.failures.get(channel);
    if (stale && (failure === undefined || this.now() - failure >= RETRY)) {
      if (cached) void this.refresh(channel);
      else await this.refresh(channel);
    }
    const feed = this.feeds.get(channel);
    return {
      channel,
      items: (feed?.items || []).map(({ posterUrl, ...item }) => item),
      updatedAt: feed?.updatedAt || '',
      stale: !feed || this.now() - Date.parse(feed.updatedAt) > TTL,
      refreshing: this.pending.has(channel),
      message: this.failures.has(channel)
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

  async poster(id) {
    await this.ready;
    if (!/^\d{1,20}$/.test(id)) return null;
    let item = [...this.feeds.values()].flatMap(feed => feed.items).find(item => item.catalogId === 'douban:' + id);
    if (!item) {
      try { item = JSON.parse(await fs.readFile(path.join(this.directory, 'works', id + '.json'), 'utf8')); } catch { return null; }
    }
    if (!item || !imageHost(item.posterUrl)) return null;
    const key = crypto.createHash('sha256').update(item.posterUrl).digest('hex').slice(0, 32);
    if (this.images.has(key)) return this.images.get(key);
    const file = path.join(this.directory, key + '.jpg');
    try {
      const buffer = await fs.readFile(file);
      return { buffer, contentType: 'image/jpeg' };
    } catch { /* Fetch only catalog-owned images; never accept a caller-provided URL. */ }
    while (this.images.size >= 4) await Promise.race(this.images.values());
    if (this.images.has(key)) return this.images.get(key);
    const task = (async () => {
      const response = await this.fetcher(item.posterUrl, {
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
      // Bound the disk cache as popular works rotate.
      const files = (await fs.readdir(this.directory)).filter(name => /^[a-f0-9]{32}\.jpg$/.test(name));
      if (files.length > 200) {
        const current = new Set([...this.feeds.values()].flatMap(feed => feed.items).map(item => crypto.createHash('sha256').update(item.posterUrl || '').digest('hex').slice(0, 32) + '.jpg'));
        await Promise.all(files.filter(name => !current.has(name)).map(name => fs.unlink(path.join(this.directory, name)).catch(() => {})));
      }
      return { buffer, contentType };
    })().catch(() => null).finally(() => this.images.delete(key));
    this.images.set(key, task);
    return task;
  }
}
