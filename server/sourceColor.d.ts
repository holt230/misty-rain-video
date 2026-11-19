export type SourceColor = 'sdr' | 'unknown' | 'hdr' | 'dolby-vision';
export function sourceColor(label?: string): SourceColor;
export function sourceColorRank(color?: SourceColor): number;
export function fileSourceColor(entry: { name: string; ancestorFids?: string[] }, folderNames: ReadonlyMap<string, string>, releaseTitle?: string): SourceColor;
export function leastCompatibleColor(colors: Iterable<SourceColor>): SourceColor;
