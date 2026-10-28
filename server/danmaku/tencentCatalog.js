import crypto from 'node:crypto';
import { parseVideoUrl, upstream } from './providers.js';

const SEARCH_URL = 'https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vplatform=2';
const EPISODES_URL = 'https://pbaccess.video.qq.com/trpc.universal_backend_service.page_server_rpc.PageServer/GetPageData?video_appid=3000010&vversion_name=8.2.96&vversion_platform=2';
const text = value => String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, 160);
const unavailable = () => Object.assign(new Error('备用作品目录暂不可用，请稍后重试'), { code: 'DANMAKU_CATALOG_UNAVAILABLE', statusCode: 502 });
const modules = data => (data.module_list_datas || []).flatMap(group => group.module_datas || []);

export function parseTencentWorks(result) {
  if (result?.ret !== 0 || !result.data) throw unavailable();
  if (!Array.isArray(result.data.normalList?.itemList) && !Array.isArray(result.data.areaBoxList)) throw unavailable();
  const items = [...(result.data.normalList?.itemList || []), ...(result.data.areaBoxList || []).flatMap(box => box.itemList || [])];
  const works = new Map();
  for (const item of items) {
    const info = item.videoInfo;
    const cid = String(item.doc?.id || '');
    // 搜索同时包含解说、短视频和外站结果，只接入明确的腾讯电视剧专辑。
    if (item.doc?.dataType !== 2 || info?.typeName !== '电视剧' || !/^[A-Za-z0-9]{15}$/.test(cid)) continue;
    const sites = [...(info.episodeSites || []), ...(info.playSites || [])];
    if (!sites.some(site => site.enName === 'qq' && site.episodeInfoList?.some(episode => {
      if (!/^[A-Za-z0-9]{11}$/.test(episode.id)) return false;
      // 平台搜索也会聚合外站内容；有链接时必须核对真实域名和视频 ID。
      if (!episode.url) return true;
      const target = parseVideoUrl(episode.url);
      return target?.platform === 'qq' && target.id === episode.id;
    }))) continue;
    const title = text(info.title);
    if (!title) continue;
    const id = `qq:2:${cid}`;
    works.set(id, { id, title, year: /^\d{4}$/.test(String(info.year)) ? String(info.year) : '', category: '2', categoryLabel: '电视剧', platforms: ['qq'] });
  }
  return [...works.values()].slice(0, 15);
}

export function parseTencentEpisodes(data, cid) {
  const episodes = [];
  for (const module of modules(data)) {
    for (const item of module.item_data_lists?.item_datas || []) {
      const info = item.item_params || {};
      if (String(info.is_trailer) === '1' || (info.cid && info.cid !== cid)) continue;
      if (!/^\d{1,4}$/.test(String(info.title)) || !/^[A-Za-z0-9]{11}$/.test(info.vid || '')) continue;
      const number = Number(info.title);
      if (number < 1) continue;
      episodes.push({ platform: 'qq', number, title: text(info.play_title || `第 ${number} 集`), url: `https://v.qq.com/x/cover/${cid}/${info.vid}.html` });
    }
  }
  return episodes;
}

export class TencentCatalog {
  constructor(request = upstream) { this.request = request; this.works = new Map(); }
  async post(url, body) {
    return (await this.request(url, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', Origin: 'https://v.qq.com', Referer: 'https://v.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      }, body: JSON.stringify(body)
    })).json();
  }
  async search(keyword) {
    const result = await this.post(SEARCH_URL, {
      version: '25071701', clientType: 1, query: keyword, pagenum: 0, pagesize: 20,
      isneedQc: true, uuid: crypto.randomUUID(), extraInfo: { multi_terminal_pc: '1', themeType: '1' }
    });
    const works = parseTencentWorks(result);
    for (const work of works) {
      this.works.delete(work.id); this.works.set(work.id, work);
      if (this.works.size > 64) this.works.delete(this.works.keys().next().value);
    }
    return works;
  }
  async page(cid, context) {
    const result = await this.post(EPISODES_URL, { has_cache: 1, page_params: {
      req_from: 'web_vsite', page_id: 'vsite_episode_list', page_type: 'detail_operation',
      id_type: '1', page_size: '', cid, vid: '', lid: '', page_num: '',
      page_context: context, detail_page_type: '1'
    } });
    if (result?.ret !== 0 || !Array.isArray(result.data?.module_list_datas)) throw unavailable();
    return result.data;
  }
  async details(workId, cid) {
    const first = await this.page(cid, `cid=${cid}&detail_page_type=1&req_from=web_vsite&req_from_second_type=&req_type=0`);
    const contexts = new Set();
    for (const module of modules(first)) {
      const value = module.module_params?.tabs;
      let tabs = [];
      try { tabs = typeof value === 'string' && value ? JSON.parse(value) : value || []; } catch { throw unavailable(); }
      if (!Array.isArray(tabs)) throw unavailable();
      for (const tab of tabs) {
        const context = tab.page_context;
        if (typeof context !== 'string' || context.length > 2048) continue;
        const params = new URLSearchParams(context);
        if (params.get('cid') && params.get('cid') !== cid) continue;
        contexts.add(context);
      }
    }
    // 防止异常目录导致无界并发；失败不能伪装为缺集。
    if (contexts.size > 8) throw unavailable();
    const pages = [first], queue = [...contexts];
    for (let i = 0; i < queue.length; i += 2) pages.push(...await Promise.all(queue.slice(i, i + 2).map(context => this.page(cid, context))));
    const unique = new Map(), ambiguous = new Set();
    for (const episode of pages.flatMap(page => parseTencentEpisodes(page, cid))) {
      if (unique.has(episode.number) && unique.get(episode.number).url !== episode.url) ambiguous.add(episode.number);
      else unique.set(episode.number, episode);
    }
    const episodes = [...unique.values()].filter(episode => !ambiguous.has(episode.number)).sort((a, b) => a.number - b.number);
    const known = this.works.get(workId);
    // 重启后仍能按已保存的专辑 ID 读取，不依赖再次搜索网盘中的别名。
    const title = known?.title || text(episodes[0]?.title.replace(/\s+第\s*\d+\s*[集话].*$/, ''));
    if (!title || !episodes.length) throw unavailable();
    const category=workId.startsWith('qq:4:')?'4':'2';
    return { id: workId, title, year: known?.year || '', category, categoryLabel: category==='4'?'动漫':'电视剧', episodes };
  }
}
