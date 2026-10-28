import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDiscoveryImageUrl } from './discoverySources.js';

export const LEGACY_DEFAULT_POSTER = 'https://images.unsplash.com/photo-1578836537282-3171d77f8632?w=600&q=80';

const USER_AGENT = 'MistyRainVideo/1.0';
const CACHE_VERSION = 1;
const RESOLVE_BATCH_SIZE = 8;
const RESOLVE_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 5_000;
const IMAGE_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MISS_RETRY_MS = 60 * 60 * 1000;

const ensureDirectory = directory => {
  fs.mkdirSync(directory, { recursive: true });
};

const readJson = (filePath, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJson = (filePath, value) => {
  ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporaryPath, filePath);
};

const normalizeTitle = value => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[（(]\s*(?:19|20)\d{2}\s*[)）]/g, '')
  .replace(/(?:4k|8k|2160p|1080p|uhd|hdr|高码|超清|高清|蓝光|完整版)/gi, '')
  .replace(/[\s·•:：—_.,，。!！?？《》“”'"【】\[\]()（）-]+/g, '');

const titleBigrams = value => {
  if (value.length < 2) return new Set(value ? [value] : []);
  const result = new Set();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
};

const titleScore = (queryTitle, candidateTitles) => {
  const query = normalizeTitle(queryTitle);
  if (!query) return 0;

  return Math.max(0, ...candidateTitles.map((candidateTitle, index) => {
    const candidate = normalizeTitle(candidateTitle);
    if (!candidate) return 0;
    if (candidate === query) return 100 - index;
    if (candidate.startsWith(query)) return 90 - Math.min(12, candidate.length - query.length) - index;
    if (query.startsWith(candidate)) return 84 - Math.min(12, query.length - candidate.length) - index;
    if (candidate.includes(query) || query.includes(candidate)) return 72 - index;

    const queryParts = titleBigrams(query);
    const candidateParts = titleBigrams(candidate);
    if (!queryParts.size || !candidateParts.size) return 0;
    let intersection = 0;
    queryParts.forEach(part => {
      if (candidateParts.has(part)) intersection += 1;
    });
    const similarity = (2 * intersection) / (queryParts.size + candidateParts.size);
    return similarity >= 0.66 ? Math.round(45 + similarity * 25) - index : 0;
  }));
};

const withTimeout = async (url, options, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const mapWithConcurrency = async (items, concurrency, handler) => {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await handler(items[index], index);
    }
  });
  await Promise.all(workers);
};

const mimeExtension = contentType => {
  const value = String(contentType || '').toLowerCase();
  if (value.includes('image/png')) return { extension: 'png', contentType: 'image/png' };
  if (value.includes('image/webp')) return { extension: 'webp', contentType: 'image/webp' };
  if (value.includes('image/gif')) return { extension: 'gif', contentType: 'image/gif' };
  return { extension: 'jpg', contentType: 'image/jpeg' };
};

export const isGenericPoster = value => {
  const poster = String(value || '').trim();
  return !poster || poster === LEGACY_DEFAULT_POSTER || poster.includes('images.unsplash.com/photo-1578836537282-3171d77f8632');
};

export class PosterService {
  constructor(dataDir, { resolveThumbnail, fetchThumbnail } = {}) {
    this.posterDirectory = path.resolve(dataDir, 'posters');
    this.cachePath = path.resolve(dataDir, 'media_posters.json');
    this.cache = readJson(this.cachePath, { version: CACHE_VERSION, entries: {} });
    if (!this.cache || this.cache.version !== CACHE_VERSION || !this.cache.entries || typeof this.cache.entries !== 'object' || Array.isArray(this.cache.entries)) {
      this.cache = { version: CACHE_VERSION, entries: {} };
    }
    this.inFlight = new Map();
    this.posterUpgradeRetries = new Map();
    this.resolveThumbnail = resolveThumbnail;
    this.fetchThumbnail = fetchThumbnail;
    ensureDirectory(this.posterDirectory);
  }

