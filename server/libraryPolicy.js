// Pure identity rules shared by storage and background source maintenance.
import { searchTitleKey, workTitleKeys } from './searchTitles.js';

const chineseNumbers = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
export const seasonNumber = value => {
  const text = String(value || '').normalize('NFKC');
  const number = text.match(/(?:^|[^a-z])s(\d{1,2})(?=e\d|[^a-z0-9]|$)/i)?.[1]
    || text.match(/第\s*(\d{1,2}|[一二三四五六七八九十])\s*季/)?.[1];
  return Number(number) || chineseNumbers[number] || 0;
};

export const episodeKey = (episode, defaultSeason = 1) => episode.episodeNumber > 0
  ? `episode:${episode.seasonNumber || defaultSeason}:${episode.episodeNumber}:${episode.episodePart || ''}`
  : `file:${String(episode.fileName || '').normalize('NFKC').toLowerCase()}:${Number(episode.size) || 0}`;

export const missingLibraryEpisodes = (local, source, card) => {
  // A saved movie is kept as-is; an alternative encode is not a new episode.
  if (card.category === 'movie' && local.length) return [];
  const season = seasonNumber(card.title) || 1;
  const saved = new Set(local.map(item => episodeKey(item, season)));
  return source.filter(item => !saved.has(episodeKey(item, season)));
};

export const libraryVideoName = (episode, category) => {
  const extension = String(episode.fileName || '').match(/\.[a-z0-9]{2,5}$/i)?.[0] || '';
  // Unnumbered specials/movies retain their names so identity survives a restart.
  if (category === 'movie' || !episode.episodeNumber || !extension) return episode.fileName;
  const season = episode.seasonNumber ? `第${String(episode.seasonNumber).padStart(2, '0')}季 ` : '';
  const part = episode.episodePart ? `（${episode.episodePart}）` : '';
  return `${season}第${String(episode.episodeNumber).padStart(2, '0')}集${part}${extension}`;
};

export const isAncillaryVideoPath = value => String(value || '').split('/').some(part =>
  /(?:^|[\s._\-【\[(（])(?:预告片?|花絮|幕后花絮|宣传片|广告|推广|片头|片尾|资源说明)(?=[\s._\-】\])）\d]|$)/.test(part));

const cleanTitle = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[\s·:：_.,，。《》【】\[\]()（）-]/g, '');
const titleMatches = (title, value) => {
  const expected = cleanTitle(title);
  const actual = cleanTitle(value);
  if (expected.length < 2 || !actual.startsWith(expected)) return false;
  // Only known release descriptors may follow an exact title. A sequel, other
  // season, or mixed collection must not pass a substring match.
  return /^(?:(?:19|20)\d{2}|4k|1080p|2160p|720p|高清|超清|蓝光|原盘|中字|国语|粤语|双语|简繁|无水印|全集|完结|更新至?\d+集?|全\d+集|\d+集|h26[45]|hevc|webdl|web|aac|mkv|mp4)*$/i
    .test(actual.slice(expected.length));
};

