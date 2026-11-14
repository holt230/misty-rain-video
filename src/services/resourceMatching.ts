import type { CategoryType } from '../types/media';
import type { ResourceItem } from '../types/search';
import { isNonVideoResource } from './resourceFiltering';
import { resourceHeading, resourceTitleMatch } from './resourceTitles';

export function matchResource(keyword: string, title: string, category?: CategoryType) {
  const heading = resourceHeading(title);
  const match = resourceTitleMatch(keyword, heading);
  const matches = Boolean(match) && !isNonVideoResource(heading, keyword);
  const tail = match ? heading.slice(match.index + match[0].length) : heading;
  const titleStart = match ? match.index + match[0].length - match[1].length : 0;
  const description = match ? heading.slice(0, titleStart) + tail : heading;
  const episodic = /年番|番剧|更(?:新)?\s*(?:至|到|第)?\s*\d+\s*集|全\s*\d+\s*集|第\s*\d+\s*[-~至]\s*\d+\s*集|s\d+e\d+|\d+\s*集全/i.test(description);
  const anime = /国漫|日漫|动漫|动画|年番|番剧|动画电影|剧场版|\b(?:ova|oad)\b/i.test(description);
  const live = /真人版|电视剧|网剧|短剧|剧版/.test(description);
  const sequelMovie = /^\s*[1-9]\d?\s*[:：]/.test(tail) && /(?:19|20)\d{2}/.test(description) && !episodic && !anime;
  const inferred: CategoryType | undefined = /综艺|真人秀|晚会|脱口秀/.test(description) ? 'variety'
    : live ? 'tv' : anime ? 'anime' : /电影|院线|movie|film/i.test(description) || sequelMovie ? 'movie'
      : episodic ? 'tv' : undefined;
  // Bare episode counts cannot distinguish animation from TV; explicit live-action labels can.
  const animatedMovie = category === 'movie' && anime && /剧场版|动画电影/.test(description);
  const conflict = Boolean(category && inferred && inferred !== category && !(category === 'anime' && inferred === 'tv' && !live) && !animatedMovie);
  const special = /特别篇|剧场版|番外|外传|电影版|\b(?:ova|oad)\b/i.test(tail);
  const subtitle = tail.match(/^[\s\p{P}\p{S}]*([\p{Script=Han}]{2,})/u)?.[1] || '';
  const extraTitle = Boolean(subtitle && !/^(?:年番|动漫|动画|国语|国粤|中字|简中|繁中|高清|超清|蓝光|臻彩|杜比|全集|合集|完结|更新|更至|全[一二三四五六七八九十百]+集|第[一二三四五六七八九十百]+季|剧情|动作|喜剧|爱情|奇幻|悬疑|犯罪|无删减|内封|内嵌|双语|网盘|夸克)/.test(subtitle));
  const otherVersion = conflict || (category !== 'movie' && (special || extraTitle || sequelMovie));
  const categoryScore = !inferred ? 0 : inferred === category || (category === 'anime' && anime) ? 300 : conflict ? -600 : 0;
  const score = (matches ? 500 : -1000) + categoryScore + (otherVersion ? -400 : 400) + (episodic && !special ? 100 : 0)
    + (/4k|2160p|uhd/i.test(heading) ? 12 : /1080p/i.test(heading) ? 6 : 0);
  return { matches, inferred, otherVersion, conflict, episodic, score };
}

export function resourceEpisode(title: string) {
  const heading = resourceHeading(title);
  const patterns = [/(?:更新|更至|更)\s*(?:至|到|第)?\s*0*(\d{1,4})(?:\s*[-~至]\s*0*(\d{1,4}))?(?=\s*(?:集|话)|$|[\s.\[\]【】])/ig,
    /(?:全|第)\s*0*(\d{1,4})(?:\s*[-~至]\s*0*(\d{1,4}))?\s*(?:集|话)/ig,
    /(?:^|[^a-z])(?:s\d+)?e(?:p)?\s*0*(\d{1,4})(?=$|[^0-9])/ig];
  const numbers = patterns.flatMap(pattern => [...heading.matchAll(pattern)].map(match => Number(match[2] || match[1])));
  return numbers.length ? Math.max(...numbers) : 0;
}

export function rankResourceCandidates(resources: ResourceItem[], keyword: string, category?: CategoryType) {
  const ranked = resources.map(resource => ({ resource, match: matchResource(keyword, resource.title, category) }))
    .filter(item => item.match.matches)
    .sort((a, b) => (category === 'movie' ? 0 : resourceEpisode(b.resource.title) - resourceEpisode(a.resource.title))
      || Number(a.match.otherVersion) - Number(b.match.otherVersion)
      || b.match.score - a.match.score || (Date.parse(b.resource.datetime) || 0) - (Date.parse(a.resource.datetime) || 0));
  const seen = new Set<string>();
  return ranked.filter(({ resource }) => {
    if (seen.has(resource.url)) return false;
    seen.add(resource.url); return true;
  });
}
