import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Transform only the service and its small dependencies in memory.
const compiled = await build({ entryPoints: ['src/services/silentSearchEngine.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node', define: { 'import.meta.env.BASE_URL': '"/misty-rain/"' }, logLevel: 'silent' });
const { SilentSearchEngine } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const transferCompiled = await build({ entryPoints: ['src/composables/useQuarkTransfer.ts'], bundle: true, write: false,
  format: 'esm', platform: 'browser', define: { 'import.meta.env.BASE_URL': '"/misty-rain/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
const { useQuarkTransfer } = await import(`data:text/javascript;base64,${Buffer.from(transferCompiled.outputFiles[0].text).toString('base64')}`);
const data = (extra = {}, note = '测试剧 4K') => ({ total: 1, merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/abc', note }] }, ...extra });

const mockFetch = (t, handler) => t.mock.method(globalThis, 'fetch', async (url, init) => {
  if (String(url).includes('/resource-search/validate')) {
    const items = JSON.parse(init.body).items;
    return Response.json({ code: 0, data: { entries: items.map(row => ({ ...row, password: row.password || '', status: 'available' })), pending: false } });
  }
  return handler(url, init);
});
const flush = () => new Promise(resolve => setImmediate(resolve));

test('首批、缓存补齐和公共补充允许片名前缀模糊匹配，但排除嵌在无关短片名中的字符', async t => {
  const titles = [
    '剑仙归来：谁让这剑仙逆世重修的？ 第七季（89集）',
    '剑仙归来：谁让这剑仙逆世重修的？ 第六季（200集）',
    '修仙逆袭记（79集）',
    '仙逆世界（2026）',
    '剑\u200b仙逆\u200b世',
    '仙逆 更新162集',
    '仙逆年番3 更新至162集',
    '《仙逆剧场版 神临之战》夸克网盘下载链接',
    '2025最新动画.仙逆剧场版.神临之战.4k.国语中字',
    '【国漫】仙\u200b逆 (2024) 更新162集',
    '仙 逆 第三季 全162集'
  ];
  const rows = titles.map((note, index) => ({ note, url: `https://pan.quark.cn/s/item${index}` }));
  mockFetch(t, async () => Response.json({ code: 0, data: { total: rows.length, merged_by_type: { quark: rows } } }));
  const service = new SilentSearchEngine();
  for (const result of [await service.search('《仙逆》'), await service.readCached('仙逆'), await service.supplement('仙逆')]) {
    assert.equal(result.total, 7);
    assert.deepEqual(result.items.map(item => item.title), [titles[3], ...titles.slice(5)]);
    assert.deepEqual(result.quarkItems, result.items);
  }
});

test('首次查询只读取本站，公共源补充由页面单独发起', async t => {
  const calls = [];
  let mode = 'failed';
  mockFetch(t, async url => {
    calls.push(String(url));
    return mode === 'failed' ? Response.json({ code: 'RESOURCE_SEARCH_TIMEOUT', message: '检索来源响应超时，请稍后重试' }, { status: 503 })
      : Response.json({ code: 0, data: { total: 0, merged_by_type: { quark: [] } } });
  });
  const failed = await new SilentSearchEngine().search('测试剧');
  assert.equal(failed.success, false);
  assert.match(failed.message, /超时/);
  mode = 'empty';
  const empty = await new SilentSearchEngine().search('测试剧');
  assert.equal(empty.success, true);
  assert.equal(empty.total, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.startsWith('/misty-rain/api/resource-search?')));
});

test('节流等待期间重复点击和刷新复用请求，所有调用收到一致错误结果', async t => {
  let calls = 0;
  mockFetch(t, async () => { calls += 1; return Response.json({ code: 'UNAVAILABLE', message: '检索来源暂时不可用' }, { status: 503 }); });
  const service = new SilentSearchEngine();
  await service.search('先前剧');
  const [first, second] = await Promise.all([service.search('测试剧'), service.search('测试剧', { force: true })]);
  assert.equal(calls, 2);
  assert.equal(first.success, false);
  assert.deepEqual(first, second);
});

test('缓存/补充状态传给页面，补充查询只读取服务端缓存并解除旧的客户端结果缓存', async t => {
  const calls = [];
  let complete = false;
  mockFetch(t, async url => {
    calls.push(String(url));
    return Response.json({ code: 0, data: data(complete ? { partial: false, refreshing: false }
      : { stale: true, partial: true, refreshing: true, message: '正在补充' }) });
  });
  const service = new SilentSearchEngine();
  const first = await service.search('测试剧');
  assert.equal(first.refreshing, true);
  assert.equal(first.stale, true);
  assert.equal(first.message, '正在补充');
  complete = true;
  const latest = await service.readCached('测试剧');
  assert.equal(latest.refreshing, false);
  assert.match(calls[1], /cached=1/);
  await service.search('测试剧');
  assert.equal(calls.length, 3);
});

test('登录失效直接返回，不绕过本站认证发起公共检索', async t => {
  let calls = 0;
  mockFetch(t, async () => { calls += 1; return Response.json({ code: 'APP_AUTH_REQUIRED', message: '请先登录' }, { status: 401 }); });
  const result = await new SilentSearchEngine().search('测试剧');
  assert.equal(result.success, false);
  assert.equal(result.message, '请先登录');
  assert.equal(result.allowPublicFallback, false);
  assert.equal(calls, 1);
});

test('首批结果立即可用，慢通道候选自动补齐；关闭面板后不再轮询', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  const calls = [];
  mockFetch(t, async url => {
    calls.push(String(url));
    const cached = String(url).includes('cached=1');
    const keyword = new URL(String(url), 'https://local.invalid').searchParams.get('kw');
    const result = data({ partial: !cached, refreshing: !cached, message: cached ? '' : '正在补充' }, `${keyword} 4K`);
    if (cached) result.merged_by_type.quark.push({ url: 'https://pan.quark.cn/s/second', note: `${keyword} 补充来源` });
    return Response.json({ code: 0, data: result });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ title: '仙逆渐进测试', category: 'anime' });
  await flush();
  assert.equal(view.isAnalyzing.value, false);
  assert.equal(view.quarkResources.value.length, 1);
  assert.equal(calls.filter(url => url.startsWith('/')).length, 1);
  t.mock.timers.tick(1_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.quarkResources.value.length, 2);
  assert.equal(calls.filter(url => url.startsWith('/')).length, 2);
  assert.equal(view.searchNotice.value, '');
  await view.openTransferModal({ title: '仙逆关闭测试', category: 'anime' });
  view.closeTransferModal();
  t.mock.timers.tick(10_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(url => url.startsWith('/')).length, 3);
});

test('公共补充合并重复请求，不发送站内 Cookie、Referer 或认证头，失败后退避', async t => {
  let count = 0;
  let fail = false;
  mockFetch(t, async (url, options) => {
    count += 1;
    assert.equal(new URL(url).host, 'so.252035.xyz');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    return fail ? new Response('', { status: 429 }) : Response.json({ code: 0, data: data() });
  });
  const service = new SilentSearchEngine();
  const [a, b] = await Promise.all([service.supplement('测试剧'), service.supplement('测试剧')]);
  assert.equal(count, 1);
  assert.equal(a.items.length, 1);
  assert.deepEqual(a, b);
  await service.supplement('测试剧');
  assert.equal(count, 1);
  fail = true;
  assert.equal((await service.supplement('测试剧', { force: true })).success, false);
  assert.equal((await service.supplement('另一个关键词')).success, false);
  assert.equal(count, 2);
});

test('生产只返回部分候选时立即显示，同时合并浏览器补充；后续服务器缓存不能覆盖补充结果', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 2_000_000 });
  let resolvePublic;
  const pending = new Promise(resolve => { resolvePublic = resolve; });
  mockFetch(t, async url => {
    if (String(url).startsWith('https:')) return pending;
    const cached = String(url).includes('cached=1');
    return Response.json({ code: 0, data: data({ partial: true, refreshing: !cached }, '恢复浏览器补充测试 4K') });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ title: '恢复浏览器补充测试', category: 'anime' });
  await flush();
  assert.equal(view.isAnalyzing.value, false);
  assert.equal(view.quarkResources.value.length, 1);
  resolvePublic(Response.json({ code: 0, data: { merged_by_type: { quark: [
    ...data({}, '恢复浏览器补充测试 4K').merged_by_type.quark,
    { url: 'https://pan.quark.cn/s/series162', note: '恢复浏览器补充测试 更新162集' },
    { url: 'https://pan.quark.cn/s/irrelevant', note: '其他剧集 更新200集' }
  ] } } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.quarkResources.value.length, 2);
  assert.equal(view.searchPending.value, true);
  t.mock.timers.tick(1_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.quarkResources.value.length, 2);
  assert.equal(view.searchPending.value, false);
  assert.match(view.searchNotice.value, /备用来源补充/);
  view.closeTransferModal();
});

test('恢复旧版本服务器失败时的浏览器兜底，但登录失效不发起公共查询', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 3_000_000 });
  let authFailed = false;
  const calls = [];
  mockFetch(t, async url => {
    calls.push(String(url));
    if (String(url).startsWith('https:')) return Response.json({ code: 0, data: data({}, '服务器失败兜底测试 4K') });
    return Response.json({ code: authFailed ? 'APP_AUTH_REQUIRED' : 'RESOURCE_SEARCH_UNAVAILABLE', message: authFailed ? '请先登录' : '服务端来源不可用' },
      { status: authFailed ? 401 : 503 });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ title: '服务器失败兜底测试', category: 'anime' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.quarkResources.value.length, 1);
  assert.equal(view.searchError.value, '');
  assert.equal(calls.length, 2);
  authFailed = true;
  t.mock.timers.tick(1_000);
  await view.openTransferModal({ title: '登录失效兜底测试', category: 'anime' });
  assert.equal(calls.length, 3);
  assert.equal(view.searchError.value, '请先登录');
  view.closeTransferModal();
});

test('页面等待真正后台完成，超过旧的 8 秒轮询窗口仍接收补齐的正篇候选', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 4_000_000 });
  let polls = 0;
  mockFetch(t, async url => {
    const cached = String(url).includes('cached=1');
    if (cached) polls += 1;
    const complete = polls >= 12;
    const result = data({ partial: !complete, refreshing: !complete, message: complete ? '' : '继续补查' }, '仙逆长窗口测试 4K');
    if (complete) result.merged_by_type.quark.push({ url: 'https://pan.quark.cn/s/mainseries', note: '仙逆长窗口测试 正篇' });
    return Response.json({ code: 0, data: result });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ title: '仙逆长窗口测试', category: 'anime' });
  for (let i = 0; i < 12; i += 1) { t.mock.timers.tick(1_000); await new Promise(resolve => setImmediate(resolve)); }
  await flush();
  assert.equal(polls, 12);
  assert.equal(view.quarkResources.value.length, 2);
  assert.equal(view.searchPending.value, false);
  t.mock.timers.tick(10_000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(polls, 12);
});

