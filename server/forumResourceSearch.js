import { parse } from 'parse5';
import { readWebResponseText } from './http.js';
import { isExactWorkTitle } from './searchTitles.js';

const ORIGIN = 'https://quark4k.com';
const fail = (message, code = 'RESOURCE_SEARCH_INVALID_RESPONSE') => Object.assign(new Error(message), { code, statusCode: 503 });
const text = node => node?.nodeName === '#text' ? node.value : (node?.childNodes || []).map(text).join('');
const workName = value => String(value || '').normalize('NFKC').replace(/^(?:【(?:国漫|动漫|动画|日漫|电影|电视剧|剧集|综艺)】\s*)+/, '')
  .split(/\s*[\[(](?:19|20)\d{2}[\])]/)[0].replace(/\s+(?:4K|1080P|2160P|蓝光|高清|夸克).*$/i, '').trim();
const categoryOf = title => /【(?:国漫|动漫|动画|日漫)】/.test(title) ? 'anime' : /【电影】/.test(title) ? 'movie' : /【(?:电视剧|剧集)】/.test(title) ? 'tv' : /【综艺】/.test(title) ? 'variety' : undefined;

export function parseForumResources(payload, keyword, category = 'all') {
  if (!Array.isArray(payload?.data) || (payload.data.length > 0 && !Array.isArray(payload?.included))) throw fail('公开资源论坛响应异常');
  const posts = new Map((payload.included || []).filter(row => row.type === 'posts' && /^\d{1,16}$/.test(String(row.id))).map(row => [String(row.id), row]));
  const found = new Map();
  for (const row of payload.data.slice(0, 30)) {
    if (row.type !== 'discussions' || !/^\d{1,16}$/.test(String(row.id))) continue;
    const title = String(row.attributes?.title || '').slice(0, 500), work = workName(title), kind = categoryOf(title);
    if (!kind || (category !== 'all' && category !== kind) || !isExactWorkTitle(keyword, work) || /剧场版|小说|有声|壁纸|电子书/.test(title)) continue;
    const ids = [row.relationships?.mostRelevantPost?.data?.id, row.relationships?.firstPost?.data?.id].filter(Boolean).map(String);
    for (const id of [...new Set(ids)]) {
      const post = posts.get(id), html = String(post?.attributes?.contentHtml || '');
      if (!post || html.length > 100000) continue;
      const document = parse(html), body = text(document);
      const visit = node => {
        if (node.tagName === 'a') {
          const href = node.attrs?.find(attr => attr.name === 'href')?.value || '';
          let url;
          try { url = new URL(href); } catch { /* Only explicit share anchors are accepted. */ }
          const shareId = url?.protocol === 'https:' && url.hostname === 'pan.quark.cn' && !url.port && !url.username && !url.password
            ? url.pathname.match(/^\/s\/([a-zA-Z0-9]+)\/?$/)?.[1] : '';
          if (shareId) {
            const shareUrl = 'https://pan.quark.cn/s/' + shareId;
            const year = title.match(/[\[(]((?:19|20)\d{2})[\])]/)?.[1] || '';
            const candidate = { url: shareUrl, note: title, work_title: work, category: kind, year,
              password: url.searchParams.get('pwd') || body.match(/(?:提取码|访问码)\s*[:：]?\s*([a-zA-Z0-9]{4})/)?.[1] || '',
              datetime: row.attributes?.createdAt || '', source: 'quark4k', source_url: ORIGIN + '/d/' + row.id };
            const previous = found.get(shareUrl);
            if (!previous || (work === keyword && previous.work_title !== keyword)) found.set(shareUrl, candidate);
          }
        }
        for (const child of node.childNodes || []) visit(child);
      };
      visit(document);
    }
  }
  return [...found.values()];
}

export class ForumResourceSearch {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) { this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async search(keyword, { category = 'all' } = {}) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('公开资源论坛查询超时', 'RESOURCE_SEARCH_TIMEOUT')); }, this.timeoutMs); }),
        (async () => {
          const params = new URLSearchParams({ 'filter[q]': keyword, 'page[limit]': '30', include: 'mostRelevantPost,firstPost' });
          const response = await this.fetchImpl(ORIGIN + '/api/discussions?' + params, { signal: controller.signal, redirect: 'error',
            headers: { Accept: 'application/json', 'User-Agent': 'MistyRainVideo/1.0', Referer: ORIGIN + '/' } });
          if (!response.ok) throw fail('公开资源论坛返回 HTTP ' + response.status, 'RESOURCE_SEARCH_HTTP_ERROR');
          let payload;
          try { payload = JSON.parse(await readWebResponseText(response, { maxBytes: 2 * 1024 * 1024, idleTimeoutMs: this.timeoutMs })); }
          catch { throw fail('公开资源论坛未返回有效数据'); }
          const items = parseForumResources(payload, keyword, category);
          return { total: items.length, merged_by_type: { quark: items } };
        })()
      ]);
    } catch (error) {
      if (String(error.code || '').startsWith('RESOURCE_SEARCH_')) throw error;
      throw fail('公开资源论坛暂时无法访问', 'RESOURCE_SEARCH_NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }
}
