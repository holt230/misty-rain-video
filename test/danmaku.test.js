import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { DanmakuProviders, parseVideoUrl, parseTencent, parseIqiyi, parseYouku, validateSource, upstream } from '../server/danmaku/providers.js';
import { DanmakuCatalog, automaticWork, missingEpisode } from '../server/danmaku/catalog.js';
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
test('Youku query links and legacy links resolve to the same episode and survive reparsing', async () => {
  const id = 'XNjU0MjIxOTc4NA==';
  const canonical = `https://v.youku.com/v_show/id_${id}.html`;
  const provider = new DanmakuProviders(() => { throw Error('URL resolution must not fetch the page'); });
  for (const url of [canonical, `${canonical}?refer=360`, `https://v.youku.com/video?vid=${id}&refer=360`, `https://v.youku.com/video?refer=360&vid=${encodeURIComponent(id)}`]) {
    const parsed = parseVideoUrl(url);
    assert.deepEqual(parsed, { platform: 'youku', id, url: canonical });
    assert.deepEqual(parseVideoUrl(parsed.url), parsed);
    assert.deepEqual(await provider.resolveUrl(url), parsed);
  }
  for (const url of [
    'https://v.youku.com/video', 'https://v.youku.com/video?vid=',
    'https://v.youku.com/video?vid=Xabc%2F..%2Fsecret',
    `https://v.youku.com/video?vid=${id}&vid=Xanother`,
    `https://v.youku.com.evil.com/video?vid=${id}`, `https://evil.com/video?vid=${id}`,
    `https://v.youku.com/other?vid=${id}`
  ]) assert.equal(parseVideoUrl(url), null, url);
});
test('2026 九门 catalogue query links match real episode numbers and do not select the 2021 movie', async t => {
  const ids = { 1: 'XNjU0MjIxOTc4NA==', 4: 'XNjU0MjcxMDkxNg==', 30: 'XNjU0NTU2MzkzNg==' };
  const link = id => `https://v.youku.com/video?vid=${id}&refer=360`;
  const workId = '2:RLFtbH7nTG4pN3';
  const catalog = new DanmakuCatalog(async url => {
    if (url.includes('/index?')) return response({ code: 0, data: { longData: { rows: [
      { titleTxt: '九门', year: '2026', cat_id: '2', en_id: 'RLFtbH7nTG4pN3', playlinks: { youku: link(ids[30]) } },
      { titleTxt: '九门', year: '2021', cat_id: '1', en_id: 'hKbmZxH6RHPATB', playlinks: { youku: link('XNTE1ODA4MTc2MA==') } }
    ] } } });
    return response({ data: { id: '239147', title: '九门', pubdate: '2026', allepidetail: { youku:
      Object.entries(ids).map(([number, id]) => ({ playlink_num: number, url: link(id), is_vip: number === '1' ? '0' : '1' }))
    } } });
  });
  const service = new DanmakuService(directory(t), { catalog });
  for (const [number, id] of Object.entries(ids)) {
    const result = await service.match('alice', { ...input, title: '九门', episodeNumber: Number(number) });
    assert.equal(result.status, 'matched');
    assert.equal(result.selected.workId, workId);
    assert.equal(result.selected.id, id);
    assert.equal(result.selected.platform, 'youku');
  }
  await assert.rejects(catalog.episode(workId, 'youku', 2), /没有对应集数/);
  const manual = await service.select('bob', { ...input, title: '九门', episodeNumber: 4, workId });
  assert.equal(manual.id, ids[4]);
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

test('an exact work reports upstream failure separately from missing episodes and ambiguous titles', async t => {
  let mode = 'offline';
  const service = new DanmakuService(directory(t), {
    catalog: {
      search: async () => mode === 'empty' ? [] : mode === 'ambiguous' ? [work, { ...work, id: '2:OtherId' }] : [work],
      episode: async (id, platform) => {
        if (mode === 'offline' && platform === 'qq') throw Error('private upstream timeout');
        throw missingEpisode();
      }
    }
  });
  const unavailable = error => error.code === 'DANMAKU_SOURCE_UNAVAILABLE' && error.statusCode === 502
    && !error.message.includes('private') && error.cause.message.includes('timeout');
  await assert.rejects(service.match('alice', input), unavailable);
  await assert.rejects(service.select('alice', { ...input, workId: work.id }), unavailable);
  mode = 'missing';
  await assert.rejects(service.match('alice', input), { code: 'DANMAKU_EPISODE_NOT_FOUND' });
  await assert.rejects(service.select('alice', { ...input, workId: work.id }), { code: 'DANMAKU_EPISODE_NOT_FOUND' });
  mode = 'empty'; assert.equal((await service.match('alice', input)).status, 'missing');
  mode = 'ambiguous'; assert.equal((await service.match('alice', input)).status, 'choose');
  assert.equal(fs.existsSync(service.mappingPath('alice', input.mediaKey)), false);
});

test('a remembered work falls back across platforms without searching the original title or losing episode overrides', async t => {
  let mode = 'ready'; const attempts = [];
  const service = new DanmakuService(directory(t), {
    catalog: {
      search: async () => { throw Error('The confirmed work must not be searched again'); },
      episode: async (id, platform, number) => {
        attempts.push({ id, platform, number });
        if (mode === 'offline') throw Error('offline');
        if (mode === 'missing' || (number === 3 && platform !== 'qiyi')) throw missingEpisode();
        return { title: work.title, year: work.year, episode: { url: platform, title: `第${number}集` } };
      }
    },
    providers: { resolveUrl: async url => ({ ...source, platform: url === 'qiyi' ? 'qiyi' : 'qq' }) }
  });
  await service.select('alice', { ...input, workId: work.id, platform: 'qq' });
  await service.select('alice', { ...input, url: 'https://v.qq.com/x/j4100jwv4qo.html' });
  attempts.length = 0;
  const next = { ...input, title: '片库里的别名', episodeNumber: 3, episodeTitle: '第3集' };
  const result = await service.match('alice', next);
  assert.equal(result.selected.workId, work.id); assert.equal(result.selected.platform, 'qiyi');
  assert.deepEqual(attempts.map(item => item.platform), ['qq', 'qiyi']);
  assert.ok(attempts.every(item => item.id === work.id && item.number === 3));
  const file = service.mappingPath('alice', input.mediaKey);
  const saved = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(saved).platform, 'qiyi');
  assert.equal((await service.match('alice', input)).selected.workId, ''); // Manual episode override survives.
  for (const [value, code] of [['offline', 'DANMAKU_SOURCE_UNAVAILABLE'], ['missing', 'DANMAKU_EPISODE_NOT_FOUND']]) {
    mode = value; attempts.length = 0;
    await assert.rejects(service.match('alice', next), { code });
    assert.equal(attempts[0].platform, 'qiyi');
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
  }
});

test('manual segment retry bypasses automatic cooldown and coalesces simultaneous retries', async t => {
  let time = 1000000, calls = 0, fail = true;
  const service = new DanmakuService(directory(t), { now: () => time, providers: { async segment() {
    calls++; await new Promise(resolve => setImmediate(resolve));
    if (fail) throw Error('offline'); return [comment];
  } } });
  await assert.rejects(service.segment(source, 0));
  time += 100;
  await assert.rejects(service.segment(source, 0)); assert.equal(calls, 1);
  await assert.rejects(service.segment(source, 0, true)); assert.equal(calls, 2);
  fail = false; time += 100;
  const [a, b] = await Promise.all([service.segment(source, 0, true), service.segment(source, 0, true)]);
  assert.equal(calls, 3); assert.deepEqual(a, b); assert.equal(a.stale, false);
  await service.segment(source, 0); assert.equal(calls, 3);
  assert.equal(service.cooldowns.size, 0);
  // Even a recently fetched cache must not swallow an explicit refresh.
  await service.segment(source, 0, true); assert.equal(calls, 4);
});

test('a failed refresh retains cached comments and an immediate manual retry replaces them', async t => {
  let calls = 0, fail = false;
  const service = new DanmakuService(directory(t), { providers: { async segment() {
    calls++; if (fail) throw Error('offline'); return [{ ...comment, text: String(calls) }];
  } } });
  const original = await service.segment(source, 0);
  fail = true;
  const stale = await service.segment(source, 0, true);
  assert.equal(stale.stale, true); assert.deepEqual(stale.comments, original.comments);
  fail = false;
  const fresh = await service.segment(source, 0, true);
  assert.equal(fresh.stale, false); assert.equal(fresh.comments[0].text, '3');
});
