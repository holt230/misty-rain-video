import type { CatalogItem } from '../types/catalog';
import type { MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import type { QuarkShareDetails } from './quarkStreamService';

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const escape = (value: string) => value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
const year = (value: string) => value.match(/(?:19|20)\d{2}/)?.[0] || '';
const explicitSeason = (value: string): number | undefined => {
  const match = value.match(/第([一二三四五六七八九十\d]+)季|(?:^|[^a-z0-9])s0*(\d{1,2})(?=$|[^a-z0-9]|e\d)|(?:^|[^a-z0-9])season[ ._-]*0*(\d{1,2})(?=$|[^a-z0-9])/i);
  if (!match) return undefined;
  const raw = match[1] || match[2] || match[3] || '';
  if (/^\d+$/.test(raw)) return Number(raw);
  const digits = '零一二三四五六七八九';
  if (raw.includes('十')) {
    const [a, b] = raw.split('十');
    return (a ? digits.indexOf(a) : 1) * 10 + (b ? digits.indexOf(b) : 0);
  }
  return digits.indexOf(raw);
};
const season = (value: string) => explicitSeason(value) ?? 1;
export function findCatalogMedia(item: CatalogItem, library: MediaItem[]) {
  const linked = library.find(media => media.catalogId === item.catalogId && media.quarkFid);
  if (linked) return linked;
  const candidates = library.filter(media => media.quarkFid && media.category === item.category
    && normalize(media.title) === normalize(item.title) && (!item.year || media.year === item.year));
  return candidates.length === 1 ? candidates[0] : undefined;
}
export function matchesCatalogTitle(item: CatalogItem, title: string, requireYear = true) {
  if (!item.title.trim() || /解说|混剪|沙雕|有声|合集|全季|多季/.test(title)) return false;
  if (requireYear && (!item.year || year(title) !== item.year)) return false;
  if (!requireYear && year(title) && item.year && year(title) !== item.year) return false;
  if (season(item.title) !== season(title)) return false;
  const pattern = new RegExp('(^|[^\\p{L}\\p{N}])' + escape(item.title).replace(/\s+/g, '\\s*') + '(?=$|[^\\p{L}\\p{N}])', 'iu');
  return pattern.test(title) || normalize(title) === normalize(item.title);
}
export function automaticCatalogCandidates(item: CatalogItem, resources: ResourceItem[]) {
  return resources.filter(resource => /^https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:[/?#]|$)/.test(resource.url)
    && matchesCatalogTitle(item, resource.title)
    && !(item.category === 'anime' && /短剧|真人/.test(resource.title)));
}

export function validatesCatalogShare(item: CatalogItem, details: QuarkShareDetails) {
  if (!details.videoCount || !matchesCatalogTitle(item, details.title, false)) return false;
  const videos = details.entries.filter(entry => entry.isVideo);
  if (!videos.length) return false;
  return details.entries.every(entry => !(entry.isVideo || entry.isDirectory) || explicitSeason(entry.name) === undefined || season(entry.name) === season(item.title));
}
