import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
const { createApp, nextTick, reactive, h } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/player-fullscreen-');
const output = path.resolve(folder, 'fullscreen.mjs');
await build({ entryPoints: ['src/composables/usePlayerFullscreen.ts'], outfile: output, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { usePlayerFullscreen } = await import(pathToFileURL(output));
const event = name => new dom.window.Event(name);

function mount(enabled = true, mobile = false) {
  document.body.innerHTML = '<section id="player"><video></video><div id="mount"></div></section>';
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: enabled });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value: null });
  const player = document.querySelector('#player');
  const video = document.querySelector('video');
  const state = reactive({ open: true });
  let controls;
  document.exitFullscreen = async () => { document.fullscreenElement = null; document.dispatchEvent(event('fullscreenchange')); };
  player.requestFullscreen = async () => { document.fullscreenElement = player; document.dispatchEvent(event('fullscreenchange')); };
  const app = createApp({ setup() { controls = usePlayerFullscreen(() => player, () => video, () => state.open, mobile); return () => h('div'); } });
  app.mount('#mount');
  return { app, player, video, state, controls };
}

test('容器全屏包含控制栏与面板，系统退出事件同步状态', async () => {
  const v = mount();
  try {
    await v.controls.toggleFullscreen();
    assert.equal(document.fullscreenElement, v.player);
    assert.equal(v.controls.fullscreen.value, true);
    await document.exitFullscreen();
    assert.equal(v.controls.fullscreen.value, false);
    assert.equal(v.controls.notice.value, '');
  } finally { v.app.unmount(); }
});
test('全屏请求失败只报告原因，不改成网页全屏或调用另一种全屏', async () => {
  const v = mount(); let nativeCalls = 0;
  try {
    v.player.requestFullscreen = async () => { throw new Error('denied'); };
    v.video.webkitEnterFullscreen = () => nativeCalls++;
    await v.controls.toggleFullscreen();
    assert.equal(v.controls.fullscreen.value, false);
    assert.equal(nativeCalls, 0);
    assert.equal(document.fullscreenElement, null);
    assert.match(v.controls.notice.value, /未允许进入全屏/);
  } finally { v.app.unmount(); }
});
test('iPhone仅支持视频全屏时明确使用系统视频API，关闭播放器退出系统全屏', async () => {
  const v = mount(false); let exits = 0;
  try {
    v.video.webkitEnterFullscreen = () => { v.video.webkitDisplayingFullscreen = true; v.video.dispatchEvent(event('webkitbeginfullscreen')); };
    v.video.webkitExitFullscreen = () => { exits++; v.video.webkitDisplayingFullscreen = false; v.video.dispatchEvent(event('webkitendfullscreen')); };
    assert.equal(v.controls.nativeVideoFullscreen.value, true);
    await v.controls.toggleFullscreen();
    assert.equal(v.controls.fullscreen.value, true);
    v.state.open = false; await nextTick();
    assert.equal(exits, 1); assert.equal(v.controls.fullscreen.value, false);
  } finally { v.app.unmount(); }
});
test('没有全屏API时不伪造成功，旋转方向交给用户和设备', async () => {
  const v = mount(false);
  try {
    await v.controls.toggleFullscreen();
    assert.equal(v.controls.fullscreen.value, false);
    assert.match(v.controls.notice.value, /不支持系统全屏/);
  } finally { v.app.unmount(); }
});
test('全屏请求进行中重复点击不会并发发起，关闭后迟到的成功也会退出', async () => {
  const v = mount(); let resolve, calls = 0;
  try {
    v.player.requestFullscreen = () => { calls++; return new Promise(done => { resolve = () => { document.fullscreenElement = v.player; document.dispatchEvent(event('fullscreenchange')); done(); }; }); };
    const first = v.controls.toggleFullscreen();
    await v.controls.toggleFullscreen(); assert.equal(calls, 1);
    v.state.open = false; await nextTick(); resolve(); await first;
    assert.equal(document.fullscreenElement, null); assert.equal(v.controls.fullscreen.value, false);
  } finally { v.app.unmount(); }
});
test('浏览器拒绝方向锁定时保留真实全屏并明确提示旋转，退出后清除提示', async () => {
  const v = mount(true, true);
  const previous = {width: window.innerWidth, height: window.innerHeight};
  Object.defineProperty(window, 'innerWidth', {configurable: true, value: 402});
  Object.defineProperty(window, 'innerHeight', {configurable: true, value: 874});
  Object.defineProperty(window.screen, 'orientation', {configurable: true, value: {lock: async () => {throw new Error('not supported');}, unlock() {}}});
  try {
    await v.controls.toggleFullscreen();
    assert.equal(v.controls.fullscreen.value, true);
    assert.equal(document.fullscreenElement, v.player);
    assert.match(v.controls.notice.value, /未允许自动横屏，请旋转手机/);
    await v.controls.exitFullscreen();
    assert.equal(v.controls.notice.value, '');
  } finally {
    v.app.unmount(); delete window.screen.orientation;
    Object.defineProperty(window, 'innerWidth', {configurable: true, value: previous.width});
    Object.defineProperty(window, 'innerHeight', {configurable: true, value: previous.height});
  }
});
test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });
