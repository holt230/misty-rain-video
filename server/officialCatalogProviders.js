import crypto from 'node:crypto';
import { TencentCatalog } from './danmaku/tencentCatalog.js';
import { readWebResponseText } from './http.js';
import { artworkUrl, cleanText, titleKey, scriptData, walkObjects, PLATFORM_NAMES } from './officialCatalogData.js';

const categories = { '电视剧': 'tv', '电影': 'movie', '动漫': 'anime', '动画': 'anime', '综艺': 'variety' };
const pickArtwork = (...values) => values.map(artworkUrl).find(Boolean) || '';
const yearOf = value => String(value || '').match(/(?:19|20)\d{2}/)?.[0] || '';
const releaseDateOf = row => {
  if (row.showDate && Number.isFinite(Date.parse(row.showDate))) return cleanText(row.showDate, 30);
  const { year, month, day } = row.date || {};
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value.toISOString().slice(0, 10) : '';
};
const credits = rows => (Array.isArray(rows) ? rows : []).slice(0, 40).map(row => ({ id: '', name: cleanText(row.name || row, 100), latinName: '', role: '演员', avatar: '' })).filter(row => row.name);
const unique = rows => [...new Map(rows.map(row => [row.catalogId, row])).values()].slice(0, 120);
const seed = (platform, id, category, title, values) => ({
  catalogId: platform + ':' + id, providerId: String(id), platform, category, title: cleanText(title, 160), year: '', tag: '',
  subtitle: '', summary: '', actors: [], directors: [], genres: [], status: '', releaseDate: '', ...values
});
const desiredCategory = channel => channel === 'new' ? 'movie' : channel;

export function parseTencentCatalog(html, channel) {
  const data = scriptData(html, '__vikor__context__'), rows = [];
  const expected = desiredCategory(channel), kinds = { '1': 'movie', '2': 'tv', '3': 'anime', '10': 'variety' };
  walkObjects(data.ssrPayloads?._piniaState, row => {
    if (row.type !== 'focus' || row.reportType !== 'cid' || !/^[a-zA-Z0-9]{15}$/.test(row.cid || '')) return;
    const category = kinds[String(row.categoryType)];
    const title = cleanText(row.mzTitle || row.title, 160);
    if (!title || category !== expected) return;
    rows.push(seed('qq', row.cid, category, title, {
      posterUrl: pickArtwork(row.smallCoverPic, row.coverPic), backdropUrl: artworkUrl(row.coverPic),
      subtitle: cleanText(row.subTitle || row.topicLabelTitle), summary: cleanText(row.topicLabelTitle, 12000),
      sourceUrl: 'https://v.qq.com/x/cover/' + row.cid + '.html'
    }));
  });
  return unique(rows);
}

export function parseYoukuCatalog(html, channel) {
  const data = scriptData(html, '__INITIAL_DATA__'), rows = [], expected = desiredCategory(channel);
  if (!Array.isArray(data.moduleList) || !Array.isArray(data.navList)) throw new Error('优酷片单结构已变化');
  walkObjects(data.moduleList, row => {
    const action = row.action;
    if (!row.title || action?.type !== 'JUMP_TO_SHOW' || !/^[a-z0-9]{10,40}$/i.test(action.value || '')) return;
    const category = categories[action.extra?.category] || categories[(row.tags || []).map(tag => tag.text?.title).find(value => categories[value])];
    if (category !== expected || /广告|推广/.test(row.mark?.text || '')) return;
    const tags = (row.tags || []).map(tag => cleanText(tag.text?.title)).filter(Boolean);
    const status = tags.find(value => /更新|集全|话全|期全|限免|即将|预告/.test(value)) || cleanText(row.lbTexts).replace(/^[^・]*・/, '');
    rows.push(seed('youku', action.value, category, row.title, {
      posterUrl: pickArtwork(row.vImg, row.img), backdropUrl: pickArtwork(row.hImg, row.img),
      subtitle: cleanText(row.desc), summary: cleanText(row.desc, 12000), status,
      year: yearOf(tags.find(value => /^(?:19|20)\d{2}年?$/.test(value))), sourceUrl: 'https://v.youku.com/video?s=' + action.value
    }));
  });
  return unique(rows);
}

