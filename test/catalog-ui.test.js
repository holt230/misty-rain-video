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
const { createApp, ref, h, nextTick } = await import('vue');
await fs.mkdir('.local-runtime/tests', { recursive: true });
const directory = await fs.mkdtemp('.local-runtime/tests/catalog-ui-');
const output = path.resolve(directory, 'catalog.mjs');
await build({ entryPoints: ['src/composables/useCatalog.ts'], outfile: output, bundle: true, format: 'esm', external: ['vue'], define: { 'import.meta.env.BASE_URL': '"/misty-rain/"' }, logLevel: 'silent' });
const { useCatalog } = await import(pathToFileURL(output));
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

test('cached catalog refresh replaces visible data without reloading and stops after logout', async t => {
  const timers = [];
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 4000) { timers.push(callback); return 0; }
    return originalTimeout(callback, delay, ...args);
  });
  let tvReads = 0, calls = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    calls++;
    assert.ok(String(input).startsWith('/misty-rain/api/catalog?'));
    const channel = new URL(input, 'http://localhost').searchParams.get('channel');
    if (channel === 'tv') tvReads++;
    return Response.json({ code: 0, data: { channel, items: [{ id: 'douban:1', title: tvReads > 1 ? '更新后的剧集' : '旧剧集', poster: '/api/catalog/posters/1' }], updatedAt: new Date().toISOString(), stale: channel === 'tv' && tvReads === 1, refreshing: channel === 'tv' && tvReads === 1, message: '' } });
  });
  const enabled = ref(true);
  let catalog;
  document.body.innerHTML = '<div id="app"></div>';
  const app = createApp({ setup() { catalog = useCatalog(enabled); return () => h('div'); } });
  app.mount('#app');
  try {
    await flush();
    assert.equal(catalog.feeds.value.tv.items[0].title, '旧剧集');
    assert.equal(catalog.feeds.value.tv.items[0].poster, '/misty-rain/api/catalog/posters/1');
    assert.equal(timers.length, 1);
    const followup = timers.shift();
    followup(); await flush();
    assert.equal(catalog.feeds.value.tv.items[0].title, '更新后的剧集');
    assert.equal(catalog.feeds.value.tv.refreshing, false);
    enabled.value = false; await nextTick();
    const count = calls; followup(); await flush();
    assert.equal(calls, count);
  } finally { app.unmount(); }
});