  async enrich(items, user) {
    const cards = items.map(item => ({ ...item }));
    const unresolved = [];

    for (const card of cards) {
      const catalog = card.catalogId && this.catalogPoster(card.catalogId);
      if (catalog) { Object.assign(card, catalog); continue; }
      if (!isGenericPoster(card.poster)) continue;
      const key = this.#cacheKey(card);
      const cached = this.#cachedPoster(key);
      if (cached) {
        Object.assign(card, cached);
        continue;
      }
      // A title miss must not prevent discovery of this user's video cover.
      const thumbnail = this.#cachedPoster(this.#thumbnailKey(card, user));
      if (thumbnail) Object.assign(card, thumbnail);
      if (!this.#hasRecentMiss(key) || (!thumbnail && this.resolveThumbnail && card.quarkFid)) unresolved.push(card);
    }

    await mapWithConcurrency(unresolved.slice(0, RESOLVE_BATCH_SIZE), RESOLVE_CONCURRENCY, async card => {
      const resolved = await this.resolve(card, user);
      if (resolved) Object.assign(card, resolved);
    });

    return cards;
  }

  async resolve(item, user) {
    const key = this.#cacheKey(item);
    const cached = this.#cachedPoster(key);
    if (cached) return cached;
    const thumbnailKey = this.#thumbnailKey(item, user);
    const taskKey = `${key}:${thumbnailKey}`;
    if (this.inFlight.has(taskKey)) return this.inFlight.get(taskKey);

    const task = (async () => {
      const poster = this.#hasRecentMiss(key) ? null : await this.#resolveAndCache(item, key);
      if (poster) return poster;
      const thumbnail = this.#cachedPoster(thumbnailKey);
      if (thumbnail) return thumbnail;
      if (!this.resolveThumbnail || !item.quarkFid || this.#hasRecentMiss(thumbnailKey)) return null;
      try {
        const candidate = await this.resolveThumbnail(item, user);
        if (!candidate) { this.#rememberMiss(thumbnailKey); return null; }
        const asset = await this.#downloadPoster({ ...candidate, provider: 'video' }, thumbnailKey, true);
        const entry = { status: 'ready', fileName: asset.fileName, provider: 'video', matchedTitle: item.title, sourceUrl: item.imageUrl, updatedAt: new Date().toISOString() };
        this.cache.entries[thumbnailKey] = entry;
        this.#persistCache();
        return this.#serializePoster(entry);
      } catch {
        this.#rememberMiss(thumbnailKey, '', 60_000);
        return null;
      }
    })().finally(() => {
      this.inFlight.delete(taskKey);
    });
    this.inFlight.set(taskKey, task);
    return task;
  }

  getAsset(fileName) {
    const cleanName = path.basename(String(fileName || ''));
    if (!/^[a-f0-9]{24}-[a-f0-9]{10}\.(?:jpg|png|webp|gif)$/i.test(cleanName)) return null;
    const filePath = path.resolve(this.posterDirectory, cleanName);
    if (!filePath.startsWith(`${this.posterDirectory}${path.sep}`) || !fs.existsSync(filePath)) return null;
    const extension = path.extname(cleanName).toLowerCase();
    const contentType = extension === '.png' ? 'image/png'
      : extension === '.webp' ? 'image/webp'
        : extension === '.gif' ? 'image/gif'
          : 'image/jpeg';
    return { filePath, contentType, size: fs.statSync(filePath).size };
  }

  catalogPoster(id) {
    return this.#cachedPoster(crypto.createHash('sha256').update(`catalog\0${id}`).digest('hex').slice(0, 24));
  }

  async resolveCatalogPoster(item, { preferSource = false } = {}) {
    if (!/^(douban|bangumi)-\d{1,13}$/.test(item.id) || !isDiscoveryImageUrl(item.imageUrl, item.provider)) throw new Error('INVALID_CATALOG_POSTER');
    const cached = this.catalogPoster(item.id);
    const key = crypto.createHash('sha256').update(`catalog\0${item.id}`).digest('hex').slice(0, 24);
    if (cached && (!preferSource || this.cache.entries[key]?.sourceUrl === item.imageUrl || (this.posterUpgradeRetries.get(key) || 0) > Date.now())) return cached;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const task = (async () => {
      const asset = await this.#downloadPoster({ ...item, referer: item.provider === 'douban' ? 'https://movie.douban.com/' : 'https://bgm.tv/',
        validateUrl: url => isDiscoveryImageUrl(url, item.provider) }, key);
      const entry = { status: 'ready', fileName: asset.fileName, provider: item.provider, providerId: item.id,
        matchedTitle: item.title, sourceUrl: item.imageUrl, updatedAt: new Date().toISOString() };
      this.cache.entries[key] = entry; this.#persistCache();
      return this.#serializePoster(entry);
    })().catch(error => {
      if (!cached) throw error;
      // An unavailable larger image must never remove an existing usable cover.
      for (const [id, until] of this.posterUpgradeRetries) if (until <= Date.now()) this.posterUpgradeRetries.delete(id);
      if (this.posterUpgradeRetries.size >= 1000) this.posterUpgradeRetries.delete(this.posterUpgradeRetries.keys().next().value);
      this.posterUpgradeRetries.set(key, Date.now() + 60_000);
      return cached;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  async #resolveAndCache(item, key) {
    try {
      const candidate = await this.#findPoster(item);
      if (!candidate) {
        this.#rememberMiss(key);
        return null;
      }
      const asset = await this.#downloadPoster(candidate, key);
      const entry = {
        status: 'ready',
        fileName: asset.fileName,
        provider: candidate.provider,
        providerId: candidate.providerId,
        matchedTitle: candidate.title,
        sourceUrl: candidate.imageUrl,
        updatedAt: new Date().toISOString()
      };
      this.cache.entries[key] = entry;
      this.#persistCache();
      return this.#serializePoster(entry);
    } catch (error) {
      this.#rememberMiss(key, error instanceof Error ? error.message : '封面解析失败');
      return null;
    }
  }

  async #findPoster(item) {
    const providers = item.category === 'anime'
      ? [this.#searchBangumi.bind(this), this.#searchDouban.bind(this)]
      : [this.#searchDouban.bind(this), this.#searchBangumi.bind(this)];

    for (const search of providers) {
      const candidate = await search(item.title).catch(() => null);
      if (candidate) return candidate;
    }
    return null;
  }

  async #searchDouban(title) {
    const response = await withTimeout(
      `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`,
      { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
      REQUEST_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data)) return null;

    return data
      .map((item, index) => ({
        provider: 'douban',
        providerId: String(item.id || ''),
        title: item.title || item.sub_title || '',
        imageUrl: item.img || '',
        referer: 'https://movie.douban.com/',
        score: titleScore(title, [item.title, item.sub_title]) - index
      }))
      .filter(item => item.imageUrl && item.score >= 68)
      .sort((left, right) => right.score - left.score)[0] || null;
  }

  async #searchBangumi(title) {
    const response = await withTimeout(
      `https://api.bgm.tv/search/subject/${encodeURIComponent(title)}?type=2&responseGroup=small&max_results=10`,
      { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
      REQUEST_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const data = await response.json();
    const list = Array.isArray(data?.list) ? data.list : [];

    return list
      .map((item, index) => ({
        provider: 'bangumi',
        providerId: String(item.id || ''),
        title: item.name_cn || item.name || '',
        imageUrl: String(item.images?.large || item.images?.common || '').replace(/^http:/, 'https:'),
        referer: 'https://bgm.tv/',
        score: titleScore(title, [item.name_cn, item.name]) - index
      }))
      .filter(item => item.imageUrl && item.score >= 68)
      .sort((left, right) => right.score - left.score)[0] || null;
  }

  async #downloadPoster(candidate, key, thumbnail = false) {
    const signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
    const fetchImage = async () => {
      let url = candidate.imageUrl;
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (candidate.validateUrl && !candidate.validateUrl(url)) throw new Error('INVALID_POSTER_URL');
        const result = await fetch(url, { signal, redirect: candidate.validateUrl ? 'manual' : 'follow', headers: {
          Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8', Referer: candidate.referer, 'User-Agent': USER_AGENT
        } });
        if (candidate.validateUrl && [301, 302, 303, 307, 308].includes(result.status)) {
          const location = result.headers.get('location'); await result.body?.cancel();
          if (!location) throw new Error('INVALID_POSTER_REDIRECT');
          url = new URL(location, url).toString(); continue;
        }
        return result;
      }
      throw new Error('TOO_MANY_POSTER_REDIRECTS');
    };
    const response = thumbnail && this.fetchThumbnail
      ? await this.fetchThumbnail(candidate.imageUrl, signal)
      : await fetchImage();
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`海报下载失败 (${response.status})`); }

    const declaredSize = Number(response.headers.get('content-length')) || 0;
    if (declaredSize > MAX_IMAGE_BYTES) { await response.body.cancel(); throw new Error('海报文件过大'); }
    const contentType = String(response.headers.get('content-type') || '');
    if (!/^image\/(?:jpeg|png|webp|gif)(?:;|$)/i.test(contentType)) { await response.body.cancel(); throw new Error('封面不是有效图片'); }
    const type = mimeExtension(contentType);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error('海报文件过大');
      }
      chunks.push(Buffer.from(value));
    }
    if (!size) throw new Error('海报文件为空');

    const sourceHash = crypto.createHash('sha256').update(candidate.imageUrl).digest('hex').slice(0, 10);
    const fileName = `${key}-${sourceHash}.${type.extension}`;
    const filePath = path.resolve(this.posterDirectory, fileName);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, Buffer.concat(chunks), { mode: 0o644 });
    fs.renameSync(temporaryPath, filePath);
    return { fileName, contentType: type.contentType };
  }

  #cacheKey(item) {
    return crypto.createHash('sha256')
      .update(`${item.category || 'unknown'}\0${normalizeTitle(item.title)}`)
      .digest('hex')
      .slice(0, 24);
  }

  #thumbnailKey(item, user) {
    return crypto.createHash('sha256').update(`video\0${user?.username || ''}\0${item.quarkFid || ''}`).digest('hex').slice(0, 24);
  }

  #cachedPoster(key) {
    const entry = this.cache.entries[key];
    if (!entry || entry.status !== 'ready' || !entry.fileName) return null;
    const asset = this.getAsset(entry.fileName);
    if (!asset) return null;
    return this.#serializePoster(entry);
  }

  #serializePoster(entry) {
    return {
      poster: `/api/media-posters/${encodeURIComponent(entry.fileName)}`,
      posterSource: entry.provider,
      posterMatchedTitle: entry.matchedTitle
    };
  }

  #hasRecentMiss(key) {
    const entry = this.cache.entries[key];
    if (!entry || entry.status !== 'miss') return false;
    const updatedAt = Date.parse(entry.updatedAt || '') || 0;
    return Date.now() - updatedAt < (entry.retryMs || MISS_RETRY_MS);
  }

  #rememberMiss(key, error = '', retryMs = MISS_RETRY_MS) {
    this.cache.entries[key] = {
      status: 'miss',
      error,
      retryMs,
      updatedAt: new Date().toISOString()
    };
    this.#persistCache();
  }

  #persistCache() {
    writeJson(this.cachePath, this.cache);
  }
}
