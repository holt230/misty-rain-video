import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollTo = function(options) {
  this.scrollLeft = Number(options.left || 0); this.scrollTop = Number(options.top || 0);
  this.dispatchEvent(new window.Event('scroll'));
};
window.HTMLElement.prototype.scrollBy = function(options) { this.scrollTo({ left: this.scrollLeft + Number(options.left || 0), top: this.scrollTop + Number(options.top || 0) }); };
const mediaState = { width: 768, reducedMotion: false };
const mediaQueries = new Map();
window.matchMedia = query => {
  if (!mediaQueries.has(query)) {
    const target = new window.EventTarget(), listeners = new Set();
    Object.defineProperties(target, { media: { value: query }, matches: { get: () => {
      if (query.includes('prefers-reduced-motion')) return mediaState.reducedMotion;
      const min = query.match(/min-width:\s*(\d+)px/), max = query.match(/max-width:\s*(\d+)px/);
      return Boolean(min || max) && (!min || mediaState.width >= Number(min[1])) && (!max || mediaState.width <= Number(max[1]));
    } } });
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (name, callback, options) => { if (name === 'change') listeners.add(callback); add(name, callback, options); };
    target.removeEventListener = (name, callback, options) => { if (name === 'change') listeners.delete(callback); remove(name, callback, options); };
    target.listeners = listeners; mediaQueries.set(query, target);
  }
  return mediaQueries.get(query);
};
const resize = width => { mediaState.width = width; for (const query of mediaQueries.values()) query.dispatchEvent(new window.Event('change')); window.dispatchEvent(new window.Event('resize')); };
globalThis.ResizeObserver=class { observe(){} disconnect(){} };
test.beforeEach(t => { t.mock.method(Math,'random',()=>0); mediaState.width = 768; mediaState.reducedMotion = false; window.history.replaceState({}, '', '/'); });
const { createApp, h, nextTick, reactive } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/catalog-sort-');
const compile = async entry => {
  const outfile = path.resolve(folder, path.basename(entry) + '.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser', external: ['vue'],
    define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
    plugins: [{ name: 'vue', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
      if (!descriptor.script && !descriptor.scriptSetup) {
        const template = compileTemplate({ id: args.path, filename: args.path, source: descriptor.template?.content || '' });
        return { contents: template.code.replace('export function render', 'function render') + '\nexport default { render };', loader: 'js' };
      }
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
    }); } }] });
  return import(pathToFileURL(outfile));
};
const Catalog = (await compile('src/components/media/CatalogSearchPage.vue')).default;
const Discovery = (await compile('src/components/media/DiscoveryPage.vue')).default;
const Filters = (await compile('src/components/media/CatalogFilters.vue')).default;
const Hero = (await compile('src/components/media/FeaturedSpotlight.vue')).default;
const Rail = (await compile('src/components/media/MediaRail.vue')).default;
const { sortCatalogItems } = await compile('src/services/catalogSort.ts');
const items = [
  { id: 'douban-1', title: '热门旧作', rating: 7.2, ratingCount: 1000, year: '2022' },
  { id: 'douban-2', title: '高分新作', rating: 9.1, ratingCount: 123, year: '2025' },
  { id: 'douban-3', title: '待播', rating: null, ratingCount: 0, year: '2027' },
  { id: 'douban-4', title: '信息未知', rating: null, ratingCount: null, year: '' }
].map(item => ({ ...item, category: 'tv', provider: 'douban', subtitle: '', description: '', poster: '', sourceUrl: '' }));
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); } await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))); await nextTick(); };
const popstate = () => new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
const openFilters = async () => { const button = document.querySelector('.filter-toggle'); button.focus(); button.click(); await flush(); return document.querySelector('[role="dialog"][aria-label="影片筛选"]'); };
const finishFilters = async () => { const popped = popstate(); document.querySelector('[aria-label="完成筛选"]').click(); await popped; await flush(); };

test('rating, real rating count and year sorts put missing values last and preserve ties without mutating source order', () => {
  const keys = sort => sortCatalogItems(items, sort).map(item => item.id);
  assert.deepEqual(keys('rating'), ['douban-2', 'douban-1', 'douban-3', 'douban-4']);
  assert.deepEqual(keys('popularity'), ['douban-1', 'douban-2', 'douban-3', 'douban-4']);
  assert.deepEqual(keys('time'), ['douban-3', 'douban-2', 'douban-1', 'douban-4']);
  assert.deepEqual(keys('recommended'), items.map(item => item.id));
});

