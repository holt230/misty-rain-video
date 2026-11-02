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
