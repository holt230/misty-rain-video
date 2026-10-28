import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { ResourceSearchService } from '../server/resourceSearch.js';

const payload = (...ids) => ({ code: 0, data: { total: ids.length, merged_by_type: { quark: ids.map(id => ({ url: `https://pan.quark.cn/s/${id}`, note: '测试剧' })) } } });
const reply = (...ids) => Response.json(payload(...ids));
const flush = () => new Promise(resolve => setImmediate(resolve));
const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const create = options => new ResourceSearchService({ urls: ['http://127.0.0.1:8888/api/search'], timeoutMs: 300,
  aggregationMs: 0, followUpDelaysMs: [], completionTimeoutMs: options?.timeoutMs || 300, ...options });

test('快速通道先返回，慢通道继续补缓存；刷新与普通搜索合并为一份任务', async () => {
  const slow = gate();
  const seen = [];
  const service = create({ fetchImpl: async (url, options) => {
    seen.push({ url, signal: options.signal });
    return url.searchParams.get('src') === 'plugin' ? reply('fast') : slow.promise;
  } });
  const first = service.search('《测试剧》');
  const concurrent = service.search('测试剧', { force: true });
  const result = await first;
  assert.equal(result.total, 1);
  assert.equal(result.partial, true);
  assert.equal(result.refreshing, true);
  assert.equal(service.peek('测试剧').refreshing, true);
  assert.deepEqual(await concurrent, result);
  assert.equal(seen.length, 2);
  assert.ok(seen.every(({ url, signal }) => !signal.aborted && url.searchParams.get('cloud_types') === 'quark'));
  slow.resolve(reply('slow'));
  await flush();
  const cached = await service.search('测试剧');
  assert.equal(cached.total, 2);
  assert.equal(cached.partial, false);
  assert.equal(service.peek('测试剧').refreshing, false);
  assert.equal(service.peek('未知剧'), null);
  assert.equal(seen.length, 2);
});

