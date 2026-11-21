// Pure identity rules shared by storage and background source maintenance.
import Pinyin from 'tiny-pinyin';
import { isExactWorkTitle, searchTitleKey, workTitleKeys } from './searchTitles.js';

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

const cleanTitle = value => searchTitleKey(value);
const releaseTags = /^(?:(?:19|20)\d{2}|[248]k|(?:360|480|576|720|1080|1440|2160)p|(?:8|10|12)bit|(?:24|25|30|48|50|60|120)(?:fps|帧率?)|hq|uhd|fhd|hdr(?:10plus|10|vivid)?|sdr|dv|dolbyvision|atmos|ddp?(?:[257]1)?|dtshdma|dts|aac|truehd|flac|ac3|eac3|h26[45]|x26[45]|hevc|avc|av1|webdl|webrip|bluray|bdrip|remux|web|正片|高清|超清|蓝光|原盘|中字|中文字幕|国语|粤语|双语|简繁|无水印|全集|完结|更新至?\d+集?|全\d+集|\d+集全?|高码率)*$/i;
const titleMatches = (title, value) => {
  const expected = cleanTitle(title), actual = cleanTitle(value);
  return expected.length >= 2 && actual.startsWith(expected) && releaseTags.test(actual.slice(expected.length));
};
const supplemental = /预告|花絮|片头|片尾|主题曲|幕后|宣传片|解说|混剪|(?:^|[\s._-])(?:sample|trl|trailer|preview|op|ed|mv)(?:[\s._-]|$)/i;
const years = value => String(value || '').match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) || [];
const seasonMarker = /第\s*[\d零一二三四五六七八九十百]+\s*季|(?<![a-z])(?:season[ ._-]*|s)\d{1,2}(?=e\d|[^a-z0-9]|$)/ig;
const seasonValue = label => {
  const digits = label.match(/\d+/)?.[0];
  if (digits) return Number(digits);
  const han = label.replace(/[第季\s]/g, '');
  if (han.includes('十')) {
    const [tens, ones] = han.split('十');
    return (tens ? chineseNumbers[tens] : 1) * 10 + (ones ? chineseNumbers[ones] : 0);
  }
  return chineseNumbers[han] ?? NaN;
};
const seasonsIn = text => [...String(text || '').matchAll(seasonMarker)].map(match => seasonValue(match[0]));
const qualityFolder = name => releaseTags.test(cleanTitle(name.replace(seasonMarker, '')));
const episodeMarker = /(?:s\d{1,2}[ ._-]*)?(?:ep?|episode)[ ._-]*\d{1,4}|第\s*\d{1,4}\s*[集话期]/i;
const numericName = /^(?:\d{1,4}(?![\dkp])|(?:s\d{1,2}[ ._-]*)?(?:ep?|episode)[ ._-]*\d{1,4}|第\s*\d{1,4}\s*[集话期])/i;
const indexedTvDirectories = new Map([['多喜一家人', '多喜'], ['折月亮', '【z】折丨y越亮']]);
const directoryKey = value => String(value || '').normalize('NFKC').trim().toLowerCase();

/** Compare the complete reading only for a publisher-marked series directory with exact edition metadata. */
function sameReading(title, directory) {
  const marked = directory.normalize('NFKC').match(/^[A-Z]\s+([\p{Script=Han}]{3,24})(?:\s+(?:更新至?0*\d+集|全?\d+集全?))?$/u);
  if (!marked || !/^[\p{Script=Han}]{3,24}$/u.test(title) || marked[1].length !== title.length || !Pinyin.isSupported()) return false;
  return Pinyin.convertToPinyin(marked[1], '/', true) === Pinyin.convertToPinyin(title, '/', true);
}