export function parseIqiyiCatalog(data, channel) {
  if (data?.code !== 0 || !Array.isArray(data.items)) throw new Error('爱奇艺片单结构已变化');
  const rows = [], expected = desiredCategory(channel), kinds = { '1': 'movie', '2': 'tv', '4': 'anime', '6': 'variety' };
  for (const module of data.items) for (const group of module.video || []) for (const row of group.data || []) {
    const category = kinds[String(row.channel_id)], id = String(row.album_id || row.entity_id || '');
    if (category !== expected || !/^\d{5,18}$/.test(id) || !row.title || row.isAd || row.isPpcAd || row.isGame || row.isCommand
      || (row.content_type && row.content_type !== 'FEATURE_FILM')) continue;
    let url;
    try { url = new URL(row.page_url); } catch { continue; }
    if (url.protocol !== 'https:' || !['www.iqiyi.com', 'iqiyi.com'].includes(url.hostname) || !/^\/[va]_[a-z0-9]+\.html$/i.test(url.pathname)) continue;
    rows.push(seed('iqiyi', id, category, row.title, {
      year: yearOf(row.date?.year || row.showDate), releaseDate: releaseDateOf(row),
      posterUrl: pickArtwork(row.image_cover, row.image_url), backdropUrl: pickArtwork(row.banner_image_url, row.image_url, row.thumbnail_url, row.image_cover),
      subtitle: cleanText(row.desc), summary: cleanText(row.description || row.desc, 12000), actors: credits(row.starring || row.actor),
      directors: credits(row.creator).map(person => ({ ...person, role: '导演' })), genres: cleanText(row.tag).split(';').filter(Boolean),
      status: cleanText(row.dq_updatestatus), sourceUrl: url.origin + url.pathname
    }));
  }
  return unique(rows);
}

export function parseMangoCatalog(data, channel) {
  if (data?.code !== 200 || !Array.isArray(data.data)) throw new Error('芒果片单结构已变化');
  const rows = [], category = desiredCategory(channel);
  for (const module of data.data) {
    if (/剧圈热点|花絮|预告|热门标签|短视频|广告/.test(module.moduleTitle || '')) continue;
    for (const list of module.DSLList || []) for (const row of list.data?.items || []) {
      if (!row.name || /预告|花絮/.test(row.cornerType?.cornerTitle || '') || ![1, 12].includes(row.jumpKind)) continue;
      let url;
      try { url = new URL(row.videoUrl); } catch { continue; }
      const match = url.pathname.match(/^\/b\/(\d{1,12})(?:\/(\d{1,12})\.html|\/)?$/);
      if (url.protocol !== 'https:' || url.hostname !== 'www.mgtv.com' || !match) continue;
      const title = cleanText(row.name).split(/[\p{Extended_Pictographic}\uFE0F\u200D]/u)[0].trim();
      if (!title) continue;
      rows.push(seed('mango', match[1], category, title, {
        posterUrl: pickArtwork(row.imageV, row.thumbImg, row.imageH), backdropUrl: pickArtwork(row.imageNew, row.imageH, row.imageV),
        subtitle: cleanText(row.subName), summary: cleanText(row.subName, 12000), status: cleanText(row.updateInfo),
        sourceUrl: 'https://www.mgtv.com' + url.pathname, videoId: match[2] || ''
      }));
    }
  }
  // Keep a real video detail URL when the same album is also listed as /b/id/.
  const byId = new Map();
  for (const row of rows) {
    const prior = byId.get(row.catalogId);
    if (!prior) byId.set(row.catalogId, row);
    else byId.set(row.catalogId, { ...prior, status: row.status || prior.status, videoId: prior.videoId || row.videoId,
      sourceUrl: prior.videoId ? prior.sourceUrl : row.sourceUrl });
  }
  return [...byId.values()].slice(0, 120);
}

