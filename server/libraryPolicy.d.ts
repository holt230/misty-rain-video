import type { QuarkShareDetails, QuarkShareEntry } from '../src/services/quarkStreamService';
import type { ResourceItem } from '../src/types/search';

export function matchingShareFiles(work: { title: string; category: string; year?: string }, details: QuarkShareDetails,
  publication?: ResourceItem, options?: { allowUnspecifiedSeason?: boolean }): QuarkShareEntry[];
