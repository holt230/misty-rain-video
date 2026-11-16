import { TencentCatalog, parseTencentEpisodes } from './danmaku/tencentCatalog.js';
import { isExactWorkTitle } from './searchTitles.js';
import { readWebResponseText } from './http.js';

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
  async lookup(keyword, { category = 'all', signal } = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    const catalog = new TencentCatalog(async (url, options) => {
      const response = await this.fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error('官方目录暂时无法访问');
      const body = await readWebResponseText(response, { maxBytes: 4 * 1024 * 1024, idleTimeoutMs: this.timeoutMs });
      return { json: () => JSON.parse(body) };
    });
    try {
      const works = await Promise.race([
        (async () => {
          const candidates = parseOfficialProgress(await catalog.searchResponse(keyword), keyword, category);
          const confirmed = [];
          for (let start = 0; start < Math.min(candidates.length, 9); start += 3) {
            const results = await Promise.allSettled(candidates.slice(start, start + 3).map(work => confirmOfficialLatest(catalog, work)));
            for (const result of results) if (result.status === 'fulfilled') confirmed.push(result.value);
          }
          return confirmed;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('官方进度读取超时')); }, this.timeoutMs); })
      ]);
      return { status: works.length ? 'confirmed' : 'unknown', works, checkedAt: new Date().toISOString(),
        message: works.length ? '' : '暂未在腾讯视频确认到这部作品的正片进度。' };
    } catch {
      return { status: 'unavailable', works: [], checkedAt: '', message: '官方进度暂时无法读取，已找到的资源仍按实际文件核对。' };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
}
