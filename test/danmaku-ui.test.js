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
globalThis.VTTCue = class {
  constructor(startTime, endTime, text) { this.startTime = startTime; this.endTime = endTime; this.text = text; }
};
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
  const tracks = [];
  Object.defineProperty(video, 'textTracks', { value: tracks });
  video.addTextTrack = (kind, label) => {
    const track = {
      kind, label, cues: [], mode: 'disabled',
      addCue(cue) { this.cues.push(cue); },
      removeCue(cue) { const index = this.cues.indexOf(cue); if (index < 0) throw new Error('Unknown cue'); this.cues.splice(index, 1); }
    };
    tracks.push(track);
    return track;
  };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const data = await handler(String(url), options);
    if (data instanceof Response) return data;
    return new Response(JSON.stringify({ code: 0, data }), { headers: { 'Content-Type': 'application/json' } });
  };
  const props = reactive({ video: markRaw(video), input: { ...input } });
  const app = createApp({ render: () => h(Component, props) }); app.mount('#mount');
  return { app, props, calls, video, tracks, get nativeTrack() { return tracks.find(track => track.label === '弹幕'); },
    remount() { this.app.unmount(); this.app = createApp({ render: () => h(Component, props) }); this.app.mount('#mount'); }
  };
}
function defaultResponse(url) {
  if (url.includes('/match')) return { selected: source, candidates: [], status: 'matched' };
  return { comments: [{ time: 1, text: '<img src=x onerror=alert(1)>', color: '#ffffff', mode: 'rtl' }], index: 0, segmentSeconds: 30, fetchedAt: Date.now(), stale: false };
}
const apiError = (code, status = 502) => new Response(JSON.stringify({ code, message: '测试错误详情' }), {
  status, headers: { 'Content-Type': 'application/json' }
});

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
    assert.match(document.querySelector('[role="status"]').textContent, /弹幕暂时没加载出来/);
    assert.equal(view.video.currentTime, 65); assert.equal(view.video.paused, true);
  } finally { view.app.unmount(); }
});
test('ambiguous works offer selection, remember the selected source, and keep native fullscreen free of synthetic subtitle tracks', async () => {
  const view = mount(url => url.includes('/match') ? { selected: null, candidates: [{ id: '2:ABCdef', title: '测试剧', year: '2024', categoryLabel: '电视剧', platforms: ['qq'] }], status: 'choose' }
    : url.includes('/select') ? source : defaultResponse(url));
  try {
    button('弹幕关').click(); await flush();
    button('选一下片名').click(); await nextTick();
    button('选择').click(); await flush(); await flush();
    assert.ok(view.calls.some(call => call.url.includes('/select')));
    const selectCall = view.calls.find(call => call.url.includes('/select'));
    assert.equal(JSON.parse(selectCall.options.body).platform, undefined);
    view.video.dispatchEvent(new dom.window.Event('webkitbeginfullscreen')); await flush();
    assert.equal(document.querySelector('.danmaku-overlay').style.visibility, 'hidden');
    assert.equal(view.tracks.length, 0);
    assert.match(document.querySelector('[role="status"]').textContent, /系统播放器不显示飘屏弹幕/);
    view.video.dispatchEvent(new dom.window.Event('webkitendfullscreen')); await flush();
    assert.equal(view.tracks.length, 0);
    assert.equal(document.querySelector('.danmaku-overlay').style.visibility, 'visible');
  } finally { view.app.unmount(); }
});
test('container fullscreen keeps the scrolling renderer visible without adding captions', async () => {
  const view = mount(defaultResponse);
  try {
    button('弹幕关').click(); await flush(); await flush();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: view.video.parentElement });
    document.dispatchEvent(new dom.window.Event('fullscreenchange')); await flush();
    assert.equal(document.querySelector('.danmaku-overlay').style.visibility, 'visible');
    assert.ok(document.querySelector('.danmaku-overlay').childElementCount > 0);
    assert.equal(view.tracks.length, 0);
  } finally { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); view.app.unmount(); }
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
    document.querySelector('button[aria-label="弹幕设置"]').click(); await nextTick();
    button('更多选项').click(); await nextTick();
    assert.match(document.querySelector('.danmaku-source').textContent, /第2集/);
  } finally { view.app.unmount(); }
});
test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });

test('manual refresh and time correction use the new segment; unmount removes the teleported overlay', async () => {
  const view = mount(defaultResponse);
  try {
    button('弹幕关').click(); await flush(); await flush();
    document.querySelector('button[aria-label="弹幕设置"]').click(); await nextTick();
    button('更多选项').click(); await nextTick();
    button('刷新弹幕').click(); await flush();
    assert.ok(view.calls.some(call => call.url.includes('refresh=1')));
    view.video.currentTime = 29;
    button('提前 1 秒').click(); await flush();
    assert.ok(view.calls.some(call => call.url.includes('index=1')));
    assert.equal(localStorage.getItem('misty_rain_danmaku_offset:sample:2:ABCdef'), '-1');
  } finally { view.app.unmount(); }
  assert.equal(document.querySelector('.danmaku-overlay'), null);
});

