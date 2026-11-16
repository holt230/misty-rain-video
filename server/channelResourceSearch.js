import { parse } from 'parse5';
import { readWebResponseText } from './http.js';

// These are existing public sources from the bundled engine. Query them directly
// in the same bounded operation, without the engine's cache or background tasks.
export const SEARCH_CHANNELS = ['Quark_Movies', 'guoman4K'];
const failure = (message, code = 'RESOURCE_SEARCH_UNAVAILABLE') => Object.assign(new Error(message), { code, statusCode: 503 });
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value || '';
const hasClass = (node, name) => attr(node, 'class').split(/\s+/).includes(name);
const content = node => node.nodeName === '#text' ? node.value : node.tagName === 'br' ? '\n' : (node.childNodes || []).map(content).join('');
function find(root, predicate) {
  const found = [];
  const walk = node => { if (predicate(node)) found.push(node); for (const child of node.childNodes || []) walk(child); };
  walk(root); return found;
}

export function parseChannelResults(html, channel, category = 'all') {
  const doc = parse(html);
  if (!find(doc, node => hasClass(node, 'tgme_channel_history')).length) throw failure('公开来源页面无法读取', 'RESOURCE_SEARCH_INVALID_RESPONSE');
  const rows = [];
  for (const message of find(doc, node => hasClass(node, 'tgme_widget_message'))) {
    const body = find(message, node => hasClass(node, 'tgme_widget_message_text'))[0];
    if (!body) continue;
    const lines = content(body).split('\n').map(line => line.trim()).filter(Boolean);
    const heading = lines.find(line => !/^【(?:已)?(?:停更|完结|复播)】$/.test(line))?.replace(/^(?:名称|资源名称|片名)\s*[:：]\s*/, '') || '';
    if (!heading) continue;
    const tags = lines.filter(line => /标签\s*[:：]/.test(line)).join(' ');
    const metadata = heading + ' ' + tags;
    const kind = /真人版|电视剧|国产剧|美剧|韩剧|日剧|短剧/.test(metadata) ? 'tv'
      : /动漫|动画|国漫|日漫|年番|番剧/.test(metadata) || channel === 'guoman4K' ? 'anime'
        : /综艺|真人秀|脱口秀/.test(metadata) ? 'variety' : /电影|院线/.test(metadata) ? 'movie' : undefined;
    if (category !== 'all' && kind && category !== kind) continue;
    const episodeLabels = [...heading.matchAll(/(?:更新|更至|全|第)\s*(?:至|第)?\s*(\d{1,4})(?:\s*[-~至]\s*(\d{1,4}))?\s*[集话]|(\d{1,4})\s*[集话]/g)];
    const episodeCodes = [...heading.matchAll(/(?:^|[^a-z])(?:s\d{1,2})?e(?:p)?\s*0*(\d{1,4})(?=$|[^0-9])/ig)];
    const latest = Math.max(0, ...episodeLabels.map(match => Number(match[2] || match[1] || match[3])), ...episodeCodes.map(match => Number(match[1])));
    const datetime = attr(find(message, node => node.tagName === 'time')[0] || {}, 'datetime');
    const post = attr(message, 'data-post');
    const sourceUrl = new RegExp(`^${channel}/\\d+$`).test(post) ? `https://t.me/${post}` : `https://t.me/s/${channel}`;
    const links = find(body, node => node.tagName === 'a').map(node => attr(node, 'href'));
    for (const link of links) {
      const match = link.match(/^https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)(?:[/?#]|$)/i);
      if (!match) continue;
      const password = new URL(link).searchParams.get('pwd') || content(body).match(/(?:提取码|访问码|密码)\s*[:：]?\s*([a-zA-Z0-9]{4})/)?.[1] || '';
      // Informal post headings are not structured work titles or authoritative
      // premiere years. The normal title/category checks and share inspection apply.
      rows.push({ url: `https://pan.quark.cn/s/${match[1]}`, password, note: heading, category: kind,
        latest_episode: latest, datetime, source: channel, source_url: sourceUrl });
    }
  }
  const unique = new Map();
  for (const row of rows.sort((a, b) => b.latest_episode - a.latest_episode || b.datetime.localeCompare(a.datetime) || a.url.localeCompare(b.url))) {
    if (!unique.has(row.url)) unique.set(row.url, row);
  }
  return [...unique.values()];
}

export class ChannelResourceSearch {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) { this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async search(keyword, { channel, category = 'all', signal } = {}) {
    if (!SEARCH_CHANNELS.includes(channel)) throw failure('搜索来源配置无效');
    if (channel === 'guoman4K' && !['all', 'anime'].includes(category)) return { total: 0, merged_by_type: { quark: [] } };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    try {
      return await Promise.race([
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('公开来源查询超时', 'RESOURCE_SEARCH_TIMEOUT')); }, this.timeoutMs); }),
        (async () => {
          const url = new URL(`https://t.me/s/${channel}`); url.searchParams.set('q', keyword);
          const response = await this.fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'text/html', 'User-Agent': 'MistyRainVideo/1.0' } });
          if (!response.ok) throw failure(`公开来源返回 HTTP ${response.status}`, 'RESOURCE_SEARCH_HTTP_ERROR');
          const rows = parseChannelResults(await readWebResponseText(response, { maxBytes: 2 * 1024 * 1024, idleTimeoutMs: this.timeoutMs }), channel, category);
          return { total: rows.length, merged_by_type: { quark: rows } };
        })()
      ]);
    } catch (error) {
      if (String(error.code || '').startsWith('RESOURCE_SEARCH_')) throw error;
      throw failure('服务器无法连接公开频道来源', /redirect/i.test(error.cause?.message || error.message || '') ? 'RESOURCE_SEARCH_REDIRECT' : 'RESOURCE_SEARCH_NETWORK_ERROR');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
}
