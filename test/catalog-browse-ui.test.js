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
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
HTMLElement.prototype.scrollIntoView = () => {};
Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
window.scrollTo = options => { window.scrollY = options.top || 0; };
const { createApp, reactive, h, nextTick } = await import('vue');
await fs.mkdir('.local-runtime/tests', { recursive: true });
const dir = await fs.mkdtemp('.local-runtime/tests/catalog-browse-');
const output = path.resolve(dir, 'home.mjs');
await build({ entryPoints: ['src/components/catalog/HomePage.vue'], outfile: output, bundle: true, format: 'esm', external: ['vue'], define: { 'import.meta.env.BASE_URL': '"/misty-rain/"' }, logLevel: 'silent', plugins: [{ name: 'test-vue', setup(builder) {
  builder.onLoad({ filter: /\.vue$/ }, async args => ({ contents: compileScript(parse(await fs.readFile(args.path, 'utf8')).descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) }));
} }] });
const Home = (await import(pathToFileURL(output))).default;
const item = n => ({ id: 'douban:' + n, catalogId: 'douban:' + n, title: '影片' + n, category: 'tv', poster: '', year: '2026', subtitle: '剧情', sourceUrl: '', tag: '' });
const items = (count, start = 1) => Array.from({ length: count }, (_, i) => item(start + i));
const tick = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 10)); await nextTick(); };
const channel = name => [...document.querySelectorAll('.channel-nav button')].find(button => button.textContent === name);
function mount() {
  document.body.innerHTML = '<div id="app"></div>'; window.scrollY = 0;
  const feeds = Object.fromEntries(['tv', 'movie', 'anime', 'variety', 'new'].map((id, i) => [id, { channel: id, items: items(24, i * 100 + 1), updatedAt: '2026-11-03T00:00:00Z', message: '' }]));
  const browse = Object.fromEntries(Object.entries(feeds).map(([id, feed]) => [id, { items: id === 'tv' ? items(48) : feed.items, page: id === 'tv' ? 2 : 1, revision: 'aaaaaaaaaaaaaaaa', hasMore: true, loading: false, error: '', needsRefresh: false, endMessage: '' }]));
  const props = reactive({ feeds, browse, loading: [], library: [], history: [], active: false });
  const loads = [], refreshes = [];
  const app = createApp({ render: () => h(Home, { ...props, onLoadMore: id => loads.push(id), onRefreshChannel: id => refreshes.push(id) }) }); app.mount('#app');
  return { app, props, loads, refreshes };
}
test('featured view stays at six per category, full channels retain loaded items and scroll positions independently', async () => {
  const v = mount();
  try {
    assert.deepEqual([...document.querySelectorAll('.catalog-grid')].map(grid => grid.children.length), [6, 6, 6, 6, 6]);
    window.scrollY = 120; channel('电视剧').click(); await tick();
    assert.equal(window.scrollY, 0); assert.equal(document.querySelectorAll('.catalog-card').length, 48);
    window.scrollY = 850; document.querySelector('.catalog-page-footer .more-films').click(); assert.deepEqual(v.loads, ['tv']);
    v.props.browse.tv.items.push(...items(24, 49)); await tick(); assert.equal(window.scrollY, 850); assert.equal(document.querySelectorAll('.catalog-card').length, 72);
    channel('电影').click(); await tick(); assert.equal(window.scrollY, 0);
    window.scrollY = 400; channel('电视剧').click(); await tick(); assert.equal(window.scrollY, 850); assert.equal(document.querySelectorAll('.catalog-card').length, 72);
    channel('精选').click(); await tick(); assert.equal(window.scrollY, 120); assert.equal(document.querySelectorAll('.catalog-card').length, 30);
  } finally { v.app.unmount(); }
});
test('loading, retry, end and changed-directory states keep the list and expose the right next action', async () => {
  const v = mount();
  try {
    channel('电视剧').click(); await tick();
    v.props.browse.tv.loading = true; await tick(); assert.equal(document.querySelector('.catalog-page-footer .more-films').disabled, true);
    v.props.browse.tv.loading = false; v.props.browse.tv.error = '加载失败'; await tick();
    assert.match(document.querySelector('.catalog-page-footer .more-films').textContent, /重试/); assert.equal(document.querySelectorAll('.catalog-card').length, 48);
    v.props.browse.tv.needsRefresh = true; await tick();
    assert.equal(document.querySelector('.catalog-page-footer .more-films'), null); document.querySelector('.catalog-update-note button').click(); assert.deepEqual(v.refreshes, ['tv']);
    v.props.browse.tv.needsRefresh = false; v.props.browse.tv.error = ''; v.props.browse.tv.hasMore = false; v.props.browse.tv.endMessage = '已显示全部可用影片'; await tick();
    assert.match(document.querySelector('.catalog-page-footer').textContent, /全部可用/); assert.equal(document.querySelector('.catalog-page-footer .more-films'), null);
  } finally { v.app.unmount(); }
});
test.after(async () => { dom.window.close(); await fs.rm(dir, { recursive: true, force: true }); });
