import { isDiscoveryImageUrl } from './discoverySources.js';
import { normalizeCatalogSearch } from './catalogSearch.js';
import { CATALOG_GENRES, CATALOG_COUNTRIES, catalogYears } from './catalogFacets.js';
const PAGE_SIZE = 24;
const badInput = () => Object.assign(new Error('筛选条件无效'), { statusCode: 400 });
const unavailable = () => Object.assign(new Error('豆瓣筛选暂时不可用，请稍后重试'), { statusCode: 503 });
const sorts = { recommended: 'T', rating: 'S', popularity: 'U', time: 'R' };

export function browseOptions(input = {}) {
  const options = { category: input.category || 'all', genre: input.genre || '', country: input.country || '',
    year: input.year || '', sort: input.sort || 'recommended', start: Number(input.start || 0) };
  if (!['all','movie','tv','anime','variety'].includes(options.category)
    || options.genre && !CATALOG_GENRES.includes(options.genre)
    || options.country && !CATALOG_COUNTRIES.includes(options.country)
    || options.year && !catalogYears().includes(options.year)
    || !Object.hasOwn(sorts, options.sort)
    || !Number.isInteger(options.start) || options.start < 0 || options.start > 480 || options.start % PAGE_SIZE !== 0) throw badInput();
  return options;
}

export class CatalogBrowse {
  constructor({ catalogSearch, now = Date.now }) {
    this.search = catalogSearch; this.now = now; this.cache = new Map(); this.pending = new Map();
  }
  async get(input) {
    const options = browseOptions(input), key = JSON.stringify(options), cached = this.cache.get(key);
    if (cached && cached.until > this.now()) { this.search.discovery.registerCatalogItems(cached.items); return this.publicResult(cached); }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 4) throw unavailable();
    const types = options.category === 'all' ? ['movie','tv'] : [options.category === 'movie' ? 'movie' : 'tv'];
    const task = Promise.allSettled(types.map(type => this.load(type, options))).then(results => {
      const pages = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      const partial = pages.length < types.length;
      if (!pages.length || partial && !pages.some(page => page.items.length)) throw unavailable();
      // Alternate movie/TV recommendations. Their provider heat rankings are
      // independent; there is no invented cross-category popularity score.
      const unique = new Map();
      for (let i = 0; i < PAGE_SIZE; i++) for (const page of pages) {
        const item = page.items[i]; if (item && !unique.has(item.id)) unique.set(item.id, item);
      }
      const items = [...unique.values()];
      if (options.sort === 'rating') items.sort((a,b) => (b.rating ?? -1) - (a.rating ?? -1));
      if (options.sort === 'time') items.sort((a,b) => Number(b.year || 0) - Number(a.year || 0));
      const value = { items, partial, nextStart: options.start < 480 && pages.some(page => page.hasMore) ? options.start + PAGE_SIZE : null,
        until: this.now() + (partial ? 30_000 : 10 * 60_000) };
      this.cache.delete(key); this.cache.set(key, value);
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      this.search.discovery.registerCatalogItems(items);
      return this.publicResult(value);
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  publicResult({ items, partial, nextStart }) { return { items: this.search.publicItems(items), partial, nextStart }; }
  async load(type, options) {
    const form = options.category === 'variety' ? '综艺' : options.category === 'tv' ? '电视剧' : '';
    const tags = [...new Set([form, options.category === 'anime' ? '动画' : '', options.genre, options.country, options.year].filter(Boolean))];
    const query = new URLSearchParams({ tags: tags.join(','), selected_categories: JSON.stringify(form ? { 形式: form } : {}),
      sort: sorts[options.sort], start: String(options.start), count: String(PAGE_SIZE) });
    const data = await this.search.fetchJson(`https://m.douban.com/rexxar/api/v2/${type}/recommend?${query}`, 'https://movie.douban.com/explore');
    if (!Array.isArray(data?.items) || data.banned || !Number.isSafeInteger(data.total) || data.total < 0) throw unavailable();
    const items = normalizeCatalogSearch({ subjects: { items: data.items.map(item => ({ target_type: item?.type,
      target: { ...item, cover_url: (isDiscoveryImageUrl(item?.pic?.large, 'douban') ? item.pic.large : '') || item?.pic?.normal || item?.cover_url } })) } });
    // Movie recommendations include animated features. Preserve that format;
    // TV recommendations retain the genres supplied by Douban.
    if (type === 'movie') for (const item of items) item.category = 'movie';
    return { items, hasMore: options.start + PAGE_SIZE < data.total };
  }
}
