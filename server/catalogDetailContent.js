import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDiscoveryImageUrl } from './discoverySources.js';
const text = (value, limit = 2000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const stableId = (value, fallback) => /^[1-9]\d{0,18}$/.test(String(value)) ? String(value) : crypto.createHash('sha256').update(fallback).digest('hex').slice(0, 20);
const imageUrl = value => isDiscoveryImageUrl(value, 'douban') ? value : '';
const error = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode });
export const normalizePhotos = payload => (Array.isArray(payload?.photos) ? payload.photos : []).slice(0, 24).map(photo => {
  const large = imageUrl(photo.image?.large?.url || photo.image?.normal?.url), small = imageUrl(photo.image?.normal?.url) || large;
  return { id: stableId(photo.id, large), imageUrl: small, fullImageUrl: large, description: text(photo.description, 500) };
}).filter(photo => photo.imageUrl);
export const normalizeComments = payload => (Array.isArray(payload?.interests) ? payload.interests : []).slice(0, 20).map(item => ({
  id: stableId(item.id, `${item.user?.name}|${item.create_time}|${item.comment}`), author: text(item.user?.name, 80),
  text: text(item.comment, 3000), rating: count(item.rating?.value) <= 5 ? count(item.rating?.value) : 0,
  date: text(item.create_time, 10), votes: count(item.vote_count)
})).filter(item => item.text);
const decode = value => value.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity) => {
  if (!entity.startsWith('#')) return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[entity.toLowerCase()] || '';
  const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
  return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
}).trim();
/** Only consume the provider's structured fact table, never render upstream HTML. */
export function parseSubjectInfo(html) {
  const facts = {};
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length === 2) facts[decode(cells[0][1])] = decode(cells[1][1]).slice(0, 6000);
  }
  const values = key => (facts[key] || '').split(' / ').map(value => text(value, 300)).filter(Boolean).slice(0, 100);
  return { writers: values('编剧'), actors: values('主演'), premieres: values('上映'), genres: values('类型'),
    countries: values('地区'), languages: values('语言'), durations: values('片长'), aliases: values('又名'),
    imdb: /^tt\d{5,12}$/.test(facts.IMDb || '') ? facts.IMDb : '' };
}

/** User-driven pages, bounded on disk and in flight; no background crawl of entire subjects. */
export class CatalogDetailContent {
  constructor(owner, { dataDir, now = Date.now }) {
    this.owner = owner; this.now = now; this.file = path.resolve(dataDir, 'catalog-detail-content.json');
    this.cache = new Map(); this.pending = new Map(); this.failures = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version === 1) for (const [key, value] of (saved.entries || []).slice(-120)) {
        if (/^douban-[1-9]\d{0,12}:(photos|comments):\d+$/.test(key) && Array.isArray(value?.page?.items) && value.at > now() - 7 * 86400_000) this.cache.set(key, value);
      }
    } catch { /* Rebuilt on demand. */ }
  }
  save() {
    for (const [key, value] of this.cache) if (this.now() - value.at >= 7 * 86400_000) this.cache.delete(key);
    while (this.cache.size > 120) this.cache.delete(this.cache.keys().next().value);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, entries: [...this.cache] }), { mode: 0o600 });
      fs.renameSync(this.file + '.tmp', this.file);
    } catch { /* Optional cache storage must not block live content. */ }
  }
  async get(id, section, startValue = '0') {
    if (!/^douban-[1-9]\d{0,12}$/.test(id) || !['photos', 'comments'].includes(section)) throw error('内容不存在', 404);
    if (!/^\d{1,5}$/.test(String(startValue)) || Number(startValue) > 10000) throw error('分页参数无效', 400);
    const start = Number(startValue), key = `${id}:${section}:${start}`, cached = this.cache.get(key);
    const age = cached ? this.now() - cached.at : Infinity;
    if (age < 6 * 3600_000) return this.publicPage(cached.page, section, false);
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 4 || (this.failures.get(key) || 0) > this.now()) {
      if (age < 7 * 86400_000) return this.publicPage(cached.page, section, true);
      throw error('内容暂时无法加载，请稍后重试');
    }
    const task = (async () => {
      const detail = await this.owner.get(id);
      const signal = AbortSignal.timeout(8000), size = section === 'photos' ? 24 : 20;
      const base = `https://m.douban.com/rexxar/api/v2/${detail.subjectType}/${id.slice(7)}`;
      const suffix = section === 'photos' ? `/photos?type=S&start=${start}&count=${size}` : `/interests?order_by=hot&start=${start}&count=${size}`;
      const payload = await this.owner.json(base + suffix, signal);
      const rows = section === 'photos' ? payload.photos : payload.interests;
      if (!Array.isArray(rows) || payload.start !== start) throw error('内容分页暂时不可用');
      const items = section === 'photos' ? normalizePhotos(payload) : normalizeComments(payload);
      const total = count(payload.total), consumed = Math.min(rows.length, size), next = start + consumed;
      // Stop on an empty/repeated page. The client also deduplicates IDs before appending.
      const page = { items, total, nextStart: items.length && consumed && next < total && next <= 10000 ? next : null };
      this.cache.delete(key); this.cache.set(key, { at: this.now(), page }); this.failures.delete(key); this.save();
      return this.publicPage(page, section, false);
    })().catch(err => {
      for (const [key, until] of this.failures) if (until <= this.now()) this.failures.delete(key);
      if (this.failures.size >= 200) this.failures.delete(this.failures.keys().next().value);
      this.failures.set(key, this.now() + 60_000);
      if (age < 7 * 86400_000) return this.publicPage(cached.page, section, true);
      throw err?.statusCode ? err : error('内容暂时无法加载，请稍后重试');
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  publicPage(page, section, stale) {
    return { ...page, stale, items: section === 'photos' ? page.items.map(({ imageUrl, fullImageUrl, ...photo }) => ({
      ...photo, image: this.owner.image(imageUrl, 'douban'), fullImage: this.owner.image(fullImageUrl, 'douban')
    })) : page.items };
  }
}
