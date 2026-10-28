import { resourceTitleRelevance } from './searchTitle.js';

// Treat spacing and decorative punctuation as input formatting. Keep season
// numbers and English word boundaries in the query sent to Douban.
export const catalogSearchKeyword = value => String(value || '').normalize('NFKC')
  .replace(/\p{Cf}/gu, '').replace(/[《》「」『』【】]/gu, ' ')
  .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
  .replace(/\s+/g, ' ').trim();
const compact = value => catalogSearchKeyword(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

// Catalog browsing can show related titles and different seasons. Drive
// replacement keeps its separate, stricter identity policy.
export function catalogTitleRelevance(query, item) {
  const key = compact(query); if (!key) return 0;
  const words = catalogSearchKeyword(query).toLowerCase().split(/\s+/).filter(word => word.length >= 2);
  return Math.max(0, ...[item.title, ...(item.aliases || [])].filter(value => typeof value === 'string').map(title => {
    const name = compact(title);
    if (name === key) return 150;
    if (key.length >= 2 && name.includes(key)) return name.startsWith(key) ? 130 : 100;
    if (words.length > 1 && words.every(word => name.includes(compact(word)))) return 80;
    return resourceTitleRelevance(query, title);
  }));
}
