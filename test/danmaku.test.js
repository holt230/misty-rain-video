import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { DanmakuProviders, parseVideoUrl, parseTencent, parseIqiyi, parseYouku, validateSource, upstream } from '../server/danmaku/providers.js';
import { DanmakuCatalog, automaticWork } from '../server/danmaku/catalog.js';
import { DanmakuService } from '../server/danmaku/service.js';
import { handleApiRequest } from '../server/api.js';

const input = { mediaKey: 'film-1', title: '庆余年第二季', category: 'tv', episodeNumber: 2, episodeTitle: '第2集' };
const source = { platform: 'qq', id: 'j4100jwv4qo', segmentSeconds: 30 };
const work = { id: '2:ABCdef', title: '庆余年第二季', year: '2024', category: '2', platforms: ['qq'] };
const comment = { time: 1, text: '测试', color: '#ffffff', mode: 'rtl' };
const response = object => ({ bytes: Buffer.from(JSON.stringify(object)), json: () => object });
function directory(t) {
  fs.mkdirSync('.local-runtime/tests', { recursive: true });
  const dir = fs.mkdtempSync('.local-runtime/tests/danmaku-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}

test('only accepts specific episode URLs; URL parsing cannot become an arbitrary proxy', async () => {
  assert.equal(parseVideoUrl('https://v.qq.com/x/cover/abc/j4100jwv4qo.html?trace=1').id, source.id);
  for (const url of ['http://127.0.0.1/private', 'https://v.qq.com.evil.com/x/j4100jwv4qo.html', 'https://user:secret@v.qq.com/x/j4100jwv4qo.html', 'https://v.youku.com:444/v_show/id_Xabc.html', 'file:///etc/passwd']) assert.equal(parseVideoUrl(url), null);
  assert.throws(() => validateSource({ platform: '__proto__', id: 'foo' }));
  assert.throws(() => validateSource({ platform: 'qq', id: '../../foo' }));
  await assert.rejects(upstream('https://localhost/'), /地址无效/);
});
test('Tencent retains text as plain text, normalizes milliseconds, removes duplicates and out-of-range data', () => {
  const rows = [0, 0, 1000, 30000].map(time => ({ time_offset: time, content: '<img onerror=alert(1)>', content_style: '{"color":"ff0000"}' }));
  const parsed = parseTencent({ barrage_list: rows }, 0, 30);
  assert.deepEqual(parsed.map(item => item.time), [0, 1]); assert.equal(parsed[0].text, rows[0].content); assert.equal(parsed[0].color, '#ff0000');
  assert.throws(() => parseTencent({ error: 'rate limit' }, 0, 30));
});
test('iQiyi parses escaped XML and rejects unsupported/malformed formats instead of reporting empty success', () => {
  const xml = '<danmu><data><entry><list><bulletInfo><showTime>301</showTime><content>A &amp; B</content><position>0</position><color>00ff00</color></bulletInfo></list></entry></data></danmu>';
  assert.equal(parseIqiyi(deflateSync(xml), 300, 600)[0].text, 'A & B');
  assert.throws(() => parseIqiyi(deflateSync('<html>error</html>'), 0, 300));
  assert.throws(() => parseIqiyi(deflateSync('<!DOCTYPE danmu><danmu/>'), 0, 300));
});
test('Youku distinguishes platform rejection from an empty segment', () => {
  assert.throws(() => parseYouku({ ret: ['FAIL_SYS_USER_VALIDATE'] }, 0, 60));
  assert.deepEqual(parseYouku({ ret: ['SUCCESS::调用成功'], data: { result: JSON.stringify({ code: 1, data: { result: [] } }) } }, 0, 60), []);
});
test('Youku obtains guest cookies once and refreshes a rejected token at most once', async () => {
  let tokens = 0, lists = 0;
  const provider = new DanmakuProviders(async url => {
    if (url.includes('mmstat')) return { headers: new Headers({ etag: 'guest' }) };
    if (url.includes('weakget')) {
      tokens++;
      const headers = new Headers(); headers.append('set-cookie', '_m_h5_tk=guesttoken_9999; Path=/'); headers.append('set-cookie', '_m_h5_tk_enc=temporary; Path=/');
      return { headers };
    }
    lists++;
    return response(lists === 1 ? { ret: ['FAIL_SYS_TOKEN_EXPIRED'] } : { ret: ['SUCCESS::调用成功'], data: { result: JSON.stringify({ code: 1, data: { result: [] } }) } });
  });
  assert.deepEqual(await provider.segment({ platform: 'youku', id: 'XNjQ3ODMyNjU3Mg==' }, 0), []);
  assert.equal(tokens, 2); assert.equal(lists, 2);
});
test('iQiyi video IDs are not rounded by JSON number decoding', async () => {
  const provider = new DanmakuProviders(async () => ({ bytes: Buffer.from('{"code":"0","data":9999999999999999}') }));
  assert.equal((await provider.resolveUrl('https://www.iqiyi.com/v_abc123.html')).id, '9999999999999999');
});
test('automatic matching requires the exact season, category and unambiguous year', () => {
  assert.equal(automaticWork(input, [work]).id, work.id);
  assert.equal(automaticWork({ ...input, title: '庆余年S02' }, [work]).id, work.id);
  assert.equal(automaticWork({ ...input, title: '庆余年' }, [work]), null);
  assert.equal(automaticWork({ ...input, title: '庆余年第二季 (2020)' }, [work]), null);
  assert.equal(automaticWork(input, [work, { ...work, year: '2025' }]), null);
  assert.equal(automaticWork({ ...input, category: 'movie' }, [work]), null);
});
test('catalogue never renumbers a sparse episode list', async () => {
  const catalog = new DanmakuCatalog(async () => response({ data: { title: work.title, allepidetail: { qq: [
    { playlink_num: '1', url: 'https://v.qq.com/x/j4100jwv4qo.html' }, { playlink_num: '3', url: 'https://v.qq.com/x/j4100jwv4qo.html' }
  ] } } }));
  await assert.rejects(catalog.episode(work.id, 'qq', 2), /没有对应集数/);
  assert.equal((await catalog.episode(work.id, 'qq', 3)).episode.number, 3);
});
test('segment requests coalesce, expire after ten minutes and fall back to last successful cache', async t => {
  let calls = 0, time = 1000000, fail = false;
  const service = new DanmakuService(directory(t), { now: () => time, providers: { async segment() { calls++; await new Promise(resolve => setImmediate(resolve)); if (fail) throw Error('upstream secret'); return [comment]; } } });
  const [a, b] = await Promise.all([service.segment(source, 0), service.segment(source, 0)]);
  assert.equal(calls, 1); assert.deepEqual(a, b);
  await service.segment(source, 0); assert.equal(calls, 1);
  time += 600001; fail = true;
  const stale = await service.segment(source, 0); assert.equal(calls, 2); assert.equal(stale.stale, true); assert.equal(stale.fetchedAt, a.fetchedAt);
  await service.segment(source, 0); assert.equal(calls, 2);
  await assert.rejects(service.segment(source, 1), /弹幕暂不可用/);
});
test('refresh replaces cached content and keeps the actual retrieval time', async t => {
  let time = Date.now(), calls = 0;
  const service = new DanmakuService(directory(t), { now: () => time, providers: { async segment() { calls++; return [{ ...comment, text: String(calls) }]; } } });
  await service.segment(source, 0); time += 6000;
  const fresh = await service.segment(source, 0, true);
  assert.equal(fresh.comments[0].text, '2'); assert.equal(fresh.fetchedAt, time);
  await assert.rejects(service.segment(source, -1)); await assert.rejects(service.segment(source, Infinity));
});
test('a manual work is remembered per user while episode URLs remain scoped to the exact episode', async t => {
  const service = new DanmakuService(directory(t), {
    catalog: { search: async () => [], episode: async (id, platform, number) => ({ title: work.title, episode: { url: 'https://v.qq.com/x/j4100jwv4qo.html', title: `第${number}集` } }) },
    providers: { resolveUrl: async () => source }
  });
  await service.select('alice', { ...input, workId: work.id, platform: 'qq' });
  assert.equal((await service.match('alice', { ...input, episodeNumber: 3 })).selected.episodeTitle, '第3集');
  assert.equal((await service.match('bob', input)).selected, null);
  await service.select('bob', { ...input, url: 'https://v.qq.com/x/j4100jwv4qo.html' });
  assert.ok((await service.match('bob', input)).selected);
  assert.equal((await service.match('bob', { ...input, episodeNumber: 3 })).selected, null);
});
test('a work choice automatically uses the first platform that has this episode', async t => {
  const attempts = [];
  const service = new DanmakuService(directory(t), {
    catalog: {
      details: async () => ({ ...work, category: '2', episodes: [{ platform: 'qq' }, { platform: 'qiyi' }] }),
      episode: async (id, platform, number) => {
        attempts.push(platform);
        if (platform === 'qq') throw Error('没有对应集数');
        return { title: work.title, episode: { url: 'https://www.iqiyi.com/v_abc123.html', title: `第${number}集` } };
      }
    },
    providers: { resolveUrl: async () => ({ ...source, platform: 'qiyi' }) }
  });
  const selected = await service.select('alice', { ...input, workId: work.id });
  assert.equal(selected.platform, 'qiyi');
  assert.deepEqual(attempts, ['qq', 'qiyi']);
  assert.equal((await service.match('alice', input)).selected.platform, 'qiyi');
});
test('API authentication and origin checks also protect danmaku endpoints', async () => {
  const res = () => ({ headersSent: false, setHeader() {}, end(body) { this.body = JSON.parse(body); this.headersSent = true; } });
  const rejected = res();
  await handleApiRequest({ url: '/api/danmaku/segment?platform=qq', method: 'GET', headers: {} }, rejected, {
    authService: { authenticate() { throw Object.assign(Error('login required'), { statusCode: 401, code: 'APP_AUTH_REQUIRED' }); } }
  });
  assert.equal(rejected.body.code, 'APP_AUTH_REQUIRED');
  const origin = res();
  await handleApiRequest({ url: '/api/danmaku/select', method: 'POST', headers: {} }, origin, {
    authService: { authenticate: () => ({ folder: 'alice' }), assertSameOrigin() { throw Object.assign(Error('origin denied'), { statusCode: 403 }); } }, userContext: () => ({})
  });
  assert.equal(origin.statusCode, 403);
});
