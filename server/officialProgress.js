import { TencentCatalog, parseTencentEpisodes } from './danmaku/tencentCatalog.js';
import { isExactWorkTitle, knownAnimeEdition } from './searchTitles.js';
import { readWebResponseText } from './http.js';
import { collectEpisodeTitles, discoverOfficialPlatforms, officialPlatformUrl, OfficialPlatformCatalog } from './officialPlatforms.js';

const clean = value => String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, 160);
const categories = { '动漫': 'anime', '电视剧': 'tv' };
const upcoming = /预告|预约|即将|花絮|片花|彩蛋|抢先看/;
const labels = value => {
  try { return Object.values(typeof value === 'string' ? JSON.parse(value || '{}') : value || {}).map(tag => clean(tag?.info?.text || tag?.text)).join(' '); }
  catch { return ''; }
};

export function parseOfficialProgress(result, keyword, category = 'all') {
  if (result?.ret !== 0 || !result.data || (!Array.isArray(result.data.normalList?.itemList) && !Array.isArray(result.data.areaBoxList))) throw new Error('官方目录响应异常');
  const rows = [...(result.data.normalList?.itemList || []), ...(result.data.areaBoxList || []).flatMap(box => box.itemList || [])];
  const works = new Map();
  for (const row of rows) {
    const info = row.videoInfo, cid = String(row.doc?.id || ''), title = clean(info?.title);
    const kind = categories[info?.typeName];
    if (row.doc?.dataType !== 2 || !/^[a-zA-Z0-9]{15}$/.test(cid) || !kind || (category !== 'all' && category !== kind) || !isExactWorkTitle(keyword, title)) continue;
    const episodes = [];
    for (const site of info.episodeSites || []) {
      if (site.enName !== 'qq') continue;
      for (const episode of site.episodeInfoList || []) {
        const number = Number(episode.title), id = String(episode.id || '');
        if (!/^\d{1,4}$/.test(String(episode.title)) || number < 1 || number > 5000 || !/^[a-zA-Z0-9]{11}$/.test(id)) continue;
        if (upcoming.test(`${episode.titleSuffix || ''} ${labels(episode.markLabel)} ${episode.rawTags || ''}`) || String(episode.is_trailer) === '1') continue;
        let url;
        try { url = new URL(episode.url); } catch { continue; }
        if (url.protocol !== 'https:' || url.hostname !== 'v.qq.com' || url.port || url.username || url.password || url.pathname !== `/x/cover/${cid}/${id}.html`) continue;
        episodes.push({ number, url: `https://v.qq.com${url.pathname}` });
      }
    }
    const last = episodes.sort((a, b) => b.number - a.number)[0];
    if (!last) continue;
    // totalEpisode includes extras/trailers and is never the released count.
    const full = labels(info.imgTag).match(/全\s*(\d+)\s*集/)?.[1];
    works.set(cid, { id: cid, title, category: kind, year: /^\d{4}$/.test(String(info.year)) ? String(info.year) : '',
      latestEpisode: last.number, completed: Number(full) === last.number, platform: '腾讯视频', sourceUrl: last.url });
  }
  return [...works.values()];
}

export async function confirmOfficialLatest(catalog, work) {
  // A final-episode badge corroborated by that released episode is sufficient.
  if (work.completed) return work;
  const first = await catalog.page(work.id, `cid=${work.id}&detail_page_type=1&req_from=web_vsite&req_from_second_type=&req_type=0`);
  const modules = (first.module_list_datas || []).flatMap(group => group.module_datas || []);
  const tabs = [];
  let advertised = 0, completePage = false;
  for (const module of modules) {
    const params = module.module_params || {};
    if (params.desk_module_type !== 'episode_list') continue;
    advertised = Math.max(advertised, Number(String(params.sub_title || '').match(/更新至\s*(\d+)\s*集/)?.[1] || 0));
    completePage ||= String(params.is_all_data) === 'true' && String(params.has_next) === 'false';
    const entries = typeof params.tabs === 'string' ? JSON.parse(params.tabs || '[]') : params.tabs || [];
    if (!Array.isArray(entries) || entries.length > 200) throw new Error('官方分页结构异常');
    for (const tab of entries) {
      if (typeof tab.page_context !== 'string' || tab.page_context.length > 2048) continue;
      const context = new URLSearchParams(tab.page_context);
      if (context.get('cid') !== work.id || !Number.isInteger(tab.begin) || !Number.isInteger(tab.end) || tab.begin < 1 || tab.end > 5000) continue;
      tabs.push(tab);
    }
  }
  if (!completePage) throw new Error('官方目录未完整返回');
  let episodes;
  if (tabs.length) {
    tabs.sort((a, b) => b.end - a.end);
    const last = advertised ? tabs.find(tab => tab.begin <= advertised && tab.end >= advertised) || tabs[0] : tabs[0];
    episodes = parseTencentEpisodes(last.selected ? first : await catalog.page(work.id, last.page_context), work.id);
    if (!episodes.length) throw new Error('最新分页尚未确认正片');
    // Do not silently downgrade to page one when the latest page is unavailable.
    if (advertised && !episodes.some(episode => episode.number === advertised)) throw new Error('官方更新标记与分集目录暂不一致');
  } else {
    episodes = parseTencentEpisodes(first, work.id);
  }
  const latest = episodes.sort((a, b) => b.number - a.number)[0];
  if (!latest) throw new Error('官方最新正片暂未确认');
  return { ...work, latestEpisode: latest.number, sourceUrl: latest.url };
}

