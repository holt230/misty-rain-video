export function searchTitleKey(value: string): string;
export function hasConflictingOfficialEditions(works: { platform: string; latestEpisode: number; completed?: boolean }[]): boolean;
export function isExactWorkTitle(keyword: string, title: string): boolean;
