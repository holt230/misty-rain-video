import type { CategoryType, MediaItem } from './media';

export type CatalogChannel = CategoryType | 'new';
export interface CatalogItem extends MediaItem {
  catalogId: string;
  year: string;
  rating?: number;
  subtitle: string;
  sourceName: string;
  sourceUrl: string;
}
export interface CatalogFeed {
  channel: CatalogChannel;
  items: CatalogItem[];
  updatedAt: string;
  stale: boolean;
  refreshing?: boolean;
  message: string;
}
