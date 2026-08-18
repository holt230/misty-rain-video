import type { MediaItem, CategoryType, LibraryUpdateApplySummary, LibraryUpdateSummary } from '../types/media';
import { apiUrl, withAppBase } from './appUrl';
import { authFetch } from './authService';

const API_URL = apiUrl('/api/media-cards');

const hydrateMedia = (items: MediaItem[]): MediaItem[] => items.map(item => ({
  ...item,
  poster: withAppBase(item.poster)
}));

export class MediaStore {
  /** 从当前账户的服务端片库拉取数据（同一账户跨终端同步）。 */
  static async getAllMedia(): Promise<MediaItem[]> {
    const resp = await authFetch(API_URL);
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.code !== 0 || !Array.isArray(json.data)) {
      throw new Error(json.message || '读取片库失败');
    }
    return hydrateMedia(json.data);
  }

  /**
   * 获取指定分类下的片单
   */
  static async getMediaByCategory(category: CategoryType): Promise<MediaItem[]> {
    const all = await this.getAllMedia();
    return all.filter(item => item.category === category);
  }

  /**
   * 获取各大分类的片单数量
   */
  static async getCategoryCounts(): Promise<Record<CategoryType, number>> {
    const all = await this.getAllMedia();
    const counts: Record<CategoryType, number> = {
      tv: 0,
      movie: 0,
      variety: 0,
      anime: 0
    };
    all.forEach(item => {
      if (counts[item.category] !== undefined) {
        counts[item.category]++;
      }
    });
    return counts;
  }

  /**
   * 保存/新增影片卡片到服务端持久化数据库
   */
  static async saveMedia(item: MediaItem): Promise<MediaItem[]> {
    const resp = await authFetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.code !== 0 || !Array.isArray(json.data)) {
      throw new Error(json.message || '转存到云端片库失败');
    }
    const items = hydrateMedia(json.data);
    return items;
  }

  /**
   * 从服务端持久化数据库删除指定卡片
   */
  static async removeMedia(media: MediaItem): Promise<MediaItem[]> {
    const params = new URLSearchParams({ id: media.id, title: media.title });
    const resp = await authFetch(`${API_URL}?${params}`, { method: 'DELETE' });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.code !== 0) {
      throw new Error(json.message || '删除失败，请稍后重试');
    }
    return this.getAllMedia();
  }

  /** 保存用户选择的展示分类；不会移动或删除网盘文件。 */
  static async updateCategory(title: string, category: CategoryType): Promise<void> {
    const resp = await authFetch(apiUrl('/api/media-cards/category'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category })
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.code !== 0) {
      throw new Error(json.message || '分类更新失败');
    }
  }

  static async checkLibraryUpdates(force = false): Promise<LibraryUpdateSummary> {
    const suffix = force ? '?force=1' : '';
    const resp = await authFetch(`${apiUrl('/api/library-updates')}${suffix}`, { cache: 'no-store' });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.code !== 0 || !Array.isArray(json.data?.items)) {
      throw new Error(json.message || '检查片库更新失败');
    }
    return json.data;
  }

  static async applyLibraryUpdates(quarkFids: string[]): Promise<LibraryUpdateApplySummary> {
    const resp = await authFetch(apiUrl('/api/library-updates/apply'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quarkFids })
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.code !== 0 || !Array.isArray(json.data?.items)) {
      throw new Error(json.message || '更新片库失败');
    }
    return json.data;
  }
}
