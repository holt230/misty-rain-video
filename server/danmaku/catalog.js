import { parseVideoUrl, platforms, upstream } from './providers.js';
import { TencentCatalog } from './tencentCatalog.js';
import { BilibiliCatalog } from './bilibiliCatalog.js';
import { seasonNumber } from '../libraryPolicy.js';

const categoryIds = { movie: '1', tv: '2', variety: '3', anime: '4' };
const categoryNames = { '1': '电影', '2': '电视剧', '3': '综艺', '4': '动漫' };
const text = value => String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, 160);
const chinese = value => {
  if (/^\d+$/.test(value)) return String(Number(value));
  const digits = '零一二三四五六七八九';
  if (value === '十') return '10';
  if (value.includes('十')) { const [a, b] = value.split('十'); return String((a ? digits.indexOf(a) : 1) * 10 + (b ? digits.indexOf(b) : 0)); }
  return String(digits.indexOf(value));
};
export const normalizeTitle = value => text(value).normalize('NFKC').toLowerCase()
  .replace(/(?:19|20)\d{2}/g, '')
  .replace(/(?:4k|8k|2160p|1080p|720p|uhd|hdr|高清|蓝光)/g, '')
  .replace(/第([一二三四五六七八九十\d]+)季/g, (_, n) => `s${chinese(n)}`)
  .replace(/s0*(\d+)/g, (_, n) => `s${Number(n)}`)
  .replace(/[\s·•:：—_.,，。!！?？《》“”'"【】\[\]()（）-]+/g, '');
export function automaticWork(input, candidates) {
  // A resource browser's default category is not evidence of the work/version.
  if (input.categoryConfirmed === false || input.episodePart) return null;
  const season = input.seasonNumber || seasonNumber(input.episodeTitle) || seasonNumber(input.title) || 1;
  const year = /^\d{4}$/.test(String(input.year || '')) ? String(input.year) : String(input.title).match(/(?:19|20)\d{2}/)?.[0];
  const matches = candidates.filter(item => normalizeTitle(item.title) === normalizeTitle(input.title)
    && (!year || item.year === year) && item.category === categoryIds[input.category]
    && (input.category === 'movie' || (item.seasonNumber || seasonNumber(item.title) || 1) === season));
  return matches.length === 1 ? matches[0] : null;
}
const error = message => Object.assign(new Error(message), { statusCode: 502, code: 'DANMAKU_CATALOG_UNAVAILABLE' });
export const missingEpisode = (message = '本集暂未收录弹幕，可稍后再试或查看作品是否选对') =>
  Object.assign(new Error(message), { statusCode: 404, code: 'DANMAKU_EPISODE_NOT_FOUND' });
export function validateWorkId(id) {
  const bili = String(id).match(/^bili:([1-4]):([1-9]\d{0,18})$/);
  if (bili) return { category:bili[1],id:bili[2],provider:'bilibili' };
  const direct = String(id).match(/^qq:([24]):([A-Za-z0-9]{15})$/);
  if (direct) return { category: direct[1], id: direct[2], provider: 'qq' };
  const match = String(id).match(/^([1-4]):([A-Za-z0-9]{5,40})$/);
  if (!match) throw Object.assign(new Error('作品编号无效'), { statusCode: 400 });
  return { category: match[1], id: match[2] };
}
export class DanmakuCatalog {
  constructor(request = upstream, directory) { this.request = request; this.tencent = new TencentCatalog(request); this.bilibili = new BilibiliCatalog(request,directory); this.cache = new Map(); this.pending = new Map(); }
  async cached(key, loader) {
    const old = this.cache.get(key);
    if (old && Date.now() - old.time < 10 * 60_000) return old.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const task = loader().then(value => {
      this.cache.delete(key); this.cache.set(key, { time: Date.now(), value });
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  async search(query) {
    if(!text(query) || text(query).length>100)throw Object.assign(new Error('请输入有效片名'),{statusCode:400});
    const [legacy,bili]=await Promise.allSettled([this.searchLegacy(query),this.bilibili.search(text(query))]);
    const works=[...(bili.status==='fulfilled'?bili.value:[]),...(legacy.status==='fulfilled'?legacy.value:[])];
    if(!works.length && legacy.status==='rejected')throw legacy.reason;
    return works;
  }
  async importBilibili(url, number) { return this.bilibili.link(url,number); }
  async searchLegacy(query) {
    const keyword = text(query);
    if (!keyword || keyword.length > 100) throw Object.assign(new Error('请输入有效片名'), { statusCode: 400 });
    return this.cached(`search:${keyword}`, async () => {
      let primaryError, primaryResults = [];
      try {
        const data = (await this.request(`https://api.so.360kan.com/index?${new URLSearchParams({ force_v: '1', kw: keyword, from: '', pageno: '1', v_ap: '1', tab: 'all' })}`)).json();
        if (data.code !== 0 || !data.data) throw error('作品搜索暂不可用，可以粘贴平台剧集链接');
        const rows = data.data.longData?.rows || [];
        primaryResults = rows.filter(row => /^[1-4]$/.test(row.cat_id) && /^[A-Za-z0-9]{5,40}$/.test(row.en_id)).slice(0, 15).map(row => ({
          id: `${row.cat_id}:${row.en_id}`, title: text(row.titleTxt || row.title), year: String(row.year || ''),
          category: String(row.cat_id), categoryLabel: categoryNames[row.cat_id],
          platforms: Object.keys(row.playlinks || {}).filter(key => Object.hasOwn(platforms, key))
        })).filter(row => row.platforms.length);
        if (primaryResults.some(work => normalizeTitle(work.title) === normalizeTitle(keyword))) return primaryResults;
      } catch (failure) { primaryError = failure; }
      let secondary;
      try { secondary = await this.tencent.search(keyword); }
      catch {
        if (primaryResults.length) return primaryResults;
        throw error('备用作品目录暂不可用，请稍后重试');
      }
      if (!secondary.length && primaryError) throw error('作品目录连接失败，请稍后重试');
      return [...primaryResults, ...secondary];
    });
  }
  async details(workId) {
    const { category, id, provider } = validateWorkId(workId);
    return this.cached(`detail:${workId}`, async () => {
      if (provider === 'bilibili') {
        const work=await this.bilibili.season(id);
        if(work.category!==category)throw error('B 站作品分类不一致');
        return work;
      }
      if (provider === 'qq') return this.tencent.details(workId, id);
      const result = (await this.request(`https://api.web.360kan.com/v1/detail?${new URLSearchParams({ cat: category, id })}`)).json();
      const data = result.data;
      if (!data?.title) throw error('暂时无法读取作品集数');
      const episodes = [];
      for (const platform of Object.keys(platforms)) {
        if (category === '1') {
          const source = parseVideoUrl(data.playlinks?.[platform]);
          if (source?.platform === platform) episodes.push({ platform, number: 1, title: '正片', url: source.url });
          continue;
        }
        for (const item of data.allepidetail?.[platform] || []) {
          const source = parseVideoUrl(item.url);
          // Never renumber a sparse list: catalogues may omit paid or unavailable episodes.
          const number = Number(item.playlink_num);
          if (source?.platform === platform && Number.isInteger(number) && number > 0) {
            episodes.push({ platform, number, title: text(item.name || `第 ${number} 集`), url: source.url });
          }
        }
      }
      return { id: workId, catalogId: String(data.id || ''), title: text(data.title), year: String(data.pubdate || '').slice(0, 4), category, categoryLabel: categoryNames[category], episodes,
        platforms: Object.keys(platforms).filter(platform => episodes.some(episode => episode.platform === platform) || data.playlinks?.[platform]) };
    });
  }
  async episode(workId, platform, number, episodeTitle = '') {
    let work = await this.details(workId);
    let episodes = work.episodes;
    if (work.category === '3') {
      episodes = await this.varietyEpisodes(work, platform, episodeTitle);
      const key = normalizeTitle(episodeTitle);
      const exact = episodes.filter(item => normalizeTitle(item.title) === key);
      if (exact.length !== 1) throw missingEpisode('综艺分期无法准确对应，请粘贴这一期的平台链接');
      return { ...work, episode: exact[0] };
    }
    if(platform==='qq' && !episodes.some(item=>item.platform===platform && item.number===number)){
      work=await this.completeTencent(work);episodes=work.episodes;
    }
    const matches = episodes.filter(item => item.platform === platform && item.number === number);
    if (new Set(matches.map(item => item.url)).size > 1) throw missingEpisode('这个集号存在多个版本，请粘贴对应正片链接确认');
    const episode = matches[0];
    if (!episode) throw missingEpisode('该来源没有对应集数，请选择其他来源或粘贴本集链接');
    return { ...work, episode };
  }
  async completeTencent(work) {
    if(!['2','4'].includes(work.category) || work.id.startsWith('qq:'))return work;
    const cids=[...new Set(work.episodes.filter(episode=>episode.platform==='qq')
      .map(episode=>episode.url.match(/^https:\/\/v\.qq\.com\/x\/cover\/([A-Za-z0-9]{15})\//)?.[1]).filter(Boolean))];
    // Only follow the explicit cover identity carried by this catalogue. A
    // title search or combining unrelated covers can silently change seasons.
    if(cids.length!==1)return work;
    return this.cached(`tencent-complete:${work.id}`,async()=>{
      const direct=await this.tencent.details(`qq:${work.category}:${cids[0]}`,cids[0]);
      return {...work,episodes:[...work.episodes.filter(episode=>episode.platform!=='qq'),
        ...direct.episodes.map(episode=>({...episode,title:`第 ${episode.number} 集`}))]};
    });
  }
  async varietyEpisodes(work, platform, episodeTitle) {
    const year = episodeTitle.match(/(?:19|20)\d{2}/)?.[0] || work.year;
    if (!/^\d{4}$/.test(year)) return work.episodes.filter(item => item.platform === platform);
    const result = await this.cached(`variety:${work.id}:${platform}:${year}`, async () =>
      (await this.request(`https://api.so.360kan.com/episodeszongyi?${new URLSearchParams({ entid: work.catalogId, site: platform, y: year, count: '200', offset: '0' })}`)).json());
    if (!Array.isArray(result.data?.list)) throw error('暂时无法读取节目分期');
    return result.data.list.map(item => ({ platform, number: Number(item.playlink_num) || 0, title: text(`${item.period || ''} ${item.name || ''}`), url: item.url }))
      .filter(item => parseVideoUrl(item.url)?.platform === platform);
  }
  async options(workId, episodeTitle = '') {
    let work = await this.details(workId), partial=false;
    try { work=await this.completeTencent(work); } catch { partial=true; }
    let episodes = work.episodes;
    if (work.category === '3') {
      const available = (work.platforms || []).filter(platform => Object.hasOwn(platforms, platform));
      const results = await Promise.allSettled(available.map(platform => this.varietyEpisodes(work, platform, episodeTitle)));
      episodes = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      if (!episodes.length && results.some(result => result.status === 'rejected')) throw error('暂时无法读取节目分期');
    }
    const groups = new Map();
    for (const episode of episodes) {
      if (!Object.hasOwn(platforms, episode.platform) || !Number.isInteger(episode.number) || episode.number < 0 || episode.number > 10000) continue;
      const key = work.category === '3' ? episode.title : String(episode.number);
      const group = groups.get(key) || { key, number: episode.number, title: episode.title, platforms: [] };
      if (!group.platforms.includes(episode.platform)) group.platforms.push(episode.platform);
      groups.set(key, group);
    }
    return { workId, title: work.title, year: work.year, category: work.category, categoryLabel: work.categoryLabel, episodes: [...groups.values()].sort((a,b)=>a.number-b.number).slice(0, 1000), ...(partial ? {partial:true} : {}) };
  }
}
