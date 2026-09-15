import crypto from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const platforms = { qq: '腾讯视频', qiyi: '爱奇艺', youku: '优酷' };
export const segmentSeconds = { qq: 30, qiyi: 300, youku: 60 };
const fail = message => Object.assign(new Error(message), { code: 'DANMAKU_UNAVAILABLE', statusCode: 502 });
const md5 = value => crypto.createHash('md5').update(value).digest('hex');
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];

// Fixed upstreams only. User input is never fetched as a URL; redirects are rejected.
export async function upstream(url, options = {}) {
  const allowed = new Set(['api.so.360kan.com', 'api.web.360kan.com', 'dm.video.qq.com', 'cmts.iqiyi.com', 'pcw-api.iq.com', 'acs.youku.com', 'log.mmstat.com']);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowed.has(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw fail('弹幕数据地址无效');
  const response = await fetch(parsed, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(8_000),
    headers: { 'User-Agent': 'Mozilla/5.0', ...options.headers }
  });
  if (!response.ok) { await response.body?.cancel(); throw fail('弹幕平台暂时无法连接'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw fail('弹幕数据过大，请稍后再试');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  return { bytes, headers: response.headers, json: () => JSON.parse(bytes.toString('utf8')) };
}

export function parseVideoUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password) return null;
    let platform, id;
    if (url.hostname === 'v.qq.com') { platform = 'qq'; id = url.pathname.match(/\/([a-zA-Z0-9]{11})\.html$/)?.[1]; }
    if (['www.iqiyi.com', 'iqiyi.com'].includes(url.hostname)) { platform = 'qiyi'; id = url.pathname.match(/^\/v_([a-zA-Z0-9]+)\.html$/)?.[1]; }
    if (url.hostname === 'v.youku.com') {
      platform = 'youku';
      id = url.pathname.match(/^\/v_show\/id_(X[a-zA-Z0-9=]+)\.html$/)?.[1];
      // Current catalogue links put the episode ID in a query parameter.
      // Canonicalize it before stripping tracking parameters, or a second parse loses the ID.
      if (url.pathname === '/video' && url.searchParams.getAll('vid').length === 1) id = url.searchParams.get('vid');
      if (!/^X[a-zA-Z0-9=]{4,79}$/.test(id || '')) return null;
      return { platform, id, url: `https://v.youku.com/v_show/id_${id}.html` };
    }
    return id && id.length < 80 ? { platform, id, url: `https://${url.hostname}${url.pathname}` } : null;
  } catch { return null; }
}
export function validateSource(source) {
  if (!source || !Object.hasOwn(platforms, source.platform)) throw fail('请选择有效的弹幕来源');
  const pattern = source.platform === 'qq' ? /^[a-zA-Z0-9]{11}$/ : source.platform === 'qiyi' ? /^\d{4,20}$/ : /^X[a-zA-Z0-9=]{4,79}$/;
  if (!pattern.test(source.id)) throw fail('弹幕剧集编号无效');
  return source;
}

