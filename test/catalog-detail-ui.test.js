import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const observers = [];
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe(node) { this.node = node; } disconnect() {} };
const { createApp, ref, reactive, h, nextTick } = await import('vue');
await fs.mkdir('.local-runtime/tests', { recursive: true });
const folder = await fs.mkdtemp('.local-runtime/tests/detail-ui-');
const vuePlugin = { name: 'test-vue', setup(builder) {
  builder.onLoad({ filter: /\.vue$/ }, async args => {
    const source = await fs.readFile(args.path, 'utf8');
    const compiled = compileScript(parse(source).descriptor, { id: args.path, inlineTemplate: true });
    return { contents: compiled.content, loader: 'ts', resolveDir: path.dirname(args.path) };
  });
} };
const output = path.resolve(folder, 'detail.mjs');
await build({ entryPoints: ['src/components/catalog/CatalogDetail.vue'], outfile: output, bundle: true, format: 'esm', external: ['vue'], plugins: [vuePlugin], define: { 'import.meta.env.BASE_URL': '"/misty-rain/"' }, logLevel: 'silent' });
const Detail = (await import(pathToFileURL(output))).default;
const loaderOutput = path.resolve(folder, 'loader.mjs');
await build({ entryPoints: ['src/composables/useCatalogDetails.ts'], outfile: loaderOutput, bundle: true, format: 'esm', external: ['vue'], define: { 'import.meta.env.BASE_URL': '"/misty-rain/"' }, logLevel: 'silent' });
const { useCatalogDetails } = await import(pathToFileURL(loaderOutput));
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); await nextTick(); };
const meta = { updatedAt: '2026-11-03T00:00:00.000Z', stale: false, refreshing: false, message: '', sourceName: '豆瓣', sourceUrl: 'https://movie.douban.com/subject/123/' };
const item = { id: 'douban:123', catalogId: 'douban:123', title: '测试剧', year: '2026', poster: '', category: 'tv', tag: '', subtitle: '2026 / 中国大陆 / 剧情', sourceName: '豆瓣', sourceUrl: meta.sourceUrl };
const actors = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), name: '演员' + (i + 1), role: '饰 角色' + (i + 1), latinName: '', avatar: '/api/catalog/people/' + (i + 1) + '/portrait' }));
const work = { ...meta, catalogId: item.catalogId, title: item.title, summary: '这是一部测试剧的剧情简介。'.repeat(20), genres: ['剧情'], countries: ['中国大陆'], languages: [], releaseDates: [], durations: [], directors: [], actors };
const person = { ...meta, id: '1', name: '演员1', latinName: 'Actor One', avatar: actors[0].avatar, description: '演员 / 代表作甲', info: [{ label: '出生地', value: '中国' }] };
const comments = (start = 0) => ({ ...meta, catalogId: item.catalogId, start, total: 20, hasMore: start === 0,
  items: Array.from({ length: 10 }, (_, i) => ({ id: String(start + i), text: '公开短评 ' + (start + i), author: '观众' + i, rating: 4, upvotes: 10, createdAt: '2026-11-03 12:00:00' })) });
const ok = data => Response.json({ code: 0, data });
const fixtures = async input => {
  const url = new URL(input, 'http://localhost');
  assert.ok(url.pathname.startsWith('/misty-rain/api/catalog/'));
  if (url.pathname.endsWith('/comments')) return ok(comments(Number(url.searchParams.get('start'))));
  if (url.pathname.includes('/people/')) return ok(person);
  return ok(work);
};
function mount() {
  document.body.innerHTML = '<div id="app"></div>'; observers.length = 0;
  let plays = 0, closes = 0;
  const props = reactive({ item, inLibrary: false });
  const app = createApp({ render: () => h(Detail, { ...props, onPlay: () => { plays++; }, onClose: () => { closes++; } }) });
  app.mount('#app');
  return { app, props, get plays() { return plays; }, get closes() { return closes; } };
}