test('source outages, catalogue outages and missing episodes have different recovery messages', async () => {
  for (const [code, hint, action] of [
    ['DANMAKU_SOURCE_UNAVAILABLE', '弹幕来源连接失败，请重试', '重试'],
    ['DANMAKU_CATALOG_UNAVAILABLE', '弹幕目录暂不可用，请重试', '重试'],
    ['DANMAKU_EPISODE_NOT_FOUND', '本集暂未收录弹幕', '选一下片名']
  ]) {
    const view = mount(() => apiError(code, code === 'DANMAKU_EPISODE_NOT_FOUND' ? 404 : 502));
    try {
      button('弹幕关').click(); await flush();
      assert.equal(document.querySelector('[role="status"]').textContent, hint);
      assert.ok(button(action));
      assert.equal(button(action === '重试' ? '选一下片名' : '重试'), undefined);
    } finally { view.app.unmount(); }
  }
});

test('retry after a work selection outage retries the same work instead of searching again', async () => {
  let selects = 0, finish;
  const view = mount(url => {
    if (url.includes('/match')) return { selected: null, candidates: [{ id: source.workId, title: input.title, year: '2024', categoryLabel: '电视剧', platforms: ['qq'] }], status: 'choose' };
    if (url.includes('/select')) return ++selects === 1 ? apiError('DANMAKU_SOURCE_UNAVAILABLE') : new Promise(resolve => { finish = resolve; });
    return defaultResponse(url);
  });
  try {
    button('弹幕关').click(); await flush();
    button('选一下片名').click(); await nextTick();
    document.querySelector('.danmaku-work').click(); await flush();
    const retry = button('重试'); retry.click(); retry.click(); await flush();
    assert.equal(selects, 2);
    assert.equal(view.calls.filter(call => call.url.includes('/match')).length, 1);
    const selections = view.calls.filter(call => call.url.includes('/select')).map(call => JSON.parse(call.options.body));
    assert.deepEqual(selections[0], selections[1]);
    finish(source); await flush(); await flush();
    assert.equal(document.querySelector('[role="status"]').textContent, '');
    assert.equal(document.querySelector('.danmaku-settings'), null);
    assert.ok(document.querySelector('.danmaku-overlay').childElementCount > 0);
  } finally { view.app.unmount(); }
});

test('retry retains a manual search query and a manual episode link', async () => {
  for (const value of ['另外一个片名', 'https://v.youku.com/video?vid=XNjU0MjIxOTc4NA==']) {
    let attempts = 0;
    const view = mount((url, options) => {
      if (url.includes('/match') || url.includes('/select')) {
        const body = JSON.parse(options.body);
        if (body.query === value || body.url === value) {
          if (++attempts === 1) return apiError('DANMAKU_SOURCE_UNAVAILABLE');
          return body.url ? source : { selected: source, candidates: [], status: 'matched' };
        }
        return { selected: null, candidates: [], status: 'missing' };
      }
      return defaultResponse(url);
    });
    try {
      button('弹幕关').click(); await flush();
      if (value.startsWith('https:')) {
        document.querySelector('button[aria-label="弹幕设置"]').click(); await nextTick();
        button('更多选项').click(); await nextTick();
      } else { button('选一下片名').click(); await flush(); }
      const field = document.querySelector(value.startsWith('https:') ? '#danmaku-link' : '#danmaku-query');
      field.value = value; field.dispatchEvent(new dom.window.Event('input')); await nextTick();
      field.closest('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await flush();
      // Editing the field must not change which failed request the retry button repeats.
      field.value = '尚未提交的新输入'; field.dispatchEvent(new dom.window.Event('input')); await nextTick();
      button('重试').click(); await flush(); await flush();
      assert.equal(attempts, 2);
      const requests = view.calls.filter(call => call.options.body).map(call => JSON.parse(call.options.body));
      assert.deepEqual(requests.at(-1), requests.at(-2));
      assert.ok(view.calls.some(call => call.url.includes('/segment')));
    } finally { view.app.unmount(); }
  }
});

test('a segment failure can be retried immediately and successful retry clears the notice', async () => {
  let segmentCalls = 0, finish;
  const view = mount(url => {
    if (!url.includes('/segment')) return defaultResponse(url);
    if (++segmentCalls === 1) return apiError('DANMAKU_UNAVAILABLE', 503);
    return new Promise(resolve => { finish = () => resolve(defaultResponse(url)); });
  });
  try {
    button('弹幕关').click(); await flush();
    const retry = button('重试'); retry.click(); retry.click(); await flush();
    assert.equal(segmentCalls, 2);
    assert.ok(view.calls.at(-1).url.includes('refresh=1'));
    assert.equal(document.querySelector('[role="status"]').textContent, '正在重试…');
    finish(); await flush();
    assert.equal(button('重试'), undefined);
    assert.equal(document.querySelector('[role="status"]').textContent, '');
  } finally { view.app.unmount(); }
});

test('stale comments remain visible while a refresh failure offers retry', async () => {
  let stale = true;
  const view = mount(url => url.includes('/segment') ? { ...defaultResponse(url), stale } : defaultResponse(url));
  try {
    button('弹幕关').click(); await flush(); await flush();
    assert.equal(document.querySelector('[role="status"]').textContent, '弹幕更新失败，正在显示缓存');
    assert.ok(document.querySelector('.danmaku-overlay').childElementCount > 0);
    stale = false; button('重试').click(); await flush();
    assert.equal(document.querySelector('[role="status"]').textContent, '');
    assert.ok(view.calls.at(-1).url.includes('refresh=1'));
  } finally { view.app.unmount(); }
});
