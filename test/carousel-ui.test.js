import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
const { createApp, ref, reactive, h, nextTick } = await import('vue');
await fs.mkdir('.local-runtime/tests', { recursive: true });
const folder = await fs.mkdtemp('.local-runtime/tests/carousel-');
const output = path.resolve(folder, 'carousel.mjs');
await build({ entryPoints: ['src/composables/useFeaturedCarousel.ts'], outfile: output, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { useFeaturedCarousel } = await import(pathToFileURL(output));

function mount(t, reducedMotion = false) {
  const timers = new Map(), motionListeners = new Set();
  let nextId = 0, hidden = false, visibility, disconnected = false;
  const motion = { matches: reducedMotion, addEventListener: (_, cb) => motionListeners.add(cb), removeEventListener: (_, cb) => motionListeners.delete(cb) };
  window.matchMedia = () => motion;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  globalThis.IntersectionObserver = class {
    constructor(cb) { visibility = cb; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  t.mock.method(globalThis, 'setTimeout', (cb, delay) => { assert.equal(delay, 6000); timers.set(++nextId, cb); return nextId; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  document.body.innerHTML = '<div id="app"></div>';
  const props = reactive({ items: ['a', 'b', 'c'], active: true });
  let carousel;
  const root = ref(null);
  const app = createApp({ setup() {
    carousel = useFeaturedCarousel(() => props.items, () => props.active, root);
    return () => h('section', { ref: root }, h('button', '影片'));
  } });
  app.mount('#app');
  return {
    app, props, carousel, root, timers, motion, motionListeners,
    tick() { const [id, cb] = timers.entries().next().value; timers.delete(id); cb(); },
    hidden(value) { hidden = value; document.dispatchEvent(new dom.window.Event('visibilitychange')); },
    intersect(value) { visibility([{ isIntersecting: value }]); },
    get disconnected() { return disconnected; }
  };
}

test('recommendations advance every six seconds, reset on manual selection, wrap, and stop when the page or list changes', async t => {
  const v = mount(t);
  try {
    assert.equal(v.timers.size, 1);
    v.tick(); assert.equal(v.carousel.index.value, 1);
    const oldTimer = [...v.timers.keys()][0];
    v.carousel.select(2); assert.equal(v.carousel.index.value, 2); assert.ok(!v.timers.has(oldTimer));
    v.tick(); assert.equal(v.carousel.index.value, 0);
    v.props.active = false; assert.equal(v.timers.size, 0);
    v.props.active = true; assert.equal(v.timers.size, 1);
    v.props.items = []; await nextTick(); assert.equal(v.timers.size, 0); assert.equal(v.carousel.index.value, 0);
    v.props.items = ['only']; await nextTick(); assert.equal(v.timers.size, 0);
    v.props.items = ['new', 'list']; await nextTick(); assert.equal(v.timers.size, 1);
  } finally { v.app.unmount(); }
  assert.equal(v.timers.size, 0); assert.equal(v.disconnected, true); assert.equal(v.motionListeners.size, 0);
});

test('hover, keyboard focus, touching, offscreen and background tabs pause recommendations', t => {
  const v = mount(t);
  try {
    v.carousel.enter({ pointerType: 'mouse' }); assert.equal(v.timers.size, 0);
    v.carousel.leave(); assert.equal(v.timers.size, 1);
    v.carousel.enter({ pointerType: 'touch' }); assert.equal(v.timers.size, 1);
    v.carousel.press(); assert.equal(v.timers.size, 0);
    v.carousel.focus(); // A touch-generated focus must not permanently stop rotation after release.
    v.carousel.release(); assert.equal(v.timers.size, 1);
    v.carousel.focus(); assert.equal(v.timers.size, 0);
    v.carousel.blur({ relatedTarget: v.root.value.querySelector('button') }); assert.equal(v.timers.size, 0);
    v.carousel.blur({ relatedTarget: null }); assert.equal(v.timers.size, 1);
    v.intersect(false); assert.equal(v.timers.size, 0);
    v.intersect(true); assert.equal(v.timers.size, 1);
    v.hidden(true); assert.equal(v.timers.size, 0);
    v.hidden(false); assert.equal(v.timers.size, 1);
    v.carousel.toggle(); assert.equal(v.timers.size, 0);
    v.carousel.select(1); assert.equal(v.carousel.index.value, 1); assert.equal(v.timers.size, 0);
  } finally { v.app.unmount(); }
});

test('reduced-motion preference starts still and allows explicit playback; preference changes and unmount clean up', t => {
  const v = mount(t, true);
  try {
    assert.equal(v.carousel.enabled.value, false); assert.equal(v.timers.size, 0);
    v.carousel.toggle(); assert.equal(v.timers.size, 1);
    v.motionListeners.forEach(cb => cb()); assert.equal(v.timers.size, 0);
    v.motion.matches = false; v.motionListeners.forEach(cb => cb()); assert.equal(v.timers.size, 1);
  } finally { v.app.unmount(); }
  v.hidden(true); assert.equal(v.timers.size, 0); assert.equal(v.motionListeners.size, 0);
});

test.after(async () => { dom.window.close(); delete globalThis.IntersectionObserver; await fs.rm(folder, { recursive: true, force: true }); });
