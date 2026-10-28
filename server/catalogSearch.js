import { catalogFacets } from './catalogFacets.js';
import { isDiscoveryImageUrl, ratingCount } from './discoverySources.js';
import { catalogSearchKeyword, catalogTitleRelevance } from './catalogTitle.js';

const text = (value, max = 180) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const failure = () => Object.assign(new Error('影片信息暂时无法加载，可以直接搜索资源'), { code: 'CATALOG_UNAVAILABLE', statusCode: 503 });

export function normalizeCatalogSearch(payload) {
  if ((!Array.isArray(payload?.subjects?.items) && !Array.isArray(payload?.smart_box)) || payload.banned) throw failure();
  const items = new Map();
  for (const row of [...(payload.smart_box || []), ...(payload.subjects?.items || [])]) {
    const item = row?.target, type = row?.target_type;
    if (!['movie', 'tv'].includes(type) || !/^[1-9]\d{0,12}$/.test(String(item?.id || ''))) continue;
    const title = text(item.title, 120); if (!title) continue;
    const description = text(item.card_subtitle);
    const category = /动画|动漫/.test(description) ? 'anime'
      : type === 'tv' && /真人秀|脱口秀|综艺/.test(description) ? 'variety' : type;
    const imageUrl = text(item.cover_url, 2048).replace(/^http:/, 'https:');
    const score = Number(item.rating?.value);
    const entry = { id: `douban-${item.id}`, provider: 'douban', title, category, ...catalogFacets(item),
      ratingCount: ratingCount(item.rating?.count),
      year: /^(19|20)\d{2}$/.test(String(item.year)) ? String(item.year) : '',
      rating: score > 0 && score <= 10 && item.rating?.count !== 0 ? Math.round(score * 10) / 10 : null,
      subtitle: item.null_rating_reason === '尚未播出' ? '尚未播出' : '', description,
      imageUrl: isDiscoveryImageUrl(imageUrl, 'douban') ? imageUrl : '',
      sourceUrl: `https://movie.douban.com/subject/${item.id}/` };
    if (!items.has(entry.id)) items.set(entry.id, entry);
  }
  return [...items.values()].slice(0, 30);
}

// This is the public suggestion endpoint used by Douban Movie's own navbar.
// Its `type: movie` also includes series; only `episode` distinguishes them.
export function normalizeCatalogSuggestions(payload) {
  if (!Array.isArray(payload)) throw failure();
  const items = new Map();
  for (const row of payload) {
    if (row?.type !== 'movie' || !/^[1-9]\d{0,12}$/.test(String(row.id || ''))) continue;
    const title = text(row.title, 120); if (!title) continue;
    const imageUrl = text(row.img, 2048).replace(/^http:/, 'https:');
    const alias = text(row.sub_title, 120), id = `douban-${row.id}`;
    items.set(id, { id, provider: 'douban', title, aliases: alias && alias !== title ? [alias] : [],
      category: Number(row.episode) > 0 ? 'tv' : 'movie',
      year: /^(19|20)\d{2}$/.test(String(row.year)) ? String(row.year) : '',
      rating: null, ratingCount: null, genres: [], countries: [], subtitle: '', description: alias !== title ? alias : '',
      imageUrl: isDiscoveryImageUrl(imageUrl, 'douban') ? imageUrl : '',
      sourceUrl: `https://movie.douban.com/subject/${row.id}/` });
  }
  return [...items.values()].slice(0, 30);
}

function mergeItems(primary, suggestions, known, query) {
  const metadata = new Map();
  for (const item of [...suggestions, ...known, ...primary]) {
    const previous = metadata.get(item.id);
    metadata.set(item.id, { ...previous, ...item,
      aliases: [...new Set([...(previous?.aliases || []), ...(item.aliases || [])])],
      genres: item.genres?.length ? item.genres : previous?.genres || [],
      countries: item.countries?.length ? item.countries : previous?.countries || [],
      rating: item.ratingCount === 0 ? null : item.rating ?? previous?.rating ?? null,
      ratingCount: item.ratingCount ?? previous?.ratingCount ?? null,
      imageUrl: item.imageUrl || previous?.imageUrl || '',
      year: item.year || previous?.year || '', description: item.description || previous?.description || '' });
  }
  const ordered = [...new Set([...primary, ...suggestions, ...known].map(item => item.id))].map(id => metadata.get(id));
  // Keep upstream alias/fuzzy matches even when the displayed Chinese title
  // doesn't contain the query. Local relevance only changes their order.
  return ordered.sort((a, b) => catalogTitleRelevance(query, b) - catalogTitleRelevance(query, a)).slice(0, 30);
}

export class CatalogSearch {
  constructor({ discovery, fetcher = fetch, now = Date.now }) {
    this.discovery = discovery; this.fetcher = fetcher; this.now = now;
    this.cache = new Map(); this.pending = new Map();
  }
  async search(query) {
    const keyword = typeof query === 'string' ? catalogSearchKeyword(query) : '';
    if (!keyword || keyword.length > 100 || /https?:\/\//i.test(keyword)) throw Object.assign(new Error('请输入100字以内的片名'), { statusCode: 400 });
    const key = keyword.normalize('NFKC').toLowerCase(), cached = this.cache.get(key);
    if (cached && cached.until > this.now()) { this.discovery.registerCatalogItems(cached.items); return { items: this.publicItems(cached.items), partial: Boolean(cached.partial) }; }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 4) throw failure();
    const knownItems = () => (this.discovery.matchingCatalogItems?.(keyword) || []).filter(item =>
      item?.provider === 'douban' && /^douban-[1-9]\d{0,12}$/.test(item.id)
      && ['movie', 'tv', 'anime', 'variety'].includes(item.category) && text(item.title, 120)
      && (!item.imageUrl || isDiscoveryImageUrl(item.imageUrl, 'douban')));
    const task = Promise.allSettled([this.load(keyword), this.loadSuggestions(keyword)]).then(([search, suggest]) => {
      const primary = search.status === 'fulfilled' ? search.value : [];
      const suggestions = suggest.status === 'fulfilled' ? suggest.value : [];
      const known = knownItems();
      const partial = search.status === 'rejected' || suggest.status === 'rejected';
      // A failed upstream is not proof that a title doesn't exist.
      if (partial && !primary.length && !suggestions.length && !known.length) throw failure();
      const items = mergeItems(primary, suggestions, known, keyword);
      this.cache.delete(key); this.cache.set(key, { items, partial, until: this.now() + (partial ? 30_000 : 10 * 60_000) });
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      this.discovery.registerCatalogItems(items);
      return { items: this.publicItems(items), partial };
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  publicItems(items) { return items.map(({ imageUrl, ...item }) => ({ ...item, poster: imageUrl ? `/api/discovery/posters/${item.id}` : '' })); }
  async load(keyword) {
    return normalizeCatalogSearch(await this.fetchJson(`https://m.douban.com/rexxar/api/v2/search?type=movie&q=${encodeURIComponent(keyword)}`, 'https://m.douban.com/search/'));
  }
  async loadSuggestions(keyword) {
    return normalizeCatalogSuggestions(await this.fetchJson(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`, 'https://movie.douban.com/'));
  }
  async fetchJson(url, referer) {
    try {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(8000), redirect: 'error',
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: referer }
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw failure(); chunks.push(chunk); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw failure(); }
  }
}
