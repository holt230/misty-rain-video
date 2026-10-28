import type { ResourceItem, SearchResult, ShareValidationResult } from '../types/search';
import { apiUrl } from './appUrl';
import { authFetch } from './authService';
import { parseLibraryInput } from './libraryFeedback';
import { resourceSearchKeyword, resourceTitleRelevance } from '../../server/searchTitle.js';

const SEARCH_THROTTLE_MS = 300;
const REQUEST_TIMEOUT_MS = 12_000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 40;
const PUBLIC_SEARCH_URL = 'https://so.252035.xyz/api/search';
const PUBLIC_TIMEOUT_MS = 10_000;

/**
 * =========================================================================
 * 夸克资源聚合检索引擎 (SilentSearchEngine)
 * =========================================================================
 */
export class SilentSearchEngine {
  private cache: Map<string, { createdAt: number; data: SearchResult }> = new Map();
  private inFlight: Map<string, Promise<SearchResult>> = new Map();
  private lastRequestTime: number = 0;
  private publicInFlight = new Map<string, Promise<SearchResult>>();
  private publicCache = new Map<string, { expiresAt: number; data: SearchResult }>();
  private publicRetryAfter = 0;

  async search(keyword: string, options: { force?: boolean } = {}): Promise<SearchResult> {
    const cleanKw = keyword
      .normalize('NFKC')
      .replace(/[《》()（）]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanKw) {
      return { success: false, total: 0, items: [], quarkItems: [], source: 'error' };
    }

    const cacheKey = cleanKw.toLocaleLowerCase('zh-CN');
    const cached = this.cache.get(cacheKey);
    if (!options.force && cached && Date.now() - cached.createdAt <= (cached.data.partial || cached.data.stale ? 5_000 : SEARCH_CACHE_TTL_MS)) {
      return { ...cached.data, fromCache: true };
    }

    const requestKey = cacheKey;
    if (this.inFlight.has(requestKey)) {
      return this.inFlight.get(requestKey)!.catch(error => this.failedSearch(error));
    }

    // Register the promise before the throttle waits, so concurrent requests
    // cannot pass the in-flight check and send duplicate upstream searches.
    const task = (async () => {
      const remaining = SEARCH_THROTTLE_MS - (Date.now() - this.lastRequestTime);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      this.lastRequestTime = Date.now();
      return this.executeBackendFetch(cleanKw, Boolean(options.force));
    })();
    this.inFlight.set(requestKey, task);

    try {
      const result = await task;
      if (result.success && result.items.length > 0) {
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, { createdAt: Date.now(), data: result });
        while (this.cache.size > MAX_SEARCH_CACHE_ENTRIES) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey === undefined) break;
          this.cache.delete(oldestKey);
        }
      }
      return result;
    } catch (error) {
      return this.failedSearch(error);
    } finally {
      this.inFlight.delete(requestKey);
    }
  }

  // The browser and server use different network exits. Restore the pre-Oct-13
  // public fallback without blocking candidates already returned by the server.
  async supplement(keyword: string, { force = false } = {}): Promise<SearchResult> {
    const clean = keyword.normalize('NFKC').replace(/[《》()（）]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return this.getEmptyResult();
    const key = clean.toLocaleLowerCase('zh-CN');
    const cached = this.publicCache.get(key);
    if (cached && cached.expiresAt > Date.now() && (!force || !cached.data.success)) return cached.data;
    const pending = this.publicInFlight.get(key);
    if (pending) return pending;
    if (this.publicRetryAfter > Date.now()) return this.getEmptyResult('备用来源暂不可用，已保留当前候选');
    const task = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PUBLIC_TIMEOUT_MS);
      let result: SearchResult;
      try {
        const url = new URL(PUBLIC_SEARCH_URL);
        url.search = new URLSearchParams({ kw: resourceSearchKeyword(clean), res: 'merge', src: 'all', cloud_types: 'quark' }).toString();
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('备用来源暂不可用');
        const payload = await response.json();
        if (Number(payload.code) !== 0 || !payload.data || (!payload.data.merged_by_type && payload.data.total !== 0)) throw new Error('备用来源响应异常');
        result = this.normalizeResponse(payload.data, 'cors_proxy', clean);
      } catch {
        result = this.getEmptyResult('备用来源暂不可用，已保留当前候选');
        this.publicRetryAfter = Date.now() + 30_000;
      } finally { clearTimeout(timer); }
      this.publicCache.delete(key);
      this.publicCache.set(key, { expiresAt: Date.now() + (result.items.length ? SEARCH_CACHE_TTL_MS : 30_000), data: result });
      while (this.publicCache.size > MAX_SEARCH_CACHE_ENTRIES) this.publicCache.delete(this.publicCache.keys().next().value!);
      return result;
    })().finally(() => this.publicInFlight.delete(key));
    this.publicInFlight.set(key, task);
    return task;
  }

  async validateResources(items: ResourceItem[], force = false, signal?: AbortSignal): Promise<ShareValidationResult> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await authFetch(apiUrl('/api/resource-search/validate'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ items: items.map(item => ({ url: item.url, password: item.password || '' })), force })
      });
      const payload = await response.json();
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error('登录状态已失效'), { requiresAuth: true });
      if (!response.ok || payload.code !== 0 || !Array.isArray(payload.data?.entries)) throw new Error('链接校验暂不可用');
      return payload.data;
    } catch (error) {
      if (error && typeof error === 'object' && 'requiresAuth' in error) throw error;
      // A network failure is uncertainty, never evidence that every share was cancelled.
      return { entries: items.map(item => ({ url: item.url, password: item.password || '', status: 'unknown' })), pending: false };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
  }

  async prefetch(keyword: string, signal: AbortSignal, force=false): Promise<SearchResult> {
    const params = new URLSearchParams({ kw: keyword, background: '1' });
    if(force)params.set('refresh','1');
    const response = await authFetch(`${apiUrl('/api/resource-search')}?${params}`, { signal, cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0 || !payload.data) throw new Error('备选片源暂不可用');
    return this.normalizeResponse(payload.data, 'direct', keyword);
  }

  private failedSearch(error: unknown): SearchResult {
    return { ...this.getEmptyResult(error instanceof Error ? error.message : '资源检索失败，请稍后重试'),
      allowPublicFallback: !(error && typeof error === 'object' && 'requiresAuth' in error && error.requiresAuth) };
  }

  async readCached(keyword: string, signal?: AbortSignal): Promise<SearchResult | null> {
    const params = new URLSearchParams({ kw: keyword, cached: '1' });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await authFetch(`${apiUrl('/api/resource-search')}?${params}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0 || !payload.data) return null;
      const result = this.normalizeResponse(payload.data, 'direct', keyword);
      // Do not let an earlier partial client cache hide the completed server result.
      this.cache.delete(keyword.normalize('NFKC').replace(/[《》()（）]/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN'));
      return result;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
  }

  private async executeBackendFetch(keyword: string, force: boolean): Promise<SearchResult> {
    const params = new URLSearchParams({ kw: keyword });
    if (force) params.set('refresh', '1');
    const targetUrl = `${apiUrl('/api/resource-search')}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await authFetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json.code !== 0 || !json.data) {
        throw Object.assign(new Error(json.message || '资源检索服务暂时不可用'), {
          requiresAuth: resp.status === 401 || resp.status === 403 || json.code === 'APP_AUTH_REQUIRED'
        });
      }
      return this.normalizeResponse(json.data, 'direct', keyword);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('资源检索超时，请稍后重试');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeResponse(data: any, sourceMode: 'direct' | 'cors_proxy', keyword: string): SearchResult {
    const items: ResourceItem[] = [];
    const seen = new Set<string>();
    const list = Array.isArray(data?.merged_by_type?.quark) ? data.merged_by_type.quark : [];
    list.forEach((raw: any) => {
      const item = this.parseSingleItem(raw);
      if (!item || seen.has(item.url)) return;
      const relevance = resourceTitleRelevance(keyword, item.title);
      if (!relevance) return;
      item.relevance = relevance;
      seen.add(item.url);
      items.push(item);
    });

    items.sort((a, b) => (b.relevance || 0) - (a.relevance || 0) || (Date.parse(b.datetime) || 0) - (Date.parse(a.datetime) || 0));

    return {
      success: true,
      total: items.length,
      items,
      quarkItems: items,
      source: sourceMode,
      stale: Boolean(data.stale),
      partial: Boolean(data.partial),
      refreshing: Boolean(data.refreshing),
      ...(data.message ? { message: String(data.message) } : {})
    };
  }

  private parseSingleItem(raw: any): ResourceItem | null {
    const note = String(raw.note || raw.title || '可用影视资源');
    const share = parseLibraryInput(`${String(raw.url || '')}\n${note}`);
    if (share.kind !== 'share') return null;
    const canonicalUrl = share.url;
    const is4k = /4k|2160p|uhd|杜比|hdr/i.test(note);
    const is1080p = /1080p|fhd|蓝光/i.test(note);
    const quality = is4k ? '4K 超高清' : (is1080p ? '1080P 超清' : '清晰度待解析');
    const rawDatetime = String(raw.datetime || '').trim();
    const parsedDatetime = Date.parse(rawDatetime);
    const year = Number.isFinite(parsedDatetime) ? new Date(parsedDatetime).getFullYear() : 0;
    const datetime = year >= 2001 ? rawDatetime.substring(0, 10) : '近期收录';

    return {
      id: `quark-${canonicalUrl.split('/').pop()}`,
      title: note,
      url: canonicalUrl,
      password: raw.password || share.passcode,
      driveType: 'quark',
      datetime,
      source: raw.source || 'PanSou 聚合分析',
      quality,
      is4k
    };
  }

  private getEmptyResult(message = ''): SearchResult {
    return {
      success: false,
      total: 0,
      items: [],
      quarkItems: [],
      source: 'error',
      ...(message ? { message } : {})
    };
  }
}
