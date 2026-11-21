import { parse } from 'parse5';
import { readWebResponseText } from './http.js';
import { isExactWorkTitle, seasonQuery } from './searchTitles.js';

const ORIGIN = 'https://www.2xiaopan.one';
const MAX_DETAILS = 3;
const failure = (message, code = 'RESOURCE_SEARCH_UNAVAILABLE') => Object.assign(new Error(message), { code, statusCode: 503 });
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value || '';
const hasClass = (node, name) => attr(node, 'class').split(/\s+/).includes(name);
const text = node => node?.nodeName === '#text' ? node.value : (node?.childNodes || []).map(text).join('');
const clean = node => text(node).replace(/\s+/g, ' ').trim();
function findAll(root, predicate) {
  const result = [];
  const visit = node => { if (predicate(node)) result.push(node); for (const child of node.childNodes || []) visit(child); };
  visit(root); return result;
}
const firstClass = (root, name) => findAll(root, node => hasClass(node, name))[0];
const categoryOf = value => /动漫|动画/.test(value) ? 'anime' : /电影/.test(value) ? 'movie' : /剧集|电视剧/.test(value) ? 'tv' : /综艺/.test(value) ? 'variety' : undefined;
const canonicalDetail = value => {
  try { const url = new URL(value, ORIGIN); return url.origin === ORIGIN && /^\/(?:index\.php\/)?vod\/detail\/id\/\d+\.html$/.test(url.pathname) ? url.href : ''; }
  catch { return ''; }
};
const countEpisode = value => Number(value.match(/(?:更新至|更新|第|全)\s*(?:第)?\s*(\d+)\s*集/)?.[1] || 0);