for (const [component, label, selector] of [[Catalog, '影片排序', '.catalog-card strong']]) {
  test(`${label} reorders current cards without a network request, and selection still emits the correct item`, async t => {
    let calls = 0, selected;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ code: 0, data: { items, sections: [
      { id: 'tv', category: 'tv', title: '近期热播', source: '豆瓣', sourceUrl: '', items, updatedAt: '', refreshing: false }
    ] } }); });
    document.body.innerHTML = '<div id="mount"></div>';
    const app = createApp({ render: () => h(component, { query: '新作', active: true, libraryCatalogIds: [], onSelect: item => { selected = item; } }) });
    app.mount('#mount');
    try {
      await flush(); const count = calls;
      if (component === Discovery) { await openFilters(); assert.equal(document.querySelectorAll('.rail-track .discovery-card').length, items.length); }
      const select = document.querySelector(`select[aria-label="${label}"]`);
      const labels = { rating: "评分", popularity: "热门", time: "最新" };
      for (const [sort, first] of [['rating', '高分新作'], ['popularity', '热门旧作'], ['time', '待播']]) {
        if (select) { select.value = sort; select.dispatchEvent(new window.Event('change', { bubbles: true })); }
        else [...document.querySelectorAll('[aria-label="发现排序"] button')].find(button => button.textContent === labels[sort]).click();
        await flush();
        assert.equal(document.querySelector(selector).textContent, first);
      }
      assert.equal(calls, count); if (select) assert.match(select.title, /年份/);
      if (!select) { assert.equal(document.querySelector('[aria-label="发现排序"] [aria-pressed="true"]').textContent, '最新'); await finishFilters(); }
      document.querySelector(selector).closest('button').click(); assert.equal(selected.id, 'douban-3');
      if (select) assert.match(select.textContent, /评价人数/);
    } finally { app.unmount(); }
  });
}

test('inline filters expose all facets without a dialog, extra history entry or scroll lock', async () => {
 const state=reactive({modelValue:{genre:'',country:'',year:''},sort:'popularity',category:'tv'});
 document.body.innerHTML='<div id="mount"></div>';
 const app=createApp({render:()=>h(Filters,{...state,'onUpdate:modelValue':value=>state.modelValue=value,'onUpdate:sort':value=>state.sort=value})});app.mount('#mount');
 try {
  const length=window.history.length;assert.deepEqual([...document.querySelectorAll('[aria-label="发现排序"] button')].map(button=>button.textContent),['热门','最新','评分']);assert.equal(document.querySelector('[aria-label="发现排序"] [aria-pressed=true]').textContent,'热门');
  assert.equal(document.querySelector('.filter-toggle'),null);assert.equal(document.querySelector('[role=dialog]'),null);
  for(const [label,key,value] of [['类型','genre','科幻'],['地区','country','美国'],['年份','year','2024']]){
   const group=document.querySelector(`[aria-label="${label}筛选"]`);
   [...group.querySelectorAll('button')].find(button=>button.textContent===value).click();await flush();assert.equal(state.modelValue[key],value);
   assert.equal(group.querySelector('[aria-pressed=true]').textContent,value);
   assert.deepEqual([...document.querySelectorAll('[aria-label="片库分类"] button')].map(button=>button.textContent),['电视剧','电影','动漫','综艺']);
   assert.equal(document.querySelector('[aria-label="片库分类"] [aria-pressed=true]').textContent,'电视剧');
  }
  [...document.querySelectorAll('[aria-label="发现排序"] button')].find(button=>button.textContent==='评分').click();await flush();assert.equal(state.sort,'rating');
  document.querySelector('[aria-label="类型筛选"] button').click();await flush();assert.equal(state.modelValue.genre,'');assert.equal(state.modelValue.country,'美国');
  assert.equal(window.history.length,length);assert.notEqual(document.body.style.overflow,'hidden');
 }finally{app.unmount();}
});

test('discovery shelf controls reflect scroll boundaries and honor reduced motion', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { sections: [
    { id: 'tv', category: 'tv', title: '近期热播', source: '豆瓣', sourceUrl: '', items, updatedAt: '', refreshing: false }
  ] } }));
  mediaState.reducedMotion = true;
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Discovery, { active: true, libraryCatalogIds: [] }) });
  app.mount('#mount');
  try {
    await flush(); const shelf = document.querySelector('.rail-track'), calls = [];
    Object.defineProperties(shelf, { clientWidth: { value: 600 }, scrollWidth: { value: 1600 } });
    shelf.scrollBy = options => calls.push(options);
    window.dispatchEvent(new window.Event('resize')); await flush();
    const [previous, next] = document.querySelectorAll('.rail-controls button');
    assert.equal(previous.disabled, true); assert.equal(next.disabled, false);
    next.click(); assert.deepEqual(calls, [{ left: 510, behavior: 'instant' }]);
    shelf.scrollLeft = 1000; shelf.dispatchEvent(new window.Event('scroll')); await flush();
    assert.equal(previous.disabled, false); assert.equal(next.disabled, true);
    previous.click(); assert.equal(calls[1].left, -510);
  } finally { app.unmount(); }
});

