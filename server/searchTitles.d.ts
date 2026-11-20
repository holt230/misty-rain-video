export function searchTitleKey(value: string): string;
export function workTitleKeys(title: string): readonly string[];
export function hasConflictingOfficialEditions(works: { platform: string; latestEpisode: number; completed?: boolean }[]): boolean;
export function isExactWorkTitle(keyword: string, title: string): boolean;