test('服务器及浏览器补充都先校验，失效候选被移除且晚到的缓存不能恢复', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 5_000_000 });
  const makeRows = (...ids) => ({ total: ids.length, partial: true, refreshing: false, merged_by_type: { quark: ids.map(id => ({ url: `https://pan.quark.cn/s/${id}`, note: '校验测试 4K' })) } });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/validate')) {
      const items = JSON.parse(init.body).items;
      return Response.json({ code: 0, data: { entries: items.map(item => ({ ...item, status: item.url.endsWith('cancelled') ? 'unavailable' : 'available' })), pending: false } });
    }
    return Response.json({ code: 0, data: String(url).startsWith('https:') ? makeRows('cancelled', 'publicvalid') : makeRows('cancelled', 'servervalid') });
  });
  const view = useQuarkTransfer();
  try {
    await view.openTransferModal({ title: '校验测试', category: 'anime' });
    await flush(); t.mock.timers.tick(1_000); await flush();
    assert.deepEqual(view.quarkResources.value.map(item => item.url).sort(), ['https://pan.quark.cn/s/publicvalid', 'https://pan.quark.cn/s/servervalid']);
    assert.match(view.searchNotice.value, /排除 1 条不可用/);
    view.rejectResource('https://pan.quark.cn/s/servervalid');
    t.mock.timers.tick(1_000); await flush();
    assert.deepEqual(view.quarkResources.value.map(item => item.url), ['https://pan.quark.cn/s/publicvalid']);
  } finally { view.closeTransferModal(); }
});

