import { catalogFacets } from './catalogFacets.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DISCOVERY_FEEDS, fetchDiscoveryFeed, isDiscoveryImageUrl, ratingCount } from './discoverySources.js';
import { catalogTitleRelevance } from './catalogTitle.js';

const TTL = 6 * 60 * 60_000;
const RETRY_DELAY = 15 * 60_000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });

function limiter(concurrency) {
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift(); active++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  };
  return run => new Promise((resolve, reject) => {
    if (queue.length >= 100) { reject(error('封面请求较多，请稍后重试', 503)); return; }
    queue.push({ run, resolve, reject }); drain();
  });
}

export class DiscoveryService {
  constructor({ dataDir, posterService, loadFeed = fetchDiscoveryFeed, now = Date.now, ttlMs = TTL, retryMs = RETRY_DELAY }) {
    this.filePath = path.resolve(dataDir, 'discovery-cache.json');
    this.posters = posterService; this.loadFeed = loadFeed; this.now = now; this.ttlMs = ttlMs; this.retryMs = retryMs;
    this.snapshots = {}; this.pending = new Map(); this.imagePending = new Map(); this.imageRetries = new Map();
    this.catalogItems = new Map();
    this.load = limiter(2); this.loadImage = limiter(3); this.controllers = new Set(); this.stopped = false;
    try {
      const cache = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if ([1, 2].includes(cache.version)) for (const feed of DISCOVERY_FEEDS) {
        const snapshot = cache.feeds?.[feed.id];
        if (!snapshot || !Array.isArray(snapshot.items) || !Number.isFinite(snapshot.updatedAt)) continue;
        const items = snapshot.items.filter(item => typeof item?.title === 'string' && item.title.length <= 120
          && /^(douban|bangumi)-\d{1,13}$/.test(item.id) && item.category === feed.category
          && ['douban', 'bangumi'].includes(item.provider) && item.id.startsWith(`${item.provider}-`)
          && (!item.imageUrl || isDiscoveryImageUrl(item.imageUrl, item.provider))).slice(0, feed.id === 'calendar' ? 210 : 30)
          .map(item => ({ ...item, ...catalogFacets(item), ratingCount: ratingCount(item.ratingCount), rating: typeof item.rating === 'number' && item.rating > 0 && item.rating <= 10 ? item.rating : null,
            year: /^(19|20)\d{2}$/.test(String(item.year || '')) ? String(item.year) : '',
            subtitle: typeof item.subtitle === 'string' ? item.subtitle.slice(0, 60) : '',
            description: typeof item.description === 'string' ? item.description.slice(0, 180) : '',
            sourceUrl: item.provider === 'douban' ? `https://movie.douban.com/subject/${item.id.slice(7)}/` : `https://bgm.tv/subject/${item.id.slice(8)}` }));
        if (items.length || snapshot.failed) this.snapshots[feed.id] = { items, updatedAt: snapshot.updatedAt,
          needsRefresh: cache.version === 1 || Boolean(snapshot.needsRefresh), retryAt: Number(snapshot.retryAt) || 0, failed: Boolean(snapshot.failed) };
      }
    } catch { /* A missing or corrupt cache is rebuilt from the providers. */ }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 2, feeds: this.snapshots }), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  #refresh(feed) {
    if (this.pending.has(feed.id)) return this.pending.get(feed.id);
    const snapshot = this.snapshots[feed.id];
    if (this.stopped || (snapshot?.retryAt > this.now()) || (snapshot?.items.length && !snapshot.needsRefresh && this.now() - snapshot.updatedAt < this.ttlMs)) return Promise.resolve();
    const task = this.load(async () => {
      if (this.stopped) return;
      const controller = new AbortController(); this.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 8_000); timer.unref?.();
      try {
        const items = await this.loadFeed(feed, { signal: controller.signal });
        if (this.stopped) return;
        if (!Array.isArray(items) || !items.length) throw new Error('DISCOVERY_EMPTY_RESPONSE');
        this.snapshots[feed.id] = { items, updatedAt: this.now(), retryAt: 0, failed: false };
      } catch {
        if (!this.stopped) this.snapshots[feed.id] = { items: snapshot?.items || [], updatedAt: snapshot?.updatedAt || 0, needsRefresh: Boolean(snapshot?.needsRefresh),
          retryAt: this.now() + this.retryMs, failed: true };
      } finally { clearTimeout(timer); this.controllers.delete(controller); }
      if (!this.stopped) this.#save();
    }).catch(() => {}).finally(() => this.pending.delete(feed.id));
    this.pending.set(feed.id, task);
    return task;
  }

  async get(category = 'all') {
    if (!['all', 'tv', 'movie', 'anime', 'variety'].includes(category)) throw error('分类无效', 400);
    const feeds = DISCOVERY_FEEDS.filter(feed => category === 'all' ? feed.id !== 'calendar' : feed.category === category);
    const work = feeds.map(feed => this.#refresh(feed));
    if (!feeds.some(feed => this.snapshots[feed.id]?.items.length)) await Promise.race([Promise.all(work), delay(300)]);
    return { sections: feeds.map(feed => {
      const snapshot = this.snapshots[feed.id];
      return { id: feed.id, category: feed.category, title: feed.title, source: feed.source,
        sourceUrl: feed.collection ? `https://m.douban.com/subject_collection/${feed.collection}` : 'https://bgm.tv/calendar',
        updatedAt: snapshot?.updatedAt ? new Date(snapshot.updatedAt).toISOString() : '',
        stale: Boolean(snapshot?.items.length && (snapshot.needsRefresh || this.now() - snapshot.updatedAt >= this.ttlMs)),
        refreshing: this.pending.has(feed.id), failed: Boolean(snapshot?.failed),
        items: (snapshot?.items || []).map(({ imageUrl, ...item }) => ({ ...item,
          poster: imageUrl ? `/api/discovery/posters/${item.id}` : '' })) };
    }) };
  }

  registerCatalogItems(items) {
    for (const item of items) {
      this.catalogItems.delete(item.id); this.catalogItems.set(item.id, item);
      if (this.catalogItems.size > 2000) this.catalogItems.delete(this.catalogItems.keys().next().value);
    }
  }

  matchingCatalogItems(query) {
    return [...this.catalogItems.values(), ...Object.values(this.snapshots).flatMap(snapshot => snapshot.items)]
      .filter(item => item.provider === 'douban' && catalogTitleRelevance(query, item) > 0);
  }

  async poster(id, preferredSource) {
    if (!/^(douban|bangumi)-\d{1,13}$/.test(id)) throw error('封面不存在', 404);
    const cached = this.posters.catalogPoster(id);
    if (preferredSource && preferredSource.id !== id) throw error('封面身份不匹配', 400);
    if (cached && !preferredSource) return cached;
    if (this.imagePending.has(id)) return this.imagePending.get(id);
    const item = preferredSource || this.catalogItems.get(id) || Object.values(this.snapshots).flatMap(snapshot => snapshot.items).find(item => item.id === id && item.imageUrl);
    if (!item) throw error('封面不存在', 404);
    if (!cached && (this.imageRetries.get(id) || 0) > this.now()) throw error('封面暂时不可用', 503);
    const task = this.loadImage(() => { if (this.stopped) throw error('服务正在重启', 503); return this.posters.resolveCatalogPoster(item, { preferSource: Boolean(preferredSource) }); })
      .catch(() => {
        for (const [key, until] of this.imageRetries) if (until <= this.now()) this.imageRetries.delete(key);
        if (this.imageRetries.size >= 1000) this.imageRetries.delete(this.imageRetries.keys().next().value);
        this.imageRetries.set(id, this.now() + 60_000); throw error('封面暂时不可用', 503);
      })
      .finally(() => this.imagePending.delete(id));
    this.imagePending.set(id, task);
    return task;
  }

  start() {
    if (this.timer) return;
    this.stopped = false;
    const refresh = () => { for (const feed of DISCOVERY_FEEDS) void this.#refresh(feed); };
    this.timer = setInterval(refresh, 60_000); this.timer.unref?.();
    refresh();
  }
  stop() {
    this.stopped = true; clearInterval(this.timer); this.timer = null;
    for (const controller of this.controllers) controller.abort();
  }
}