/** A share identifies the edition; only the returned files can contribute episodes or be selected. */
export function matchingShareFiles(work, details, publication = {}, { allowUnspecifiedSeason = false } = {}) {
  const postedTitle = publication.workTitle || publication.work_title || '';
  const share = String(details.title || '').normalize('NFKC').trim();
  const year = work.year || publication.year;
  if ((postedTitle && !isExactWorkTitle(work.title, postedTitle)) || (publication.category && publication.category !== work.category)
    || (work.year && publication.year && work.year !== publication.year)) return [];
  const trusted = Boolean(postedTitle && /^\d{4}$/.test(publication.year || '') && publication.category === work.category
    && ['erxiaopan', 'quark4k'].includes(publication.source));
  const titles = [work.title, postedTitle, ...(trusted ? publication.workTitleAliases || [] : [])].filter(Boolean).flatMap(workTitleKeys);
  const named = text => titles.some(title => titleMatches(title, text) || titleMatches(title, text.replace(seasonMarker, '')));
  const conflict = text => supplemental.test(text.replace(work.title, ''))
    || /特别篇|番外|外传|剧场版/.test(text.replace(work.title, ''))
    || (year && years(text).some(y => y !== year && !work.title.includes(y)));
  if (conflict(share)) return [];
  const wanted = seasonsIn(work.title)[0] ?? seasonsIn(postedTitle)[0];
  const rootSeasons = seasonsIn(share);
  const season = wanted ?? (allowUnspecifiedSeason && work.category !== 'tv' ? rootSeasons[0] : 1);
  const wrongSeason = list => new Set(list).size > 1 || (season !== undefined && list.some(n => n !== season));
  if (wrongSeason(rootSeasons)) return [];
  const prefixed = share.replace(/^(?:[a-z]\s+|【[a-z]】\s*)/i, '');
  const prefix = share.match(/^[A-Z]\s+([\p{Script=Han}]{2,})$/u)?.[1];
  const publicPrefix = publication.source === 'public_guoman4K' && prefix && work.title.startsWith(prefix)
    && prefix.length >= Math.ceil(work.title.length / 2) && titleMatches(work.title, (publication.title || '').replace(/^(?:【[^】]+】\s*)+/u, ''));
  const alias = trusted && work.category === 'tv' && publication.source === 'erxiaopan'
    && workTitleKeys(work.title).includes(cleanTitle(postedTitle))
    && indexedTvDirectories.get(cleanTitle(work.title)) === directoryKey(share);
  const rootMatch = named(share) || (postedTitle && named(prefixed)) || alias || publicPrefix
    || (trusted && work.category !== 'movie' && sameReading(postedTitle, share));
  const folders = new Map(details.entries.filter(entry => entry.isDirectory).map(entry => [entry.fid, entry.name]));
  const parentKey = entry => entry.parentFid || '0';
  const subtitledFolders = new Set(), ambiguousSubtitles = new Set();
  if (trusted && work.category === 'movie' && publication.runtimeMinutes) {
    for (const entry of details.entries) {
      if (!entry.isSubtitle || !/\.(?:srt|vtt|ass|ssa)$/i.test(entry.name)) continue;
      const name = entry.name.replace(/\.(?:srt|vtt|ass|ssa)$/i, '').replace(/[._-](?:chs|cht|eng|zh(?:-hans|-hant)?|en)$/i, '');
      if (!conflict(name) && named(name)) subtitledFolders.add(parentKey(entry));
      else ambiguousSubtitles.add(parentKey(entry));
    }
  }
  const viaSubtitle = new Set();
  // A variety directory may abbreviate the show title and call its season an anniversary.
  // Only an explicitly numbered published season and a dated issue can support that reading.
  const varietyRoot = trusted && work.category === 'variety' && postedTitle.match(/^(.+?)\s*第[一二三四五六七八九十\d]+季$/u);
  const anniversary = varietyRoot && share.match(/^([\p{Script=Han}]{2,})\s*(\d{1,2})年$/u);
  const varietyMatch = anniversary && varietyRoot[1].startsWith(anniversary[1]) && varietyRoot[1].length - anniversary[1].length <= 1
    && Number(anniversary[2]) === seasonNumber(postedTitle);
  const foundSeasons = new Set();
  const files = details.entries.filter(entry => {
    // An archive is eligible for extraction, never proof of playable contents.
    const archive = entry.isArchive;
    if (archive ? (!['anime', 'tv'].includes(work.category) || !postedTitle || !/\.(zip|rar|7z)$/i.test(entry.name)) : !entry.isVideo) return false;
    const stem = entry.name.normalize('NFKC').replace(/\.[a-z0-9]{2,5}$/i, '');
    const parents = entry.pathNames || (entry.ancestorFids || []).map(id => folders.get(id));
    if (parents.some(part => !part) || conflict(stem) || parents.some(conflict)) return false;
    const fileSeasons = [...rootSeasons, ...parents.flatMap(seasonsIn), ...seasonsIn(stem), ...(entry.seasonNumber ? [entry.seasonNumber] : [])];
    if (wrongSeason(fileSeasons)) return false;
    let identified = Boolean(rootMatch);
    for (const part of parents) {
      if (part === share || qualityFolder(part)) continue;
      identified = named(part);
    }
    const explicit = stem.match(episodeMarker);
    const prefix = explicit ? stem.slice(0, explicit.index) : stem;
    const ownTitle = named(work.category === 'movie' ? stem : prefix);
    const numbered = stem.match(numericName);
    const neutral = work.category === 'movie' ? releaseTags.test(cleanTitle(stem))
      : numbered && releaseTags.test(cleanTitle(stem.slice(numbered[0].length)));
    // A self-identifying file can live under an opaque folder. An anonymous file needs an identified parent.
    const date = varietyMatch && stem.match(/^((?:19|20)\d{2})[-.]?(\d{2})[-.]?(\d{2})[ ._-]*(?:(?:2160p|1080p|60fps)[ ._-]*)*第\s*(\d{1,3})\s*期/u);
    const datedIssue = date && date[1] === year && Number(date[2]) >= 1 && Number(date[2]) <= 12 && Number(date[3]) >= 1
      && Number(date[3]) <= 31 && Number(date[4]) === entry.episodeNumber && parents.every(part => part === share || qualityFolder(part));
    const corroborated = entry.sidecarTag && subtitledFolders.has(parentKey(entry)) && !ambiguousSubtitles.has(parentKey(entry)) && neutral && entry.duration > 0
      && Math.abs(entry.duration - publication.runtimeMinutes * 60) <= 90;
    const accept = (ownTitle && (identified || (trusted && (work.category !== 'movie' || years(stem).includes(year)))))
      || (identified && neutral) || datedIssue;
    if (!accept && corroborated) viaSubtitle.add(entry);
    if (accept || corroborated) for (const n of fileSeasons) foundSeasons.add(n);
    return accept || corroborated;
  });
  if (season === undefined && foundSeasons.size > 1) return [];
  return files.map(entry => {
    if (entry.isArchive && entry.isVideo) return { ...entry, isVideo: false };
    return viaSubtitle.has(entry) ? { ...entry, identityTag: entry.sidecarTag } : entry;
  });
}

