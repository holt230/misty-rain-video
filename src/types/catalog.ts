import type { CategoryType, MediaItem } from './media';

export type CatalogChannel = CategoryType | 'new';
export type CatalogPlatform = 'qq' | 'mango' | 'youku' | 'iqiyi';
export interface CatalogPlatformSource { id: CatalogPlatform; name: string; catalogId: string; url: string }
export interface CatalogSourceState { id: CatalogPlatform; name: string; status: 'success' | 'stale' | 'unavailable'; count: number; updatedAt: string; refreshing?: boolean }
export interface CatalogItem extends MediaItem {
  catalogId: string;
  year: string;
  rating?: number;
  ratingSource?: string;
  backdrop?: string;
  platforms?: CatalogPlatformSource[];
  subtitle: string;
  sourceName: string;
  sourceUrl: string;
}
export interface CatalogFeed {
  channel: CatalogChannel;
  platform?: CatalogPlatform | 'all';
  sourceName?: string;
  sources?: CatalogSourceState[];
  page?: number;
  pageSize?: number;
  revision?: string;
  hasMore?: boolean;
  total?: number;
  loadError?: boolean;
  items: CatalogItem[];
  updatedAt: string;
  stale: boolean;
  refreshing?: boolean;
  message: string;
}
export interface CatalogBrowseState {
  items: CatalogItem[];
  page: number;
  revision: string;
  hasMore: boolean;
  loading: boolean;
  error: string;
  needsRefresh: boolean;
  endMessage: string;
}

export interface CatalogCredit {
  id: string;
  name: string;
  latinName: string;
  role: string;
  avatar: string;
}
export interface CatalogMetadataState {
  updatedAt: string;
  stale: boolean;
  refreshing: boolean;
  message: string;
  sourceUrl: string;
  sourceName: string;
}
export interface CatalogWorkDetails extends CatalogMetadataState {
  rating?: number;
  ratingSource?: string;
  catalogId: string;
  catalogAliases?: string[];
  title: string;
  year?: string;
  summary: string;
  genres: string[];
  countries: string[];
  languages: string[];
  releaseDates: string[];
  durations: string[];
  episodeCount?: number;
  directors: CatalogCredit[];
  actors: CatalogCredit[];
}
export interface CatalogPersonDetails extends CatalogMetadataState {
  id: string;
  name: string;
  latinName: string;
  avatar: string;
  description: string;
  info: { label: string; value: string }[];
}
export interface CatalogComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  rating?: number;
  upvotes: number;
}
export interface CatalogComments extends CatalogMetadataState {
  catalogId: string;
  start: number;
  total: number;
  items: CatalogComment[];
  hasMore: boolean;
}
