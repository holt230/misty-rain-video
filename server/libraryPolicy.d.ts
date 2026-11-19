import type { QuarkShareEntry } from '../src/services/quarkStreamService';

type Work = { title: string; category: string; year?: string };
type Publication = { source: string; workTitle?: string; category?: string; year?: string };
type SourceVideo = { entry: QuarkShareEntry; fileName: string; episodeNumber: number; size: number; sourcePath: string; seasonNumber: number };

export function matchesIndexedTvDirectory(card: Work, shareTitle: string, publication?: Publication): boolean;
export function shareVideoCandidates(entries: QuarkShareEntry[]): SourceVideo[];
export function validateSourceCandidate(input: {
  card: Work; shareTitle: string; episodes: SourceVideo[]; localEpisodes: SourceVideo[]; publication?: Publication;
}): boolean;
