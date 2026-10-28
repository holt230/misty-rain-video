import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual:true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
window.scrollTo = () => {};
globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
const { createApp, h, nextTick } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/catalog-details-');
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
const Detail = (await compile('src/components/media/FilmDetailPage.vue')).default;
const { subjectIdFromHash } = await compile('src/services/catalogDetails.ts');
const item = (id = 'douban-123') => ({ id, provider: 'douban', title: '测试影片', category: 'tv', poster: '', year: '2026', rating: 8.1, ratingCount: 11, subtitle: '', description: '测试简介', sourceUrl: '' });
const details = (id = 'douban-123') => ({ ...item(id), originalTitle: 'Original', genres: ['剧情'], countries: ['中国大陆'], languages: ['汉语'], premieres: ['2026-01-01'], durations: [], aliases: [], episodeCount: 24, directors: [], credits: [], photos: [], photoCount: 0, comments: [], commentCount: 0, honors: [], partial: false, stale: false });
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); } };

test('detail hash routes accept only provider identities, including refresh links', () => {
  assert.equal(subjectIdFromHash('#/subject/douban-123'), 'douban-123');
  assert.equal(subjectIdFromHash('#/subject/bangumi-123'), 'bangumi-123');
  for (const hash of ['#/watch/123', '#/subject/douban-0', '#/subject/https://example.com', '#/subject/douban-123/..']) assert.equal(subjectIdFromHash(hash), '');
});
test('opening details and reading metadata never searches or plays; the explicit button passes correct title and durable poster', async t => {
  const urls = []; let searched, played = 0;
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url); return Response.json({ code: 0, data: details() }); });
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Detail, { id: 'douban-123', seed: item(), collected: true, onSearch: item => { searched = item; }, onPlayCollection: () => played++ }) });
  app.mount('#mount'); t.after(() => app.unmount()); await flush();
  assert.deepEqual(urls, ['/api/catalog/subjects/douban-123']); assert.equal(searched, undefined); assert.equal(played, 0);
  assert.match(document.body.textContent, /全 24 集/); assert.match(document.body.textContent, /测试简介/);
  document.querySelector('.search-resources').click(); assert.equal(searched.id, 'douban-123'); assert.equal(searched.poster, '/api/discovery/posters/douban-123');
  document.querySelector('.play-collection').click(); assert.equal(played, 1); assert.equal(urls.length, 1);
});
test('late detail response cannot overwrite a newer subject; previous request is cancelled', async t => {
  const { ref } = await import('vue'); const id = ref('douban-123'), requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({ url, options, resolve })));
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Detail, { id: id.value }) }); app.mount('#mount'); t.after(() => app.unmount());
  id.value = 'douban-456'; await nextTick(); assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve(Response.json({ code: 0, data: { ...details('douban-456'), title: '新影片' } })); await flush();
  requests[0].resolve(Response.json({ code: 0, data: details() })); await flush();
  assert.equal(document.querySelector('h1').textContent, '新影片');
});
test('metadata failure retains matching seed and manual search, with a retry; no seed renders a clear failure instead of fake content', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  for (const seed of [item(), null]) {
    document.body.innerHTML = '<div id="mount"></div>'; let searched;
    const app = createApp({ render: () => h(Detail, { id: 'douban-123', seed, onSearch: item => { searched = item; } }) });
    app.mount('#mount'); await flush(); assert.match(document.body.textContent, /详情暂时无法加载/);
    if (seed) { document.querySelector('.search-resources').click(); assert.equal(searched.title, '测试影片'); }
    else assert.equal(document.querySelector('.search-resources'), null);
    app.unmount();
  }
});

