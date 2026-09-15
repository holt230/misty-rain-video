import { parseVideoUrl, platforms, upstream } from './providers.js';

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
  const year = String(input.title).match(/(?:19|20)\d{2}/)?.[0];
  const matches = candidates.filter(item => normalizeTitle(item.title) === normalizeTitle(input.title)
    && (!year || item.year === year) && item.category === categoryIds[input.category]);
  return matches.length === 1 ? matches[0] : null;
}
const error = message => Object.assign(new Error(message), { statusCode: 502, code: 'DANMAKU_CATALOG_UNAVAILABLE' });
export const missingEpisode = (message = '本集暂未收录弹幕，可稍后再试或查看作品是否选对') =>
  Object.assign(new Error(message), { statusCode: 404, code: 'DANMAKU_EPISODE_NOT_FOUND' });
export function validateWorkId(id) {
  const match = String(id).match(/^([1-4]):([A-Za-z0-9]{5,40})$/);
  if (!match) throw Object.assign(new Error('作品编号无效'), { statusCode: 400 });
  return { category: match[1], id: match[2] };
}
export class DanmakuCatalog {
  constructor(request = upstream) { this.request = request; this.cache = new Map(); this.pending = new Map(); }
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
    const keyword = text(query);
    if (!keyword || keyword.length > 100) throw Object.assign(new Error('请输入有效片名'), { statusCode: 400 });
    return this.cached(`search:${keyword}`, async () => {
      const data = (await this.request(`https://api.so.360kan.com/index?${new URLSearchParams({ force_v: '1', kw: keyword, from: '', pageno: '1', v_ap: '1', tab: 'all' })}`)).json();
      if (data.code !== 0 || !data.data) throw error('作品搜索暂不可用，可以粘贴平台剧集链接');
      const rows = data.data.longData?.rows || [];
      return rows.filter(row => /^[1-4]$/.test(row.cat_id) && /^[A-Za-z0-9]{5,40}$/.test(row.en_id)).slice(0, 15).map(row => ({
        id: `${row.cat_id}:${row.en_id}`, title: text(row.titleTxt || row.title), year: String(row.year || ''),
        category: String(row.cat_id), categoryLabel: categoryNames[row.cat_id],
        platforms: Object.keys(row.playlinks || {}).filter(key => Object.hasOwn(platforms, key))
      })).filter(row => row.platforms.length);
    });
  }
  async details(workId) {
    const { category, id } = validateWorkId(workId);
    return this.cached(`detail:${workId}`, async () => {
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
      return { id: workId, catalogId: String(data.id || ''), title: text(data.title), year: String(data.pubdate || '').slice(0, 4), category, categoryLabel: categoryNames[category], episodes };
    });
  }
  async episode(workId, platform, number, episodeTitle = '') {
    const work = await this.details(workId);
    let episodes = work.episodes;
    if (work.category === '3') {
      // Variety programmes use dates/parts instead of a reliable ordinal episode number.
      const id = work.catalogId;
      const year = episodeTitle.match(/(?:19|20)\d{2}/)?.[0] || work.year;
      if (/^\d{4}$/.test(year)) {
        const result = await this.cached(`variety:${workId}:${platform}:${year}`, async () =>
          (await this.request(`https://api.so.360kan.com/episodeszongyi?${new URLSearchParams({ entid: id, site: platform, y: year, count: '200', offset: '0' })}`)).json());
        episodes = (result.data?.list || []).map(item => ({ platform, number: Number(item.playlink_num), title: text(`${item.period || ''} ${item.name || ''}`), url: item.url }));
      }
      const key = normalizeTitle(episodeTitle);
      const exact = episodes.filter(item => normalizeTitle(item.title) === key);
      if (exact.length !== 1) throw missingEpisode('综艺分期无法准确对应，请粘贴这一期的平台链接');
      return { ...work, episode: exact[0] };
    }
    const episode = episodes.find(item => item.platform === platform && item.number === number);
    if (!episode) throw missingEpisode('该来源没有对应集数，请选择其他来源或粘贴本集链接');
    return { ...work, episode };
  }
}
