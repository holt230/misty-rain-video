import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
const { createApp, defineComponent, h, ref, nextTick, isReadonly } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/auto-carousel-'), output = path.resolve(folder, 'hooks.mjs');
await build({ stdin: { contents: "export { useAutoCarousel } from './src/composables/useAutoCarousel.ts'; export { useDialog, dialogOpenCount } from './src/composables/useDialog.ts';", resolveDir: process.cwd() },
  outfile: output, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { useAutoCarousel, useDialog, dialogOpenCount } = await import(pathToFileURL(output));
after(() => { fs.rmSync(folder, { recursive: true, force: true }); dom.window.close(); });

function clock(t) {
  let now = 1000, nextId = 0; const jobs = new Map();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (run, delay = 0) => { const id = ++nextId; jobs.set(id, { run, at: now + delay }); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => jobs.delete(id));
  return { jobs, async tick(ms) {
    const until = now + ms;
    for (let n = 0; n < 1000; n++) {
      const due = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; jobs.delete(due[0]); due[1].run(); await nextTick();
    }
    now = until; await nextTick();
  } };
}
const pointer = (type, target, pointerType = 'touch', pointerId = 1) => {
  const event = new window.Event(type, { bubbles: true });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: pointerId } });
  target.dispatchEvent(event);
};
const Modal = defineComponent({ props: { open: Boolean }, setup(props) {
  const element = ref(null); useDialog(element, () => props.open);
  return () => props.open ? h('div', { ref: element, role: 'dialog' }, [h('button', '关闭')]) : null;
} });

async function mount(t, { count = 3, reduced = false, active = true } = {}) {
  document.body.innerHTML = '<div id="mount"></div>'; document.body.style.cssText = ''; document.documentElement.style.cssText = '';
  const time = clock(t), observers = [], motionListeners = new Set(), documentListeners = new Map();
  let visibility = 'visible', reduce = reduced, hoveredInBrowser = false;
  t.mock.getter(document, 'visibilityState', () => visibility);
  const motion = { get matches() { return reduce; }, addEventListener: (_, listener) => motionListeners.add(listener), removeEventListener: (_, listener) => motionListeners.delete(listener) };
  t.mock.method(window, 'matchMedia', query => query.includes('prefers-reduced-motion') ? motion : { matches: true });
  const originalObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
    show(value) { this.callback([{ target: this.element, isIntersecting: value, intersectionRatio: value ? 1 : 0 }]); }
  };
  t.after(() => { if (originalObserver === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = originalObserver; });
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  t.mock.method(document, 'addEventListener', (name, listener, options) => { if (!documentListeners.has(name)) documentListeners.set(name, new Set()); documentListeners.get(name).add(listener); add(name, listener, options); });
  t.mock.method(document, 'removeEventListener', (name, listener, options) => { documentListeners.get(name)?.delete(listener); remove(name, listener, options); });
  const state = { count: ref(count), active: ref(active), modal: ref(false), secondModal: ref(false), advances: 0 };
  let api;
  const app = createApp({ setup() {
    const element = ref(null);
    api = useAutoCarousel({ element, count: () => state.count.value, active: () => state.active.value, onAdvance: () => { state.advances++; } });
    return () => h('div', [h('section', { ref: element, onPointerenter: api.onPointerEnter, onPointerleave: api.onPointerLeave,
      onPointerdown: api.onPointerDown, onPointerup: api.onPointerUp, onPointercancel: api.onPointerCancel, onFocusin: api.onFocusIn }, [
      h('button', { id: 'rotation', onClick: api.toggle }, '切换自动播放'), h('button', { id: 'manual', onClick: () => { state.advances++; api.restart(); } }, '下一张')
    ]), h(Modal, { open: state.modal.value }), h(Modal, { open: state.secondModal.value })]);
  } });
  app.mount('#mount'); await nextTick();
  const element = document.querySelector('section'), matches = element.matches.bind(element);
  t.mock.method(element, 'matches', selector => selector === ':hover' ? hoveredInBrowser : matches(selector));
  let mounted = true;
  const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
  t.after(unmount);
  return { api, state, time, observers, motionListeners, documentListeners, element, unmount,
    async visible(value) { observers.at(-1).show(value); await nextTick(); },
    async foreground(value) { visibility = value ? 'visible' : 'hidden'; document.dispatchEvent(new window.Event('visibilitychange')); await nextTick(); },
    async reduced(value) { reduce = value; for (const fn of motionListeners) fn(); await nextTick(); },
    async hover(value) { hoveredInBrowser = value; pointer(value ? 'pointerenter' : 'pointerleave', element, 'mouse'); await nextTick(); }
  };
}

