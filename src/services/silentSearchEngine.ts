import type { ResourceItem, SearchResult } from '../types/search';
import { apiUrl } from './appUrl';
import { authFetch } from './authService';
import { parseLibraryInput } from './libraryFeedback';
import { isNonVideoResource } from './resourceFiltering';
import { matchesResourceTitle, resourceHeading } from './resourceTitles';

const REQUEST_TIMEOUT_MS = 35_000;
const normalizeKeyword = (keyword: string) => keyword.normalize('NFKC').replace(/[《》()（）]/g, ' ').replace(/\s+/g, ' ').trim();

/** Only query the application once for the submitted title. Results are never cached here. */
export class SilentSearchEngine {
  private inFlight = new Map<string, Promise<SearchResult>>();
  private controllers = new Set<AbortController>();

  cancelPending() {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear(); this.inFlight.clear();
  }

  async search(keyword: string): Promise<SearchResult> {
    const clean = normalizeKeyword(keyword);
    if (!clean) return this.failed('请输入片名');
    const key = clean.toLocaleLowerCase('zh-CN');
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const controller = new AbortController();
    this.controllers.add(controller);
    const task = this.request(clean, controller).finally(() => {
      this.controllers.delete(controller);
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  private async request(keyword: string, controller: AbortController): Promise<SearchResult> {
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await authFetch(`${apiUrl('/api/resource-search')}?${new URLSearchParams({ kw: keyword })}`, {
        method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal
      });
      const envelope = await response.json();
      if (controller.signal.aborted) return this.failed('搜索已取消');
      if (!response.ok || envelope.code !== 0 || !envelope.data) return this.failed(envelope.message || '搜索失败，请重试');
      const data = envelope.data;
      if (data.stale || data.refreshing || data.fromCache || data.from_cache) return this.failed('搜索未返回本次完整结果，请重试');
      if (!(data.total === 0 && data.merged_by_type == null) && (!data.merged_by_type || typeof data.merged_by_type !== 'object' || Array.isArray(data.merged_by_type))) return this.failed('搜索返回了无效数据，请重试');
      const seen = new Set<string>();
      const rows = Array.isArray(data.merged_by_type?.quark) ? data.merged_by_type.quark : [];
      const items: ResourceItem[] = [];
      for (const raw of rows) {
        const item = this.parseSingleItem(raw);
        if (!item || isNonVideoResource(item.title, keyword) || !matchesResourceTitle(keyword, item.title) || seen.has(item.url)) continue;
        seen.add(item.url); items.push(item);
      }
      if (data.partial && !items.length) return this.failed('部分搜索来源请求失败，本次没有取得匹配结果，请重试');
      return { success: true, total: items.length, items, quarkItems: items, source: 'direct', partial: Boolean(data.partial), ...(data.message ? { message: String(data.message) } : {}) };
    } catch (error) {
      return this.failed(error instanceof DOMException && error.name === 'AbortError' ? '搜索超时，请重试' : '搜索失败，请检查网络后重试');
    } finally { clearTimeout(timer); }
  }

  private parseSingleItem(raw: any): ResourceItem | null {
    if (!raw || typeof raw !== 'object') return null;
    const note = String(raw.note || raw.title || '');
    const title = resourceHeading(note);
    const share = parseLibraryInput(`${String(raw.url || '')}\n${note}`);
    if (share.kind !== 'share') return null;
    const is4k = /4k|2160p|uhd|杜比|hdr/i.test(title);
    const quality = is4k ? '4K 超高清' : /1080p|fhd|蓝光/i.test(title) ? '1080P 超清' : '清晰度待解析';
    const rawDate = String(raw.datetime || '').trim();
    const parsed = Date.parse(rawDate);
    return { id: `quark-${share.url.split('/').pop()}`, title, url: share.url, password: raw.password || share.passcode,
      driveType: 'quark', datetime: Number.isFinite(parsed) && new Date(parsed).getFullYear() >= 2001 ? rawDate.substring(0, 10) : '日期未知', source: raw.source || '', quality, is4k };
  }

  private failed(message: string): SearchResult { return { success: false, total: 0, items: [], quarkItems: [], source: 'error', message }; }
}
