import type { ResourceItem, SearchResult, DriveType } from '../types/search';
import { apiUrl } from './appUrl';
import { authFetch } from './authService';

const SEARCH_THROTTLE_MS = 300;
const REQUEST_TIMEOUT_MS = 28_000;
const DIRECT_FALLBACK_DELAY_MS = 650;
const DIRECT_FALLBACK_TIMEOUT_MS = 10_000;
const PUBLIC_FALLBACK_ENDPOINTS = [
  'https://so.252035.xyz/api/search'
];

/**
 * =========================================================================
 * 夸克与全网网盘聚合检索引擎 (SilentSearchEngine)
 * =========================================================================
 */
export class SilentSearchEngine {
  private cache: Map<string, SearchResult> = new Map();
  private inFlight: Map<string, Promise<SearchResult>> = new Map();
  private lastRequestTime: number = 0;

  async search(keyword: string): Promise<SearchResult> {
    const cleanKw = keyword.replace(/[《》\(\)\s]/g, '').trim();
    if (!cleanKw) {
      return { success: false, total: 0, items: [], quarkItems: [], source: 'error' };
    }

    if (this.cache.has(cleanKw)) {
      const cached = this.cache.get(cleanKw)!;
      return { ...cached, fromCache: true };
    }

    if (this.inFlight.has(cleanKw)) {
      return this.inFlight.get(cleanKw)!;
    }

    const now = Date.now();
    if (now - this.lastRequestTime < SEARCH_THROTTLE_MS) {
      await new Promise(r => setTimeout(r, SEARCH_THROTTLE_MS - (now - this.lastRequestTime)));
    }
    this.lastRequestTime = Date.now();

    const task = this.executeResilientFetch(cleanKw);
    this.inFlight.set(cleanKw, task);

    try {
      const result = await task;
      if (result.success && result.items.length > 0) {
        this.cache.set(cleanKw, result);
      }
      return result;
    } catch (error) {
      return this.getEmptyResult(error instanceof Error ? error.message : '资源检索失败，请稍后重试');
    } finally {
      this.inFlight.delete(cleanKw);
    }
  }

  private async executeResilientFetch(keyword: string): Promise<SearchResult> {
    const fallbackController = new AbortController();
    let backendEmptyResult: SearchResult | null = null;
    let fallbackEmptyResult: SearchResult | null = null;
    let backendError: unknown = null;

    const requireResources = (result: SearchResult, recordEmpty: (value: SearchResult) => void): Promise<SearchResult> => {
      if (result.items.length > 0) return Promise.resolve(result);
      recordEmpty(result);
      return Promise.reject(new Error('empty search result'));
    };

    const backend = this.executeBackendFetch(keyword)
      .then(result => requireResources(result, value => { backendEmptyResult = value; }))
      .catch(error => {
        backendError = error;
        throw error;
      });
    const directFallback = new Promise<void>(resolve => setTimeout(resolve, DIRECT_FALLBACK_DELAY_MS))
      .then(() => {
        if (fallbackController.signal.aborted) throw new DOMException('Search fallback cancelled', 'AbortError');
        return this.executePublicFallback(keyword, fallbackController.signal);
      })
      .then(result => requireResources(result, value => { fallbackEmptyResult = value; }));

    try {
      const result = await new Promise<SearchResult>((resolve, reject) => {
        let rejected = 0;
        let settled = false;
        let lastError: unknown = null;
        const resolveFirst = (value: SearchResult) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const rejectWhenExhausted = (error: unknown) => {
          if (settled) return;
          rejected += 1;
          lastError = error;
          if (rejected === 2) reject(lastError);
        };
        backend.then(resolveFirst, rejectWhenExhausted);
        directFallback.then(resolveFirst, rejectWhenExhausted);
      });
      fallbackController.abort();
      return result;
    } catch {
      fallbackController.abort();
      if (backendEmptyResult) return backendEmptyResult;
      if (fallbackEmptyResult) return fallbackEmptyResult;
      if (backendError instanceof Error) throw backendError;
      throw new Error('资源检索服务暂时不可用');
    }
  }

  private async executeBackendFetch(keyword: string): Promise<SearchResult> {
    const targetUrl = `${apiUrl('/api/resource-search')}?kw=${encodeURIComponent(keyword)}`;
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
        url.searchParams.set('src', 'plugin');
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
    const merged = data.merged_by_type || {};

    const driveTypes: DriveType[] = ['quark', 'aliyun', 'baidu', 'xunlei', '115', 'uc', 'tianyi', 'mobile'];
    driveTypes.forEach(type => {
      const list = merged[type] || [];
      list.forEach((raw: any) => {
        items.push(this.parseSingleItem(raw, type));
      });
    });

    items.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
    const quarkItems = items.filter(i => i.driveType === 'quark');

    return {
      success: true,
      total: data.total || items.length,
      items,
      quarkItems,
      source: sourceMode
    };
  }

  private parseSingleItem(raw: any, driveType: DriveType): ResourceItem {
    const note = raw.note || raw.title || '高清完整版资源';
    const is4k = /4k|2160p|uhd|杜比|hdr/i.test(note);
    const is1080p = /1080p|fhd|蓝光/i.test(note);
    const quality = is4k ? '4K 杜比臻彩' : (is1080p ? '1080P 高清' : '全集完结');
    const rawDatetime = String(raw.datetime || '').trim();
    const parsedDatetime = Date.parse(rawDatetime);
    const year = Number.isFinite(parsedDatetime) ? new Date(parsedDatetime).getFullYear() : 0;
    const datetime = year >= 2001 ? rawDatetime.substring(0, 10) : '近期收录';

    return {
      id: Math.random().toString(36).substring(2, 9),
      title: note,
      url: raw.url || `https://pan.quark.cn/s/search?kw=${encodeURIComponent(note)}`,
      password: raw.password || '',
      driveType,
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
