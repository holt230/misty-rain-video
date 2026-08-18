import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
  constructor(dataDir) {
    this.posterDirectory = path.resolve(dataDir, 'posters');
    this.cachePath = path.resolve(dataDir, 'media_posters.json');
    this.cache = readJson(this.cachePath, { version: CACHE_VERSION, entries: {} });
    if (!this.cache || this.cache.version !== CACHE_VERSION || typeof this.cache.entries !== 'object') {
      this.cache = { version: CACHE_VERSION, entries: {} };
    }
    this.inFlight = new Map();
    ensureDirectory(this.posterDirectory);
  }

  async enrich(items) {
    const cards = items.map(item => ({ ...item }));
    const unresolved = [];

    for (const card of cards) {
      if (!isGenericPoster(card.poster)) continue;
      const key = this.#cacheKey(card);
      const cached = this.#cachedPoster(key);
      if (cached) {
        Object.assign(card, cached);
        continue;
      }
      if (!this.#hasRecentMiss(key)) unresolved.push(card);
    }

    await mapWithConcurrency(unresolved.slice(0, RESOLVE_BATCH_SIZE), RESOLVE_CONCURRENCY, async card => {
      const resolved = await this.resolve(card);
      if (resolved) Object.assign(card, resolved);
    });

    return cards;
  }

  async resolve(item) {
    const key = this.#cacheKey(item);
    const cached = this.#cachedPoster(key);
    if (cached) return cached;
    if (this.#hasRecentMiss(key)) return null;
    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const task = this.#resolveAndCache(item, key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
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

  async #downloadPoster(candidate, key) {
    const response = await withTimeout(candidate.imageUrl, {
      redirect: 'follow',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: candidate.referer,
        'User-Agent': USER_AGENT
      }
    }, IMAGE_TIMEOUT_MS);
    if (!response.ok || !response.body) throw new Error(`海报下载失败 (${response.status})`);

    const declaredSize = Number(response.headers.get('content-length')) || 0;
    if (declaredSize > MAX_IMAGE_BYTES) throw new Error('海报文件过大');
    const type = mimeExtension(response.headers.get('content-type'));
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
    return Date.now() - updatedAt < MISS_RETRY_MS;
  }

  #rememberMiss(key, error = '') {
    this.cache.entries[key] = {
      status: 'miss',
      error,
      updatedAt: new Date().toISOString()
    };
    this.#persistCache();
  }

  #persistCache() {
    writeJson(this.cachePath, this.cache);
  }
}
