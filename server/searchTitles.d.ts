export function searchTitleKey(value: string): string;
export function workTitleKeys(title: string): readonly string[];
export function hasConflictingOfficialEditions(works: { platform: string; latestEpisode: number; completed?: boolean }[]): boolean;
export function isExactWorkTitle(keyword: string, title: string): boolean;
export function isTheatricalTitle(title: string): boolean;
export function workFormat<T extends string>(title: string, category: T): T | 'movie';

export function sameWorkEdition(left: string, right: string): boolean;
export function seasonQuery(title: string): { base: string; number: number; han: string } | undefined;