test('空通道不会掩盖另一通道故障，不缓存成“未收录”；全渠道成功空结果才短暂缓存', async t => {
  t.mock.method(console, 'warn', () => {});
  let clock = 1_000_000;
  let fail = true;
  let calls = 0;
  const service = create({ now: () => clock, fetchImpl: async url => {
    calls += 1;
    return fail && url.searchParams.get('src') === 'tg' ? new Response('', { status: 503 }) : reply();
  } });
  await assert.rejects(service.search('测试剧'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  assert.equal(service.cache.size, 0);
  fail = false; clock += 10_000;
  assert.equal((await service.search('测试剧')).total, 0);
  const before = calls;
  await service.search('测试剧');
  assert.equal(calls, before);
  clock += 11_000;
  await service.search('测试剧');
  assert.equal(calls, before + 2);
});

test('生产 tg 的成功空结果省略 merged_by_type 时，不误报异常或触发渠道退避', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const service = create({ fetchImpl: async url => url.searchParams.get('src') === 'tg'
    ? Response.json({ code: 0, message: 'success', data: { total: 0 } })
    : reply('series', 'movie') });
  await service.search('仙逆'); await flush();
  const result = service.peek('仙逆');
  assert.equal(result.total, 2);
  assert.equal(result.partial, false);
  assert.equal(service.endpointHealth.size, 0);
  assert.deepEqual(warnings, []);
});

test('合法零结果与错误、缺字段响应分开，公共源失败不能被空 tg 结果掩盖', async t => {
  t.mock.method(console, 'warn', () => {});
  for (const response of [{ total: 0 }, { total: 0, merged_by_type: null }]) {
    const service = create({ source: 'tg', fetchImpl: async () => Response.json({ code: 0, data: response }) });
    const result = await service.search('未收录');
    assert.equal(result.total, 0);
    assert.equal(result.partial, false);
  }
  for (const response of [{ code: 500, data: { total: 0 } }, { code: 0, data: {} },
    { code: 0, data: { total: 1 } }, { code: 0, data: { total: 0, merged_by_type: [] } }]) {
    const service = create({ source: 'tg', fetchImpl: async () => Response.json(response) });
    await assert.rejects(service.search('仙逆'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  }
  const service = create({ urls: ['http://127.0.0.1:8888/api/search', 'https://public.example/api/search'], source: 'tg',
    fetchImpl: async url => url.hostname === 'public.example' ? new Response('', { status: 400 })
      : Response.json({ code: 0, message: 'success', data: { total: 0 } }) });
  await assert.rejects(service.search('仙逆'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  assert.equal(service.cache.size, 0);
});

test('正文阻塞也受截止时间限制，没有逐级重试；失败渠道冷却时不重新轰炸', async t => {
  t.mock.method(console, 'warn', () => {});
  let clock = 1_000_000;
  let calls = 0;
  const signals = [];
  const service = create({ timeoutMs: 20, now: () => clock, fetchImpl: async (_url, options) => {
    calls += 1;
    signals.push(options.signal);
    return { ok: true, json: () => new Promise(() => {}) };
  } });
  await assert.rejects(service.search('测试剧', { priority: 'background' }), { code: 'RESOURCE_SEARCH_TIMEOUT' });
  assert.equal(calls, 2);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(service.inFlight.size, 0);
  await assert.rejects(service.search('另一部'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  assert.equal(calls, 2);
  clock += 9_000;
  await assert.rejects(service.search('另一部', { priority: 'background' }), { code: 'RESOURCE_SEARCH_TIMEOUT' });
  assert.equal(calls, 4);
});

test('限流尊重 Retry-After；故障隔离到单个通道', async t => {
  t.mock.method(console, 'warn', () => {});
  let clock = 1_000_000;
  const calls = [];
  const service = create({ now: () => clock, fetchImpl: async url => {
    const source = url.searchParams.get('src'); calls.push(source);
    return source === 'plugin' ? new Response('', { status: 429, headers: { 'Retry-After': '60' } }) : reply('tg');
  } });
  assert.equal((await service.search('测试剧')).total, 1);
  await flush();
  clock += 10_000;
  await service.search('另一部');
  assert.deepEqual(calls, ['plugin', 'tg', 'tg']);
});

test('过期缓存立即可读并后台刷新；持久化重启恢复，严格后台换源检索不用过期结果', async t => {
  t.mock.method(console, 'warn', () => {});
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-search-cache-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let clock = 1_000_000;
  const service = create({ dataDir, now: () => clock, fetchImpl: async () => reply('saved') });
  await service.search('测试剧'); await flush();
  clock += 6 * 60_000;
  const pending = gate();
  const restarted = create({ dataDir, now: () => clock, fetchImpl: async () => pending.promise });
  const cached = await restarted.search('测试剧');
  assert.equal(cached.stale, true);
  assert.equal(cached.total, 1);
  const strict = restarted.search('测试剧', { force: true });
  pending.resolve(new Response('', { status: 503 }));
  await assert.rejects(strict, { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  const fallback = await restarted.search('测试剧', { force: true, allowStale: true });
  assert.equal(fallback.stale, true);
  assert.equal(fallback.cachedAt, cached.cachedAt);
});

test('并发有上限且给手动搜索预留容量，任务结束后释放名额', async () => {
  const pending = gate();
  const service = create({ fetchImpl: async () => pending.promise });
  const jobs = [service.search('一'), service.search('二')];
  await assert.rejects(service.search('追更', { priority: 'background' }), { code: 'RESOURCE_SEARCH_BUSY' });
  jobs.push(service.search('三'), service.search('四'));
  await assert.rejects(service.search('五'), { code: 'RESOURCE_SEARCH_BUSY' });
  pending.resolve({ ok: true, json: async () => payload('done') });
  await Promise.all(jobs); await flush();
  assert.equal(service.inFlight.size, 0);
  assert.equal((await service.search('五')).total, 1);
});

test('无效响应不能误报未收录；非夸克链接不返回给客户端', async t => {
  t.mock.method(console, 'warn', () => {});
  const invalid = create({ fetchImpl: async () => Response.json({ error: 'busy' }) });
  await assert.rejects(invalid.search('测试剧'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  const service = create({ source: 'plugin', fetchImpl: async () => Response.json({ merged_by_type: { quark: [
    { url: 'https://example.test/s/abc' }, { url: 'https://pan.quark.cn.evil.test/s/abc' },
    { url: 'https://pan.quark.cn/s/valid', note: '正片' }
  ] } }) });
  assert.equal((await service.search('测试剧')).total, 1);
});

test('公共备用源每个关键词只请求一次，不复制本地的分通道请求或并发配置', async () => {
  const calls = [];
  const service = create({ urls: ['https://search.example/api/search'], fetchImpl: async (url, options) => {
    assert.equal(options.headers['Accept-Encoding'], undefined);
    calls.push(url); return reply('public');
  } });
  assert.equal((await service.search('仙逆')).total, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('src'), 'all');
  assert.equal(calls[0].searchParams.has('conc'), false);
});

test('复现第 228 字符后的重复 JSON，内置请求禁用压缩后正常返回', async () => {
  // Shape and byte-for-byte duplication captured from production; share ID
  // replaced with a synthetic ID of the same length.
  const base = { code: 0, message: 'success', data: { total: 1, merged_by_type: { quark: [{
    url: 'https://pan.quark.cn/s/example12345', password: '', note: '《仙逆剧场版 神临之战》夸克网盘下载链接',
    datetime: '2025-05-30T07:35:36Z', source: 'plugin:quark4k'
  }] } } };
  const raw = JSON.stringify(base);
  assert.equal(raw.length, 228);
  // Upstream bodyLogWriter forwards while buffering; the small-body branch
  // then writes the same bytes again. The legacy response.json() rejects it.
  await assert.rejects(new Response(raw + raw).json(), error => error instanceof SyntaxError && /position 228/.test(error.message));
  let requests = 0;
  const service = create({ fetchImpl: async (_url, options) => {
    requests += 1;
    const identity = options.headers['Accept-Encoding'] === 'identity';
    return new Response(identity ? raw : raw + raw, { headers: { 'Content-Type': 'application/json' } });
  } });
  const result = await service.search('仙逆');
  assert.equal(result.total, 1);
  assert.equal(result.partial, false);
  assert.equal(requests, 2);
});

test('忽略 identity 的异常来源仍报错，不截断、拼凑或缓存损坏 JSON', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const raw = JSON.stringify(payload('xianni'));
  for (const suffix of [raw, '<html>upstream failed</html>', '\u001f\u008bgarbled']) {
    const service = create({ fetchImpl: async () => new Response(raw + suffix) });
    await assert.rejects(service.search('仙逆'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
    assert.equal(service.cache.size, 0);
  }
  assert.ok(warnings.every(([, detail]) => detail.code === 'RESOURCE_SEARCH_INVALID_RESPONSE'));
});

test('第一批只有剧场版时再次读取引擎缓存，正篇迟到后自动补齐且不缩减已显示结果', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const calls = [];
  let plugins = 0;
  const service = create({ completionTimeoutMs: 30_000, followUpDelaysMs: [5_000, 15_000],
    fetchImpl: async url => {
      calls.push(url);
      if (url.searchParams.get('src') === 'tg') return reply();
      plugins += 1;
      return plugins <= 2 ? reply('movie') : plugins === 3 ? reply('series1', 'series2') : reply('series3');
    }
  });
  const first = service.search('仙逆', { force: true });
  const complete = service.search('仙逆', { priority: 'background', force: true });
  await flush(); t.mock.timers.tick(0); await flush();
  assert.equal((await first).total, 1);
  assert.equal(service.peek('仙逆').refreshing, true);
  t.mock.timers.tick(5_000); await flush();
  assert.equal(service.peek('仙逆').total, 3);
  assert.equal(service.peek('仙逆').refreshing, true);
  t.mock.timers.tick(10_000); await flush();
  assert.equal((await complete).total, 4);
  assert.equal(service.peek('仙逆').refreshing, false);
  assert.equal(calls.length, 8);
  assert.ok(calls.every(url => !url.searchParams.has('conc')));
  assert.equal(calls.filter(url => url.searchParams.get('refresh') === 'true').length, 2);
  assert.ok(calls.slice(0, 2).every(url => !url.searchParams.has('refresh')));
  assert.ok(calls.slice(4).every(url => !url.searchParams.has('refresh')));
});

test('8 秒是首屏等待而非取消全部检索，12 秒才返回的来源仍会进入结果', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const slow = gate();
  let signal;
  const service = create({ source: 'plugin', timeoutMs: 8_000, completionTimeoutMs: 30_000,
    fetchImpl: async (_url, options) => { signal = options.signal; return slow.promise; } });
  const first = service.search('仙逆');
  await flush();
  t.mock.timers.tick(8_000); await flush();
  const early = await first;
  assert.equal(early.total, 0);
  assert.equal(early.refreshing, true);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(4_000);
  slow.resolve(reply('series'));
  await flush();
  assert.equal(service.peek('仙逆').total, 1);
  assert.equal(service.peek('仙逆').refreshing, false);
  assert.equal(service.inFlight.size, 0);
});

test('强制刷新重开初始检索，但在途请求和补查不重复刷新引擎', async t => {
  const calls = [];
  const service = create({ fetchImpl: async url => { calls.push(url); return reply('cached'); } });
  await service.search('仙逆'); await flush();
  calls.length = 0;
  await service.search('仙逆', { force: true }); await flush();
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(0, 2).every(url => !url.searchParams.has('refresh')));
  assert.ok(calls.slice(2).every(url => url.searchParams.get('refresh') === 'true'));
});

test('旧版本把单条结果当完整缓存时，升级后立即重新补查而非继续缓存 5 分钟', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-search-legacy-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'resource_search_cache.json'), JSON.stringify([
    ['仙逆', { createdAt: Date.now(), data: payload('movie').data, isEmpty: false, partial: false }]
  ]));
  const calls = [];
  const service = create({ dataDir, fetchImpl: async url => { calls.push(url); return reply('series'); } });
  const early = await service.search('仙逆');
  assert.equal(early.stale, true);
  assert.equal(early.refreshing, true);
  await flush();
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(0, 2).every(url => !url.searchParams.has('refresh')));
  assert.ok(calls.slice(2).every(url => url.searchParams.get('refresh') === 'true'));
  assert.equal(service.peek('仙逆').merged_by_type.quark[0].url, 'https://pan.quark.cn/s/series');
});

test('公共来源的多个同名正篇保留不同链接，不被内置单条剧场版或后续缓存覆盖', async () => {
  const pending = gate();
  const service = create({ urls: ['http://127.0.0.1:8888/api/search', 'https://public.example/api/search'],
    fetchImpl: async url => url.hostname === 'public.example' ? pending.promise : reply('movie') });
  const first = await service.search('仙逆');
  assert.equal(first.total, 1);
  pending.resolve(Response.json({ code: 0, data: { merged_by_type: { quark: [
    { url: 'https://pan.quark.cn/s/series1', note: '仙逆', source: 'plugin:wanou' },
    { url: 'https://pan.quark.cn/s/series2', note: '仙逆', source: 'plugin:erxiaopan' },
    { url: 'https://pan.quark.cn/s/movie', note: '仙逆剧场版 神临之战', source: 'plugin:quark4k' }
  ] } } }));
  await flush();
  const final = service.peek('仙逆');
  assert.equal(final.total, 3);
  assert.equal(final.merged_by_type.quark.filter(item => item.note === '仙逆').length, 2);
  assert.equal((await service.search('仙逆')).total, 3);
});

test('生产四条原始结果保留三条不同的夸克链接，相似域名短链不会冒充正篇', async () => {
  const rows = [
    { note: '2025最新动画.仙逆剧场版.神临之战.4k.国语中字', url: 'https://pan.quark.cn/s/movie1', source: 'plugin:quarktv' },
    { note: '仙逆.年番2‎.2025.1080p.2160p【含2023第一季以及2024年番1】【更新第89集】', url: 'https://pan.quark.cn/s/series1', source: 'plugin:quarktv' },
    { note: '🎞️ 仙逆', url: 'https://pan.qoark.cn/s/xn', source: 'plugin:quarksoo' },
    { note: '《仙逆剧场版 神临之战》夸克网盘下载链接', url: 'https://pan.quark.cn/s/movie2', source: 'plugin:quark4k' }
  ];
  const service = create({ source: 'plugin', fetchImpl: async () => Response.json({ code: 0, data: { merged_by_type: { quark: rows } } }) });
  const result = await service.search('仙逆');
  assert.equal(result.total, 3);
  assert.deepEqual(result.merged_by_type.quark.map(item => item.url), rows.filter(item => item.source !== 'plugin:quarksoo').map(item => item.url));
});

test('重新搜索先取上游已补齐的结果，再刷新；单条快速刷新不能覆盖三条暖缓存', async () => {
  const calls = [];
  const service = create({ source: 'plugin', fetchImpl: async url => {
    calls.push(url.searchParams.get('refresh'));
    return url.searchParams.get('refresh') === 'true' ? reply('movie') : reply('movie', 'series', 'another');
  } });
  const result = await service.search('仙逆', { force: true });
  await flush();
  assert.equal(result.total, 3);
  assert.equal(service.peek('仙逆').total, 3);
  assert.deepEqual(calls, [null, 'true']);
});

const gzipPayload = {
  code: 0,
  data: { merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/example123', note: '测试片源' }] } }
};

test('缓存搜索返回 JSON 后附加 gzip 数据时，请求原始响应避免丢失已有结果', async () => {
  const json = JSON.stringify(gzipPayload);
  const malformed = Buffer.concat([Buffer.from(json), gzipSync(json)]);
  let calls = 0;
  const search = create({
    source: 'plugin',
    urls: ['http://127.0.0.1:8888/api/search'],
    fetchImpl: async (_url, { headers }) => {
      calls += 1;
      // Reproduce the observed PanSou response for clients that negotiate compression.
      return new Response(headers['Accept-Encoding'] === 'identity' ? json : malformed, {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  const result = await search.search('仙逆');
  assert.equal(result.total, 1);
  assert.equal(result.merged_by_type.quark[0].url, 'https://pan.quark.cn/s/example123');
  assert.equal(calls, 1);
});

test('无法避免的非法响应仍按上游故障处理，不截断为成功结果', async () => {
  const search = create({
    source: 'plugin',
    urls: ['http://127.0.0.1:8888/api/search'],
    fetchImpl: async () => new Response(JSON.stringify(gzipPayload) + 'invalid trailing content')
  });
  await assert.rejects(search.search('测试'), error => error.code === 'RESOURCE_SEARCH_UNAVAILABLE');
  assert.equal(search.cache.size, 0);
});

test('expired search metadata is evicted on access and prefetch reserves interactive capacity',async()=>{
 let clock=1000000;const service=create({now:()=>clock,fetchImpl:async()=>reply('valid')});
 await service.search('缓存剧');await flush();assert.ok(service.cache.size);
 clock+=12*60*60*1000+1;assert.equal(service.peek('缓存剧'),null);assert.equal(service.cache.size,0);
 const pending=gate();const limited=create({maxConcurrent:3,fetchImpl:()=>pending.promise.then(()=>reply('ok'))});
 const first=limited.search('后台剧',{priority:'prefetch'});
 await assert.rejects(limited.search('第二部',{priority:'prefetch'}),{code:'RESOURCE_SEARCH_BUSY'});
 const interactive=limited.search('手动剧');pending.resolve(reply('ok'));await Promise.all([first,interactive]);
});

test('expired persisted source candidates are removed from disk when accessed',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'misty-expire-cache-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 let clock=1000000;const service=create({dataDir,now:()=>clock,fetchImpl:async()=>reply('saved')});await service.search('测试剧');await flush();
 clock+=12*60*60*1000+1;service.peek('测试剧');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'resource_search_cache.json'),'utf8')),[]);
});
