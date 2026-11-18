import type { CategoryType } from './media';
export type SearchCategory = CategoryType | 'all';
export type DriveType = 'quark' | 'aliyun' | 'baidu' | 'xunlei' | '115' | 'uc' | 'tianyi' | 'mobile' | 'other';

export interface OfficialWorkProgress {
  id: string;
  title: string;
  category: 'anime' | 'tv';
  year: string;
  latestEpisode: number;
  completed: boolean;
  platform: string;
  sourceUrl: string;
}

export interface OfficialProgress {
  status: 'confirmed' | 'unknown' | 'unavailable';
  works: OfficialWorkProgress[];
  checkedAt: string;
  message: string;
}

export interface ResourceItem {
  id: string;
  title: string;
  url: string;
  password?: string;
  driveType: DriveType;
  datetime: string;
  source: string;
  quality: string;
  is4k: boolean;
  size?: string;
  workTitle?: string;
  category?: CategoryType;
  updateText?: string;
  latestEpisode?: number;
  year?: string;
  sourceUrl?: string;
  batchEligible?: boolean;
  archivePreparation?: { archiveFid: string; episode: number; fileName: string; bytes: number; requiredMembership: string; notice: string; summary?: string; availableEpisodes?: number[]; missingEpisodes?: number[]; batchEligible?: boolean };
  verification?: {
    summary: string;
    episodeCount: number;
    latestEpisode: number;
    requestedEpisode?: number;
    selectedFids?: string[];
    requiredEpisodes: number[];
    shareTitle: string;
    complete?: boolean;
    notice?: string;
  };
}

export interface SearchResult {
  success: boolean;
  total: number;
  items: ResourceItem[];
  quarkItems: ResourceItem[];
  source: 'direct' | 'error';
  partial?: boolean;
  message?: string;
}

export interface AppSettings {
  baseUrl: string;
  authToken: string;
  corsProxy: string;
}

export interface DriveCountMap {
  all: number;
  quark: number;
  aliyun: number;
  baidu: number;
  xunlei: number;
  115: number;
  uc: number;
  tianyi: number;
  [key: string]: number;
}
