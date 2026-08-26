const DEFAULT_SEARCH_URLS = [
  'http://127.0.0.1:8888/api/search',
  'http://resource-search:8888/api/search',
  'https://so.252035.xyz/api/search'
];
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_SEARCH_SOURCE = 'all';
const RESULT_AGGREGATION_WINDOW_MS = 1_800;
const FRESH_CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 90 * 1000;
const ENDPOINT_FAILURE_BASE_COOLDOWN_MS = 8 * 1000;
const ENDPOINT_FAILURE_MAX_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 120;
const MAX_RESULTS = 100;

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
  return Math.min(30_000, Math.max(3_000, configured));
};

const configuredSearchSource = () => {
  const source = String(process.env.RESOURCE_SEARCH_SOURCE || DEFAULT_SEARCH_SOURCE).trim().toLowerCase();
  return ['all', 'tg', 'plugin'].includes(source) ? source : DEFAULT_SEARCH_SOURCE;
};

const safeText = (value, limit) => String(value || '').trim().slice(0, limit);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const isAbortError = error => error instanceof DOMException && error.name === 'AbortError';
const isRetryableError = error => {
  if (isAbortError(error)) return false;
  const message = String(error instanceof Error ? error.message : error || '');
  return /HTTP (?:408|425|429|5\d{2})\b|fetch failed|network|socket|reset|timeout/i.test(message);
};

const normalizePayload = payload => {
  if (payload?.code !== undefined && Number(payload.code) !== 0) {
    throw createSearchError(
      safeText(payload.message || payload.error, 160) || '上游检索服务返回异常',
      'RESOURCE_SEARCH_UPSTREAM_ERROR',
      502
    );
  }
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const rawItems = Array.isArray(data?.merged_by_type?.quark) ? data.merged_by_type.quark : [];
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
  constructor({ fetchImpl = globalThis.fetch, urls = configuredSearchUrls(), timeoutMs = requestTimeoutMs() } = {}) {
    this.fetchImpl = fetchImpl;
    this.urls = urls;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
    this.inFlight = new Map();
    this.endpointHealth = new Map();
  }

  async search(rawKeyword, { force = false } = {}) {
    const keyword = normalizeKeyword(rawKeyword);
    if (!keyword) {
      throw createSearchError('请输入有效片名', 'RESOURCE_SEARCH_KEYWORD_REQUIRED', 400);
    }

    const cacheKey = keyword.toLocaleLowerCase('zh-CN');
    const cached = this.cache.get(cacheKey);
    if (!force && cached && this.#isFreshCache(cached)) return cached.data;
    const requestKey = force ? `${cacheKey}:refresh` : cacheKey;
    if (this.inFlight.has(requestKey)) return this.inFlight.get(requestKey);

    const task = this.#searchUpstreams(keyword, force ? null : cached)
      .finally(() => this.inFlight.delete(requestKey));
    this.inFlight.set(requestKey, task);
    return task;
  }

  async #searchUpstreams(keyword, cached) {
    const endpoints = this.#availableEndpoints();
    if (!endpoints.length) {
      throw createSearchError('资源检索服务未配置可用来源', 'RESOURCE_SEARCH_UNAVAILABLE', 503);
    }
    const controller = new AbortController();
    const failures = [];
    const payloads = [];

    const outcome = await new Promise(resolve => {
      let completed = 0;
      let settled = false;
      let aggregationTimer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (aggregationTimer) clearTimeout(aggregationTimer);
        controller.abort();
        resolve({
          data: mergePayloads(payloads),
          hasResponses: payloads.length > 0,
          hasResults: payloads.some(data => data.merged_by_type.quark.length > 0)
        });
      };

      for (const endpoint of endpoints) {
        this.#fetchEndpointWithRetry(endpoint, keyword, controller.signal)
          .then(data => {
            this.#recordEndpointSuccess(endpoint);
            payloads.push(data);
            if (data.merged_by_type.quark.length) {
              if (endpoints.length === 1) finish();
              else if (!aggregationTimer) aggregationTimer = setTimeout(finish, RESULT_AGGREGATION_WINDOW_MS);
            }
          })
          .catch(error => {
            if (!controller.signal.aborted || !settled) {
              this.#recordEndpointFailure(endpoint);
              let host = 'configured-source';
              try { host = new URL(endpoint).host; } catch { /* URLs were validated at construction. */ }
              failures.push(`${host}: ${error instanceof Error ? error.message : 'unknown error'}`);
            }
          })
          .finally(() => {
            completed += 1;
            if (completed === endpoints.length && !settled) finish();
          });
      }
    });

    if (outcome?.hasResults && outcome.data) {
      this.#remember(keyword, outcome.data);
      return outcome.data;
    }
    if (cached && !cached.isEmpty && Date.now() - cached.createdAt <= STALE_CACHE_TTL_MS) return cached.data;
    if (outcome?.hasResponses && outcome.data) {
      this.#remember(keyword, outcome.data);
      return outcome.data;
    }
    if (failures.length) console.warn(`[resource-search] ${keyword} 检索失败：${failures.join(' | ')}`);
    throw createSearchError(
      '资源检索服务暂时繁忙，请稍后重试',
      'RESOURCE_SEARCH_UNAVAILABLE',
      503
    );
  }

  async #fetchEndpointWithRetry(endpoint, keyword, signal) {
    try {
      return await this.#fetchEndpoint(endpoint, keyword, signal);
    } catch (error) {
      if (!isRetryableError(error) || signal?.aborted) throw error;
      await delay(220);
      if (signal?.aborted) throw error;
      return this.#fetchEndpoint(endpoint, keyword, signal);
    }
  }

  async #fetchEndpoint(endpoint, keyword, parentSignal) {
    const url = new URL(endpoint);
    url.searchParams.set('kw', keyword);
    url.searchParams.set('res', 'merge');
    url.searchParams.set('src', configuredSearchSource());
    url.searchParams.set('cloud_types', 'quark');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MistyRainVideo/1.0'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      return normalizePayload(payload);
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  }

  #availableEndpoints() {
    const now = Date.now();
    const ready = this.urls.filter(endpoint => {
      const health = this.endpointHealth.get(endpoint);
      return !health?.retryAfter || health.retryAfter <= now;
    });
    return ready.length ? ready : this.urls;
  }

  #recordEndpointSuccess(endpoint) {
    this.endpointHealth.delete(endpoint);
  }

  #recordEndpointFailure(endpoint) {
    const previous = this.endpointHealth.get(endpoint) || { failures: 0, retryAfter: 0 };
    const failures = Math.min(previous.failures + 1, 5);
    const cooldown = Math.min(
      ENDPOINT_FAILURE_MAX_COOLDOWN_MS,
      ENDPOINT_FAILURE_BASE_COOLDOWN_MS * (2 ** (failures - 1))
    );
    this.endpointHealth.set(endpoint, { failures, retryAfter: Date.now() + cooldown });
  }

  #isFreshCache(entry) {
    const ttl = entry.isEmpty ? EMPTY_CACHE_TTL_MS : FRESH_CACHE_TTL_MS;
    return Date.now() - entry.createdAt <= ttl;
  }

  #remember(keyword, data) {
    const cacheKey = keyword.toLocaleLowerCase('zh-CN');
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, {
      createdAt: Date.now(),
      data,
      isEmpty: !data.merged_by_type.quark.length
    });
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
