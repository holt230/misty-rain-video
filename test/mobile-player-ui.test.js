import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from 'vue/compiler-sfc';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
const { createApp, nextTick, reactive, markRaw, h } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/mobile-player-');
const file = 'src/components/player/MobilePlaybackControls.vue';
const compiled = compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: 'mobile-player-test', inlineTemplate: true });
const output = path.resolve(folder, 'controls.mjs');
await build({ stdin: { contents: compiled.content, loader: 'ts', resolveDir: path.resolve('src/components/player') }, outfile: output, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const Controls = (await import(pathToFileURL(output))).default;
const layoutOutput = path.resolve(folder, 'landscape.mjs');
await build({ entryPoints: ['src/composables/useMobileLandscape.ts'], outfile: layoutOutput, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { useMobileLandscape } = await import(pathToFileURL(layoutOutput));
const button = label => document.querySelector(`button[aria-label="${label}"]`);
const event = name => new dom.window.Event(name);

function video() {
  const element = document.createElement('video');
  let paused = true;
  Object.defineProperty(element, 'paused', { get: () => paused });
  Object.defineProperty(element, 'duration', { value: 120 });
  element.play = async () => { paused = false; element.dispatchEvent(event('play')); };
  element.pause = () => { paused = true; element.dispatchEvent(event('pause')); };
  const tracks = [{ kind: 'subtitles', label: '中文', mode: 'showing' }, { kind: 'metadata', mode: 'hidden' }];
  const events = new dom.window.EventTarget();
  tracks.addEventListener = events.addEventListener.bind(events);
  tracks.removeEventListener = events.removeEventListener.bind(events);
  Object.defineProperty(element, 'textTracks', { value: tracks });
  return element;
}
function mount() {
  document.body.innerHTML = '<div id="mount"></div>';
  const media = video(); document.body.appendChild(media);
  const props = reactive({ video: markRaw(media), expanded: false });
  let toggles = 0;
  const app = createApp({ render: () => h(Controls, { ...props, onFullscreen: () => { toggles++; props.expanded = !props.expanded; } }) });
  app.mount('#mount');
  return { app, props, media, get toggles() { return toggles; } };
}

test('mobile controls play, pause, seek without time updates overriding a drag, and toggle one fullscreen entry', async () => {
  const view = mount();
  try {
    button('播放').click(); await nextTick(); assert.equal(view.media.paused, false);
    button('暂停').click(); await nextTick(); assert.equal(view.media.paused, true);
    const range = document.querySelector('input');
    range.value = '65'; range.dispatchEvent(event('input')); await nextTick();
    view.media.currentTime = 10; view.media.dispatchEvent(event('timeupdate')); await nextTick();
    assert.equal(range.value, '65');
    range.dispatchEvent(event('change')); await nextTick(); assert.equal(view.media.currentTime, 65);
    range.value = '80'; range.dispatchEvent(event('input')); await nextTick();
    range.dispatchEvent(event('pointercancel')); await nextTick(); assert.equal(range.value, '65');
    button('横屏播放').click(); await nextTick(); assert.ok(button('退出横屏'));
    button('退出横屏').click(); await nextTick(); assert.equal(view.toggles, 2);
    assert.ok(button('横屏播放'));
  } finally { view.app.unmount(); }
});
test('subtitle selection leaves metadata tracks alone; mute can restore zero volume', async () => {
  const view = mount();
  try {
    const select = document.querySelector('select');
    select.value = '-1'; select.dispatchEvent(event('change')); await nextTick();
    assert.equal(view.media.textTracks[0].mode, 'disabled');
    assert.equal(view.media.textTracks[1].mode, 'hidden');
    select.value = '0'; select.dispatchEvent(event('change')); await nextTick();
    assert.equal(view.media.textTracks[0].mode, 'showing');
    view.media.volume = 0; view.media.dispatchEvent(event('volumechange')); await nextTick();
    button('取消静音').click(); await nextTick();
    assert.equal(view.media.volume, 1); assert.equal(view.media.muted, false);
  } finally { view.app.unmount(); }
});
test('playing fades controls, tapping the video reveals them, and pausing keeps controls visible', async () => {
  const originalTimeout = globalThis.setTimeout;
  let hide;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 3500) { hide = callback; return 0; }
    return originalTimeout(callback, delay, ...args);
  };
  const view = mount();
  try {
    button('播放').click(); await nextTick();
    assert.equal(typeof hide, 'function'); hide(); await nextTick();
    assert.ok(document.querySelector('.mobile-controls').classList.contains('concealed'));
    view.media.dispatchEvent(event('click')); await nextTick();
    assert.ok(!document.querySelector('.mobile-controls').classList.contains('concealed'));
    hide = null; button('暂停').click(); await nextTick();
    assert.equal(hide, null);
    assert.ok(!document.querySelector('.mobile-controls').classList.contains('concealed'));
  } finally { view.app.unmount(); globalThis.setTimeout = originalTimeout; }
});
test('play rejection is visible and replaced video no longer controls the UI', async () => {
  const view = mount();
  try {
    view.media.play = async () => { throw new Error('blocked'); };
    button('播放').click(); await nextTick(); await nextTick();
    assert.match(document.querySelector('[role="status"]').textContent, /未能开始播放/);
    const replacement = video(); replacement.currentTime = 20;
    view.props.video = markRaw(replacement); await nextTick();
    view.media.currentTime = 100; view.media.dispatchEvent(event('timeupdate')); await nextTick();
    assert.equal(document.querySelector('input').value, '20');
    assert.equal(document.querySelector('[role="status"]'), null);
    button('播放').click(); await nextTick();
    assert.equal(replacement.paused, false);
  } finally { view.app.unmount(); }
});
test('portrait-locked landscape swaps dimensions, follows resize, exits without re-entering and resets on close', async () => {
  document.body.innerHTML = '<div id="mount"></div>';
  const resize = (width, height) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    window.dispatchEvent(event('resize'));
  };
  resize(402, 874);
  const props = reactive({ open: true }); let layout;
  const app = createApp({ setup() { layout = useMobileLandscape(true, () => props.open); return () => h('div'); } }); app.mount('#mount');
  try {
    assert.equal(layout.immersive.value, false);
    layout.toggleWebFullscreen(); assert.equal(layout.rotated.value, true);
    assert.deepEqual(layout.immersiveStyle.value, { '--player-width': '402px', '--player-height': '874px' });
    resize(874, 402); assert.equal(layout.rotated.value, false); assert.equal(layout.immersive.value, true);
    layout.toggleWebFullscreen(); resize(874, 380); assert.equal(layout.immersive.value, false);
    resize(402, 874); resize(874, 402); assert.equal(layout.immersive.value, true);
    resize(402, 874); layout.toggleWebFullscreen();
    props.open = false; await nextTick(); assert.equal(layout.immersive.value, false); assert.equal(layout.rotated.value, false);
    props.open = true; await nextTick(); assert.equal(layout.immersive.value, false);
  } finally { app.unmount(); }
  const before = layout.immersiveStyle.value;
  resize(874, 402); assert.equal(layout.immersiveStyle.value, before);
});
test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });
