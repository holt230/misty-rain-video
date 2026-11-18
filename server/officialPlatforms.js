import { scriptData } from './officialCatalogData.js';
import { isExactWorkTitle } from './searchTitles.js';

const clean = value => String(value || '').replace(/<[^>]*>/g, '').normalize('NFKC').trim().slice(0, 160);
const kindOf = value => /^(?:动漫|动画)$/.test(value) ? 'anime' : value === '电视剧' ? 'tv' : undefined;
const episodeNumber = value => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 5000 ? Number(value) : 0;
const ancillary = /预告|花絮|片花|彩蛋|幕后|采访|抢先预览/;
const platforms = { qiyi: '爱奇艺', youku: '优酷', hunantv: '芒果TV' };
const unavailable = () => new Error('官方正片进度暂未确认');

/** Canonicalize known official links only. Search redirects are decoded, never followed. */
export function officialPlatformUrl(value, platform) {
  try {
    let url = new URL(value);
    if (url.hostname === 'v.qq.com' && url.pathname === '/search_redirect.html') {
      if (url.searchParams.getAll('url').length !== 1) return undefined;
      url = new URL(url.searchParams.get('url'));
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password) return undefined;
    if (platform === 'qiyi' && ['www.iqiyi.com', 'iqiyi.com'].includes(url.hostname) && /^\/v_[a-z0-9]{5,20}\.html$/i.test(url.pathname)) {
      return `https://www.iqiyi.com${url.pathname}`;
    }
    if (platform === 'youku' && ['v.youku.com', 'm.youku.com'].includes(url.hostname)) {
      const id = url.pathname.match(/^\/(?:v_show|video|alipay_video)\/id_(X[a-zA-Z0-9=]{4,79})\.html$/)?.[1];
      if (id) return `https://v.youku.com/v_show/id_${id}.html`;
    }
    if (platform === 'hunantv' && url.hostname === 'www.mgtv.com' && /^\/b\/\d{1,12}\/\d{1,12}\.html$/.test(url.pathname)) {
      return `https://www.mgtv.com${url.pathname}`;
    }
  } catch { /* No external or malformed URLs enter the official request queue. */ }
  return undefined;
}

/** The search catalog only locates a work; its episode totals never establish progress. */
export function discoverOfficialPlatforms(result, keyword, category = 'all') {
  if (result?.ret !== 0 || !result.data) throw unavailable();
  const rows = [...(result.data.normalList?.itemList || []), ...(result.data.areaBoxList || []).flatMap(box => box.itemList || [])];
  const found = new Map();
  for (const row of rows) {
    const info = row.videoInfo, title = clean(info?.title), kind = kindOf(info?.typeName);
    if (row.doc?.dataType !== 2 || !kind || (category !== 'all' && category !== kind) || !isExactWorkTitle(keyword, title)) continue;
    for (const site of [...(info.episodeSites || []), ...(info.playSites || [])]) {
      if (!Object.hasOwn(platforms, site.enName)) continue;
      for (const episode of site.episodeInfoList || []) {
        const url = officialPlatformUrl(episode.url, site.enName);
        if (!url) continue;
        const key = `${site.enName}:${title}:${info.year || ''}`;
        if (!found.has(key)) found.set(key, { title, category: kind, year: /^\d{4}$/.test(String(info.year)) ? String(info.year) : '', provider: site.enName, url });
        break;
      }
    }
  }
  return [...found.values()];
}

function matchesWork(candidate, keyword, title, category) {
  // Discovery years can be stale; return the official page's year so the caller
  // can match the requested edition. Discovery totals/years are not authority.
  return category === candidate.category && isExactWorkTitle(keyword, title)
    && (isExactWorkTitle(candidate.title, title) || isExactWorkTitle(title, candidate.title));
}

export function parseYoukuProgress(html, candidate, keyword) {
  const data = scriptData(html, '__INITIAL_DATA__');
  const info = data?.pageMap?.extra;
  const category = kindOf(info?.showCategory), title = clean(info?.showName), year = String(info?.showReleaseTime || '').match(/^(?:19|20)\d{2}/)?.[0] || '';
  if (!info || !matchesWork(candidate, keyword, title, category, year) || !/^[a-z0-9]{10,40}$/i.test(info.showId || '')) throw unavailable();
  if (candidate.albumId && info.showId !== candidate.albumId) throw unavailable();
  const requestedId = candidate.albumId ? info.videoId : candidate.url.match(/id_([^/]+)\.html$/)?.[1];
  if (info.videoId !== requestedId || info.videoType !== '正片') throw unavailable();
  const latest = episodeNumber(info.episodeLast);
  if (!latest) throw unavailable();
  const components = (data.moduleList || []).flatMap(module => module.components || []);
  const list = components.find(component => component.type === 10013 && Array.isArray(component.itemList));
  if (!list) throw unavailable();
  const subtitle = clean(list.subtitle);
  const updated = Number(subtitle.match(/更新至\s*(\d+)\s*(?:\/\s*\d+)?\s*[集话]/)?.[1] || 0);
  const full = subtitle.match(/(\d+)\s*[集话]全|全\s*(\d+)\s*[集话]/);
  const total = Number(full?.[1] || full?.[2] || 0);
  if (updated ? updated !== latest : !total || latest > total) throw unavailable();
  // Paged anime lists may contain 1..60 while episodeLast describes the current
  // release. Use the explicit update marker, never lastStage or episodeTotal
  // (both may include unreleased trailers).
  const episode = list.itemList.find(item => Number(item.stage) === latest && item.videoType === '正片'
    && item.episodeInfo?.isZp === true && item.action?.type === 'JUMP_TO_VIDEO'
    && (!item.action.extra?.showId || item.action.extra.showId === info.showId));
  const lastUrl = episode && officialPlatformUrl(`https://v.youku.com/v_show/id_${episode.action.value}.html`, 'youku');
  if (!lastUrl && (!list.more || (!updated && total !== latest))) throw unavailable();
  return { id: `youku:${info.showId}`, title, category, year, latestEpisode: latest,
    completed: info.completed === true && episodeNumber(info.episodeTotal) === latest,
    platform: platforms.youku, sourceUrl: lastUrl || candidate.url };
}

export function iqiyiVideoId(url) {
  const canonical = officialPlatformUrl(url, 'qiyi');
  if (!canonical) throw unavailable();
  const encoded = canonical.match(/\/v_([a-z0-9]+)\.html$/i)[1];
  let value = 0n;
  for (const digit of encoded.toLowerCase()) value = value * 36n + BigInt(parseInt(digit, 36));
  value ^= 0x75706971676cn;
  if (value < 900000n) value = 100n * (value + 900000n);
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
  return String(value);
}

export function parseIqiyiWork(response, candidate, keyword) {
  const info = response?.data;
  const title = clean(info?.albumName), category = Number(info?.channelId) === 2 ? 'tv' : Number(info?.channelId) === 4 ? 'anime' : undefined;
  const year = String(info?.formatIssueTime || info?.period || '').match(/^(?:19|20)\d{2}/)?.[0] || '';
  if (response?.code !== 'A00000' || !matchesWork(candidate, keyword, title, category, year)
    || String(info.tvId) !== iqiyiVideoId(candidate.url) || !/^\d{5,17}$/.test(String(info.albumId))
    || info.effective !== true || Number(info.contentType) !== 1 || info.pagePublishStatus !== 'PAGE_ONLINE') throw unavailable();
  const latest = episodeNumber(info.latestOrder);
  if (!latest) throw unavailable();
  return { id: String(info.albumId), title, category, year, latest, total: episodeNumber(info.videoCount) };
}

