import fs from 'node:fs';
import path from 'node:path';
import { resourceSearchKeyword } from './searchTitle.js';

const DEFAULT_SEARCH_URLS = [
  'http://127.0.0.1:8888/api/search',
  'http://resource-search:8888/api/search',
  'https://so.252035.xyz/api/search'
];
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_SEARCH_SOURCE = 'all';
const RESULT_AGGREGATION_WINDOW_MS = 150;
const PARTIAL_CACHE_TTL_MS = 15_000;
const FRESH_CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 10 * 1000;
const ENDPOINT_FAILURE_BASE_COOLDOWN_MS = 8 * 1000;
const ENDPOINT_FAILURE_MAX_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 120;
const MAX_RESULTS = 100;
const SEARCH_CACHE_REVISION = 5;
const COMPLETION_TIMEOUT_MS = 30_000;
const FOLLOW_UP_DELAYS_MS = [5_000, 15_000];

const createSearchError = (message, code, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const normalizeKeyword = value => String(value || '')
  .normalize('NFKC')
  .replace(/[《》()（）]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 80);

const configuredSearchUrls = () => {
  const configured = String(process.env.RESOURCE_SEARCH_URLS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const urls = configured.length ? configured : DEFAULT_SEARCH_URLS;
  return [...new Set(urls)].filter(value => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  });
};

const requestTimeoutMs = () => {
  const configured = Number(process.env.RESOURCE_SEARCH_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS;
  return Math.min(10_000, Math.max(3_000, configured));
};

const configuredSearchSource = () => {
  const source = String(process.env.RESOURCE_SEARCH_SOURCE || DEFAULT_SEARCH_SOURCE).trim().toLowerCase();
  return ['all', 'tg', 'plugin'].includes(source) ? source : DEFAULT_SEARCH_SOURCE;
};

const safeText = (value, limit) => String(value || '').trim().slice(0, limit);
const isBundledEndpoint = endpoint => ['127.0.0.1', 'localhost', 'resource-search', '[::1]'].includes(new URL(endpoint).hostname);

const normalizePayload = payload => {
  if (payload?.code !== undefined && Number(payload.code) !== 0) {
    throw createSearchError(
      safeText(payload.message || payload.error, 160) || '上游检索服务返回异常',
      'RESOURCE_SEARCH_UPSTREAM_ERROR',
      502
    );
  }
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const merged = data?.merged_by_type;
  // PanSou declares merged_by_type with omitempty: a successful empty search
  // legitimately returns only { total: 0 }. Do not penalize that channel.
  const empty = data?.total === 0 && merged == null;
  if (!empty && (!merged || typeof merged !== 'object' || Array.isArray(merged))) {
    throw createSearchError('检索来源响应格式异常', 'RESOURCE_SEARCH_UPSTREAM_ERROR', 502);
  }
  const rawItems = Array.isArray(merged?.quark) ? merged.quark : [];
  const seen = new Set();
  const items = [];
  for (const item of rawItems) {
    const url = safeText(item?.url, 2048);
    const match = url.match(/^https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/i);
    if (!match) continue;
    const canonical = `https://pan.quark.cn/s/${match[1]}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    items.push({
      url: canonical,
      password: safeText(item?.password, 32),
      note: safeText(item?.note || item?.title, 800),
      datetime: safeText(item?.datetime, 64),
      source: safeText(item?.source, 160)
    });
    if (items.length >= MAX_RESULTS) break;
  }
  return {
    total: items.length,
    merged_by_type: { quark: items }
  };
};

const mergePayloads = payloads => {
  const merged = new Map();
  for (const payload of payloads) {
    for (const item of payload?.merged_by_type?.quark || []) {
      const existing = merged.get(item.url);
      if (!existing) {
        merged.set(item.url, item);
      } else if (item.note.length > existing.note.length) {
        merged.set(item.url, {
          ...item,
          password: item.password || existing.password,
          datetime: item.datetime || existing.datetime,
          source: item.source || existing.source
        });
      }
      if (merged.size >= MAX_RESULTS) break;
    }
    if (merged.size >= MAX_RESULTS) break;
  }
  const items = [...merged.values()];
  return {
    total: items.length,
    merged_by_type: { quark: items }
  };
};

export class ResourceSearchService {
  constructor({ fetchImpl = globalThis.fetch, urls = configuredSearchUrls(), timeoutMs = requestTimeoutMs(),
    source = configuredSearchSource(), aggregationMs = RESULT_AGGREGATION_WINDOW_MS, dataDir, now = Date.now,
    exclude = () => false, maxConcurrent = 4, completionTimeoutMs = COMPLETION_TIMEOUT_MS, followUpDelaysMs = FOLLOW_UP_DELAYS_MS } = {}) {
    this.fetchImpl = fetchImpl;
    this.exclude = exclude;
    this.urls = urls;
    this.timeoutMs = timeoutMs;
    this.source = source;
    this.aggregationMs = aggregationMs;
    this.now = now;
    this.maxConcurrent = maxConcurrent;
    this.completionTimeoutMs = completionTimeoutMs;
    this.followUpDelaysMs = followUpDelaysMs;
    this.cache = new Map();
    this.inFlight = new Map();
    this.endpointHealth = new Map();
    this.cacheFile = dataDir ? path.resolve(dataDir, 'resource_search_cache.json') : '';
    if (this.cacheFile) {
      try {
        for (const [key, entry] of JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')).slice(-MAX_CACHE_ENTRIES)) {
          if (entry.createdAt <= this.now() && this.now() - entry.createdAt <= STALE_CACHE_TTL_MS) {
            const data = normalizePayload(entry.data);
            if (data.total) this.cache.set(key, { ...entry, data, isEmpty: false,
              partial: entry.partial || entry.revision !== SEARCH_CACHE_REVISION });
          }
        }
      } catch { /* A missing cache must not prevent service startup. */ }
    }
  }

  async search(rawKeyword, { force = false, allowStale = !force, priority = 'interactive' } = {}) {
    this.cleanup();
    const keyword = normalizeKeyword(rawKeyword);
    if (!keyword) throw createSearchError('请输入有效片名', 'RESOURCE_SEARCH_KEYWORD_REQUIRED', 400);
    const key = keyword.toLocaleLowerCase('zh-CN');
    const cached = this.cache.get(key);
    if (!force && cached && this.#isFreshCache(cached)) return this.#publicResult(cached, false, this.inFlight.has(key));
    const stale = allowStale && cached && !cached.isEmpty && this.now() - cached.createdAt <= STALE_CACHE_TTL_MS;
    let job = this.inFlight.get(key);
    if (!job) {
      const limit = priority !== 'interactive' ? Math.max(1, this.maxConcurrent - 2) : this.maxConcurrent;
      if (this.inFlight.size >= limit) {
        if (stale) return this.#publicResult(cached, true);
        throw createSearchError('正在处理其他检索，请稍后重试', 'RESOURCE_SEARCH_BUSY', 503);
      }
      // Register before work begins, so normal/refresh requests share one job.
      job = this.#startSearch(keyword, key, { refreshLocal: force || Boolean(cached && cached.revision !== SEARCH_CACHE_REVISION) });
      this.inFlight.set(key, job);
    }
    if (stale && !force) {
      return this.#publicResult(cached, true, true);
    }
    try { return await (priority === 'background' ? job.completed : job.first); }
    catch (error) {
      if (stale) return this.#publicResult(cached, true);
      throw error;
    }
  }

  cleanup() {
    let changed = false;
    for (const [key, entry] of this.cache) if (this.now() - entry.createdAt > STALE_CACHE_TTL_MS) { this.cache.delete(key); changed = true; }
    if (changed) this.#persist();
  }

  peek(rawKeyword) {
    this.cleanup();
    const key = normalizeKeyword(rawKeyword).toLocaleLowerCase('zh-CN');
    const entry = this.cache.get(key);
    if (!entry || this.now() - entry.createdAt > STALE_CACHE_TTL_MS) return null;
    return this.#publicResult(entry, !this.#isFreshCache(entry), this.inFlight.has(key));
  }

  #startSearch(keyword, key, { refreshLocal }) {
    const channels = this.urls.flatMap(endpoint => {
      // Public services receive one request. Only the engine we operate gets
      // bounded cache follow-ups for its asynchronous plugin/channel backfill.
      const sources = this.source === 'all' && isBundledEndpoint(endpoint) ? ['plugin', 'tg'] : [this.source];
      return sources.map(source => ({ endpoint, source, key: `${endpoint}:${source}` }));
    });
    const ready = channels.filter(channel => (this.endpointHealth.get(channel.key)?.retryAfter || 0) <= this.now());
    const deadline = this.now() + this.completionTimeoutMs;
    let resolveFirst, rejectFirst, resolveCompleted, rejectCompleted;
    const first = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
    const completed = new Promise((resolve, reject) => { resolveCompleted = resolve; rejectCompleted = reject; });
    // A caller may only consume one view, or immediately return a stale cache.
    first.catch(() => {});
    completed.catch(() => {});
    let settled = false;
    let aggregateTimer;
    const payloads = [];
    const failures = new Map();
    let active = ready.length;
    const publish = () => {
      const data = mergePayloads(payloads);
      const previous = this.cache.get(key);
      if (!data.total && previous && !previous.isEmpty && this.now() - previous.createdAt <= STALE_CACHE_TTL_MS) {
        if (!settled) { settled = true; resolveFirst(this.#publicResult(previous, true, true)); }
        return;
      }
      const entry = this.#remember(keyword, data, true);
      const result = this.#publicResult(entry, false, true);
      if (!settled) { settled = true; resolveFirst(result); }
    };
    // The initial UI wait is separate from the bounded background deadline.
    // An 8-second first response must not discard a source returning at 12s.
    const firstTimer = setTimeout(publish, Math.min(this.timeoutMs, this.completionTimeoutMs));
    const finish = () => {
      clearTimeout(firstTimer);
      clearTimeout(aggregateTimer);
      const partial = failures.size > 0 || ready.length < channels.length;
      const data = mergePayloads(payloads);
      if (data.total || (!partial && payloads.length)) {
        const result = this.#publicResult(this.#remember(keyword, data, partial));
        if (!settled) { settled = true; resolveFirst(result); }
        resolveCompleted(result);
      } else {
        const timedOut = [...failures.values()].some(error => error?.code === 'RESOURCE_SEARCH_TIMEOUT');
        const error = createSearchError(timedOut ? '检索来源响应超时，请稍后重试' : '检索来源暂时不可用，请稍后重试',
          timedOut ? 'RESOURCE_SEARCH_TIMEOUT' : 'RESOURCE_SEARCH_UNAVAILABLE', 503);
        // A preliminary empty response is a progress snapshot, never a cached
        // assertion that the title is unlisted after all sources failed.
        const entry = this.cache.get(key);
        if (entry?.isEmpty) this.cache.delete(key);
        if (!settled) { settled = true; rejectFirst(error); }
        rejectCompleted(error);
      }
      this.inFlight.delete(key);
    };
    const collect = (channel, data) => {
      this.endpointHealth.delete(channel.key);
      payloads.push(data);
      if (settled) publish();
      else if (data.total && !aggregateTimer) aggregateTimer = setTimeout(publish, this.aggregationMs);
    };
    const run = async channel => {
      try {
        collect(channel, await this.#fetchEndpoint(channel, keyword, {
          timeoutMs: Math.max(1, deadline - this.now())
        }));
        if (isBundledEndpoint(channel.endpoint)) {
          // A forced PanSou search can immediately return only fast plugins,
          // even when its cache already contains late results from the previous
          // round. Capture those first and merge the refresh into them.
          if (refreshLocal && deadline > this.now()) {
            collect(channel, await this.#fetchEndpoint(channel, keyword, {
              timeoutMs: deadline - this.now(), refresh: true
            }));
          }
          const receivedAt = this.now();
          for (const delayMs of this.followUpDelaysMs) {
            const dueAt = receivedAt + delayMs;
            if (dueAt >= deadline) break;
            const waitMs = dueAt - this.now();
            if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
            const remaining = deadline - this.now();
            if (remaining <= 0) break;
            // Never force follow-ups: read the cache that late plugins updated,
            // rather than restarting all plugin searches on every poll.
            collect(channel, await this.#fetchEndpoint(channel, keyword, { timeoutMs: remaining }));
          }
        }
      } catch (error) {
        failures.set(channel.key, error);
        const count = Math.min((this.endpointHealth.get(channel.key)?.failures || 0) + 1, 5);
        const cooldown = Math.max(error.retryAfterMs || 0, Math.min(ENDPOINT_FAILURE_MAX_COOLDOWN_MS, ENDPOINT_FAILURE_BASE_COOLDOWN_MS * 2 ** (count - 1)));
        this.endpointHealth.set(channel.key, { failures: count, retryAfter: this.now() + cooldown });
        console.warn('[resource-search] source failed', { host: new URL(channel.endpoint).host, source: channel.source,
          code: error.code || 'RESOURCE_SEARCH_UPSTREAM_ERROR', ...(error.upstreamStatus ? { status: error.upstreamStatus } : {}) });
      } finally { if (--active === 0) finish(); }
    };
    queueMicrotask(() => {
      if (!ready.length) finish();
      else for (const channel of ready) void run(channel);
    });
    return { first, completed };
  }

  async #fetchEndpoint(channel, keyword, { timeoutMs = this.timeoutMs, refresh = false } = {}) {
    const url = new URL(channel.endpoint);
    url.searchParams.set('kw', resourceSearchKeyword(keyword) || keyword);
    url.searchParams.set('res', 'merge');
    url.searchParams.set('src', channel.source);
    url.searchParams.set('cloud_types', 'quark');
    if (refresh) url.searchParams.set('refresh', 'true');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(createSearchError('检索来源超时', 'RESOURCE_SEARCH_TIMEOUT', 504));
      }, timeoutMs);
    });
    try {
      // The deadline covers both headers and JSON body; even a broken adapter
      // ignoring AbortSignal cannot retain a search slot forever.
      return await Promise.race([timeout, (async () => {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'MistyRainVideo/1.0',
            // Bundled PanSou versions can write the JSON once while buffering
            // and again while compressing. Avoid that middleware on loopback;
            // do not hide corruption by accepting just the first JSON object.
            ...(isBundledEndpoint(channel.endpoint) ? { 'Accept-Encoding': 'identity' } : {})
          },
          signal: controller.signal
        });
        if (!response.ok) {
          const error = createSearchError(`HTTP ${response.status}`, 'RESOURCE_SEARCH_UPSTREAM_ERROR', 502);
          error.upstreamStatus = response.status;
          const retry = response.headers.get('retry-after');
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry || '') - this.now();
          error.retryAfterMs = Number.isFinite(seconds) ? Math.min(300_000, Math.max(0, seconds))
            : [403, 429].includes(response.status) ? 60_000 : 0;
          throw error;
        }
        let payload;
        try { payload = await response.json(); }
        catch (error) {
          if (error instanceof SyntaxError) {
            throw createSearchError('检索来源返回了无效 JSON', 'RESOURCE_SEARCH_INVALID_RESPONSE', 502);
          }
          throw error;
        }
        return normalizePayload(payload);
      })()]);
    } finally { clearTimeout(timer); }
  }

  #isFreshCache(entry) {
    if (entry.revision !== SEARCH_CACHE_REVISION) return false;
    const ttl = entry.partial ? PARTIAL_CACHE_TTL_MS : entry.isEmpty ? EMPTY_CACHE_TTL_MS : FRESH_CACHE_TTL_MS;
    return this.now() - entry.createdAt <= ttl;
  }

  #publicResult(entry, stale = false, refreshing = false) {
    const items = entry.data.merged_by_type.quark.filter(item => !this.exclude(item));
    return { ...entry.data, total: items.length, merged_by_type: { quark: items }, stale, refreshing, partial: Boolean(entry.partial), cachedAt: new Date(entry.createdAt).toISOString(),
      ...(refreshing ? { message: entry.isEmpty ? '检索引擎仍在搜索，结果会自动出现…' : '先展示已找到的候选，正在补充其余来源…' }
        : stale ? { message: '暂用最近检索结果；添加时会验证链接' }
          : entry.partial ? { message: '部分来源暂不可用，已展示找到的候选；添加时会验证链接' } : {}) };
  }

  #remember(keyword, data, partial) {
    this.cleanup();
    const key = keyword.toLocaleLowerCase('zh-CN');
    const entry = { createdAt: this.now(), data, partial, isEmpty: !data.total, revision: SEARCH_CACHE_REVISION };
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
    if (!entry.isEmpty) this.#persist();
    return entry;
  }

  #persist() {
    if (this.cacheFile) {
      try {
        fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
        const temp = `${this.cacheFile}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify([...this.cache].filter(([, value]) => !value.isEmpty)), { mode: 0o600 });
        fs.renameSync(temp, this.cacheFile);
      } catch { /* Search still works when the cache volume is read-only. */ }
    }
  }
}
