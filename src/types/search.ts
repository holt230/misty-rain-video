export type DriveType = 'quark' | 'aliyun' | 'baidu' | 'xunlei' | '115' | 'uc' | 'tianyi' | 'mobile' | 'other';

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
}

export interface SearchResult {
  success: boolean;
  total: number;
  items: ResourceItem[];
  quarkItems: ResourceItem[];
  source: 'direct' | 'cors_proxy' | 'cache' | 'error';
  fromCache?: boolean;
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