test('新检索忽略前一次晚到的链接校验，网络不确定性保留候选并标记待确认', async t => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/validate')) {
      const items = JSON.parse(init.body).items;
      if (items[0]?.url.endsWith('old')) return waiting;
      return Response.json({ code: 0, data: { entries: items.map(item => ({ ...item, status: 'unknown' })), pending: false } });
    }
    const old = String(url).includes(encodeURIComponent('旧校验测试'));
    return Response.json({ code: 0, data: { total: 1, merged_by_type: { quark: [{ url: `https://pan.quark.cn/s/${old ? 'old' : 'new'}`, note: old ? '旧校验测试 4K' : '新校验测试 4K' }] } } });
  });
  const view = useQuarkTransfer();
  try {
    await view.openTransferModal({ title: '旧校验测试', category: 'anime' });
    await view.openTransferModal({ title: '新校验测试', category: 'anime' }); await flush();
    release(Response.json({ code: 0, data: { entries: [{ url: 'https://pan.quark.cn/s/old', password: '', status: 'available' }], pending: false } }));
    await flush();
    assert.equal(view.quarkResources.value.length, 1);
    assert.equal(view.quarkResources.value[0].url, 'https://pan.quark.cn/s/new');
    assert.equal(view.quarkResources.value[0].linkStatus, 'unknown');
  } finally { view.closeTransferModal(); }
});

test('content-invalid and temporarily unreadable sources are removed from current search without discarding valid candidates',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('/validate'))return Response.json({code:0,data:{pending:false,entries:JSON.parse(init.body).items.map(item=>({...item,status:item.url.endsWith('good')?'available':item.url.endsWith('empty')?'unavailable':'deferred'}))}});
  return Response.json({code:0,data:{total:3,refreshing:false,allowPublicFallback:false,merged_by_type:{quark:['empty','unreadable','good'].map(id=>({url:'https://pan.quark.cn/s/'+id,note:'内容测试 '+id}))}}});
 });
 const view=useQuarkTransfer();try{await view.openTransferModal({title:'内容测试',category:'tv'});await flush();assert.deepEqual(view.quarkResources.value.map(item=>item.url),['https://pan.quark.cn/s/good']);assert.match(view.searchNotice.value,/排除 2 条不可用/);}finally{view.closeTransferModal();}
});