export class OfficialCatalogProviders {
  constructor({ fetcher = globalThis.fetch, timeoutMs = 8000 } = {}) {
    this.fetcher = fetcher; this.timeoutMs = timeoutMs; this.active = 0; this.queue = []; this.pending = new Map();
  }
  async request(url, format = 'text', options = {}) {
    const key = url + '\n' + (options.body || '');
    if (this.pending.has(key)) return this.pending.get(key);
    const task = (async () => {
      if (this.active >= 3) await new Promise(resolve => this.queue.push(resolve)); else this.active++;
      try {
        let target = new URL(url);
        const allowed = ['v.qq.com', 'www.youku.com', 'mesh.if.iqiyi.com', 'dc.bz.mgtv.com', 'movie.douban.com',
          'pbaccess.video.qq.com', 'v.youku.com', 'pcweb.api.mgtv.com'];
        let response;
        for (let redirect = 0; redirect < 3; redirect++) {
          if (target.protocol !== 'https:' || target.port || target.username || target.password || !allowed.includes(target.hostname)) throw new Error('片单地址无效');
          response = await this.fetcher(target.href, { ...options, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'manual',
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: format === 'json' ? 'application/json' : 'text/html', Referer: target.origin + '/', ...options.headers } });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          if (!location || options.method === 'POST') throw new Error('片单跳转地址无效');
          await response.body?.cancel(); target = new URL(location, target);
        }

        if (!response.ok) throw new Error('片单来源返回 HTTP ' + response.status);
        const body = await readWebResponseText(response, { maxBytes: 4 * 1024 * 1024, idleTimeoutMs: this.timeoutMs });
        return format === 'json' ? JSON.parse(body) : body;
      } finally {
        const next = this.queue.shift(); if (next) next(); else this.active--;
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  async metadata(item) {
    if (item.year && item.actors?.length) return {};
    const sources = item.platforms || [];
    const qq = sources.find(source => source.id === 'qq');
    if (qq) {
      const catalog = new TencentCatalog(async (url, options) => ({ json: () => this.request(url, 'json', options) }));
      const data = await catalog.searchResponse(item.title);
      const rows = [...(data?.data?.normalList?.itemList || []), ...(data?.data?.areaBoxList || []).flatMap(box => box.itemList || [])];
      const found = rows.find(row => String(row.doc?.id) === qq.providerId && titleKey(row.videoInfo?.title) === titleKey(item.title));
      if (!found) throw new Error('腾讯作品版本尚未确认');
      const info = found.videoInfo;
      return { year: yearOf(info.year), summary: cleanText(info.description || info.intro || item.summary, 12000) };
    }
    const mango = sources.find(source => source.id === 'mango' && source.videoId);
    if (mango) {
      const data = await this.request('https://pcweb.api.mgtv.com/video/info?vid=' + mango.videoId, 'json');
      const info = data?.data?.info;
      if (data.code !== 200 || String(info?.clipId) !== mango.providerId || titleKey(info?.clipName) !== titleKey(item.title)) throw new Error('芒果作品版本尚未确认');
      return { year: yearOf(info.detail?.releaseTime), summary: cleanText(info.detail?.story || item.summary, 12000) };
    }
    const youku = sources.find(source => source.id === 'youku');
    if (youku) {
      const data = scriptData(await this.request(youku.url), '__INITIAL_DATA__'), info = data?.pageMap?.extra;
      if (String(info?.showId) !== youku.providerId || titleKey(info?.showName) !== titleKey(item.title)) throw new Error('优酷作品版本尚未确认');
      return { year: yearOf(info.showReleaseTime), summary: cleanText(info.showDesc || item.summary, 12000) };
    }
    return {};
  }
  async fetch(platform, channel) {
    const category = desiredCategory(channel);
    let rows;
    if (platform === 'qq') {
      const path = { tv: 'tv', movie: 'movie', anime: 'cartoon', variety: 'variety' }[category];
      rows = parseTencentCatalog(await this.request('https://v.qq.com/channel/' + path), channel);
    } else if (platform === 'youku') {
      const path = { tv: 'webtv', movie: 'webmovie', anime: 'webcomic', variety: 'webvariety' }[category];
      rows = parseYoukuCatalog(await this.request('https://www.youku.com/ku/' + path), channel);
    } else if (platform === 'iqiyi') {
      const path = { tv: 'tv', movie: 'film', anime: 'cartoon', variety: 'variety' }[category];
      const params = new URLSearchParams({ uid: '', vip: '0', auth: '', device: crypto.randomUUID(), scale: '100', brightness: 'dark',
        pcv: '17.112.26935', v: '17.112.26935', width: '1280', mode: 'page', page: '1', conduit_id: 'PPStream',
        from: 'webapp', agenttype: '1', platformcode: 'b6c13e26323c537d' });
      rows = parseIqiyiCatalog(await this.request('https://mesh.if.iqiyi.com/portal/lw/v7/channel/' + path + '?' + params, 'json'), channel);
    } else if (platform === 'mango') {
      const id = crypto.randomUUID(), channelId = { tv: 4, movie: 9, anime: 8, variety: 6 }[category];
      const url = 'https://dc.bz.mgtv.com/dynamic/v1/channel/index/' + id + '/9.0.9/10_15/10000000/space/0/4/' + channelId + '?osType=mac&device=pc';
      rows = parseMangoCatalog(await this.request(url, 'json'), channel);
    } else throw new Error('未知的平台');
    if (!rows.length) throw new Error(PLATFORM_NAMES[platform] + '暂未返回可识别的作品');
    if (channel === 'new') rows = rows.filter(row => row.releaseDate && Number.isFinite(Date.parse(row.releaseDate)) && Date.parse(row.releaseDate) <= Date.now()
      && Date.now() - Date.parse(row.releaseDate) <= 180 * 24 * 60 * 60_000).sort((a, b) => Date.parse(b.releaseDate) - Date.parse(a.releaseDate));
    return rows;
  }
}