test('plot overflow expands, cast loads on demand, person details restore focus and play stays available', async t => {
  t.mock.method(globalThis, 'fetch', fixtures);
  const view = mount();
  try {
    await flush();
    assert.match(document.querySelector('.detail-synopsis').textContent, /剧情简介/);
    const summary = document.querySelector('.detail-synopsis p');
    Object.defineProperty(summary, 'scrollHeight', { value: 240 }); Object.defineProperty(summary, 'clientHeight', { value: 80 });
    observers.find(observer => observer.node === summary).cb(); await nextTick();
    document.querySelector('.summary-toggle').click(); await nextTick(); assert.equal(document.querySelector('.summary-clamped'), null);
    assert.equal(document.querySelectorAll('.credit-card').length, 8);
    document.querySelector('.credits-toggle').click(); await nextTick(); assert.equal(document.querySelectorAll('.credit-card').length, 10);
    const trigger = document.querySelector('.credit-card'); trigger.focus(); trigger.click(); await flush();
    assert.match(document.querySelector('.person-insight').textContent, /演员 \/ 代表作甲/);
    assert.equal(document.querySelector('.catalog-detail a[href]'), null);
    assert.match(document.querySelector('.person-insight img').getAttribute('src'), /^\/misty-rain\/api\/catalog\/people\/1\/portrait$/);
    document.querySelector('.person-insight').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick(); assert.equal(document.querySelector('.person-insight'), null); assert.equal(view.closes, 0); assert.equal(document.activeElement, trigger);
    document.querySelector('.play-feature').click(); assert.equal(view.plays, 1);
  } finally { view.app.unmount(); }
  assert.equal(document.body.style.overflow, '');
});

test('short reviews append pages, preserve already loaded rows on failure and retry the failed offset', async t => {
  let fail = true; const requested = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('/comments')) {
      const start = Number(url.searchParams.get('start')); requested.push(start);
      if (start === 10 && fail) throw Error('offline');
    }
    return fixtures(input);
  });
  const view = mount();
  try {
    await flush(); assert.equal(document.querySelectorAll('.comment-item').length, 10);
    document.querySelector('.catalog-comments .more-films').click(); await flush();
    assert.equal(document.querySelectorAll('.comment-item').length, 10); assert.ok(document.querySelector('.comments-feedback'));
    fail = false;
    document.querySelector('.catalog-comments .more-films').click(); await flush();
    assert.equal(document.querySelectorAll('.comment-item').length, 20); assert.deepEqual(requested, [0, 10, 10]);
    assert.equal(document.querySelector('.catalog-comments .more-films'), null);
  } finally { view.app.unmount(); }
});

test('metadata outages do not prevent playback and do not insert untrusted HTML', async t => {
  t.mock.method(globalThis, 'fetch', async input => String(input).includes('/comments')
    ? ok({ ...comments(), items: [{ ...comments().items[0], author: '<img src=x>', text: '<script>unsafe()</script>' }], hasMore: false })
    : Promise.reject(Error('offline')));
  const view = mount();
  try {
    await flush(); assert.ok(document.querySelector('.metadata-feedback'));
    assert.equal(document.querySelector('script'), null); assert.equal(document.querySelector('.comment-author img'), null);
    assert.match(document.querySelector('.comment-text').textContent, /<script>/);
    document.querySelector('.play-feature').click(); assert.equal(view.plays, 1);
  } finally { view.app.unmount(); }
});

test('switching subjects aborts old requests and late results cannot overwrite the next subject', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => { requests.push({ url, signal: options.signal, resolve }); }));
  document.body.innerHTML = '<div id="app"></div>';
  const url = ref('/api/catalog/works/1'); let state;
  const app = createApp({ setup() { state = useCatalogDetails(() => url.value, value => value); return () => h('div'); } });
  app.mount('#app');
  try {
    url.value = '/api/catalog/works/2'; await nextTick();
    assert.equal(requests[0].signal.aborted, true);
    requests[1].resolve(ok({ ...meta, title: '第二部' })); await flush();
    requests[0].resolve(ok({ ...meta, title: '迟到的第一部' })); await flush();
    assert.equal(state.data.value.title, '第二部');
  } finally { app.unmount(); }
  assert.equal(requests[1].signal.aborted, true);
});

test.after(async () => { dom.window.close(); delete globalThis.ResizeObserver; await fs.rm(folder, { recursive: true, force: true }); });