test('featured posters automatically cycle without reverse scrolling or metadata requests and clean up their single timer and observer', async t => {
  const requests = [], observers = [], jobs = new Map(); let now = 0, serial = 0, scrollCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => { requests.push(String(url)); return Response.json({ code: 0, data: null }); });
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, delay = 0) => { const id = ++serial; jobs.set(id, { callback, at: now + delay }); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => jobs.delete(id));
  t.mock.method(window.HTMLElement.prototype, 'scrollTo', function() { if(!this.classList.contains('featured-dots'))scrollCalls++; });
  const tick = async ms => {
    const until = now + ms;
    for (let n = 0; n < 100; n++) {
      const entry = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      now = entry[1].at; jobs.delete(entry[0]); entry[1].callback(); await flush();
    }
    now = until; await flush();
  };
  const originalObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    show(value) { this.callback([{ target: this.target, isIntersecting: value, intersectionRatio: value ? 1 : 0 }]); }
  };
  t.after(() => { if (originalObserver === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = originalObserver; });
  const state = reactive({ items: items.slice(0, 3).map(item => ({ ...item, poster: `/poster/${item.id}` })), active: true, savedIds: [] });
  let selected;
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Hero, { ...state, onSelect: item => { selected = item; } }) });
  app.mount('#mount'); let mounted = true;
  const assertSelected = index => {
    const slides = [...document.querySelectorAll('.featured-slide')];
    assert.equal(slides.length, 3);
    slides.forEach((slide, i) => {
      assert.equal(slide.getAttribute('aria-hidden'), String(i !== index));
      assert.equal(slide.hasAttribute('inert'), i !== index);
      assert.equal(slide.classList.contains('is-current'), i === index);
      assert.equal(slide.querySelector('.featured-open').tabIndex, i === index ? 0 : -1);
    });
    assert.equal(document.querySelector('.featured-dots [aria-current="true"]').getAttribute('aria-label'), `精选：${state.items[index].title}`);
  };
  try {
    await flush(); assertSelected(0);
    assert.equal(document.querySelector('.rotation-control'),null);assert.equal(document.querySelector('.featured-info'),null);
    assert.deepEqual([...document.querySelectorAll('.featured-poster img')].map(img => img.getAttribute('src')), state.items.map(item => item.poster));
    document.querySelector('.featured-open[tabindex="0"]').click(); assert.equal(selected.id, 'douban-1');
    assert.equal(observers.length, 1); assert.equal(observers[0].target, document.querySelector('.featured-spotlight'));
    assert.equal(jobs.size, 0); observers[0].show(true); await flush(); assert.equal(jobs.size, 1);
    assert.equal(document.querySelector('.featured-stage').getAttribute('aria-live'), 'off');
    const hover=new window.Event('pointerenter');Object.defineProperty(hover,'pointerType',{value:'mouse'});document.querySelector('.featured-spotlight').dispatchEvent(hover);await flush();assert.equal(jobs.size,1,'hover continues the featured rotation');
    for (let refresh = 0; refresh < 3; refresh++) {
      await tick(600);
      state.items = state.items.map(item => ({ ...item, subtitle: `推荐更新 ${refresh}` }));
      await flush();
    }
    await tick(1199); assertSelected(0); await tick(1); assertSelected(1);
    await tick(3000); assertSelected(2); await tick(3000); assertSelected(0);
    assert.equal(scrollCalls, 0, 'wrapping the crossfade never sweeps the scroll position backwards');
    await tick(2000); document.querySelector('[aria-label="精选：待播"]').click(); await flush(); assertSelected(2);
    await tick(1000); assertSelected(2); await tick(2000); assertSelected(0);
    state.active = false; await flush(); await tick(21000); assertSelected(0); assert.equal(jobs.size, 0);
    state.active = true; await flush(); await tick(3000); assertSelected(1);
    app.unmount(); mounted = false;
    assert.equal(observers[0].disconnected, true); assert.equal(jobs.size, 0);
    assert.equal(mediaQueries.get('(prefers-reduced-motion: reduce)').listeners.size, 0);
    assert.deepEqual(requests, [], 'browsing supplied posters never requests optional metadata');
  } finally { if (mounted) app.unmount(); }
});

