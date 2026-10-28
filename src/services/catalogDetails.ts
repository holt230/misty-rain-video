import { authFetch } from './authService';
import { apiUrl, withAppBase } from './appUrl';
import type { DiscoveryItem } from './discoveryService';
export interface CatalogPhoto { id: string; image: string; fullImage: string; description: string }
export interface CatalogComment { id: string; author: string; text: string; rating: number; date: string; votes: number }
export interface ContentPage<T> { items: T[]; total: number; nextStart: number | null; stale: boolean }
export interface CatalogDetails extends DiscoveryItem {
  originalTitle: string; languages: string[]; premieres: string[]; durations: string[]; aliases: string[];
  episodeCount: number; directors: string[]; writers: string[]; imdb: string; creditCount: number;
  credits: { name: string; role: string; image: string; url: string }[];
  photos: CatalogPhoto[]; photoCount: number;
  comments: CatalogComment[];
  commentCount: number; reviewCount: number; honors: string[]; partial: boolean; stale: boolean;
}
export const subjectIdFromHash = (hash: string) => hash.match(/^#\/subject\/((?:douban|bangumi)-[1-9]\d{0,12})$/)?.[1] || '';
export async function loadCatalogDetails(id: string, signal: AbortSignal): Promise<CatalogDetails> {
  const response = await authFetch(apiUrl(`/api/catalog/subjects/${encodeURIComponent(id)}`), { signal, cache: 'no-store' });
  const json = await response.json();
  if (!response.ok || json.code !== 0 || json.data?.id !== id) throw new Error(response.status === 404 ? '没有找到这部影片' : '详情暂时无法加载');
  const detail: CatalogDetails = json.data;
  return { ...detail, poster: withAppBase(detail.poster),
    credits: detail.credits.map(person => ({ ...person, image: withAppBase(person.image) })),
    photos: detail.photos.map(photo => ({ ...photo, image: withAppBase(photo.image), fullImage: withAppBase(photo.fullImage) })) };
}

export async function loadCatalogContent<T extends CatalogPhoto | CatalogComment>(id: string, section: 'photos' | 'comments', start: number, signal: AbortSignal): Promise<ContentPage<T>> {
  const response = await authFetch(apiUrl(`/api/catalog/subjects/${encodeURIComponent(id)}/${section}?start=${start}`), { signal, cache: 'no-store' });
  const json = await response.json();
  if (!response.ok || json.code !== 0 || !Array.isArray(json.data?.items)) throw new Error('暂时无法加载，请稍后重试');
  const page: ContentPage<T> = json.data;
  return { ...page, items: page.items.map(item => 'image' in item ? { ...item, image: withAppBase(item.image), fullImage: withAppBase(item.fullImage) } : item) };
}
