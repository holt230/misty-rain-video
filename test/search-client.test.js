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

test('首批、缓存补齐和公共补充一致剔除4K壁纸、图片和音频，保留正片及改编说明', async t => {
  const titles = ['斗破苍穹-云韵4K精美壁纸', '斗破苍穹-美杜莎4K精美壁纸', '斗破苍穹 4K wallpaper',
    '斗破苍穹 高清写真图集', '斗破苍穹.jpg', '斗破苍穹 有声小说', '斗破苍穹 原声带 FLAC',
    '斗破苍穹 2026 4K 更新至120集', '斗破苍穹 1080P 小说改编', '斗破苍穹 第五季 国语中字'];
  const rows = titles.map((note, index) => ({ note, url: `https://pan.quark.cn/s/item${index}` }));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { merged_by_type: { quark: rows } } }));
  const service = new SilentSearchEngine();
  for (const result of [await service.search('斗破苍穹'), await service.readCached('斗破苍穹'), await service.supplement('斗破苍穹')]) {
    assert.equal(result.total, 3);
    assert.deepEqual(result.items.map(item => item.title), titles.slice(7));
    assert.deepEqual(result.quarkItems, result.items);
  }
});

test('资源分类不把影片本身的名字当作周边类型', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: data({}, '小说家的电影 2022 1080P') }));
  assert.equal((await new SilentSearchEngine().search('小说家的电影')).items.length, 1);
});

test('首批、缓存补齐和公共补充均按片名边界匹配，剔除剑仙逆世并保留年番与剧场版', async t => {
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
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { total: rows.length, merged_by_type: { quark: rows } } }));
  const service = new SilentSearchEngine();
  for (const result of [await service.search('《仙逆》'), await service.readCached('仙逆'), await service.supplement('仙逆')]) {
    assert.equal(result.total, 6);
    assert.deepEqual(result.items.map(item => item.title), titles.slice(5));
    assert.deepEqual(result.quarkItems, result.items);
  }
});

test('首次查询只读取本站，公共源补充由页面单独发起', async t => {
  const calls = [];
  let mode = 'failed';
  t.mock.method(globalThis, 'fetch', async url => {
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
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return Response.json({ code: 'UNAVAILABLE', message: '检索来源暂时不可用' }, { status: 503 }); });
  const service = new SilentSearchEngine();
  await service.search('先前剧');
  const [first, second] = await Promise.all([service.search('测试剧'), service.search('测试剧', { force: true })]);
  assert.equal(calls, 2);
  assert.equal(first.success, false);
  assert.deepEqual(first, second);
});

test('缓存补齐更新客户端快照，返回该关键词时立即使用最新结果', async t => {
  const calls = [];
  let complete = false;
  t.mock.method(globalThis, 'fetch', async url => {
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
  const revisited = await service.search('测试剧');
  assert.equal(revisited.fromCache, true);
  assert.equal(revisited.refreshing, false);
  assert.equal(calls.length, 2);
});

test('登录失效直接返回，不绕过本站认证发起公共检索', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return Response.json({ code: 'APP_AUTH_REQUIRED', message: '请先登录' }, { status: 401 }); });
  const result = await new SilentSearchEngine().search('测试剧');
  assert.equal(result.success, false);
  assert.equal(result.message, '请先登录');
  assert.equal(result.allowPublicFallback, false);
  assert.equal(calls, 1);
});

test('首批结果立即可用，慢通道候选自动补齐；关闭面板后不再轮询', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    const cached = String(url).includes('cached=1');
    const keyword = new URL(String(url), 'https://local.invalid').searchParams.get('kw');
    const result = data({ partial: !cached, refreshing: !cached, message: cached ? '' : '正在补充' }, `${keyword} 4K`);
    if (cached) result.merged_by_type.quark.push({ url: 'https://pan.quark.cn/s/second', note: `${keyword} 补充来源` });
    return Response.json({ code: 0, data: result });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ title: '仙逆渐进测试', category: 'anime' });
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
  t.mock.method(globalThis, 'fetch', async (url, options) => {
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
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).startsWith('https:')) return pending;
    const cached = String(url).includes('cached=1');
    return Response.json({ code: 0, data: data({ partial: true, refreshing: !cached }, '恢复浏览器补充测试 4K') });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ title: '恢复浏览器补充测试', category: 'anime' });
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
  t.mock.method(globalThis, 'fetch', async url => {
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
  t.mock.method(globalThis, 'fetch', async url => {
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
  assert.equal(polls, 12);
  assert.equal(view.quarkResources.value.length, 2);
  assert.equal(view.searchPending.value, false);
  t.mock.timers.tick(10_000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(polls, 12);
});

test('连续换词立即切换当前搜索并取消旧请求，晚到的旧结果不能覆盖新结果', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 5_000_000 });
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => {
    requests.push({ keyword: new URL(String(url), 'http://localhost').searchParams.get('kw'), signal: options.signal, resolve });
  }));
  const view = useQuarkTransfer();
  const first = view.openTransferModal({ id: 'search-race', title: '首次搜索测试', category: 'tv' });
  assert.equal(view.searchPending.value, true);
  const second = view.refreshResources('后续搜索测试');
  assert.equal(view.searchKeyword.value, '后续搜索测试');
  assert.equal(view.currentMedia.value.title, '后续搜索测试');
  assert.equal(view.isAnalyzing.value, true);
  assert.equal(requests[0].signal.aborted, true);
  t.mock.timers.tick(300); await new Promise(resolve => setImmediate(resolve));
  requests[1].resolve(Response.json({ code: 0, data: data({}, '后续搜索测试 4K') }));
  await second;
  requests[0].resolve(Response.json({ code: 0, data: data({}, '首次搜索测试 4K') }));
  await first;
  assert.deepEqual(view.quarkResources.value.map(item => item.title), ['后续搜索测试 4K']);
  assert.equal(view.searchPending.value, false);
  view.closeTransferModal();
});

