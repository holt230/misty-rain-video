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
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'CustomEvent']) globalThis[key] = dom.window[key];
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

test('生产四条原始结果经服务端、客户端、实际 Vue 列表后保留三条，并显示正篇', async t => {
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
    assert.equal(document.querySelectorAll('.resource-item').length, 1);
    props.quarkResources = client.items;
    await nextTick();
    assert.equal(document.querySelectorAll('.resource-item').length, 3);
    assert.match(document.querySelector('.resource-list').textContent, /更新第89集/);
    assert.equal(document.querySelector('.resource-toolbar > span').textContent, '3 个资源');
  } finally { app.unmount(); }
});

test('动漫结果在推荐、最新、4K 和完整列表均不混入同名短剧、沙雕解说与混剪', async t => {
  const notes = [
    '仙逆 4K 更新162集',
    '仙逆 全162集 4K',
    '【短剧】仙逆（115集）谢蕊伊&王镱深',
    '【仙逆】更245集，1080P，B站沙雕版 免充电看，奇遇王富贵，小作坊解说视频【40+GB】',
    '仙逆 4K 混剪视频 全162集',
    '剑仙归来：谁让这剑仙逆世重修的？ 第七季（89集）'
  ];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { merged_by_type: { quark:
    notes.map((note, index) => ({ note, url: `https://pan.quark.cn/s/content${index}` })) } } }));
  const client = await new SilentSearchEngine().search('仙逆');
  assert.equal(client.items.length, 5);
  document.body.innerHTML = '<div id="app"></div>';
  const props = reactive({ isOpen: true, isAnalyzing: false, currentCategory: 'anime', searchKeyword: '仙逆',
    media: { id: 'anime-content-test', title: '仙逆', category: 'anime', poster: '' }, quarkResources: client.items });
  const app = createApp({ render: () => h(Modal, props) });
  app.mount('#app');
  try {
    for (const [label, count] of [['推荐', 2], ['最新', 2], ['4K', 2], ['完整', 1]]) {
      const select = document.querySelector('[aria-label="资源筛选"]');
      select.value = [...select.options].find(option => option.textContent === label).value; select.dispatchEvent(new window.Event('change'));
      await nextTick();
      assert.equal(document.querySelectorAll('.resource-item').length, count);
      assert.doesNotMatch(document.querySelector('.resource-list').textContent, /短剧|沙雕|解说|混剪|剑仙归来/);
      assert.equal(document.querySelector('.resource-toolbar > span').textContent, '2 个资源');
    }
  } finally { app.unmount(); }
});
