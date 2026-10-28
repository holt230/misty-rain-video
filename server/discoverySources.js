import { catalogFacets } from './catalogFacets.js';
export const DISCOVERY_FEEDS = [
  { id: 'tv', category: 'tv', title: '近期热剧', collection: 'tv_hot', source: '豆瓣' },
  { id: 'movie', category: 'movie', title: '热门电影', collection: 'movie_hot_gaia', source: '豆瓣' },
  { id: 'anime', category: 'anime', title: '动漫精选', collection: 'tv_animation', source: '豆瓣' },
  { id: 'variety', category: 'variety', title: '热门综艺', collection: 'tv_variety_show', source: '豆瓣' },
  { id: 'calendar', category: 'anime', title: '本周放送', source: 'Bangumi' }
];

const text = (value, limit = 180) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const subjectId = value => /^[1-9]\d{0,12}$/.test(String(value || '')) ? String(value) : '';
const year = value => /^(?:19|20)\d{2}$/.test(String(value)) ? String(value) : '';
export const ratingCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const rating = value => Number(value) > 0 && Number(value) <= 10 ? Math.round(Number(value) * 10) / 10 : null;

export function isDiscoveryImageUrl(value, provider) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && (provider === 'douban' ? /^(?:(?:img\d+|qnmob\d+-sign)\.)?doubanio\.com$/i.test(url.hostname)
        : provider === 'bangumi' && ['lain.bgm.tv', 'lain.bangumi.tv'].includes(url.hostname));
  } catch { return false; }
}

const imageUrl = (value, provider) => {
  const url = text(value, 2048).replace(/^http:/, 'https:');
  return isDiscoveryImageUrl(url, provider) ? url : '';
};

export function normalizeDoubanFeed(payload, feed) {
  if (!Array.isArray(payload?.subject_collection_items)) throw new Error('INVALID_DISCOVERY_RESPONSE');
  const unique = new Map();
  for (const item of payload.subject_collection_items) {
    const id = subjectId(item?.id), title = text(item?.title, 120);
    if (!id || !title || (feed.category === 'movie' ? item.type !== 'movie' : item.type !== 'tv')) continue;
    const value = {
      id: `douban-${id}`, provider: 'douban', title, category: feed.category, ...catalogFacets(item),
      year: year(item.year), ratingCount: ratingCount(item.rating?.count), rating: item.rating?.count === 0 ? null : rating(item.rating?.value),
      subtitle: text(item.episodes_info, 60), description: text(item.card_subtitle),
      imageUrl: imageUrl(item.pic?.large, 'douban') || imageUrl(item.pic?.normal || item.cover?.url, 'douban'),
      sourceUrl: `https://movie.douban.com/subject/${id}/`
    };
    unique.set(value.id, value);
  }
  return [...unique.values()].slice(0, 30);
}

export function normalizeBangumiCalendar(payload) {
  if (!Array.isArray(payload)) throw new Error('INVALID_DISCOVERY_RESPONSE');
  const unique = new Map();
  for (const day of payload) {
    const weekday = Number(day?.weekday?.id);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !Array.isArray(day.items)) continue;
    let count = 0;
    for (const item of day.items) {
      if (count >= 30) break;
      const id = subjectId(item?.id), title = text(item?.name_cn || item?.name, 120);
      if (!id || !title || item.type !== 2 || item.nsfw === true) continue;
      const value = { id: `bangumi-${id}`, provider: 'bangumi', title, category: 'anime',
        year: year(String(item.air_date || '').slice(0, 4)), ratingCount: ratingCount(item.rating?.total), rating: rating(item.rating?.score), weekday,
        subtitle: `周${'一二三四五六日'[weekday - 1]}播出`, description: '',
        imageUrl: imageUrl(item.images?.common || item.images?.large, 'bangumi'), sourceUrl: `https://bgm.tv/subject/${id}` };
      unique.set(value.id, value); count++;
    }
  }
  return [...unique.values()].slice(0, 210);
}

export async function fetchDiscoveryFeed(feed, { fetcher = fetch, signal } = {}) {
  const isCalendar = feed.id === 'calendar';
  const url = isCalendar ? 'https://api.bgm.tv/calendar'
    : `https://m.douban.com/rexxar/api/v2/subject_collection/${feed.collection}/items?start=0&count=30`;
  const response = await fetcher(url, { signal, redirect: 'error', headers: {
    Accept: 'application/json',
    'User-Agent': isCalendar ? 'MistyRainVideo/1.0 (https://github.com/Sicndu/misty-rain-video)' : 'Mozilla/5.0',
    Referer: isCalendar ? 'https://bgm.tv/' : `https://m.douban.com/subject_collection/${feed.collection}`
  } });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`DISCOVERY_HTTP_${response.status}`); }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('DISCOVERY_RESPONSE_TOO_LARGE'); }
    chunks.push(Buffer.from(value));
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const items = isCalendar ? normalizeBangumiCalendar(payload) : normalizeDoubanFeed(payload, feed);
  if (!items.length) throw new Error('DISCOVERY_EMPTY_RESPONSE');
  return items;
}