export function parseResourceIndex(html, keyword, category = 'all') {
  const doc = parse(html);
  const cards = findAll(doc, node => hasClass(node, 'module-search-item'));
  if (!cards.length && !findAll(doc, node => hasClass(node, 'mac_total')).length) throw failure('搜索来源页面结构异常', 'RESOURCE_SEARCH_INVALID_RESPONSE');
  const matches = [];
  for (const card of cards) {
    const heading = findAll(card, node => node.tagName === 'h3')[0];
    const anchor = heading && findAll(heading, node => node.tagName === 'a')[0];
    const title = clean(anchor);
    if (!anchor || !isExactWorkTitle(keyword, title)) continue;
    const detailUrl = canonicalDetail(attr(anchor, 'href'));
    const metadata = firstClass(card, 'video-info-aux');
    const kind = metadata ? categoryOf(clean(metadata)) : undefined;
    if (category !== 'all' && kind && kind !== category) continue;
    const updateText = clean(firstClass(card, 'video-serial'));
    const year = clean(metadata).match(/(?:19|20)\d{2}/)?.[0] || '';
    if (detailUrl && !matches.some(item => item.detailUrl === detailUrl)) matches.push({ title, category: kind, year, updateText, latestEpisode: countEpisode(updateText), detailUrl });
  }
  const next = findAll(doc, node => node.tagName === 'a' && attr(node, 'title') === '下一页')[0];
  let nextUrl = '';
  try { const url = new URL(attr(next || {}, 'href'), ORIGIN); if (next && url.origin === ORIGIN && /^\/(?:index\.php\/)?vod\/search\//.test(url.pathname)) nextUrl = url.href; } catch { /* No next page. */ }
  return { matches, nextUrl };
}

export function parseResourceDetail(html, work) {
  const doc = parse(html);
  const root = firstClass(doc, 'view-heading');
  const titleNode = root && findAll(root, node => node.tagName === 'h1' && hasClass(node, 'page-title'))[0];
  if (!titleNode || clean(titleNode) !== work.title) throw failure('资源详情与搜索作品不一致', 'RESOURCE_SEARCH_INVALID_RESPONSE');
  const notes = findAll(root, node => hasClass(node, 'video-info-items'));
  const remark = notes.find(node => /^(?:备注|更新|状态)\s*[:：]/.test(clean(firstClass(node, 'video-info-itemtitle'))));
  const updateText = clean(firstClass(remark || {}, 'video-info-item')) || work.updateText;
  const rows = findAll(doc, node => hasClass(node, 'module-row-shortcuts'));
  const results = new Map();
  for (const row of rows) {
    for (const anchor of findAll(row, node => node.tagName === 'a')) {
      const raw = attr(anchor, 'href');
      const match = raw.match(/^https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)(?:[/?#]|$)/i);
      if (!match) continue;
      const url = `https://pan.quark.cn/s/${match[1]}`;
      let password = '';
      try { password = new URL(raw).searchParams.get('pwd') || ''; } catch { /* Canonical link is still valid. */ }
      const parentText = clean(row.parentNode || row);
      password ||= parentText.match(/(?:提取码|访问码|密码)\s*[:：]?\s*([a-zA-Z0-9]{4})/)?.[1] || '';
      results.set(url, { url, password, note: work.title, work_title: work.title, category: work.category, year: work.year,
        update_text: updateText, latest_episode: countEpisode(updateText), datetime: '', source: 'erxiaopan', source_url: work.detailUrl });
    }
  }
  return [...results.values()];
}

/** One submitted title, one existing source, matched details only; no cache or fallback. */
export class CatalogResourceSearch {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) { this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async search(keyword, { category = 'all', signal } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('搜索超时，请重试', 'RESOURCE_SEARCH_TIMEOUT')); }, this.timeoutMs); });
    try {
      return await Promise.race([timeout, this.run(keyword, category, controller.signal)]);
    } catch (error) {
      if (controller.signal.aborted) throw failure(signal?.aborted ? '搜索已取消' : '搜索超时，请重试', signal?.aborted ? 'RESOURCE_SEARCH_CANCELLED' : 'RESOURCE_SEARCH_TIMEOUT');
      if (String(error?.code || '').startsWith('RESOURCE_SEARCH_')) throw error;
      throw failure('搜索来源访问失败，请稍后重试');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async page(url, signal) {
    const response = await this.fetchImpl(url, { signal, headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0', Referer: ORIGIN + '/' }, redirect: 'error' });
    if (!response.ok) throw failure(`搜索来源返回 HTTP ${response.status}`);
    return readWebResponseText(response, { maxBytes: 2 * 1024 * 1024, idleTimeoutMs: this.timeoutMs });
  }
  async run(keyword, category, signal) {
    // The upstream text index lists the same season as “剧名3” or “剧名 第三季”. Only exact editions survive parseResourceIndex.
    const base = category !== 'movie' && seasonQuery(keyword)?.base;
    let works = [];
    for (const lookup of base ? [keyword, base] : [keyword]) {
      let pageUrl = `${ORIGIN}/index.php/vod/search/wd/${encodeURIComponent(lookup)}.html`;
      for (let page = 0; page < 2 && pageUrl && !works.length; page++) {
        const result = parseResourceIndex(await this.page(pageUrl, signal), keyword, category);
        works = result.matches; pageUrl = result.nextUrl;
      }
      if (works.length) break;
    }
    if (!works.length) return { total: 0, merged_by_type: { quark: [] }, partial: false };
    const selected = works.sort((a, b) => b.latestEpisode - a.latestEpisode || Number(b.year) - Number(a.year) || a.title.localeCompare(b.title)).slice(0, MAX_DETAILS);
    const resolved = [];
    let failed = false;
    // Two matched detail requests at a time; unrelated works are never opened.
    for (let start = 0; start < selected.length; start += 2) {
      const batch = await Promise.allSettled(selected.slice(start, start + 2).map(async work => parseResourceDetail(await this.page(work.detailUrl, signal), work)));
      for (const result of batch) { if (result.status === 'fulfilled') resolved.push(...result.value); else failed = true; }
    }
    if (failed && !resolved.length) throw failure('搜索来源详情请求失败，请重试');
    const unique = new Map();
    for (const item of resolved) {
      const existing = unique.get(item.url);
      if (!existing || item.latest_episode > existing.latest_episode) unique.set(item.url, item);
    }
    const items = [...unique.values()].sort((a, b) => b.latest_episode - a.latest_episode || a.work_title.localeCompare(b.work_title) || a.url.localeCompare(b.url));
    return { total: items.length, merged_by_type: { quark: items }, partial: failed,
      ...(failed ? { message: '部分匹配作品详情请求失败，以下为本次实际取得的结果。' } : {}) };
  }
}
