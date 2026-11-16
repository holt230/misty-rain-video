import { readWebResponseText } from './http.js';
import { parseChannelResults } from './channelResourceSearch.js';
import { isExactWorkTitle } from './searchTitles.js';

const ORIGIN = 'https://tg.i-c-a.su';
const CHANNEL = 'guoman4K';
const failure = (message, code = 'RESOURCE_SEARCH_INVALID_RESPONSE') => Object.assign(new Error(message), { code, statusCode: 503 });

/** Public web text only. Media, user records and sponsored messages are not used. */
export function parsePublicFeed(payload) {
  const chat = Array.isArray(payload?.chats) ? payload.chats.filter(item => item.username?.toLowerCase() === CHANNEL.toLowerCase()) : [];
  if (!['messages.channelMessages', 'messages.messages'].includes(payload?._) || !Array.isArray(payload.messages) || chat.length !== 1 || !Number.isSafeInteger(chat[0].id)) throw failure('公开网页索引响应异常');
  const rows = [];
  for (const message of payload.messages.slice(0, 50)) {
    if (message._ !== 'message' || message.peer_id !== chat[0].id || typeof message.message !== 'string'
      || message.message.length > 30_000 || !Number.isInteger(message.id) || message.id <= 0
      || !Number.isInteger(message.date) || message.date <= 0) continue;
    const date = new Date(message.date * 1000);
    if (!Number.isFinite(date.getTime())) continue;
    // This endpoint serializes HTML attributes with one extra escaped slash/quote.
    const body = message.message.replace(/\\(?=[/"'])/g, '');
    const html = `<main class="tgme_channel_history"><div class="tgme_widget_message" data-post="${CHANNEL}/${message.id}"><div class="tgme_widget_message_text">${body}</div><time datetime="${date.toISOString()}"></time></div></main>`;
    for (const row of parseChannelResults(html, CHANNEL, 'anime')) rows.push({ ...row, source: 'public_guoman4K',
      source_url: `${ORIGIN}/json/${CHANNEL}?id=${message.id}&limit=1` });
  }
  const unique = new Map();
  for (const row of rows.sort((a, b) => b.latest_episode - a.latest_episode || b.datetime.localeCompare(a.datetime) || a.url.localeCompare(b.url))) {
    if (!unique.has(row.url)) unique.set(row.url, row);
  }
  return [...unique.values()];
}

export class PublicFeedResourceSearch {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) { this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; }
  async search(keyword, { category = 'all', signal } = {}) {
    if (!['anime', 'all'].includes(category)) return { total: 0, merged_by_type: { quark: [] }, skipped: true };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    try {
      return await Promise.race([
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('公开网页索引读取超时', 'RESOURCE_SEARCH_TIMEOUT')); }, this.timeoutMs); }),
        (async () => {
          const response = await this.fetchImpl(`${ORIGIN}/json/${CHANNEL}?limit=50`, { signal: controller.signal, redirect: 'error',
            headers: { Accept: 'application/json', 'User-Agent': 'MistyRainVideo/1.0' } });
          if (!response.ok) throw failure(`公开网页索引返回 HTTP ${response.status}`, 'RESOURCE_SEARCH_HTTP_ERROR');
          let payload;
          try { payload = JSON.parse(await readWebResponseText(response, { maxBytes: 2 * 1024 * 1024, idleTimeoutMs: this.timeoutMs })); }
          catch (error) { if (controller.signal.aborted) throw error; throw failure('公开网页索引返回无效数据'); }
          const rows = parsePublicFeed(payload).filter(row => {
            const title = row.note.replace(/^(?:【(?:国漫|日漫|动漫|动画|完结|复播|停更|已停更)】\s*)+/, '')
              .split(/[（(](?:19|20)\d{2}[)）]/)[0].replace(/\s*(?:更新|更至|更|全|第)\s*(?:至|第)?\s*\d[\s\S]*$/, '').trim();
            return isExactWorkTitle(keyword, title);
          });
          return { total: rows.length, merged_by_type: { quark: rows } };
        })()
      ]);
    } catch (error) {
      if (String(error.code || '').startsWith('RESOURCE_SEARCH_')) throw error;
      throw failure('服务器无法连接公开网页索引', 'RESOURCE_SEARCH_NETWORK_ERROR');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
}