test.before(() => { if (!window.matchMedia) window.matchMedia = () => ({ matches: false }); });

test('a visible carousel advances every seven seconds with one timer and manual switching resets a full cycle', async t => {
  const h = await mount(t); assert.equal(h.api.intervalMs, 7000); assert.equal(h.time.jobs.size, 0);
  await h.visible(true); assert.equal(h.api.running.value, true); assert.equal(h.time.jobs.size, 1);
  await h.time.tick(6999); assert.equal(h.state.advances, 0);
  await h.time.tick(1); assert.equal(h.state.advances, 1); assert.equal(h.time.jobs.size, 1);
  await h.time.tick(6000); document.querySelector('#manual').click(); assert.equal(h.state.advances, 2);
  await h.time.tick(1000); assert.equal(h.state.advances, 2);
  await h.time.tick(6000); assert.equal(h.state.advances, 3); assert.equal(h.time.jobs.size, 1);
});

test('zero or one slide cannot rotate, and count changes reset rather than accumulate timers', async t => {
  const h = await mount(t, { count: 0 }); await h.visible(true);
  assert.equal(h.api.canRotate.value, false); assert.equal(h.time.jobs.size, 0);
  h.state.count.value = 1; await nextTick(); await h.time.tick(14000); assert.equal(h.state.advances, 0);
  h.state.count.value = 3; await nextTick(); assert.equal(h.time.jobs.size, 1);
  await h.time.tick(6500); h.state.count.value = 2; await nextTick(); await h.time.tick(500); assert.equal(h.state.advances, 0);
  await h.time.tick(6500); assert.equal(h.state.advances, 1);
  h.state.count.value = 1; await nextTick(); assert.equal(h.time.jobs.size, 0);
});

test('user pause survives hover leave, visibility changes and page activation until explicitly resumed', async t => {
  const h = await mount(t); await h.visible(true); h.api.toggle(); await nextTick();
  assert.equal(h.api.paused.value, true); assert.equal(h.time.jobs.size, 0);
  await h.hover(true); await h.hover(false); await h.foreground(false); await h.foreground(true);
  h.state.active.value = false; await nextTick(); h.state.active.value = true; await nextTick();
  await h.time.tick(21000); assert.equal(h.state.advances, 0); assert.equal(h.api.paused.value, true);
  h.api.toggle(); await nextTick(); await h.time.tick(7000); assert.equal(h.state.advances, 1);
});

test('hover, background, offscreen and inactive states compose without catch-up advancement', async t => {
  const h = await mount(t); await h.visible(true); await h.time.tick(6000);
  await h.hover(true); await h.foreground(false); await h.hover(false); await h.time.tick(30000); assert.equal(h.state.advances, 0);
  await h.foreground(true); await h.time.tick(6999); assert.equal(h.state.advances, 0); await h.time.tick(1); assert.equal(h.state.advances, 1);
  await h.visible(false); await h.time.tick(14000); assert.equal(h.state.advances, 1);
  h.state.active.value = false; await nextTick(); await h.visible(true); assert.equal(h.time.jobs.size, 0);
  h.state.active.value = true; await nextTick(); await h.time.tick(7000); assert.equal(h.state.advances, 2);
});

test('returning from the background still respects a pointer that remains over the carousel', async t => {
  const h = await mount(t); await h.visible(true); await h.hover(true);
  await h.foreground(false); await h.foreground(true);
  assert.equal(h.api.running.value, false); assert.equal(h.time.jobs.size, 0);
  await h.hover(false); await h.time.tick(7000); assert.equal(h.state.advances, 1);
});

