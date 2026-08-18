export type CategoryType = 'tv' | 'movie' | 'variety' | 'anime';

export interface MediaItem {
  id: string;
  title: string;
  category: CategoryType;      // 所属类型：电视剧、电影、综艺、动漫
  tag: string;                 // 最多单个标签 (例如: 4K 夸克)
  poster: string;              // 封面海报
  posterSource?: string;       // 自动匹配的海报数据源
  posterMatchedTitle?: string; // 海报数据源中的匹配片名
  duplicateCount?: number;     // 被折叠的同名片库目录数量
  desc?: string;               // 简短描述
  status?: string;             // 状态 (如: 完结/更新中)
  quarkShareUrl?: string;      // 夸克网盘直链
  quarkPasscode?: string;      // 分享提取码（如资源需要）
  quarkFid?: string;           // 烟雨影视片库中的夸克目录 ID
  quarkQuality?: string;       // 夸克画质 (如: 4K 臻彩)
  localEpisodeCount?: number;  // 当前片库中的正片数量
  sourceEpisodeCount?: number; // 原片源中的正片数量
  latestEpisodeNumber?: number;// 原片源最新集数
  latestEpisodeTitle?: string; // 原片源最新一集标题
  newEpisodeCount?: number;    // 尚未转存到片库的正片数量
  updateCheckedAt?: string;    // 最近一次片源检查时间
  updateCheckAvailable?: boolean;
  updateMessage?: string;      // 无法检查或补充时的用户可读原因
}

export interface LibraryUpdateStatus {
  quarkFid: string;
  title: string;
  localEpisodeCount: number;
  sourceEpisodeCount: number;
  latestEpisodeNumber: number;
  latestEpisodeTitle: string;
  newEpisodeCount: number;
  updateCheckedAt: string;
  updateCheckAvailable: boolean;
  message?: string;
}

export interface LibraryUpdateSummary {
  items: LibraryUpdateStatus[];
  checkedAt: string;
}

export interface LibraryUpdateApplySummary extends LibraryUpdateSummary {
  transferredCount: number;
  failedCount: number;
  failures: Array<{
    title: string;
    message: string;
  }>;
}

export interface PlaybackHistoryEntry {
  id: string;
  media: MediaItem;
  episodeFid: string;
  episodeNumber: number;
  episodeTitle: string;
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: string;
}

export type PlaybackHistoryUpdate = Omit<PlaybackHistoryEntry, 'id' | 'updatedAt'>;
