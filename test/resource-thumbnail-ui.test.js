import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';

const dom = new JSDOM('<div id="mount"></div>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
const { createApp, h, nextTick, ref } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/resource-thumbnail-');
const outfile = path.resolve(folder, 'thumbnail.mjs');
await build({ entryPoints: ['src/components/quark/ResourceThumbnail.vue'], outfile, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent',
  plugins: [{ name: 'vue', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
    const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
    return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
  }); } }] });
const Thumbnail = (await import(pathToFileURL(outfile))).default;
const observe = () => {
  const observers = [];
  window.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    intersect(isIntersecting = true) { this.callback([{ target: this.target, isIntersecting }]); }
  };
  return observers;
};
const mount = render => {
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render }); app.mount('#mount'); return app;
};

test('a 24-episode list assigns image sources only to visible rows, and scroll loads each image once', async t => {
  const observers = observe();
  const app = mount(() => h('div', Array.from({ length: 24 }, (_, i) => h(Thumbnail, { src: `/thumbnail/${i}`, video: true }))));
  t.after(() => app.unmount());
  assert.equal(document.querySelectorAll('img[src]').length, 0, 'native lazy loading must not prefetch offscreen episode requests');
  assert.equal(observers.length, 24);
  observers[0].intersect(false); await nextTick(); assert.equal(document.querySelectorAll('img').length, 0);
  for (const observer of observers.slice(0, 3)) observer.intersect();
  await nextTick(); assert.equal(document.querySelectorAll('img[src]').length, 3);
  assert.ok(observers.slice(0, 3).every(observer => observer.disconnected));
  assert.ok(observers.every(observer => observer.options.rootMargin === '0px'));
  observers[3].intersect(); await nextTick(); assert.equal(document.querySelectorAll('img[src]').length, 4);
  const image = document.querySelector('img'); image.dispatchEvent(new window.Event('error')); await nextTick();
  observers[0].intersect(); await nextTick(); assert.equal(document.querySelectorAll('img[src]').length, 3, 'a failed image remains a stable placeholder');
});

test('changing a thumbnail resets visibility and failure; obsolete callbacks and unmounted rows cannot start loads', async t => {
  const observers = observe(), src = ref('/thumbnail/old');
  const app = mount(() => h(Thumbnail, { src: src.value, video: true }));
  t.after(() => { if (app._instance) app.unmount(); });
  observers[0].intersect(); await nextTick();
  document.querySelector('img').dispatchEvent(new window.Event('error')); await nextTick();
  assert.equal(document.querySelector('img'), null);
  src.value = '/thumbnail/new'; await nextTick();
  assert.equal(document.querySelector('img'), null); assert.equal(observers.length, 2);
  observers[0].intersect(); await nextTick(); assert.equal(document.querySelector('img'), null);
  observers[1].intersect(); await nextTick(); assert.equal(document.querySelector('img').getAttribute('src'), '/thumbnail/new');
  src.value = '/thumbnail/never-visible'; await nextTick(); app.unmount();
  assert.equal(observers[2].disconnected, true); observers[2].intersect(); await nextTick();
  assert.equal(document.querySelector('img'), null);
});

test('browsers without intersection observers retain native lazy images and empty sources remain placeholders', async t => {
  delete window.IntersectionObserver;
  const app = mount(() => h('div', [h(Thumbnail, { src: '/thumbnail/legacy' }), h(Thumbnail, { src: '' })]));
  t.after(() => app.unmount()); await nextTick();
  assert.equal(document.querySelectorAll('img').length, 1); assert.equal(document.querySelector('img').getAttribute('loading'), 'lazy');
  assert.equal(document.querySelectorAll('.resource-thumbnail').length, 2);
});