export const validateSourceCandidate = ({ card, shareTitle, episodes, localEpisodes }) => {
  if (!episodes.length || !localEpisodes.length) return false;
  const evidence = [shareTitle, ...episodes.map(item => item.sourcePath?.split('/')[0]).filter(Boolean)];
  if (!evidence.some(value => titleMatches(card.title, value))) return false;
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
  for (const episode of episodes) {
    const name = String(episode.fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const prefix = name.split(/s\d{1,2}e\d|(?:ep?|episode)[\s._-]*\d|第\s*\d+\s*[集话期]|^\d+/i)[0];
    if (cleanTitle(prefix) && !titleMatches(card.title, prefix)) return false;
    // Each directory must identify this work or a release/season descriptor.
    // A correct root title does not make unrelated nested works safe.
    for (const part of String(episode.sourcePath || '').split('/').filter(Boolean)) {
      if (!titleMatches(card.title, part)
        && !qualityFolder(part)) return false;
    }
  }
  // Without episode identity, automatic association is too ambiguous.
  if (card.category === 'movie' || episodes.some(item => !item.episodeNumber)
    || localEpisodes.some(item => !item.episodeNumber)) return false;
  const available = new Set(episodes.map(item => episodeKey(item, season)));
  return localEpisodes.every(item => available.has(episodeKey(item, season)));
};