export function parseIqiyiProgress(response, work) {
  const data = response?.data;
  if (response?.code !== 'A00000' || String(data?.albumId) !== work.id || !Array.isArray(data.epsodelist)
    || Number(data.latestOrder) !== work.latest) throw unavailable();
  const last = data.epsodelist.find(episode => Number(episode.order) === work.latest && Number(episode.contentType) === 1
    && episode.effective === true && !ancillary.test(clean(episode.name)) && /^\d{5,17}$/.test(String(episode.tvId))
    && officialPlatformUrl(episode.playUrl, 'qiyi') && iqiyiVideoId(episode.playUrl) === String(episode.tvId));
  if (!last) throw unavailable();
  return { id: `qiyi:${work.id}`, title: work.title, category: work.category, year: work.year,
    latestEpisode: work.latest, completed: false, platform: platforms.qiyi, sourceUrl: officialPlatformUrl(last.playUrl, 'qiyi') };
}

export function parseMangoWork(response, candidate, keyword) {
  const info = response?.data?.info;
  const title = clean(info?.clipName), category = kindOf(info?.fstlvlType), year = String(info?.detail?.releaseTime || '').match(/^(?:19|20)\d{2}/)?.[0] || '';
  const [, clip, video] = candidate.url.match(/\/b\/(\d+)\/(\d+)\.html$/) || [];
  if (response?.code !== 200 || !info || !matchesWork(candidate, keyword, title, category, year)
    || String(info.clipId) !== clip || String(info.videoId) !== video || String(info.isIntact) !== '1') throw unavailable();
  const update = clean(info.detail?.updateInfo), latest = episodeNumber(update.match(/更新至\s*(\d+)\s*[集话]/)?.[1]);
  const total = episodeNumber(update.match(/(?:共|全)\s*(\d+)\s*[集话]/)?.[1]);
  if (!latest) throw unavailable();
  return { id: clip, video, title, category, year, latest, total };
}

export function parseMangoProgress(response, work) {
  const data = response?.data;
  if (response?.code !== 200 || !Array.isArray(data?.list) || clean(data.info?.title) !== work.title) throw unavailable();
  const last = data.list.find(episode => String(episode.clip_id) === work.id && String(episode.isIntact) === '1'
    && /^\d+$/.test(String(episode.t1)) && Number(episode.t1) === work.latest && !ancillary.test(clean(episode.t3))
    && /^\d{1,12}$/.test(String(episode.video_id)) && episode.url === `/b/${work.id}/${episode.video_id}.html`);
  if (!last) throw unavailable();
  return { id: `hunantv:${work.id}`, title: work.title, category: work.category, year: work.year,
    latestEpisode: work.latest, completed: Boolean(work.total && work.total === work.latest),
    platform: platforms.hunantv, sourceUrl: `https://www.mgtv.com${last.url}` };
}

export class OfficialPlatformCatalog {
  constructor(request) { this.request = request; }
  async confirm(candidate, keyword) {
    if (candidate.provider === 'youku') return parseYoukuProgress(await this.request(candidate.url, {}, 'text'), candidate, keyword);
    if (candidate.provider === 'qiyi') {
      const info = await this.request(`https://pcw-api.iqiyi.com/video/video/baseinfo/${iqiyiVideoId(candidate.url)}`);
      const work = parseIqiyiWork(info, candidate, keyword);
      const page = Math.ceil(work.latest / 50);
      const data = await this.request(`https://pcw-api.iqiyi.com/albums/album/avlistinfo?${new URLSearchParams({ aid: work.id, page: String(page), size: '50' })}`);
      return parseIqiyiProgress(data, work);
    }
    if (candidate.provider === 'hunantv') {
      const vid = candidate.url.match(/\/(\d+)\.html$/)?.[1];
      const work = parseMangoWork(await this.request(`https://pcweb.api.mgtv.com/video/info?vid=${vid}`), candidate, keyword);
      const first = await this.request(`https://pcweb.api.mgtv.com/episode/list?video_id=${vid}&page=1`);
      const pages = Number(first?.data?.total_page);
      if (!Number.isInteger(pages) || pages < 1 || pages > 200) throw unavailable();
      const data = pages > 1 ? await this.request(`https://pcweb.api.mgtv.com/episode/list?video_id=${vid}&page=${pages}`) : first;
      return parseMangoProgress(data, work);
    }
    throw unavailable();
  }
}
