const DEFAULT_SEARCH_URLS = ['http://127.0.0.1:8888/api/search'];
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESULTS = 500;
const safeText = (value, limit) => String(value || '').trim().slice(0, limit);
const searchError = (message, code, statusCode = 503) => Object.assign(new Error(message), { code, statusCode });
const normalizeKeyword = value => String(value || '').normalize('NFKC').replace(/[《》()（）]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const configuredUrls = () => {
  const configured = String(process.env.RESOURCE_SEARCH_URLS || '').split(',').map(value => value.trim()).filter(Boolean);
  return [...new Set(configured.length ? configured : DEFAULT_SEARCH_URLS)].filter(value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  });
};
const configuredTimeout = () => {
  const value = Number(process.env.RESOURCE_SEARCH_TIMEOUT_MS);
  // Older deployments used 8s for an initial snapshot; that must not cut off
  // the engine's current 20s batch now that a search waits for completion.
  return Number.isFinite(value) && value > 0 ? Math.min(30_000, Math.max(25_000, value)) : DEFAULT_TIMEOUT_MS;
};
const configuredSource = () => ['all', 'tg', 'plugin'].includes(process.env.RESOURCE_SEARCH_SOURCE) ? process.env.RESOURCE_SEARCH_SOURCE : 'all';
const isBundled = endpoint => ['127.0.0.1', 'localhost', 'resource-search', '[::1]'].includes(new URL(endpoint).hostname);

function normalizePayload(payload) {
  if (payload?.code !== undefined && Number(payload.code) !== 0) throw searchError('搜索来源返回错误', 'RESOURCE_SEARCH_UPSTREAM_ERROR');
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (data?.stale || data?.refreshing || data?.from_cache || data?.fromCache) throw searchError('搜索来源未返回本次完整结果，请重试', 'RESOURCE_SEARCH_NOT_FRESH');
  const merged = data?.merged_by_type;
  if (!(data?.total === 0 && merged == null) && (!merged || typeof merged !== 'object' || Array.isArray(merged))) {
    throw searchError('搜索来源响应格式异常', 'RESOURCE_SEARCH_INVALID_RESPONSE');
  }
  const rows = Array.isArray(merged?.quark) ? merged.quark : [];
  const unique = new Map();
  for (const row of rows) {
    const match = safeText(row?.url, 2048).match(/^https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)(?:[/?#]|$)/i);
    if (!match) continue;
    const url = `https://pan.quark.cn/s/${match[1]}`;
    if (!unique.has(url)) unique.set(url, { url, note: safeText(row.note || row.title, 800), password: safeText(row.password, 32), datetime: safeText(row.datetime, 64), source: safeText(row.source, 160) });
    if (unique.size >= MAX_RESULTS) break;
  }
  return [...unique.values()];
}

function mergeResults(lists) {
  const unique = new Map();
  const longest = Math.max(0, ...lists.map(rows => rows.length));
  for (let index = 0; index < longest && unique.size < MAX_RESULTS; index++) {
    for (const rows of lists) {
      const item = rows[index];
      if (!item) continue;
      const existing = unique.get(item.url);
      if (!existing || item.note.length > existing.note.length) unique.set(item.url, { ...item, password: item.password || existing?.password || '' });
      if (unique.size >= MAX_RESULTS) break;
    }
  }
  return [...unique.values()];
}

/** A search returns only this operation's results; no stored results or fallback queries. */
export class ResourceSearchService {
  constructor({ fetchImpl = globalThis.fetch, urls = configuredUrls(), source = configuredSource(), timeoutMs = configuredTimeout(), maxConcurrent = 4 } = {}) {
    this.fetchImpl = fetchImpl;
    this.urls = [...new Set(urls)];
    this.source = source;
    this.timeoutMs = timeoutMs;
    this.maxConcurrent = maxConcurrent;
    this.inFlight = new Map();
  }

  async search(rawKeyword, { priority = 'interactive' } = {}) {
    const keyword = normalizeKeyword(rawKeyword);
    if (!keyword) throw searchError('请输入片名', 'RESOURCE_SEARCH_KEYWORD_REQUIRED', 400);
    const key = keyword.toLocaleLowerCase('zh-CN');
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const limit = priority === 'background' ? Math.max(1, this.maxConcurrent - 2) : this.maxConcurrent;
    if (this.inFlight.size >= limit) throw searchError('当前搜索较多，请稍后重试', 'RESOURCE_SEARCH_BUSY');
    const task = this.run(keyword).finally(() => { if (this.inFlight.get(key) === task) this.inFlight.delete(key); });
    this.inFlight.set(key, task);
    return task;
  }

  async run(keyword) {
    if (!this.urls.length) throw searchError('未配置搜索来源', 'RESOURCE_SEARCH_UNAVAILABLE');
    const responses = await Promise.allSettled(this.urls.map(endpoint => this.fetchEndpoint(endpoint, keyword)));
    const lists = responses.filter(item => item.status === 'fulfilled').map(item => item.value);
    const failures = responses.filter(item => item.status === 'rejected').map(item => item.reason);
    const items = mergeResults(lists);
    if (failures.length && !items.length) {
      const timedOut = failures.some(error => error.code === 'RESOURCE_SEARCH_TIMEOUT');
      throw searchError(timedOut ? '搜索超时，请重试' : '搜索来源请求失败，请重试', timedOut ? 'RESOURCE_SEARCH_TIMEOUT' : 'RESOURCE_SEARCH_UNAVAILABLE');
    }
    return { total: items.length, merged_by_type: { quark: items }, partial: failures.length > 0,
      ...(failures.length ? { message: '部分搜索来源请求失败，以下为本次成功返回的结果。' } : {}) };
  }

  async fetchEndpoint(endpoint, keyword) {
    const url = new URL(endpoint);
    url.searchParams.set('kw', keyword);
    url.searchParams.set('res', 'merge');
    url.searchParams.set('src', this.source);
    url.searchParams.set('cloud_types', 'quark');
    url.searchParams.set('refresh', 'true');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(searchError('搜索超时，请重试', 'RESOURCE_SEARCH_TIMEOUT'));
    }, this.timeoutMs); });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'MistyRainVideo/1.0', ...(isBundled(endpoint) ? { 'Accept-Encoding': 'identity' } : {}) }, signal: controller.signal });
        if (!response.ok) throw searchError(`搜索来源返回 HTTP ${response.status}`, 'RESOURCE_SEARCH_UPSTREAM_ERROR');
        let payload;
        try { payload = await response.json(); } catch { throw searchError('搜索来源返回了无效数据', 'RESOURCE_SEARCH_INVALID_RESPONSE'); }
        return normalizePayload(payload);
      })()]);
    } finally { clearTimeout(timer); }
  }
}