test('media rail responds to measured size changes and removes observers, resize listeners and a queued frame on unmount', async t => {
  const observers = [], resizeListeners = new Set(), queued = new Set(), cancelled = [];
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  t.mock.method(window, 'addEventListener', (name, listener, options) => { if (name === 'resize') resizeListeners.add(listener); add(name, listener, options); });
  t.mock.method(window, 'removeEventListener', (name, listener, options) => { if (name === 'resize') resizeListeners.delete(listener); remove(name, listener, options); });
  const originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; this.target = null; }
  };
  t.after(() => { if (originalObserver === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = originalObserver; });
  t.mock.method(globalThis, 'requestAnimationFrame', callback => {
    const id = window.requestAnimationFrame(time => { queued.delete(id); callback(time); }); queued.add(id); return id;
  });
  t.mock.method(globalThis, 'cancelAnimationFrame', id => { cancelled.push(id); queued.delete(id); window.cancelAnimationFrame(id); });
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Rail, { title: '测试片单', itemCount: 3 }, { default: () => items.slice(0, 3).map(item => h('button', { key: item.id }, item.title)) }) });
  app.mount('#mount'); let mounted = true;
  try {
    await flush(); assert.equal(observers.length, 1); assert.equal(resizeListeners.size, 1);
    const viewport = document.querySelector('.rail-track'); let width = 600;
    Object.defineProperties(viewport, { clientWidth: { get: () => width }, scrollWidth: { value: 1400 } });
    assert.equal(observers[0].target, viewport);
    observers[0].callback([{ target: viewport }]); await flush();
    const [previous, next] = document.querySelectorAll('.rail-controls button');
    assert.equal(previous.disabled, true); assert.equal(next.disabled, false);
    width = 1400; observers[0].callback([{ target: viewport }]); await flush(); assert.equal(next.disabled, true);
    width = 600; observers[0].callback([{ target: viewport }]); await flush();
    viewport.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await flush();
    assert.equal(viewport.scrollLeft, 510); assert.equal(previous.disabled, false);
    viewport.querySelector('button').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await flush();
    assert.equal(viewport.scrollLeft, 510, 'arrow keys on a child control are not intercepted by the rail');
    observers[0].callback([{ target: viewport }]); assert.equal(queued.size, 1);
    const frame = [...queued][0]; app.unmount(); mounted = false;
    assert.equal(observers[0].disconnected, true); assert.equal(resizeListeners.size, 0); assert.ok(cancelled.includes(frame));
    window.dispatchEvent(new window.Event('resize')); await flush(); assert.equal(queued.size, 0);
  } finally { if (mounted) app.unmount(); }
});

test('featured manual navigation wraps, preserves identity on reorder and distinguishes a swipe click from keyboard activation', async t => {
  mediaState.width = 1024; mediaState.reducedMotion = true;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => { requests.push(String(url)); return Response.json({ code: 0, data: null }); });
  let selected;
  document.body.innerHTML = '<div id="mount"></div>';
  const state = reactive({ items: items.slice(0, 3).map(item => ({ ...item, poster: `/poster/${item.id}` })) });
  const app = createApp({ render: () => h(Hero, { items: state.items, active: true, savedIds: [], onSelect: item => { selected = item; } }) });
  app.mount('#mount');
  const current = () => document.querySelector('.featured-dots [aria-current="true"]').getAttribute('aria-label');
  const pointer = (name, target, x, y, id = 1) => {
    const event = new window.Event(name, { bubbles: true });
    Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: id }, clientX: { value: x }, clientY: { value: y } });
    target.dispatchEvent(event);
  };
  try {
    await flush(); assert.equal(current(), '精选：热门旧作');
    document.querySelector('[aria-label="上一部精选"]').click(); await flush(); assert.equal(current(), '精选：待播');
    document.querySelector('[aria-label="下一部精选"]').click(); await flush(); assert.equal(current(), '精选：热门旧作');
    document.querySelector('[aria-label="精选：高分新作"]').click(); await flush();
    state.items = [state.items[2], state.items[0], state.items[1]]; await flush();
    assert.equal(current(), '精选：高分新作', 'reordering supplied cards preserves the selected subject');
    let active = document.querySelector('.featured-open[tabindex="0"]');
    pointer('pointerdown', active, 250, 100); pointer('pointerup', active, 150, 110); await flush();
    assert.equal(current(), '精选：待播');
    active = document.querySelector('.featured-open[tabindex="0"]');
    active.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 })); assert.equal(selected, undefined);
    active.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 })); assert.equal(selected.id, 'douban-3');
    // A swipe with no synthesized pointer click must not swallow the next keyboard activation.
    selected = undefined; pointer('pointerdown', active, 250, 100, 2); pointer('pointerup', active, 150, 110, 2); await flush();
    document.querySelector('.featured-open[tabindex="0"]').click(); assert.equal(selected.id, 'douban-1');
    active = document.querySelector('.featured-open[tabindex="0"]');
    pointer('pointerdown', active, 250, 100, 3); pointer('pointerup', active, 230, 200, 3); await flush();
    assert.equal(current(), '精选：热门旧作', 'vertical page scrolling does not switch featured titles');
    pointer('pointerdown', active, 250, 100, 4); pointer('pointercancel', active, 150, 100, 4); pointer('pointerup', active, 150, 100, 4); await flush();
    assert.equal(current(), '精选：热门旧作', 'a cancelled gesture cannot select a different title');
    assert.equal(document.querySelectorAll('.featured-slide[aria-hidden="false"]').length, 1);
    assert.equal(document.querySelector('.featured-open[tabindex="0"]').closest('.featured-slide').hasAttribute('inert'), false);
    assert.equal(document.querySelectorAll('.featured-slide[inert]').length, 2);
    assert.deepEqual(requests, [], 'manual navigation and gestures never request metadata');
  } finally { app.unmount(); }
});