const releaseDirectory = value => /^(?:s\d{1,2}|第[\d一二三四五六七八九十]+季|4k|1080p|2160p|720p|高清|超清|正片|国语|粤语|全集|完结)+$/i.test(cleanTitle(value));
const supplemental = /预告|花絮|片头|片尾|幕后|宣传片|解说|混剪|特别篇|番外|(?:^|[\s._-])(?:sample|trl|trailer|preview|op|ed|mv)(?:[\s._-]|$)/i;
const releaseYears = value => String(value || '').match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) || [];
const fileTitle = value => value.replace(/\.[a-z0-9]{2,5}$/i, '');
const episodeTitle = name => name.split(/(?:^|[\s._\-【[(])(?:s\d{1,2}e\d+|e(?:p|pisode)?[\s._-]*\d+)|第\s*\d+\s*[集话期]/i)[0];

export function hasPublishedVideoIdentity(card, shareTitle, videos, publication) {
  if (!['erxiaopan', 'quark4k'].includes(publication?.source) || publication.category !== card.category
    || !/^(?:19|20)\d{2}$/.test(publication.year || '') || (card.year && card.year !== publication.year)
    || !workTitleKeys(card.title).includes(searchTitleKey(publication.workTitle)) || !videos.length) return false;

  const year = publication.year;
  const season = seasonNumber(card.title) || 1;
  const titles = [...workTitleKeys(card.title), ...(publication.workTitleAliases || []).flatMap(workTitleKeys)];
  const matchesTitle = name => titles.some(title => titleMatches(title, name));
  const conflicts = name => {
    const text = String(name || '').normalize('NFKC');
    const seasonLabels = text.match(/第\s*[\d零〇一二两三四五六七八九十百]+\s*季|(?:^|[^a-z0-9])s\d{1,3}(?=e\d|[^a-z0-9]|$)/ig) || [];
    return supplemental.test(text) || releaseYears(text).some(value => value !== year)
      || seasonLabels.some(label => seasonNumber(label) !== season);
  };
  if (conflicts(shareTitle)) return false;

  return videos.every(video => {
    const name = fileTitle(video.fileName);
    if (conflicts(name)) return false;
    const paths = String(video.sourcePath || '').split('/').filter(Boolean);
    if (paths.some((part, index) => conflicts(part) || (!matchesTitle(part) && !releaseDirectory(part)
      && !(index === 0 && directoryKey(part) === directoryKey(shareTitle))))) return false;
    if (card.category === 'movie') return releaseYears(name).includes(year) && matchesTitle(name);
    if (!Number.isInteger(video.episodeNumber) || video.episodeNumber < 1 || video.episodeNumber > 5000) return false;
    const numberedFile = /^(?:s\d{1,2}[ ._-]*ep?[ ._-]*\d{1,4}|ep?[ ._-]*\d{1,4}|第\s*\d{1,4}\s*[集话期]|\d{1,4})(?:[ ._-]+(?:4k|720p|1080p|2160p|sdr|hdr))*$/i;
    return matchesTitle(episodeTitle(name)) || ((matchesTitle(shareTitle) || paths.some(matchesTitle)) && numberedFile.test(name));
  });
}

// Verified directory names from the structured TV index, scoped to their exact work.
const indexedTvDirectories = new Map([
  ['多喜一家人', '多喜'],
  ['折月亮', '【z】折丨y越亮']
]);
const directoryKey = value => String(value || '').normalize('NFKC').trim().toLowerCase();

export function matchesIndexedTvDirectory(card, shareTitle, publication) {
  if (card.category !== 'tv' || publication?.source !== 'erxiaopan' || publication.category !== 'tv') return false;
  const work = searchTitleKey(card.title);
  return work === searchTitleKey(publication.workTitle) && (!card.year || card.year === publication.year)
    && indexedTvDirectories.get(work) === directoryKey(shareTitle);
}

export function shareVideoCandidates(entries) {
  const folders = new Map(entries.filter(entry => entry.isDirectory).map(entry => [entry.fid, entry.name]));
  return entries.filter(entry => entry.isVideo).map(entry => {
    const sourcePath = (entry.ancestorFids || []).map(fid => folders.get(fid) || '').filter(Boolean).join('/');
    return { entry, fileName: entry.name, episodeNumber: entry.episodeNumber, size: entry.size, sourcePath,
      seasonNumber: seasonNumber(`${sourcePath}/${entry.name}`) };
  }).filter(item => !isAncillaryVideoPath(`${item.sourcePath}/${item.fileName}`));
}

export const validateSourceCandidate = ({ card, shareTitle, episodes, localEpisodes, publication }) => {
  if (!episodes.length || !localEpisodes.length) return false;
  const indexedDirectory = matchesIndexedTvDirectory(card, shareTitle, publication);
  const matchesAlias = value => indexedDirectory && directoryKey(value) === directoryKey(shareTitle);
  const evidence = [shareTitle, ...episodes.map(item => item.sourcePath?.split('/')[0]).filter(Boolean)];
  const namedDirectory = indexedDirectory || evidence.some(value => titleMatches(card.title, value));
  const namedFiles = !indexedDirectory && hasPublishedVideoIdentity(card, shareTitle, episodes, publication);
  if (!namedDirectory && !namedFiles) return false;
  const targetYear = String(card.year || card.title.match(/(?:19|20)\d{2}/)?.[0] || '');
  const otherYear = value => targetYear && (String(value || '').match(/(?:19|20)\d{2}/g) || []).some(year => year !== targetYear);
  if (otherYear(shareTitle)) return false;
  const season = seasonNumber(card.title) || 1;
  const otherSeason = value => {
    const found = seasonNumber(value);
    return found > 0 && found !== season;
  };
  if (episodes.some(item => item.seasonNumber && item.seasonNumber !== season)) return false;
  if (otherSeason(shareTitle)) return false;
  if (!namedFiles) {
    for (const episode of episodes) {
      const name = String(episode.fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '');
      const prefix = name.split(/s\d{1,2}e\d|(?:ep?|episode)[\s._-]*\d|第\s*\d+\s*[集话期]|^\d+/i)[0];
      if (cleanTitle(prefix) && !titleMatches(card.title, prefix) && !matchesAlias(prefix.replace(/[\s._-]+$/, ''))) return false;
      if (indexedDirectory && (otherYear(prefix) || otherSeason(name))) return false;
      // Each directory must identify this work or a release/season descriptor.
      // A correct root title does not make unrelated nested works safe.
      for (const [index, part] of String(episode.sourcePath || '').split('/').filter(Boolean).entries()) {
        if (indexedDirectory && (otherYear(part) || otherSeason(part))) return false;
        if (!titleMatches(card.title, part) && !(index === 0 && matchesAlias(part))
          && !releaseDirectory(part)) return false;
      }
    }
  }
  // Without episode identity, automatic association is too ambiguous.
  if (card.category === 'movie' || episodes.some(item => !item.episodeNumber)
    || localEpisodes.some(item => !item.episodeNumber)) return false;
  const available = new Set(episodes.map(item => episodeKey(item, season)));
  return localEpisodes.every(item => available.has(episodeKey(item, season)));
};