test('取消后立刻重搜相同关键词，旧请求结束不会清掉新请求或污染缓存', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 6_000_000 });
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({ signal: options.signal, resolve })));
  const engine = new SilentSearchEngine();
  const old = engine.search('重入测试');
  engine.cancelPending();
  const current = engine.search('重入测试', { force: true });
  t.mock.timers.tick(300); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(Response.json({ code: 0, data: data({}, '重入测试 旧版') }));
  await old;
  assert.equal(engine.cachedResult('重入测试'), null);
  const duplicate = engine.search('重入测试', { force: true });
  assert.equal(requests.length, 2);
  requests[1].resolve(Response.json({ code: 0, data: data({}, '重入测试 新版') }));
  await Promise.all([current, duplicate]);
  assert.equal(engine.cachedResult('重入测试').items[0].title, '重入测试 新版');
});

test('切换搜索取消备用请求，不把主动取消当作来源故障而限制下一次补查', async t => {
  let calls = 0, firstSignal;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    calls++;
    if (calls === 1) {
      firstSignal = options.signal;
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
    }
    return Promise.resolve(Response.json({ code: 0, data: data({}, '补查后续测试 4K') }));
  });
  const engine = new SilentSearchEngine();
  const cancelled = engine.supplement('补查前次测试');
  engine.cancelPending();
  await cancelled;
  const latest = await engine.supplement('补查后续测试');
  assert.equal(firstSignal.aborted, true);
  assert.equal(engine.cachedResult('补查前次测试'), null);
  assert.equal(latest.success, true);
  assert.equal(calls, 2);
});

test('重复搜索先展示最近结果再刷新，认证失效后清除预览并停止检索', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 7_000_000 });
  let mode = 'initial', complete;
  t.mock.method(globalThis, 'fetch', () => {
    if (mode === 'initial') return Promise.resolve(Response.json({ code: 0, data: data({}, '缓存预览测试 旧版') }));
    if (mode === 'auth') return Promise.resolve(Response.json({ code: 'APP_AUTH_REQUIRED', message: '请先登录' }, { status: 401 }));
    return new Promise(resolve => { complete = resolve; });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ id: 'search-preview', title: '缓存预览测试', category: 'tv' });
  mode = 'refresh';
  const refreshing = view.refreshResources('缓存预览测试');
  assert.equal(view.isAnalyzing.value, false);
  assert.equal(view.searchPending.value, true);
  assert.match(view.searchNotice.value, /最近/);
  assert.equal(view.quarkResources.value[0].title, '缓存预览测试 旧版');
  t.mock.timers.tick(300); await new Promise(resolve => setImmediate(resolve));
  complete(Response.json({ code: 0, data: data({}, '缓存预览测试 新版') }));
  await refreshing;
  assert.deepEqual(view.quarkResources.value.map(item => item.title), ['缓存预览测试 新版']);
  mode = 'auth';
  const forbidden = view.refreshResources('缓存预览测试');
  t.mock.timers.tick(300); await forbidden;
  assert.equal(view.quarkResources.value.length, 0);
  assert.equal(view.searchPending.value, false);
  assert.equal(view.searchError.value, '请先登录');
  view.closeTransferModal();
});

test('成功刷新为空时清除旧候选缓存，避免下一次再次显示旧资源', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 8_000_000 });
  let empty = false;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: empty ? { total: 0, merged_by_type: { quark: [] } } : data({}, '清空缓存测试 4K') }));
  const engine = new SilentSearchEngine();
  await engine.search('清空缓存测试');
  assert.equal(engine.cachedResult('清空缓存测试').items.length, 1);
  empty = true;
  const refreshed = engine.search('清空缓存测试', { force: true });
  t.mock.timers.tick(300); await refreshed;
  assert.equal(engine.cachedResult('清空缓存测试'), null);
});