const pageItems = (start, count = 24) => Array.from({ length: count }, (_, i) => ({ id: 'douban:' + (start + i), catalogId: 'douban:' + (start + i), title: '影片' + (start + i), poster: '/api/catalog/posters/' + (start + i), category: 'tv' }));
const catalogPage = (channel, page = 1, items = pageItems(1), revision = 'aaaaaaaaaaaaaaaa', hasMore = true) => Response.json({ code: 0, data: { channel, page, items: channel === 'tv' ? items : [], revision, hasMore: channel === 'tv' && hasMore, updatedAt: '2026-11-03T00:00:00Z', stale: false, refreshing: false, message: '' } });
function mountCatalog() {
  document.body.innerHTML = '<div id="app"></div>';
  const enabled = ref(true); let catalog;
  const app = createApp({ setup() { catalog = useCatalog(enabled); return () => h('div'); } }); app.mount('#app');
  return { app, enabled, get catalog() { return catalog; } };
}
test('later pages deduplicate, failed loads retry the same page, and double clicks do not duplicate requests', async t => {
  const requested = []; let fail = true;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input, 'http://localhost'), channel = url.searchParams.get('channel'), page = Number(url.searchParams.get('page'));
    if (channel === 'tv' && page > 1) {
      requested.push(page); assert.equal(url.searchParams.get('revision'), 'aaaaaaaaaaaaaaaa');
      if (fail) throw Error('offline');
      return catalogPage(channel, page, page === 2 ? pageItems(24) : pageItems(48, 2), 'aaaaaaaaaaaaaaaa', page === 2);
    }
    return catalogPage(channel);
  });
  const view = mountCatalog();
  try {
    await flush();
    await Promise.all([view.catalog.loadMore('tv'), view.catalog.loadMore('tv')]);
    assert.deepEqual(requested, [2]); assert.equal(view.catalog.browse.value.tv.items.length, 24); assert.equal(view.catalog.browse.value.tv.page, 1);
    fail = false; await view.catalog.loadMore('tv');
    assert.deepEqual(requested, [2, 2]); assert.equal(view.catalog.browse.value.tv.items.length, 47); assert.equal(view.catalog.browse.value.tv.page, 2);
    assert.match(view.catalog.browse.value.tv.items[24].poster, /^\/misty-rain\/api/);
    assert.equal(view.catalog.feeds.value.tv.items.length, 24);
    await view.catalog.loadMore('tv'); assert.equal(view.catalog.browse.value.tv.items.length, 49); assert.equal(view.catalog.browse.value.tv.hasMore, false);
    await view.catalog.loadMore('tv'); assert.deepEqual(requested, [2, 2, 3]);
  } finally { view.app.unmount(); }
});
test('a changed directory preserves the visible list until the user refreshes the channel', async t => {
  let changed = false, moreCalls = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input, 'http://localhost'), channel = url.searchParams.get('channel'), page = Number(url.searchParams.get('page'));
    if (channel === 'tv' && page > 1) { moreCalls++; return Response.json({ code: 'CATALOG_CHANGED', message: '目录更新' }, { status: 409 }); }
    return catalogPage(channel, page, pageItems(changed ? 100 : 1), changed ? 'bbbbbbbbbbbbbbbb' : 'aaaaaaaaaaaaaaaa');
  });
  const view = mountCatalog();
  try {
    await flush(); await view.catalog.loadMore('tv');
    assert.equal(view.catalog.browse.value.tv.items[0].id, 'douban:1'); assert.equal(view.catalog.browse.value.tv.needsRefresh, true);
    await view.catalog.loadMore('tv'); assert.equal(moreCalls, 1);
    changed = true; await view.catalog.refreshChannel('tv');
    assert.equal(view.catalog.browse.value.tv.items[0].id, 'douban:100'); assert.equal(view.catalog.browse.value.tv.needsRefresh, false);
    assert.equal(view.catalog.browse.value.tv.page, 1);
  } finally { view.app.unmount(); }
});
test('refreshing cancels a pending next page and logout cannot be undone by late pagination responses', async t => {
  const pending = []; let revision = 'aaaaaaaaaaaaaaaa';
  t.mock.method(globalThis, 'fetch', (input, options) => {
    const url = new URL(input, 'http://localhost'), channel = url.searchParams.get('channel'), page = Number(url.searchParams.get('page'));
    if (channel === 'tv' && page > 1) return new Promise(resolve => pending.push({ resolve, signal: options.signal, revision }));
    return Promise.resolve(catalogPage(channel, page, pageItems(revision.startsWith('b') ? 100 : 1), revision));
  });
  const view = mountCatalog();
  try {
    await flush(); const old = view.catalog.loadMore('tv');
    revision = 'bbbbbbbbbbbbbbbb'; await view.catalog.refreshChannel('tv');
    assert.equal(pending[0].signal.aborted, true);
    pending[0].resolve(catalogPage('tv', 2, pageItems(25), pending[0].revision)); await old;
    assert.equal(view.catalog.browse.value.tv.items.length, 24); assert.equal(view.catalog.browse.value.tv.items[0].id, 'douban:100');
    const next = view.catalog.loadMore('tv'); view.enabled.value = false; await nextTick();
    assert.equal(pending[1].signal.aborted, true);
    pending[1].resolve(catalogPage('tv', 2, pageItems(124), pending[1].revision)); await next;
    assert.deepEqual(view.catalog.browse.value, {}); assert.deepEqual(view.catalog.feeds.value, {});
  } finally { view.app.unmount(); }
});