export class OfficialProgressService {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 3500 } = {}) { this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async lookup(keyword, { category = 'all', signal, known = [], includeEpisodeTitles = false } = {}) {
    keyword = knownAnimeEdition(keyword, category)?.title || keyword;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    const confirmed = [];
    const request = async (url, options = {}, format = 'json') => {
      controller.signal.throwIfAborted();
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.port || target.username || target.password || ![
        'pbaccess.video.qq.com', 'v.youku.com', 'pcw-api.iqiyi.com', 'pcweb.api.mgtv.com', 'm.yangshipin.cn'
      ].includes(target.hostname)) throw new Error('官方数据地址无效');
      if (target.hostname === 'm.yangshipin.cn' && officialPlatformUrl(target.href, 'yangshipin') !== target.href) {
        throw new Error('央视频正片地址无效');
      }
      const requestOptions = { ...options, headers: { 'User-Agent': 'Mozilla/5.0', ...options.headers }, signal: controller.signal, redirect: 'manual' };
      let response = await this.fetchImpl(target.href, requestOptions);
      if (target.hostname === 'v.youku.com' && target.pathname === '/video' && [301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        const destination = location && officialPlatformUrl(new URL(location, target).href, 'youku');
        if (!destination) throw new Error('优酷作品跳转地址无效');
        response = await this.fetchImpl(destination, requestOptions);
      }
      if (!response.ok) throw new Error('官方目录暂时无法访问');
      const body = await readWebResponseText(response, { maxBytes: 4 * 1024 * 1024, idleTimeoutMs: this.timeoutMs });
      return format === 'text' ? body : JSON.parse(body);
    };
    const catalog = new TencentCatalog(async (url, options) => ({ json: () => request(url, options) }));
    const platforms = new OfficialPlatformCatalog(request);
    let timedOut = false, searchFailed = false;
    const confirming = new Set(), discoveredQq = new Map();
    let confirmationFailed = false;
    const confirm = async candidates => {
      for (let start = 0; start < Math.min(candidates.length, 12) && !controller.signal.aborted; start += 4) {
        const batch = await Promise.allSettled(candidates.slice(start, start + 4).map(async ({ work, provider }) => {
          const key = provider + ':' + (work.id || work.url);
          if (confirming.has(key)) return; confirming.add(key);
          const remember = value => { if (!controller.signal.aborted && !confirmed.includes(value)) confirmed.push(value); };
          const value = await (provider === 'qq' ? confirmOfficialLatest(catalog, work)
            : platforms.confirm(work, keyword, { includeEpisodeTitles, confirmed: remember }));
          remember(value);
          if (provider === 'qq' && includeEpisodeTitles && value.category === 'tv' && !controller.signal.aborted) {
            try {
              const { episodes } = await catalog.details(`qq:2:${value.id}`, value.id);
              if (!controller.signal.aborted) value.episodeTitles = collectEpisodeTitles(episodes, value);
            } catch { /* Missing optional titles do not invalidate confirmed progress. */ }
          }
        }));
        if (batch.some(result => result.status === 'rejected')) confirmationFailed = true;
      }
    };
    const direct = known.filter(source => isExactWorkTitle(keyword, source.title) && ['tv', 'anime'].includes(source.category)
      && (category === 'all' || category === source.category)).map(source => {
      const provider = { qq: 'qq', mango: 'hunantv', iqiyi: 'qiyi', youku: 'youku' }[source.id];
      const work = { ...source, provider, id: source.providerId, latestEpisode: 0, completed: false,
        platform: source.name, sourceUrl: source.url, albumId: source.id === 'youku' ? source.providerId : undefined };
      return { provider, work };
    }).filter(row => row.provider);
    try {
      await Promise.race([
        Promise.allSettled([
          confirm(direct),
          (async () => {
            try {
              const search = await catalog.searchResponse(keyword);
              const qq = parseOfficialProgress(search, keyword, category);
              for (const work of qq) discoveredQq.set(work.id, work);
              await confirm([
                ...qq.map(work => ({ work, provider: 'qq' })),
                ...discoverOfficialPlatforms(search, keyword, category).map(work => ({ work, provider: work.provider }))
              ]);
            } catch { searchFailed = true; }
          })()
        ]),
        new Promise(resolve => { timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(); }, this.timeoutMs); })
      ]);
      // The homepage sometimes omits the year. Fill it only from the independently matched official album ID.
      for (const work of confirmed) {
        const found = work.platform === '腾讯视频' && discoveredQq.get(work.id);
        if (!work.year && found?.year && found.category === work.category && isExactWorkTitle(work.title, found.title)) work.year = found.year;
      }
      const works = [...new Map(confirmed.map(work => [work.platform + ':' + work.id, work])).values()]
        .sort((a, b) => a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform) || a.id.localeCompare(b.id));
      return { status: works.length ? 'confirmed' : timedOut || searchFailed || confirmationFailed ? 'unavailable' : 'unknown', works, checkedAt: works.length || !timedOut ? new Date().toISOString() : '',
        message: works.length ? '' : timedOut || searchFailed || confirmationFailed ? '官方进度暂时无法读取，已找到的资源仍按实际文件核对。' : '暂未从播出平台确认对应版本的正片进度。' };
    } catch {
      return { status: 'unavailable', works: [], checkedAt: '', message: '官方进度暂时无法读取，已找到的资源仍按实际文件核对。' };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
}