test('keyboard focus pauses persistently, while a pointer focus cannot reverse the first Pause click', async t => {
  const h = await mount(t); await h.visible(true);
  const rotation = document.querySelector('#rotation');
  pointer('pointerdown', rotation, 'mouse'); rotation.focus(); pointer('pointerup', rotation, 'mouse'); rotation.click(); await nextTick();
  assert.equal(h.api.paused.value, true, 'a first pointer click must pause, not accidentally resume');
  rotation.click(); await nextTick(); assert.equal(h.api.paused.value, false);
  rotation.blur(); document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); rotation.focus(); await nextTick();
  assert.equal(h.api.paused.value, true); rotation.blur(); await h.time.tick(14000); assert.equal(h.state.advances, 0);
  rotation.click(); await nextTick(); await h.time.tick(7000); assert.equal(h.state.advances, 1);
});

test('touch does not create a hover pause, and release or cancellation outside the carousel restarts the full cycle', async t => {
  const h = await mount(t); await h.visible(true); pointer('pointerenter', h.element, 'touch');
  assert.equal(h.api.running.value, true);
  pointer('pointerdown', h.element, 'touch', 10); await h.time.tick(14000); assert.equal(h.state.advances, 0);
  pointer('pointerup', document, 'touch', 10); await nextTick(); await h.time.tick(7000); assert.equal(h.state.advances, 1);
  pointer('pointerdown', h.element, 'touch', 11); pointer('pointercancel', document, 'touch', 11); await nextTick();
  await h.time.tick(7000); assert.equal(h.state.advances, 2);
});

test('leaving a page clears an interrupted pointer gesture so returning cannot remain stuck paused', async t => {
  const h = await mount(t); await h.visible(true); pointer('pointerdown', h.element, 'touch', 8);
  h.state.active.value = false; await nextTick(); h.state.active.value = true; await nextTick();
  assert.equal(h.api.running.value, true); await h.time.tick(7000); assert.equal(h.state.advances, 1);
});

test('reduced motion defaults to static, explicit resume is allowed, and later default-policy changes are observed', async t => {
  const h = await mount(t, { reduced: true }); await h.visible(true);
  assert.equal(h.api.paused.value, true); assert.equal(h.time.jobs.size, 0);
  h.api.toggle(); await nextTick(); await h.time.tick(7000); assert.equal(h.state.advances, 1);
  await h.reduced(false); await h.reduced(true); assert.equal(h.api.paused.value, false, 'explicit opt-in remains explicit');
  h.api.toggle(); await nextTick(); await h.reduced(false); assert.equal(h.api.paused.value, true, 'OS preference changes cannot clear user pause');
});

test('read-only dialog count pauses carousel timers until the last nested dialog is released', async t => {
  const h = await mount(t); await h.visible(true); assert.equal(isReadonly(dialogOpenCount), true); assert.equal(dialogOpenCount.value, 0);
  h.state.modal.value = true; await nextTick(); await h.time.tick(0); // JSDOM focus dispatches selectionchange in a zero-delay task.
  assert.equal(dialogOpenCount.value, 1); assert.equal(h.api.running.value, false); assert.equal(h.time.jobs.size, 0);
  h.state.secondModal.value = true; await nextTick(); assert.equal(dialogOpenCount.value, 2);
  h.state.modal.value = false; await nextTick(); await h.time.tick(0); assert.equal(dialogOpenCount.value, 1); assert.equal(h.time.jobs.size, 0);
  h.state.secondModal.value = false; await nextTick(); assert.equal(dialogOpenCount.value, 0);
  await h.time.tick(7000); assert.equal(h.state.advances, 1);
});

test('unmount clears the timer, observers and listeners, and late visibility callbacks cannot re-arm it', async t => {
  const h = await mount(t); await h.visible(true); assert.equal(h.time.jobs.size, 1); assert.equal(h.motionListeners.size, 1);
  h.unmount(); assert.equal(h.time.jobs.size, 0); assert.equal(h.motionListeners.size, 0);
  assert.ok(h.observers.every(observer => observer.disconnected));
  for (const name of ['visibilitychange', 'keydown', 'pointerup', 'pointercancel']) assert.equal(h.documentListeners.get(name)?.size || 0, 0, name);
  h.observers[0].show(true); await h.time.tick(21000); assert.equal(h.state.advances, 0);
});
