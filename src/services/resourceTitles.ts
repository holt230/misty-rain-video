import { workTitleKeys } from '../../server/searchTitles.js';

const separators = '[\\s\\p{P}\\p{S}\\p{Cf}]*';
export const resourceTitleKey = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\p{Cf}]+/gu, '');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Providers often append a synopsis, advertising and unrelated work names to the title. */
export function resourceHeading(text: string) {
  const clean = text.normalize('NFKC').replace(/\p{Cf}/gu, '').trim();
  const summary = clean.search(/(?:[📜📝]|(?:剧情简介|剧情介绍|内容简介|资源介绍|故事梗概|简介|介绍)\s*[:：])/u);
  const heading = (summary >= 0 ? clean.slice(0, summary) : clean).split(/\r?\n/).find(line => line.trim()) || '';
  return heading.replace(/^[\s🗄📁💾💿🔍⬇️·|#]+/u, '').replace(/[\s·|]+$/u, '').replace(/\s+/g, ' ').trim();
}

export function resourceTitleMatch(keyword: string, title: string) {
  const keys = workTitleKeys(keyword);
  if (!keys[0]) return null;
  const heading = resourceHeading(title);
  const name = keys.map(key => [...key].map(escape).join(separators)).join('|');
  const edition = '年番|剧场版|电影版|真人版|动画版|动漫版|电视剧版|特别篇|番外|外传|合集|全集|完结|更新|更(?:新|至|第|[0-9])|全[0-9一二三四五六七八九十百]+集|第[0-9一二三四五六七八九十百]+[季集部]|[一二三四五六七八九十]+季|s[0-9]+|国语|中字|高清|超清|蓝光|臻彩|杜比';
  return new RegExp(`(?:^|[^\\p{L}]|国漫|日漫|动漫|动画|国剧|电视剧|电影)(${name})(?![\\s\\p{P}]*(?:[1-9]\\d?|[ivx]{1,5})(?:[\\s\\p{P}]*(?![集话期季部])\\p{Script=Han}|\\s*$))(?=$|[^\\p{L}]|${edition})`, 'iu').exec(heading);
}

export const matchesResourceTitle = (keyword: string, title: string) => Boolean(resourceTitleMatch(keyword, title));
