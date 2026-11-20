import type { CatalogItem } from '../types/catalog';
import type { MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import type { QuarkShareDetails } from './quarkStreamService';
import { isNonVideoResource } from './resourceFiltering';
import { compareResourceColors, matchResource, resourceEpisode } from './resourceMatching';
import { isExactWorkTitle } from '../../server/searchTitles.js';
import { hasPublishedVideoIdentity, matchesIndexedTvDirectory, shareVideoCandidates, validateSourceCandidate } from '../../server/libraryPolicy.js';
import { matchesResourceTitle } from './resourceTitles';

export type PlaybackWork = Pick<CatalogItem, 'title' | 'category'> & { year?: string };

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
  const identities = new Set([item.catalogId, ...(item.catalogAliases || [])]);
  const linked = library.find(media => media.quarkFid && [media.catalogId, ...(media.catalogAliases || [])].some(id => id && identities.has(id)));
  if (linked) return linked;
  if (item.platforms?.length && !item.year) return undefined;
  const candidates = library.filter(media => media.quarkFid && media.category === item.category
    && normalize(media.title) === normalize(item.title) && (!item.year || media.year === item.year));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** An unversioned personal copy is an explicit playback choice, not an edition match. */
export function findUnversionedCatalogMedia(item: CatalogItem, library: MediaItem[]) {
  if (findCatalogMedia(item, library)) return undefined;
  if (!item.year && item.platforms?.length) {
    const copies = library.filter(media => media.quarkFid && media.category === item.category && normalize(media.title) === normalize(item.title));
    return copies.length === 1 ? copies[0] : undefined;
  }
  if (!item.year) return undefined;
  const sameTitle = library.filter(media => media.quarkFid && media.category === item.category
    && normalize(media.title) === normalize(item.title));
  if (sameTitle.length !== 1 || sameTitle[0].year || sameTitle[0].catalogId) return undefined;
  return sameTitle[0];
}
export function matchesCatalogTitle(item: PlaybackWork, title: string, requireYear = true) {
  if (!item.title.trim() || isNonVideoResource(title, item.title) || /解说|混剪|沙雕|有声|合集|全季|多季/.test(title)) return false;
  if (requireYear && (!item.year || year(title) !== item.year)) return false;
  if (!requireYear && year(title) && item.year && year(title) !== item.year) return false;
  if (season(item.title) !== season(title)) return false;
  const pattern = new RegExp('(^|[^\\p{L}\\p{N}])' + escape(item.title).replace(/\s+/g, '\\s*') + '(?=$|[^\\p{L}\\p{N}])', 'iu');
  return pattern.test(title) || normalize(title) === normalize(item.title);
}
export function automaticCatalogCandidates(item: PlaybackWork, resources: ResourceItem[]) {
  return resources.filter(resource => /^https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:[/?#]|$)/.test(resource.url)
    && (resource.workTitle ? isExactWorkTitle(item.title, resource.workTitle) && (!item.year || item.year === resource.year)
      && (!resource.category || resource.category === item.category) : matchesCatalogTitle(item, resource.title))
    && matchResource(item.title, resource.title, item.category).matches
    && !matchResource(item.title, resource.title, item.category).conflict
    && !(item.category === 'anime' && /短剧|真人/.test(resource.title)))
    .sort((a, b) => (item.category === 'movie' ? 0
      : (b.verification?.latestEpisode ?? b.latestEpisode ?? resourceEpisode(b.title))
        - (a.verification?.latestEpisode ?? a.latestEpisode ?? resourceEpisode(a.title)))
      || compareResourceColors(a, b));
}

export function validatesCatalogShare(item: PlaybackWork, details: QuarkShareDetails, resource?: ResourceItem, { allowUnspecifiedSeason = false } = {}) {
  if (matchesIndexedTvDirectory(item, details.title, resource)) {
    const videos = shareVideoCandidates(details.entries);
    return Boolean(details.videoCount) && validateSourceCandidate({ card: item, shareTitle: details.title,
      episodes: videos, localEpisodes: videos, publication: resource });
  }
  if (details.videoCount && resource?.workTitle) {
    const videos = shareVideoCandidates(details.entries);
    if (videos.length === details.entries.filter(entry => entry.isVideo).length
      && hasPublishedVideoIdentity(item, details.title, videos, resource)) return true;
  }
  if (allowUnspecifiedSeason && explicitSeason(item.title) === undefined) {
    const match = matchResource(item.title, details.title, item.category);
    // Public posts often use a publisher marker plus a shortened directory name
    // (e.g. "M 牧神"). Only accept a strict Han prefix when the posted work name
    // independently matches, with no other edition/season or extra title text.
    const directoryPrefix = details.title.normalize('NFKC').match(/^[A-Z]\s+([\p{Script=Han}]{2,})(?:\s*[(（](?:19|20)\d{2}[)）])?\s*$/u)?.[1] || '';
    const workKey = normalize(item.title);
    const posted = resource ? matchResource(item.title, resource.title, item.category) : undefined;
    const publishedPrefix = Boolean(resource?.source === 'public_guoman4K' && posted?.matches && !posted.otherVersion
      && directoryPrefix && workKey.startsWith(normalize(directoryPrefix)) && directoryPrefix.length >= Math.ceil(workKey.length / 2));
    const exactPublished = Boolean(resource?.workTitle && isExactWorkTitle(item.title, resource.workTitle));
    const literalDirectory = normalize(details.title).replace(/^[a-z](?=[\p{Script=Han}])/u, '').replace(/(?:19|20)\d{2}$/, '');
    const punctuatedName = exactPublished && literalDirectory === workKey;
    if (!details.videoCount || (!(match.matches && !match.otherVersion) && !publishedPrefix && !punctuatedName)
      || (item.year && year(details.title) && year(details.title) !== item.year)) return false;
    const videos = details.entries.filter(entry => entry.isVideo);
    const seasons = new Set([details.title, ...details.entries.filter(entry => entry.isVideo || entry.isDirectory).map(entry => entry.name)]
      .map(explicitSeason).filter(value => value !== undefined));
    return videos.length > 0 && seasons.size <= 1;
  }
  const metadataMatch = resource?.workTitle && isExactWorkTitle(item.title, resource.workTitle) && matchesResourceTitle(item.title, details.title)
    && (!item.year || !year(details.title) || year(details.title) === item.year);
  if (!details.videoCount || !(matchesCatalogTitle(item, details.title, false) || metadataMatch)) return false;
  const videos = details.entries.filter(entry => entry.isVideo);
  if (!videos.length) return false;
  if (metadataMatch && resource?.workTitle && explicitSeason(item.title) === undefined && explicitSeason(resource.workTitle) === undefined) {
    const found = new Set(details.entries.filter(entry => entry.isVideo || entry.isDirectory).map(entry => explicitSeason(entry.name)).filter(value => value !== undefined));
    return found.size <= 1;
  }
  return details.entries.every(entry => !(entry.isVideo || entry.isDirectory) || explicitSeason(entry.name) === undefined || season(entry.name) === season(item.title));
}