const clean = (items, start, end) => {
  const seen = new Set();
  return items.filter(item => {
    if (!Number.isFinite(item.time) || item.time < start || item.time >= end || !item.text?.trim()) return false;
    item.text = String(item.text).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160);
    const key = `${item.time}:${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.time - b.time).slice(0, 8000);
};
const color = value => /^#?[a-f\d]{6}$/i.test(String(value)) ? `#${String(value).replace('#', '')}` : '#ffffff';
export function parseTencent(data, start, end) {
  if (!Array.isArray(data?.barrage_list)) throw fail('腾讯弹幕格式已变化');
  return clean(data.barrage_list.map(item => {
    let style = item.content_style || {};
    if (typeof style === 'string') { try { style = JSON.parse(style); } catch { style = {}; } }
    return { time: Number(item.time_offset) / 1000, text: item.content, color: color(style.color), mode: style.position === 1 ? 'top' : 'rtl' };
  }), start, end);
}
export function parseIqiyi(bytes, start, end) {
  const xml = inflateSync(bytes, { maxOutputLength: 12 * 1024 * 1024 }).toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw fail('爱奇艺弹幕格式暂不支持');
  const data = new XMLParser({ parseTagValue: false, processEntities: true }).parse(xml);
  if (!data?.danmu) throw fail('爱奇艺弹幕格式已变化');
  const bullets = array(data.danmu.data?.entry).flatMap(entry => array(entry.list?.bulletInfo));
  return clean(bullets.map(item => ({ time: Number(item.showTime), text: item.content, color: color(item.color), mode: Number(item.position) === 0 ? 'rtl' : 'top' })), start, end);
}
export function parseYouku(data, start, end) {
  if (!data?.ret?.some(value => value.startsWith('SUCCESS'))) throw fail('优酷弹幕暂不可用，请稍后刷新');
  const result = typeof data.data?.result === 'string' ? JSON.parse(data.data.result) : data.data?.result;
  if (!Array.isArray(result?.data?.result) || String(result.code) === '-1') throw fail('优酷弹幕格式已变化');
  return clean(result.data.result.map(item => {
    let style = {}; try { style = JSON.parse(item.propertis || '{}'); } catch { /* optional style */ }
    return { time: Number(item.playat) / 1000, text: item.content, color: color(style.color), mode: style.pos === 1 ? 'top' : style.pos === 2 ? 'bottom' : 'rtl' };
  }), start, end);
}

export class DanmakuProviders {
  constructor(request = upstream) { this.request = request; this.guest = null; this.guestTask = null; }
  async resolveUrl(url) {
    const source = parseVideoUrl(url);
    if (!source) throw fail('请粘贴腾讯、爱奇艺或优酷的具体剧集链接');
    if (source.platform === 'qiyi') {
      const result = await this.request(`https://pcw-api.iq.com/api/decode/${source.id}?platformId=3&modeCode=intl&langCode=sg`);
      // Preserve TVIDs as strings even when they exceed JavaScript's safe integer range.
      source.id = result.bytes.toString('utf8').match(/\"data\"\s*:\s*\"?(\d+)/)?.[1] || '';
    }
    return validateSource(source);
  }
  async getGuest() {
    if (this.guest && this.guest.expires > Date.now()) return this.guest;
    if (this.guestTask) return this.guestTask;
    this.guestTask = (async () => {
      const [identity, token] = await Promise.all([
        this.request('https://log.mmstat.com/eg.js'),
        this.request('https://acs.youku.com/h5/mtop.com.youku.aplatform.weakget/1.0/?jsv=2.5.1&appKey=24679788')
      ]);
      const cookies = token.headers.getSetCookie().join(';');
      const tk = cookies.match(/(?:^|[;,]\s*)_m_h5_tk=([^;]+)/)?.[1];
      const enc = cookies.match(/(?:^|[;,]\s*)_m_h5_tk_enc=([^;]+)/)?.[1];
      const guid = identity.headers.get('etag')?.replaceAll('"', '');
      if (!tk || !enc || !guid) throw fail('优酷临时认证不可用，请稍后再试');
      this.guest = { tk, enc, guid, expires: Date.now() + 5 * 60_000 };
      return this.guest;
    })().finally(() => { this.guestTask = null; });
    return this.guestTask;
  }
  async segment(source, index) {
    validateSource(source);
    const start = index * segmentSeconds[source.platform], end = start + segmentSeconds[source.platform];
    if (source.platform === 'qq') {
      const result = await this.request(`https://dm.video.qq.com/barrage/segment/${source.id}/t/v1/${start * 1000}/${end * 1000}`);
      return parseTencent(result.json(), start, end);
    }
    if (source.platform === 'qiyi') {
      const id = source.id;
      const result = await this.request(`https://cmts.iqiyi.com/bullet/${id.slice(-4, -2)}/${id.slice(-2)}/${id}_300_${index + 1}.z`);
      return parseIqiyi(result.bytes, start, end);
    }
    // Only guest tokens, held in memory. Never read or log a user's login cookies.
    for (let attempt = 0; attempt < 2; attempt++) {
      const guest = await this.getGuest();
      const t = String(Date.now());
      const msg = { ctime: Number(t), ctype: 10004, cver: 'v1.0', guid: guest.guid, mat: index, mcount: 1, pid: 0, sver: '3.1.0', type: 1, vid: source.id };
      msg.msg = Buffer.from(JSON.stringify(msg)).toString('base64');
      msg.sign = md5(`${msg.msg}MkmC9SoIw6xCkSKHhJ7b5D2r51kBiREr`);
      const data = JSON.stringify(msg);
      const params = new URLSearchParams({ jsv: '2.5.6', appKey: '24679788', t, sign: md5(`${guest.tk.split('_')[0]}&${t}&24679788&${data}`), api: 'mopen.youku.danmu.list', v: '1.0', type: 'originaljson', dataType: 'jsonp' });
      const result = (await this.request(`https://acs.youku.com/h5/mopen.youku.danmu.list/1.0/?${params}`, {
        method: 'POST', headers: { Cookie: `_m_h5_tk=${guest.tk};_m_h5_tk_enc=${guest.enc};`, Referer: 'https://v.youku.com', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data }).toString()
      })).json();
      if (attempt === 0 && result?.ret?.some(value => /TOKEN_EXPIRED|TOKEN_EMPTY/.test(value))) { this.guest = null; continue; }
      return parseYouku(result, start, end);
    }
    throw fail('优酷认证已过期，请稍后刷新');
  }
}
