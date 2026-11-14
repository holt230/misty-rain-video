import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from 'vue/compiler-sfc';
import { build } from 'esbuild';
import { ResourceSearchService } from '../server/resourceSearch.js';

// Replay the observed production response through the real backend, client,
// and result-list component. Only visual child components are stubbed.
const rows = [
  { note: '2025最新动画.仙逆剧场版.神临之战.4k.国语中字', url: 'https://pan.quark.cn/s/movie1', source: 'plugin:quarktv' },
  { note: '仙逆.年番2‎.2025.1080p.2160p【含2023第一季以及2024年番1】【更新第89集】', url: 'https://pan.quark.cn/s/series1', source: 'plugin:quarktv' },
  { note: '🎞️ 仙逆', url: 'https://pan.qoark.cn/s/xn', source: 'plugin:quarksoo' },
  { note: '《仙逆剧场版 神临之战》夸克网盘下载链接', url: 'https://pan.quark.cn/s/movie2', source: 'plugin:quark4k' }
];
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'Document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'CustomEvent']) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const { createApp, nextTick, reactive, h } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const directory = fs.mkdtempSync('.local-runtime/tests/search-pipeline-');
after(() => { fs.rmSync(directory, { recursive: true, force: true }); dom.window.close(); });
const filename = 'src/components/quark/QuarkTransferModal.vue';
const compiled = compileScript(parse(fs.readFileSync(filename, 'utf8')).descriptor, { id: 'search-pipeline', inlineTemplate: true });
const output = path.resolve(directory, 'modal.mjs');
await build({ stdin: { contents: compiled.content, loader: 'ts', resolveDir: path.resolve('src/components/quark'), sourcefile: filename },
  bundle: true, outfile: output, format: 'esm', platform: 'browser', external: ['vue'],
  define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  plugins: [{ name: 'visual-children', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default { render() { return null; } };', loader: 'js' }));
  } }]
});
const Modal = (await import(pathToFileURL(output))).default;
const clientCode = await build({ entryPoints: ['src/services/silentSearchEngine.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node', define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent' });
const { SilentSearchEngine } = await import(`data:text/javascript;base64,${Buffer.from(clientCode.outputFiles[0].text).toString('base64')}`);

test('生产结果保留全部候选，动漫默认展示正篇，剧场版可展开查看', async t => {
  const gateway = new ResourceSearchService({ urls: ['https://fixture.invalid/search'], source: 'plugin',
    fetchImpl: async () => Response.json({ code: 0, data: { merged_by_type: { quark: rows } } }) });
  const normalized = await gateway.search('仙逆');
  assert.equal(normalized.total, 3);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: normalized }));
  const client = await new SilentSearchEngine().search('仙逆');
  assert.equal(client.items.length, 3);
  document.body.innerHTML = '<div id="app"></div>';
  const props = reactive({ isOpen: true, isAnalyzing: false, currentCategory: 'anime', searchKeyword: '仙逆',
    media: { id: 'test', title: '仙逆', category: 'anime', poster: '' }, quarkResources: [client.items[2]] });
  const app = createApp({ render: () => h(Modal, props) });
  app.mount('#app');
  try {
    await nextTick();
    assert.equal(document.querySelectorAll('.liquid-resource-row').length, 0);
    props.quarkResources = client.items;
    await nextTick();
    assert.equal(document.querySelectorAll('.liquid-resource-row').length, 1);
    assert.match(document.querySelector('.resource-rows').textContent, /更新第89集/);
    assert.equal(document.querySelector('.result-summary strong').textContent, '1');
    document.querySelector('.result-versions button').click(); await nextTick();
    assert.equal(document.querySelectorAll('.liquid-resource-row').length, 3);
  } finally { app.unmount(); }
});

test('动漫结果在推荐、最新、4K 和完整列表均不混入壁纸、音频、同名短剧与二创', async t => {
  const notes = [
    '仙逆 4K 更新162集',
    '仙逆 全162集 4K',
    '【短剧】仙逆（115集）谢蕊伊&王镱深',
    '【仙逆】更245集，1080P，B站沙雕版 免充电看，奇遇王富贵，小作坊解说视频【40+GB】',
    '仙逆 4K 混剪视频 全162集',
    '剑仙归来：谁让这剑仙逆世重修的？ 第七季（89集）',
    '仙逆-云韵4K精美壁纸 全162集',
    '仙逆 4K 写真图集',
    '仙逆 原声带 FLAC'
  ];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { merged_by_type: { quark:
    notes.map((note, index) => ({ note, url: `https://pan.quark.cn/s/content${index}` })) } } }));
  const client = await new SilentSearchEngine().search('仙逆');
  assert.equal(client.items.length, 3);
  document.body.innerHTML = '<div id="app"></div>';
  const props = reactive({ isOpen: true, isAnalyzing: false, currentCategory: 'anime', searchKeyword: '仙逆',
    media: { id: 'anime-content-test', title: '仙逆', category: 'anime', poster: '' }, quarkResources: client.items });
  const app = createApp({ render: () => h(Modal, props) });
  app.mount('#app');
  try {
    for (const [label, count] of [['推荐', 2], ['最新', 2], ['4K', 2], ['完整', 1]]) {
      [...document.querySelectorAll('[role="radio"]')].find(button => button.textContent.trim() === label).click();
      await nextTick();
      assert.equal(document.querySelectorAll('.liquid-resource-row').length, count);
      assert.doesNotMatch(document.querySelector('.resource-rows').textContent, /壁纸|写真|原声带|短剧|沙雕|解说|混剪|剑仙归来/);
      assert.equal(document.querySelector('.result-summary strong').textContent, '2');
    }
  } finally { app.unmount(); }
});

