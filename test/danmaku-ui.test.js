import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from 'vue/compiler-sfc';
import { build } from 'esbuild';

// Compile only this component, not the application. Test the actual renderer and Vue lifecycle.
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'localStorage', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'CustomEvent']) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const { createApp, nextTick, reactive, markRaw, h } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/danmaku-ui-');
const file = 'src/components/player/DanmakuControls.vue';
const compiled = compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: 'danmaku-test', inlineTemplate: true });
const output = path.resolve(folder, 'component.mjs');
await build({ stdin: { contents: compiled.content, loader: 'ts', resolveDir: path.resolve('src/components/player'), sourcefile: 'DanmakuControls.vue' }, outfile: output, bundle: true, format: 'esm', platform: 'browser', external: ['vue'], define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
const Component = (await import(pathToFileURL(output))).default;
const input = { mediaKey: 'sample', title: '测试剧', category: 'tv', episodeNumber: 1, episodeTitle: '第1集' };
const source = { platform: 'qq', id: 'j4100jwv4qo', workId: '2:ABCdef', title: '测试剧', year: '2024', episodeTitle: '第1集', segmentSeconds: 30 };
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 35)); await nextTick(); };
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.includes(text));
function mount(handler) {
  localStorage.clear();
  document.body.innerHTML = '<div id="stage"><video></video></div><div id="mount"></div>';
  const video = document.querySelector('video');
  Object.defineProperty(video, 'duration', { configurable: true, value: 180 });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
  Object.defineProperty(video.parentElement, 'clientWidth', { configurable: true, value: 402 });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const data = await handler(String(url), options);
    return new Response(JSON.stringify({ code: 0, data }), { headers: { 'Content-Type': 'application/json' } });
  };
  const props = reactive({ video: markRaw(video), input: { ...input } });
  const app = createApp({ render: () => h(Component, props) }); app.mount('#mount');
  return { app, props, calls, video };
}
function defaultResponse(url) {
  if (url.includes('/match')) return { selected: source, candidates: [], status: 'matched' };
  return { comments: [{ time: 1, text: '<img src=x onerror=alert(1)>', color: '#ffffff', mode: 'rtl' }], index: 0, segmentSeconds: 30, fetchedAt: Date.now(), stale: false };
}

test('disabled makes no requests; enabled matches, loads and mounts the renderer; disabling removes it', async () => {
  const view = mount(defaultResponse);
  try {
    await flush(); assert.equal(view.calls.length, 0);
    button('弹幕关').click(); await flush(); await flush();
    assert.ok(view.calls.some(call => call.url.includes('/match'))); assert.ok(view.calls.some(call => call.url.includes('/segment')));
    assert.equal(document.querySelector('.danmaku-toggle').getAttribute('aria-checked'), 'true');
    assert.ok(document.querySelector('.danmaku-overlay').childElementCount > 0);
    assert.equal(document.querySelectorAll('.danmaku-overlay img').length, 0);
    button('弹幕开').click(); await flush();
    assert.equal(document.querySelector('.danmaku-overlay').childElementCount, 0);
  } finally { view.app.unmount(); }
});
test('turning off cancels requests and ignores a late match response', async () => {
  let finish;
  const view = mount(() => new Promise(resolve => { finish = resolve; }));
  try {
    button('弹幕关').click(); await flush();
    const signal = view.calls[0].options.signal;
    button('弹幕开').click(); await flush(); assert.equal(signal.aborted, true);
    finish({ selected: source, candidates: [], status: 'matched' }); await flush();
    assert.equal(view.calls.length, 1); assert.equal(document.querySelector('.danmaku-overlay').childElementCount, 0);
  } finally { view.app.unmount(); }
});
test('seeking requests the actual segment and a failed response remains a danmaku-only notice', async () => {
  const view = mount(url => {
    if (url.includes('index=2')) throw new Error('弹幕服务离线');
    return defaultResponse(url);
  });
  try {
    button('弹幕关').click(); await flush(); await flush();
    view.video.currentTime = 65; view.video.dispatchEvent(new dom.window.Event('seeked')); await flush();
    assert.ok(view.calls.some(call => call.url.includes('index=2')));
    assert.match(document.querySelector('[role="status"]').textContent, /暂时无法连接弹幕服务/);
    assert.equal(view.video.currentTime, 65); assert.equal(view.video.paused, true);
  } finally { view.app.unmount(); }
});
test('ambiguous works offer selection, remember the selected source, and support native-fullscreen notice', async () => {
  const view = mount(url => url.includes('/match') ? { selected: null, candidates: [{ id: '2:ABCdef', title: '测试剧', year: '2024', categoryLabel: '电视剧', platforms: ['qq'] }], status: 'choose' }
    : url.includes('/select') ? source : defaultResponse(url));
  try {
    button('弹幕关').click(); await flush();
    button('选择弹幕').click(); await nextTick();
    button('使用腾讯视频弹幕').click(); await flush(); await flush();
    assert.ok(view.calls.some(call => call.url.includes('/select')));
    assert.match(document.querySelector('[role="status"]').textContent, /腾讯视频/);
    view.video.dispatchEvent(new dom.window.Event('webkitbeginfullscreen')); await flush();
    assert.equal(document.querySelector('.danmaku-overlay').style.visibility, 'hidden');
    assert.match(document.querySelector('[role="status"]').textContent, /系统全屏/);
    view.video.dispatchEvent(new dom.window.Event('webkitendfullscreen')); await flush();
    assert.equal(document.querySelector('.danmaku-overlay').style.visibility, 'visible');
  } finally { view.app.unmount(); }
});
test('changing episodes ignores the previous request and fetches the new match', async () => {
  const finishes = [];
  const view = mount((url, options) => url.includes('/match') ? new Promise(resolve => finishes.push({ resolve, body: JSON.parse(options.body) })) : defaultResponse(url));
  try {
    button('弹幕关').click(); await flush();
    view.props.input = { ...input, episodeNumber: 2, episodeTitle: '第2集' }; await flush();
    assert.equal(finishes.length, 2);
    finishes[0].resolve({ selected: source, candidates: [], status: 'matched' }); await flush();
    assert.equal(view.calls.filter(call => call.url.includes('/segment')).length, 0);
    finishes[1].resolve({ selected: { ...source, episodeTitle: '第2集' }, candidates: [], status: 'matched' }); await flush(); await flush();
    assert.match(document.querySelector('[role="status"]').textContent, /第2集/);
  } finally { view.app.unmount(); }
});
test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });

test('manual refresh and time correction use the new segment; unmount removes the teleported overlay', async () => {
  const view = mount(defaultResponse);
  try {
    button('弹幕关').click(); await flush(); await flush();
    button('弹幕设置').click(); await nextTick();
    button('刷新弹幕').click(); await flush();
    assert.ok(view.calls.some(call => call.url.includes('refresh=1')));
    view.video.currentTime = 29;
    button('提前 1 秒').click(); await flush();
    assert.ok(view.calls.some(call => call.url.includes('index=1')));
    assert.equal(localStorage.getItem('misty_rain_danmaku_offset:sample:2:ABCdef'), '-1');
  } finally { view.app.unmount(); }
  assert.equal(document.querySelector('.danmaku-overlay'), null);
});
