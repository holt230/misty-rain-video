import type { CatalogFilters } from '../../server/catalogFacets.js';
import type { CatalogSort } from './catalogSort';
import { authFetch } from './authService';
import { apiUrl, withAppBase } from './appUrl';
import type { CategoryType, MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';

export type DiscoveryCategory = CategoryType | 'all';
export interface DiscoveryItem {
  id: string; provider: 'douban' | 'bangumi'; title: string; category: CategoryType;
  poster: string; year: string; rating: number | null; ratingCount?: number | null; subtitle: string; description: string;
  sourceUrl: string; weekday?: number; genres?: string[]; countries?: string[];
}
export interface DiscoverySection {
  id: string; category: CategoryType; title: string; source: string; sourceUrl: string;
  updatedAt: string; stale: boolean; refreshing: boolean; failed: boolean; items: DiscoveryItem[];
}

export async function loadDiscovery(category: DiscoveryCategory, signal: AbortSignal): Promise<DiscoverySection[]> {
  const response = await authFetch(apiUrl(`/api/discovery?category=${category}`), { signal, cache: 'no-store' });
  const json = await response.json();
  if (!response.ok || json.code !== 0 || !Array.isArray(json.data?.sections)) throw new Error('推荐暂时无法加载');
  return json.data.sections.map((section: DiscoverySection) => ({ ...section,
    items: section.items.map(item => ({ ...item, poster: withAppBase(item.poster) })) }));
}

export async function searchCatalog(query: string, signal: AbortSignal): Promise<{ items: DiscoveryItem[]; partial: boolean }> {
  const response = await authFetch(apiUrl(`/api/catalog/search?q=${encodeURIComponent(query)}`), { signal });
  const json = await response.json();
  if (!response.ok || json.code !== 0 || !Array.isArray(json.data?.items)) throw new Error('影片信息暂时无法加载');
  return { items: json.data.items.map((item: DiscoveryItem) => ({ ...item, poster: withAppBase(item.poster) })), partial: Boolean(json.data.partial) };
}

export interface CatalogBrowseResult { items: DiscoveryItem[]; partial: boolean; nextStart: number | null }
export async function browseCatalog(category: DiscoveryCategory, filters: CatalogFilters, sort: CatalogSort, start: number, signal: AbortSignal): Promise<CatalogBrowseResult> {
  const params = new URLSearchParams({ category, ...filters, sort, start: String(start) });
  const response = await authFetch(apiUrl(`/api/catalog/browse?${params}`), { signal });
  const json = await response.json();
  if (!response.ok || json.code !== 0 || !Array.isArray(json.data?.items)) throw new Error('豆瓣筛选暂时不可用');
  return { items: json.data.items.map((item: DiscoveryItem) => ({ ...item, poster: withAppBase(item.poster) })),
    partial: Boolean(json.data.partial), nextStart: Number.isInteger(json.data.nextStart) ? json.data.nextStart : null };
}

export const discoveryMedia = (item: DiscoveryItem): MediaItem => ({
  id: `discovery:${item.id}`, catalogId: item.id, title: item.title, year: item.year,
  category: item.category, poster: item.poster, desc: item.description, tag: ''
});

export const resourcePlaybackMedia = (media: MediaItem, resource: ResourceItem, category: CategoryType): MediaItem => {
  const shareId = resource.url.match(/^https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]{1,80})(?:[?#]|$)/)?.[1];
  if (!shareId || media.quarkFid) throw new Error('请选择有效的播放资源');
  return { ...media, id: media.catalogId ? `discovery:${media.catalogId}` : `share:${shareId}`, category,
    quarkShareUrl: `https://pan.quark.cn/s/${shareId}`, quarkPasscode: resource.password || '',
    quarkQuality: resource.quality, quarkSelectionFids: undefined, tag: resource.quality || '' };
};