test('检索中可以编辑并提交新关键词，同词重复提交和保存中操作会被阻止', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const searched = [];
  const props = reactive({ isOpen: true, isAnalyzing: true, searchPending: true, currentCategory: 'tv', searchKeyword: '旧搜索',
    media: { id: 'search-form-test', title: '旧搜索', category: 'tv', poster: '' }, quarkResources: [], isSaving: false });
  const app = createApp({ render: () => h(Modal, { ...props, onSearch: keyword => searched.push(keyword) }) });
  app.mount('#app');
  try {
    await nextTick();
    const input = document.querySelector('.result-search input'), submit = document.querySelector('.submit-search-button');
    assert.equal(input.disabled, false); assert.equal(submit.disabled, true);
    input.value = '新搜索'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await nextTick();
    assert.equal(submit.disabled, false); assert.equal(submit.textContent, '搜索');
    submit.click(); await nextTick(); assert.deepEqual(searched, ['新搜索']);
    props.isSaving = true; await nextTick();
    assert.equal(input.disabled, true); assert.equal(submit.disabled, true);
  } finally { app.unmount(); }
});

test('新搜索重置筛选和滚动位置，避免沿用4K筛选而把新结果藏起来', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const resource = { id: 'old', title: '旧搜索 4K', url: 'https://pan.quark.cn/s/old', is4k: true, quality: '4K', datetime: '2026-11-09' };
  const props = reactive({ isOpen: true, isAnalyzing: false, currentCategory: 'tv', searchKeyword: '旧搜索',
    media: { id: 'search-reset-test', title: '旧搜索', category: 'tv', poster: '' }, quarkResources: [resource] });
  const app = createApp({ render: () => h(Modal, props) }); app.mount('#app');
  try {
    await nextTick();
    [...document.querySelectorAll('[role="radio"]')].find(button => button.textContent === '4K').click(); await nextTick();
    document.querySelector('.dialog-body').scrollTop = 600;
    props.searchKeyword = '新搜索';
    props.quarkResources = [{ ...resource, id: 'new', title: '新搜索 1080P', url: 'https://pan.quark.cn/s/new', is4k: false, quality: '1080P' }];
    await nextTick();
    assert.equal(document.querySelector('[role="radio"][aria-checked="true"]').textContent, '推荐');
    assert.equal(document.querySelector('.dialog-body').scrollTop, 0);
    assert.equal(document.querySelectorAll('.liquid-resource-row').length, 1);
    assert.match(document.querySelector('.row-title').textContent, /新搜索/);
  } finally { app.unmount(); }
});

test('动漫搜索默认展示年番正篇，同名电影与特别篇在展开后出现且不被推荐', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const notes = ['斗破苍穹3：除恶 (2024)[4K][剧情 动作 奇幻][附前2部]', '斗破苍穹 三年之约.2160p.q',
    '斗破苍穹 特别篇1.2160p.q', '斗破苍穹年番 1080P 更新176集'];
  const resources = notes.map((title, i) => ({ id: String(i), title, url: 'https://pan.quark.cn/s/doupo' + i, datetime: '2026-11-14', quality: '高清', is4k: i !== 3 }));
  const props = reactive({ isOpen: true, isAnalyzing: false, currentCategory: 'anime', searchKeyword: '斗破苍穹',
    media: { id: 'search-doupo-ui', title: '斗破苍穹', category: 'anime', poster: '' }, quarkResources: resources });
  const app = createApp({ render: () => h(Modal, props) }); app.mount('#app');
  try {
    await nextTick(); assert.equal(document.querySelectorAll('.liquid-resource-row').length, 1);
    assert.match(document.querySelector('.row-title').textContent, /年番/);
    document.querySelector('.result-versions button').click(); await nextTick();
    assert.equal(document.querySelectorAll('.liquid-resource-row').length, 4);
    assert.match(document.querySelector('.row-title').textContent, /年番/);
    for (const row of [...document.querySelectorAll('.liquid-resource-row')].slice(1)) assert.equal(row.querySelector('.recommended-badge'), null);
    document.querySelector('.category-picker-trigger').click(); await nextTick();
    [...document.querySelectorAll('.cat-select-pill')].find(button => button.textContent === '电影').click(); await nextTick();
    assert.match(document.querySelector('.row-title').textContent, /除恶/);
  } finally { app.unmount(); }
});
