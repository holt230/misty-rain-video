import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CatalogService } from './catalog.js';
import { OfficialCatalogProviders } from './officialCatalogProviders.js';
import { PLATFORM_NAMES, CATALOG_CHANNELS, cleanText, titleKey } from './officialCatalogData.js';

const TTL = 60 * 60_000, RETRY = 60_000, PAGE_SIZE = 24;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const changed = () => Object.assign(new Error('目录已有更新，请重新加载后继续浏览'), { statusCode: 409, code: 'CATALOG_CHANGED' });
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
const validate = (channel, page, revision, platform) => {
  if (!CATALOG_CHANNELS.includes(channel)) throw invalid('未知的影视频道');
  if (!Number.isInteger(page) || page < 1 || page > 50) throw invalid('无效的目录分页');
  if (revision && !/^[a-f0-9]{16}$/.test(revision)) throw invalid('无效的目录版本');
  if (platform !== 'all' && !Object.hasOwn(PLATFORM_NAMES, platform)) throw invalid('未知的影视平台');
};

/** Different release years remain distinct; unknown years merge only when the edition is unambiguous. */
export function mergeOfficialCatalog(groups) {
  const buckets = new Map();
  for (const rows of groups) for (const row of rows) {
    const key = row.category + ':' + titleKey(row.title);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const merged = [];
  for (const rows of buckets.values()) {
    const years = [...new Set(rows.map(row => row.year).filter(Boolean))];
    const editions = new Map();
    for (const row of rows) {
      const year = row.year || (years.length === 1 ? years[0] : '');
      if (!editions.has(year)) editions.set(year, []);
      editions.get(year).push(row);
    }
    for (const [year, versions] of editions) {
      const primary = [...versions].sort((a, b) => Number(Boolean(b.year)) - Number(Boolean(a.year))
        || Number(Boolean(b.actors?.length)) - Number(Boolean(a.actors?.length)))[0];
      const catalogId = 'work:' + hash([primary.category, titleKey(primary.title), year]).slice(0, 24);
      const sources = [...new Map(versions.map(row => [row.platform, { id: row.platform, name: PLATFORM_NAMES[row.platform],
        catalogId: row.catalogId, url: row.sourceUrl, providerId: row.providerId, videoId: row.videoId || '' }])).values()];
      merged.push({ ...primary, id: catalogId, catalogId, year, catalogAliases: versions.map(row => row.catalogId),
        platforms: sources, sourceName: sources.map(source => source.name).join(' · '), sourceUrl: primary.sourceUrl,
        poster: '/api/catalog/posters/' + encodeURIComponent(catalogId),
        backdrop: '/api/catalog/posters/' + encodeURIComponent(catalogId) + '?kind=backdrop',
        posterUrl: versions.map(row => row.posterUrl).find(Boolean) || '', backdropUrl: versions.map(row => row.backdropUrl).find(Boolean) || '',
        order: Math.min(...versions.map(row => row.order || 0)) });
    }
  }
  // Use each platform's rank position, never compare incompatible heat/score numbers.
  return merged.sort((a, b) => a.order - b.order || b.platforms.length - a.platforms.length || a.catalogId.localeCompare(b.catalogId));
}

export class OfficialCatalogService extends CatalogService {
  constructor(dataDir, options = {}) {
    super(dataDir, options);
    this.officialDirectory = path.join(this.directory, 'official');
    this.providers = options.providers || new OfficialCatalogProviders({ fetcher: this.fetcher });
    this.platformFeeds = new Map(); this.platformPending = new Map(); this.platformFailures = new Map();
    this.officialWorks = new Map(); this.detailPending = new Map(); this.detailSeeds = new Map();
    this.officialReady = this.loadOfficial();
  }
  async loadOfficial() {
    await this.ready;
    await fs.mkdir(path.join(this.officialDirectory, 'works'), { recursive: true });
    for (const platform of Object.keys(PLATFORM_NAMES)) for (const channel of CATALOG_CHANNELS) {
      const key = platform + '-' + channel;
      try {
        const feed = JSON.parse(await fs.readFile(path.join(this.officialDirectory, key + '.json'), 'utf8'));
        if (feed.version === 1 && feed.platform === platform && feed.channel === channel && Array.isArray(feed.items)
          && Number.isFinite(Date.parse(feed.updatedAt))) this.platformFeeds.set(key, feed);
      } catch { /* First load has no previous snapshot. */ }
    }
  }
  async writeOfficial(file, value) {
    const destination = path.join(this.officialDirectory, file + '.json');
    const temporary = destination + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(value));
    await fs.rename(temporary, destination);
  }
  async refreshPlatform(platform, channel) {
    const key = platform + '-' + channel;
    if (this.platformPending.has(key)) return this.platformPending.get(key);
    const task = (async () => {
      try {
        const items = (await this.providers.fetch(platform, channel)).map((row, order) => ({ ...row, order }));
        const feed = { version: 1, platform, channel, items, updatedAt: new Date(this.now()).toISOString() };
        await this.writeOfficial(key, feed); this.platformFeeds.set(key, feed); this.platformFailures.delete(key);
      } catch (error) {
        this.platformFailures.set(key, { at: this.now(), message: cleanText(error.message, 100) });
      }
    })().finally(() => this.platformPending.delete(key));
    this.platformPending.set(key, task); return task;
  }
  async platformFeed(platform, channel) {
    const key = platform + '-' + channel, cached = this.platformFeeds.get(key), failure = this.platformFailures.get(key);
    if ((!cached || this.now() - Date.parse(cached.updatedAt) >= TTL) && (!failure || this.now() - failure.at >= RETRY)) {
      if (cached) void this.refreshPlatform(platform, channel); else await this.refreshPlatform(platform, channel);
    }
    const feed = this.platformFeeds.get(key), failed = this.platformFailures.get(key);
    return { items: feed?.items || [], source: { id: platform, name: PLATFORM_NAMES[platform],
      status: failed ? 'unavailable' : !feed ? 'unavailable' : this.now() - Date.parse(feed.updatedAt) >= TTL ? 'stale' : 'success',
      count: feed?.items.length || 0, updatedAt: feed?.updatedAt || '', refreshing: this.platformPending.has(key) } };
  }
  async get(channel, page = 1, revision = '', platform = 'all') {
    validate(channel, page, revision, platform); await this.officialReady;
    const ids = platform === 'all' ? Object.keys(PLATFORM_NAMES) : [platform];
    const groups = await Promise.all(ids.map(id => this.platformFeed(id, channel)));
    const works = mergeOfficialCatalog(groups.map(group => group.items));
    const filtered = platform === 'all' ? works : works.filter(item => item.platforms.some(source => source.id === platform));
    const currentRevision = hash([channel, platform, filtered.map(item => [item.catalogId, item.catalogAliases, item.status, item.posterUrl])]).slice(0, 16);
    if (revision && currentRevision !== revision) throw changed();
    const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    await Promise.all(items.map(async item => {
      this.officialWorks.set(item.catalogId, item);
      await this.writeOfficial('works/' + item.catalogId.slice(5), item);
    }));
    while (this.officialWorks.size > 1000) this.officialWorks.delete(this.officialWorks.keys().next().value);
    const sources = groups.map(group => group.source).filter(source => platform === 'all' || source.id === platform);
    const available = sources.filter(source => source.updatedAt), stale = sources.some(source => source.status !== 'success');
    return { channel, platform, page, pageSize: PAGE_SIZE, revision: currentRevision, hasMore: page * PAGE_SIZE < filtered.length,
      total: filtered.length, items: items.map(({ posterUrl, backdropUrl, order, providerId, videoId, platform: provider, ...item }) => item),
      sources, updatedAt: available.map(source => source.updatedAt).sort()[0] || '', stale,
      refreshing: sources.some(source => source.refreshing), loadError: !available.length,
      sourceName: platform === 'all' ? '四平台片单' : PLATFORM_NAMES[platform],
      message: !available.length ? '此平台片单暂时无法获取，请稍后重试。'
        : !filtered.length ? channel === 'new' ? '当前公开片单暂未提供可确认上映时间的新片，可切换平台查看。' : '当前公开片单暂无此类型的作品。'
        : stale ? '部分平台暂未更新，已标注各平台获取状态。' : '' };
  }
  async workItem(id) {
    if (/^(?:douban:)?\d{1,20}$/.test(id)) return super.workItem(id.replace(/^douban:/, ''));
    if (!/^work:[a-f0-9]{24}$/.test(id)) return null;
    await this.officialReady;
    if (this.officialWorks.has(id)) return this.officialWorks.get(id);
    try {
      const item = JSON.parse(await fs.readFile(path.join(this.officialDirectory, 'works', id.slice(5) + '.json'), 'utf8'));
      if (item.catalogId !== id || !Array.isArray(item.platforms)) return null;
      this.officialWorks.set(id, item); return item;
    } catch { return null; }
  }
  async poster(id, kind = 'poster') {
    const item = await this.workItem(id);
    return this.image(kind === 'backdrop' ? item?.backdropUrl || item?.posterUrl : item?.posterUrl);
  }
  async supplement(item) {
    const cachedSeed = this.detailSeeds.get(item.catalogId);
    if (cachedSeed && this.now() - cachedSeed.at < cachedSeed.ttl) return cachedSeed.value;
    if (this.detailPending.has(item.catalogId)) return this.detailPending.get(item.catalogId);
    const task = (async () => {
      let resolved = item, partial = false;
      try { resolved = { ...item, ...await this.providers.metadata(item) }; } catch { partial = true; /* Metadata absence must not become a wrong edition match. */ }
      let doubanId = '';
      if (resolved.year) {
        const cached = [...this.feeds.values()].flatMap(feed => feed.items || []).filter(row => titleKey(row.title) === titleKey(resolved.title)
          && row.category === resolved.category && row.year === resolved.year);
        if (new Set(cached.map(row => row.catalogId)).size === 1) doubanId = cached[0].catalogId.slice(7);
        if (!doubanId) try {
          const rows = await this.providers.request('https://movie.douban.com/j/subject_suggest?' + new URLSearchParams({ q: resolved.title }), 'json');
          const exact = Array.isArray(rows) ? rows.filter(row => titleKey(row.title) === titleKey(resolved.title)
            && String(row.year) === resolved.year && /^\d{1,20}$/.test(String(row.id))
            && (resolved.category === 'movie' ? !Number(row.episode) : Number(row.episode) > 0)) : [];
          if (exact.length === 1) doubanId = String(exact[0].id);
        } catch { partial = true; /* Optional enrichment has its own source label. */ }
      }
      const result = { ...resolved, doubanId };
      if (doubanId) result.catalogAliases = [...new Set([...(item.catalogAliases || []), 'douban:' + doubanId])];
      this.detailSeeds.set(item.catalogId, { at: this.now(), ttl: partial ? RETRY : 24 * TTL, value: result });
      while (this.detailSeeds.size > 256) this.detailSeeds.delete(this.detailSeeds.keys().next().value);
      return result;
    })().finally(() => this.detailPending.delete(item.catalogId));
    this.detailPending.set(item.catalogId, task); return task;
  }
  async detail(id, category) {
    if (/^(?:douban:)?\d{1,20}$/.test(id)) return super.detail(id.replace(/^douban:/, ''), category);
    const item = await this.workItem(id);
    if (!item || item.category !== category) throw Object.assign(new Error('未找到影片资料'), { statusCode: 404 });
    const resolved = await this.supplement(item);
    const base = { catalogId: id, catalogAliases: resolved.catalogAliases, title: resolved.title, year: resolved.year,
      summary: resolved.summary || resolved.subtitle, genres: resolved.genres || [], countries: [], languages: [], releaseDates: resolved.releaseDate ? [resolved.releaseDate] : [],
      durations: [], directors: resolved.directors || [], actors: resolved.actors || [], updatedAt: new Date(this.now()).toISOString(),
      stale: false, refreshing: false, message: '', sourceName: resolved.sourceName, sourceUrl: resolved.sourceUrl };
    if (!resolved.doubanId) return { ...base, message: !base.actors.length ? '部分演职员资料暂未确认，已展示平台提供的介绍。' : '' };
    const extra = await this.details.work(resolved.doubanId, resolved, category);
    return { ...base, ...extra, catalogId: id, catalogAliases: resolved.catalogAliases, title: resolved.title, year: resolved.year,
      summary: extra.summary || base.summary, actors: extra.actors.length ? extra.actors : base.actors,
      directors: extra.directors.length ? extra.directors : base.directors };
  }
  async comments(id, category, start = 0) {
    if (/^(?:douban:)?\d{1,20}$/.test(id)) return super.comments(id.replace(/^douban:/, ''), category, start);
    if (!Number.isInteger(start) || start < 0 || start > 90 || start % 10) throw invalid('无效的短评分页');
    const item = await this.workItem(id);
    if (!item || item.category !== category) throw Object.assign(new Error('未找到影片资料'), { statusCode: 404 });
    const resolved = await this.supplement(item);
    if (!resolved.doubanId) return { catalogId: id, start, total: 0, items: [], hasMore: false, sourceName: '豆瓣',
      sourceUrl: '', updatedAt: new Date(this.now()).toISOString(), stale: false, refreshing: false,
      message: '暂未确认对应版本的短评，已保留影片介绍和找源入口。' };
    return { ...await this.details.comments(resolved.doubanId, resolved, category, start), catalogId: id };
  }
  async knownPlatforms(keyword, category) {
    await this.officialReady;
    const key = titleKey(keyword);
    const matches = item => ['tv', 'anime'].includes(item.category) && titleKey(item.title) === key
      && (category === 'all' || category === item.category);
    const found = new Map();
    const feeds = [...this.platformFeeds.values()].map(feed => feed.items.filter(matches));
    for (const item of [...mergeOfficialCatalog(feeds), ...[...this.officialWorks.values()].filter(matches)]) {
      for (const source of item.platforms) found.set(source.catalogId, { ...source, title: item.title, category: item.category, year: item.year });
    }
    return [...found.values()];
  }
  start() {
    const warm = async () => { for (const channel of CATALOG_CHANNELS) await this.get(channel).catch(() => {}); };
    this.startTimer = setTimeout(() => { void warm(); }, 5000); this.startTimer.unref?.();
    this.timer = setInterval(() => { void warm(); }, TTL); this.timer.unref?.();
  }
}