test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });


test('featured selection interleaves ten unique posters and mounts only nearby artwork',async t=>{
 const sections=['tv','movie','anime','variety'].map((category,sectionIndex)=>({id:category,category,title:category,items:Array.from({length:8},(_,i)=>({...items[0],id:`douban-${100+sectionIndex*10+i}`,category,poster:`/poster/${sectionIndex}-${i}`}))}));
 sections[1].items[0]=sections[0].items[0]; // Duplicated upstream entries must not consume a slot.
 t.mock.method(globalThis,'fetch',async url=>Response.json({code:0,data:String(url).includes('/browse')?{items:[]}:{sections}}));
 document.body.innerHTML='<div id="mount"></div>';
 const app=createApp({render:()=>h(Discovery,{active:true,libraryCatalogIds:[]})});app.mount('#mount');
 try{
  await flush();const slides=[...document.querySelectorAll('.featured-slide')];assert.equal(slides.length,10);
  const categories=slides.slice(0,7).map(slide=>slide.querySelector('.featured-category').textContent);
  assert.deepEqual(categories,['电视剧','动漫','综艺','电视剧','电影','动漫','综艺']);
  assert.equal(document.querySelectorAll('.featured-poster img').length,3);
  document.querySelectorAll('.featured-dots button')[5].click();await flush();
  assert.equal(document.querySelectorAll('.featured-poster img').length,4,'outgoing artwork remains available during a distant crossfade');
  assert.equal(document.querySelector('.featured-slide.is-current').getAttribute('aria-label'),'6 / 10');
 }finally{app.unmount();}
});


test('featured random start is stable on metadata refresh and the short progress strip follows selection',async t=>{
 mediaState.reducedMotion=true;let random=.7;t.mock.method(Math,'random',()=>random);
 document.body.innerHTML='<div id="mount"></div>';
 const state=reactive({items:Array.from({length:10},(_,i)=>({...items[0],id:`film-${i}`,title:`影片${i}`})),active:true});
 const app=createApp({render:()=>h(Hero,{...state,savedIds:[]})});app.mount('#mount');
 try{
  await flush();const selected=()=>document.querySelector('.featured-slide.is-current').getAttribute('aria-label');assert.equal(selected(),'8 / 10');
  state.items=state.items.map(item=>({...item,year:'2026'}));await flush();assert.equal(selected(),'8 / 10');
  const strip=document.querySelector('.featured-dots');Object.defineProperty(strip,'clientWidth',{value:140});Object.defineProperty(strip,'scrollWidth',{value:276});
  [...strip.children].forEach((button,i)=>{Object.defineProperty(button,'offsetLeft',{value:i*28});Object.defineProperty(button,'offsetWidth',{value:24});});
  document.querySelector('[aria-label="下一部精选"]').click();await flush();assert.equal(strip.scrollLeft,136);assert.equal(selected(),'9 / 10');
  document.querySelector('[aria-label="下一部精选"]').click();await flush();document.querySelector('[aria-label="下一部精选"]').click();await flush();assert.equal(selected(),'1 / 10');assert.equal(strip.scrollLeft,0);
  state.active=false;await flush();random=.2;state.active=true;await flush();assert.equal(selected(),'3 / 10');
 }finally{app.unmount();}
});
