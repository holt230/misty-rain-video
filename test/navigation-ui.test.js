import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'KeyboardEvent', 'CompositionEvent', 'MouseEvent']) globalThis[key] = dom.window[key];
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
const { createApp, h, nextTick, reactive, ref } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/navigation-');
async function compile(entry) {
  const outdir = path.resolve(folder, path.basename(entry, '.vue'));
  await build({ entryPoints: [entry], outdir, entryNames: 'index', outExtension: { '.js': '.mjs' }, splitting: true,
    bundle: true, format: 'esm', platform: 'browser', external: ['vue'], logLevel: 'silent',
    define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'vue', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
    }); } }] });
  return (await import(pathToFileURL(path.join(outdir, 'index.mjs')))).default;
}
const Navbar = await compile('src/components/layout/Navbar.vue');
const Dock = await compile('src/components/layout/MobileTabBar.vue');
const flush = async () => {
  for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); }
  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  await nextTick();
};
const button = label => document.querySelector(`button[aria-label="${label}"]`);
const fill = async value => {
  const input = document.querySelector('input'); input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true })); await nextTick(); return input;
};
function mount(component, props) {
  document.body.innerHTML = '<div id="mount"></div>';
  const exposed = ref(null);
  const app = createApp({ render: () => h(component, { ...props, ref: exposed }) });
  app.mount('#mount'); return { app, exposed };
}
const defaults = { currentCategory: 'movie', currentCategoryName: '电影', user: { username: 'fixture', role: 'user', folder: 'fixture' }, addMedia: async () => true };

// These are user flows: the compact shell must retain the old search/share contracts.
test('every header search uses one global resource entry and leaves local filtering untouched',async()=>{
 for(const page of ['discover','library','history','account','detail','browse']){
  let opened=0;const {app}=mount(Navbar,{activePage:page,onOpenSearch:()=>opened++});
  try{button('搜索').click();await flush();assert.equal(opened,1);assert.equal(document.querySelector('input'),null);assert.equal(document.querySelector('[role="dialog"]'),null);}finally{app.unmount();}
 }
});

test('desktop top navigation and mobile bar preserve named destinations and disabled state', async () => {
  const events = [], state = reactive({ ...defaults, activePage: 'library', isSaving: false, onNavigate: value => events.push(value), onOpenAccount: () => events.push('account') });
  let view = mount(Navbar, state);
  try {
    const controls = [...document.querySelectorAll('.desktop-navigation button')];
    assert.deepEqual(controls.map(item => item.textContent), ['发现', '收藏', '历史']);
    assert.equal(document.querySelector('[aria-current="page"]').textContent, '收藏');
    controls[2].click(); button('设置').click(); assert.deepEqual(events, ['history', 'account']);
    assert.equal(button('搜索').title, '搜索'); assert.equal(button('设置').title, '设置');
    state.isSaving = true; await nextTick(); controls[0].click(); button('设置').click(); assert.equal(events.length, 2);
    state.activePage = 'detail'; await nextTick(); assert.equal(document.querySelector('[aria-current="page"]').textContent, '发现');
    assert.equal(document.querySelector('.desktop-sidebar'), null);
  } finally { view.app.unmount(); }
  const navigations = []; view = mount(Dock, { activeTab: 'history', onNavigate: value => navigations.push(value) });
  try {
    assert.equal(document.querySelectorAll('button').length, 4); assert.equal(document.querySelector('[aria-current="page"]').getAttribute('aria-label'), '历史');
    button('收藏').click(); assert.deepEqual(navigations, ['library']);
    assert.equal(document.querySelector('.mobile-tabbar').textContent, '');
    assert.ok([...document.querySelectorAll('button')].every(item => item.title === item.getAttribute('aria-label')));
  } finally { view.app.unmount(); }
});


test.after(()=>{dom.window.close();fs.rmSync(folder,{recursive:true,force:true});});