const componentSource = await fs.readFile('src/components/quark/QuarkResourceDetails.vue', 'utf8');
const compiled = compileScript(parse(componentSource).descriptor, { id: 'resource-directory-test', inlineTemplate: true });
const detailFile = path.resolve(directory, 'details.mjs');
await build({ stdin: { contents: compiled.content, loader: 'ts', resolveDir: path.resolve('src/components/quark') }, outfile: detailFile, bundle: true, format: 'esm', external: ['vue'], define: { 'import.meta.env.BASE_URL': '"/misty-rain/"' }, logLevel: 'silent' });
const Details = (await import(pathToFileURL(detailFile))).default;

test('resource back navigation climbs folders before returning to search results', async t => {
  const entries = [
    { fid: 'a', parentFid: '0', ancestorFids: [], name: '正片', isDirectory: true, isVideo: false, videoCount: 1 },
    { fid: 'b', parentFid: 'a', ancestorFids: ['a'], name: '第一季', isDirectory: true, isVideo: false, videoCount: 1 },
    { fid: 'c', parentFid: 'b', ancestorFids: ['a', 'b'], name: '第01集.mp4', isDirectory: false, isVideo: true, sizeFormatted: '1 MB', videoCount: 0 }
  ];
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads++;
    return Response.json({ code: 0, data: { title: '测试剧', videoCount: 1, episodeCount: 1, entries } });
  });
  document.body.innerHTML = '<div id="app"></div>';
  const app = createApp(Details, { resource: { id: 'test', title: '测试剧', url: 'https://pan.quark.cn/s/test123' } });
  const vm = app.mount('#app');
  try {
    await flush();
    document.querySelector('.folder-name').click(); await nextTick();
    document.querySelector('.folder-name').click(); await nextTick();
    assert.match(document.querySelector('.file-name').textContent, /第01集/);
    assert.equal(vm.dismissFolder(), true); await nextTick();
    assert.match(document.querySelector('.folder-name').textContent, /第一季/);
    assert.equal(vm.dismissFolder(), true); await nextTick();
    assert.match(document.querySelector('.folder-name').textContent, /正片/);
    assert.equal(vm.dismissFolder(), false);
    assert.equal(reads, 1);
  } finally { app.unmount(); }
});
const dialogOutput = path.resolve(directory, 'dialog.mjs');
await build({ entryPoints: ['src/composables/useDialog.ts'], outfile: dialogOutput, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { useDialog } = await import(pathToFileURL(dialogOutput));

test('Escape closes only the top dialog and restores focus before closing the player on the next Escape', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const outerOpen = ref(true), innerOpen = ref(false), outer = ref(null), inner = ref(null);
  let laterListenerCalls = 0;
  const laterListener = () => { laterListenerCalls++; };
  const app = createApp({ setup() {
    // Player sheets register before the containing player dialog.
    useDialog(inner, () => innerOpen.value, () => { innerOpen.value = false; });
    useDialog(outer, () => outerOpen.value, () => { outerOpen.value = false; });
    return () => outerOpen.value ? h('section', { ref: outer }, [
      h('button', { id: 'open-settings', onClick: () => { innerOpen.value = true; } }, '设置'),
      innerOpen.value ? h('aside', { ref: inner }, '设置内容') : null
    ]) : null;
  } });
  app.mount('#app'); await nextTick(); await nextTick();
  document.addEventListener('keydown', laterListener, true);
  try {
    const trigger = document.querySelector('#open-settings'); trigger.focus(); trigger.click();
    await nextTick(); await nextTick();
    assert.equal(document.activeElement, inner.value);
    inner.value.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick();
    assert.equal(innerOpen.value, false); assert.equal(outerOpen.value, true);
    assert.equal(laterListenerCalls, 0);
    assert.equal(document.activeElement, trigger);
    assert.equal(document.body.style.overflow, 'hidden');
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick(); assert.equal(outerOpen.value, false); assert.equal(document.body.style.overflow, '');
  } finally { document.removeEventListener('keydown', laterListener, true); app.unmount(); }
});

test.after(async () => { dom.window.close(); await fs.rm(directory, { recursive: true, force: true }); });