const reachEnd=async element=>{
 const count=()=>element.parentElement.querySelectorAll('.photo-tile,.short-comment,.credit').length;const initial=count();
 element.getClientRects=()=>[{width:100,height:2,left:10,right:110}];element.getBoundingClientRect=()=>({top:count()>initial?2000:10,bottom:count()>initial?2002:12,width:100,height:2,left:10,right:110});
 window.dispatchEvent(new window.Event('resize'));await new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve)));await flush();
};
const photo = n => ({ id: String(n), image: `/thumb/${n}`, fullImage: `/full/${n}`, description: '' });
const comment = n => ({ id: String(n), author: `观众${n}`, text: `短评${n}`, rating: 4, date: '2026-10-21', votes: 10 });
const clickText = text => [...document.querySelectorAll('button')].find(button => button.textContent === text || button.getAttribute('aria-label') === text)?.click();
test('credits and photos render immediately in horizontal rails and scrolling loads deduplicated content', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    if (url.includes('/photos?')) return Response.json({ code: 0, data: { items: Array.from({ length: 24 }, (_, i) => photo(i + 1)), total: 40, nextStart: 24, stale: false } });
    if (url.includes('/comments?')) return Response.json({ code: 0, data: { items: Array.from({ length: 20 }, (_, i) => comment(i + 1)), total: 50, nextStart: 20, stale: false } });
    return Response.json({ code: 0, data: { ...details(), photos: [photo(1), photo(2)], photoCount: 40, comments: [comment(1), comment(2)], commentCount: 50,
      writers: ['编剧甲'], imdb: 'tt1234567', credits: [{ name: '演员甲', role: '演员', image: '/actor', url: 'https://movie.douban.com/celebrity/1/' }] } });
  });
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Detail, { id: 'douban-123' }) }); app.mount('#mount'); t.after(() => app.unmount()); await flush();
  assert.equal(document.querySelectorAll('a[href^="https://"]').length, 1); assert.match(document.body.textContent, /编剧甲/); assert.match(document.body.textContent, /tt1234567/); assert.equal(calls.length, 1);
  assert.equal(document.querySelector('.detail-facts').open,true);
  assert.equal(document.querySelectorAll('.credit').length,1);assert.equal(document.querySelectorAll('.photo-tile').length,2);
  assert.equal(document.querySelector('.credits-rail [aria-expanded],.photos-rail [aria-expanded]'),null);
  await reachEnd(document.querySelector('.photos-rail .scroll-load'));
  assert.equal(document.querySelectorAll('.photo-tile').length, 24); assert.equal(calls.length, 2);
  await reachEnd(document.querySelector('.short-comment').closest('section').querySelector('.scroll-load')); assert.equal(document.querySelectorAll('.short-comment').length, 20); assert.equal(calls.length, 3);
  assert.equal(document.querySelectorAll('a[href^="https://"]').length, 1); assert.ok(calls.every(url => url.startsWith('/api/catalog/subjects/')));
});
test('closing the photo viewer while its next page loads never reopens it; switching subjects cancels pending content', async t => {
  const { ref } = await import('vue'); const id = ref('douban-123'); const pending = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (url.includes('/photos?') && new URL(url,'http://localhost').searchParams.get('start')==='0')return Promise.resolve(Response.json({code:0,data:{items:[photo(1)],total:2,nextStart:1}}));
    if (url.includes('/photos?')) return new Promise(resolve => pending.push({ resolve, signal: options.signal }));
    return Promise.resolve(Response.json({ code: 0, data: { ...details(id.value), photos: [photo(1)], photoCount: 2 } }));
  });
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Detail, { id: id.value }) }); app.mount('#mount'); t.after(() => app.unmount()); await flush();
  document.querySelector('.photo-tile').click(); await flush(); assert.ok(document.querySelector('[aria-label="剧照大图"]'));
  document.querySelector('.photo-stage .photo-full').dispatchEvent(new window.Event('error')); await flush();
  assert.equal(document.querySelector('.photo-stage .photo-full').getAttribute('src'), '/thumb/1');
  document.querySelector('[aria-label="下一张"]').click(); await flush();
  document.querySelector('[aria-label="下一张"]').click(); await flush();
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: {} })); await flush(); assert.equal(document.querySelector('[aria-label="剧照大图"]'), null);
  pending[0].resolve(Response.json({ code: 0, data: { items: [photo(1), photo(2)], total: 2, nextStart: null } })); await flush(); assert.equal(document.querySelector('[aria-label="剧照大图"]'), null);
  id.value = 'douban-456'; await flush();
  assert.equal(document.querySelectorAll('.photo-tile').length,1);
  assert.equal(document.querySelector('.detail-facts').open,true);
  document.querySelector('.photo-tile').click();await flush();document.querySelector('[aria-label="下一张"]').click();await flush();document.querySelector('[aria-label="下一张"]').click();await flush();
  id.value = 'douban-789'; await flush(); assert.equal(pending[1].signal.aborted, true);
  pending[1].resolve(Response.json({ code: 0, data: { items: [photo(99)], total: 1, nextStart: null } })); await flush();
  assert.equal(document.querySelectorAll('.photo-tile').length,1);
  assert.equal(document.querySelector('.photo-tile img').getAttribute('src'), '/thumb/1');
});


test('detail metadata keeps the already displayed seed poster and backdrop on the same durable image URL',async t=>{
 for(const id of ['douban-123','bangumi-123']){
  let finish;t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>finish=resolve));
  document.body.innerHTML='<div id="mount"></div>';
  const seed={...item(id),poster:`/api/discovery/posters/${id}`};
  const app=createApp({render:()=>h(Detail,{id,seed})});app.mount('#mount');
  try{
   const images=[...document.querySelectorAll('.detail-cover img,.detail-atmosphere img')];assert.equal(images.length,2);
   for(const img of images){img.dispatchEvent(new window.Event('load'));assert.equal(img.getAttribute('loading'),'eager');}
   await nextTick();const src=images.map(img=>img.getAttribute('src'));
   finish(Response.json({code:0,data:{...details(id),poster:'/api/catalog/images/temporary-detail-handle',title:'完整详情'}}));await flush();
   assert.equal(document.querySelector('h1').textContent,'完整详情');
   images.forEach((img,index)=>{assert.equal(img.isConnected,true);assert.equal(img.getAttribute('src'),src[index]);assert.equal(img.classList.contains('poster-loading'),false);});
  }finally{app.unmount();}
 }
});
