import type { ResourceItem, SearchResult } from '../types/search';
import { apiUrl } from './appUrl';
import { authFetch } from './authService';
import { parseLibraryInput } from './libraryFeedback';

const SEARCH_THROTTLE_MS = 300;
const REQUEST_TIMEOUT_MS = 28_000;
const DIRECT_FALLBACK_TIMEOUT_MS = 10_000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 40;
const PUBLIC_FALLBACK_ENDPOINTS = [
  'https://so.252035.xyz/api/search'
];

/**
 * =========================================================================
 * 夸克资源聚合检索引擎 (SilentSearchEngine)
 * =========================================================================
 */
export class SilentSearchEngine {
  private cache: Map<string, { createdAt: number; data: SearchResult }> = new Map();
  private inFlight: Map<string, Promise<SearchResult>> = new Map();
  private lastRequestTime: number = 0;

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
    if (!options.force && cached && Date.now() - cached.createdAt <= SEARCH_CACHE_TTL_MS) {
      return { ...cached.data, fromCache: true };
    }

    const requestKey = options.force ? `${cacheKey}:refresh` : cacheKey;
    if (this.inFlight.has(requestKey)) {
      return this.inFlight.get(requestKey)!;
    }

    const now = Date.now();
    if (now - this.lastRequestTime < SEARCH_THROTTLE_MS) {
      await new Promise(r => setTimeout(r, SEARCH_THROTTLE_MS - (now - this.lastRequestTime)));
    }
    this.lastRequestTime = Date.now();

    const task = this.executeResilientFetch(cleanKw, Boolean(options.force));
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
      return this.getEmptyResult(error instanceof Error ? error.message : '资源检索失败，请稍后重试');
    } finally {
      this.inFlight.delete(requestKey);
    }
  }

  private async executeResilientFetch(keyword: string, force: boolean): Promise<SearchResult> {
    let backendResult: SearchResult | null = null;
    let backendError: unknown = null;
    try {
      backendResult = await this.executeBackendFetch(keyword, force);
      if (backendResult.items.length > 0) return backendResult;
    } catch (error) {
      backendError = error;
    }

    const fallbackController = new AbortController();
    try {
      const fallbackResult = await this.executePublicFallback(keyword, fallbackController.signal);
      if (fallbackResult.items.length > 0 || !backendResult) return fallbackResult;
    } catch (fallbackError) {
      if (!backendResult) {
        if (backendError instanceof Error) throw backendError;
        throw fallbackError;
      }
    }
    if (backendResult) return backendResult;
    if (backendError instanceof Error) throw backendError;
    throw new Error('资源检索服务暂时不可用');
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
        throw new Error(json.message || '资源检索服务暂时不可用');
      }
      return this.normalizeResponse(json.data, 'direct');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('资源检索超时，请稍后重试');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async executePublicFallback(keyword: string, parentSignal: AbortSignal): Promise<SearchResult> {
    let lastError: unknown = null;
    for (const endpoint of PUBLIC_FALLBACK_ENDPOINTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DIRECT_FALLBACK_TIMEOUT_MS);
      const abort = () => controller.abort();
      parentSignal.addEventListener('abort', abort, { once: true });
      try {
        const url = new URL(endpoint);
        url.searchParams.set('kw', keyword);
        url.searchParams.set('res', 'merge');
        url.searchParams.set('src', 'all');
        url.searchParams.set('cloud_types', 'quark');
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || Number(json.code) !== 0 || !json.data) {
          throw new Error(json.message || `备用检索服务请求失败（HTTP ${response.status}）`);
        }
        return this.normalizeResponse(json.data, 'cors_proxy');
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
        parentSignal.removeEventListener('abort', abort);
      }
    }
    if (lastError instanceof DOMException && lastError.name === 'AbortError') {
      throw new Error('备用检索超时，请稍后重试');
    }
    throw lastError instanceof Error ? lastError : new Error('备用检索服务暂时不可用');
  }

  private normalizeResponse(data: any, sourceMode: 'direct' | 'cors_proxy'): SearchResult {
    const items: ResourceItem[] = [];
    const seen = new Set<string>();
    const list = Array.isArray(data?.merged_by_type?.quark) ? data.merged_by_type.quark : [];
    list.forEach((raw: any) => {
      const item = this.parseSingleItem(raw);
      if (!item || seen.has(item.url)) return;
      seen.add(item.url);
      items.push(item);
    });

    items.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

    return {
      success: true,
      total: items.length,
      items,
      quarkItems: items,
      source: sourceMode
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
