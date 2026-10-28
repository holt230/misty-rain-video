import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent']) globalThis[key] = dom.window[key];
globalThis.localStorage = window.localStorage; globalThis.sessionStorage = window.sessionStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window); globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
let scrollY = 0;
Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
window.scrollTo = options => { scrollY = Number(options?.top || 0); };
const { createApp, nextTick } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/app-search-');
const realComponents = new Set(['App.vue', 'Navbar.vue', 'IconButton.vue', 'BrandMark.vue', 'QuarkTransferModal.vue']);
await build({ entryPoints: ['src/App.vue'], outdir: path.resolve(folder), entryNames: 'app', outExtension: { '.js': '.mjs' },
  bundle: true, splitting: true, format: 'esm', platform: 'browser', external: ['vue'], logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'app-navigation', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
    const name = path.basename(args.path);
    if (!realComponents.has(name)) {
      const page = ({ 'FilmDetailPage.vue': 'detail', 'AccountPage.vue': 'account', 'CatalogSearchPage.vue': 'catalog', 'DiscoveryPage.vue': 'discover', 'MediaGrid.vue': 'library', 'HistoryPage.vue': 'history', 'CatalogBrowsePage.vue':'browse' })[name];
      // Keep the actual App, auth/read composables, Navbar and dialog lifecycle.
      // Page bodies are inert views so this suite never starts a media engine.
      return { loader: 'js', contents: `import {defineComponent,h} from 'vue'; export default defineComponent({ inheritAttrs:false,
        props:['id','query'], setup(props,{expose}) { const instance=globalThis.__navInstance=(globalThis.__navInstance||0)+1; expose({focusAuth(){}});
          return () => ${page ? `h('section',{'data-page':'${page}','data-instance':instance,'data-id':props.id,'data-query':props.query},[h('input',{'aria-label':'页面草稿'})])` : 'null'}; } });` };
    }
    const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
    return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
  }); } }] });
const App = (await import(pathToFileURL(path.resolve(folder, 'app.mjs')))).default;
after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });

const flush = async () => {
  for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); }
  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))); await nextTick();
};
const button = name => document.querySelector(`button[aria-label="${name}"]`);
const page = name => document.querySelector(`[data-page="${name}"]`);
const route = name => name === 'detail' ? '#/subject/douban-35575567' : name === 'browse' ? '#/browse?category=tv&country=美国&sort=rating' : name === 'catalog' ? '#/search?q=沙丘' : `#/${name}`;
const stateFor = (name, y = 420) => ({ mistyRainLayer: name, query: name === 'catalog' ? '沙丘' : '', category: 'movie', detailOrigin: 'discover', detailHasParent: true, scrollY: y });

function network(t) {
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/api/auth/session')) return Response.json({ code: 0, data: { authenticated: true, user: { username: 'fixture', folder: 'fixture', role: 'user' } } });
    if (String(url).endsWith('/api/media-cards') || String(url).endsWith('/api/playback-history')) return Response.json({ code: 0, data: [] });
    throw new Error('Unexpected request in navigation test');
  });
}
async function mount(t, initial) {
  document.body.innerHTML = '<div id="mount"></div>'; document.body.style.cssText = ''; document.documentElement.style.cssText = '';
  if (initial) window.history.replaceState(initial.state, '', initial.hash);
  const app = createApp(App); app.mount('#mount'); await flush();
  let mounted = true; const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
  t.after(unmount); return { unmount };
}
async function historyAction(action) {
  let timeout;
  const event = new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timeout); resolve(); };
    window.addEventListener('popstate', done, { once: true });
    timeout = setTimeout(() => { window.removeEventListener('popstate', done); reject(new Error('Expected history transition')); }, 2000);
  });
  action(); await event; await flush();
}

for(const origin of ['detail','account','browse','library','history','catalog','discover'])test(`${origin} header opens resource search without replacing the page or its local draft`,async t=>{
 network(t);await mount(t,{hash:route(origin),state:stateFor(origin)});const content=page(origin);assert.ok(content);const instance=content.dataset.instance;const draft=content.querySelector('input');draft.value='保留草稿';scrollY=420;
 button('搜索').click();await flush();const dialog=document.querySelector('.resource-backdrop.active');assert.ok(dialog);assert.equal(dialog.querySelector('h2').textContent,'搜索');assert.equal(document.querySelector('.result-search input').value,'');assert.ok(document.querySelector('.search-submit svg'));assert.equal(window.history.state.mistyRainLayer,'transfer');assert.equal(page(origin).dataset.instance,instance);
 await historyAction(()=>button('关闭资源选择').click());assert.equal(document.querySelector('.resource-backdrop.active'),null);assert.equal(page(origin).dataset.instance,instance);assert.equal(page(origin).querySelector('input').value,'保留草稿');assert.equal(scrollY,420);
});
