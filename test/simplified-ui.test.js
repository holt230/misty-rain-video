import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'CustomEvent', 'HTMLMediaElement', 'HTMLVideoElement']) globalThis[key] = dom.window[key];
globalThis.localStorage = dom.window.localStorage;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.MediaError = dom.window.MediaError || { MEDIA_ERR_NETWORK: 2, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 };
window.matchMedia = query => ({ matches: query.includes('max-width'), addEventListener() {}, removeEventListener() {} });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.scrollTo = function(options) {
  this.scrollLeft = Number(options.left || 0); this.scrollTop = Number(options.top || 0);
  this.dispatchEvent(new window.Event('scroll'));
};
window.HTMLElement.prototype.scrollBy = function(options) { this.scrollTo({ left: this.scrollLeft + Number(options.left || 0), top: this.scrollTop + Number(options.top || 0) }); };
test.beforeEach(() => window.history.replaceState({}, '', '/'));
window.scrollTo = () => {};
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};
window.HTMLMediaElement.prototype.play = async () => {};
const trackLists = new WeakMap();
Object.defineProperty(window.HTMLMediaElement.prototype, 'textTracks', { configurable: true, get() {
  if (!trackLists.has(this)) {
    const list = [], events = new window.EventTarget();
    list.push = (...items) => Array.prototype.push.apply(list, items.map(item => { const target = new window.EventTarget(); for(const method of ['addEventListener','removeEventListener','dispatchEvent']) item[method] = target[method].bind(target); return item; }));
    list.addEventListener = events.addEventListener.bind(events);
    list.removeEventListener = events.removeEventListener.bind(events);
    list.dispatchEvent = events.dispatchEvent.bind(events);
    trackLists.set(this, list);
  }
  return trackLists.get(this);
} });
const { createApp, h, nextTick, reactive } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/simplified-ui-');
async function compile(entry, name) {
  const outdir = path.resolve(folder, name);
  const outfile = path.join(outdir, 'index.mjs');
  await build({ entryPoints: [entry], outdir, entryNames: 'index', outExtension: { '.js': '.mjs' }, splitting: true, bundle: true, format: 'esm', platform: 'browser', external: ['vue'],
    define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
    plugins: [{ name: 'vue', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
      // Canvas rendering has its own browser/UI tests; this suite observes panel state.
      if (args.path.endsWith('/DanmakuControls.vue')) return { contents: 'export default { render() { return null; } };', loader: 'js' };
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
      if (!descriptor.script && !descriptor.scriptSetup) {
        const template = compileTemplate({ id: args.path, filename: args.path, source: descriptor.template?.content || '' });
        return { contents: template.code.replace('export function render', 'function render') + '\nexport default { render };', loader: 'js' };
      }
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
    }); } }] });
  return import(pathToFileURL(outfile));
}
const HistoryPage = (await compile('src/components/media/HistoryPage.vue', 'history-page')).default;
const Details = (await compile('src/components/quark/QuarkResourceDetails.vue', 'resource-details')).default;
const Account = (await compile('src/components/auth/AccountPage.vue', 'account')).default;
const TitleEditor = (await compile('src/components/media/MediaTitleEditor.vue', 'title-editor')).default;
const Navbar = (await compile('src/components/layout/Navbar.vue', 'navbar')).default;
const Subtitles = (await compile('src/components/player/SubtitleControls.vue', 'subtitles')).default;
const Player = (await compile('src/components/player/PlayerPage.vue', 'player')).default;
const PlayerControls = (await compile('src/components/player/XgPlayerControls.vue', 'player-controls')).default;
const Browse = (await compile('src/components/media/CatalogBrowsePage.vue','catalog-browse')).default;
const Discovery = (await compile('src/components/media/DiscoveryPage.vue', 'discovery')).default;
const Catalog = (await compile('src/components/media/CatalogSearchPage.vue', 'catalog')).default;
const ResourceModal = (await compile('src/components/quark/QuarkTransferModal.vue', 'resource-modal')).default;
const { discoveryMedia, resourcePlaybackMedia } = await compile('src/services/discoveryService.ts', 'discovery-service');
const { useQuarkTransfer } = await compile('src/composables/useQuarkTransfer.ts', 'transfer');
const user = role => ({ username: 'private_name', folder: role, role });
const flush = async () => {
  for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); }
  // Vue's real Transition schedules its enter/leave completion over two frames.
  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  await nextTick();
};
function mount(component, props) {
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(component, props) });
  app.mount('#mount'); return app;
}
const media = { id: 'quark:movie', quarkFid: 'movie', title: '测试影片', category: 'tv', poster: '' };
const episodes = [1, 2].map(n => ({ fid: 'ep' + n, episodeNumber: n, episodeTitle: '第 ' + n + ' 集', fileName: n + '.mp4', duration: 600 }));
const preferences = { skipIntroOutro: false, autoNext: true, introSeconds: 30, outroSeconds: 45 };
const discovered = { id: 'douban-123', provider: 'douban', title: '推荐影片', category: 'movie', year: '2026', rating: 8.1, poster: '/api/discovery/posters/douban-123', subtitle: '', description: '2026 / 剧情', sourceUrl: 'https://movie.douban.com/subject/123/' };
const discoverySection = (category, items = [discovered]) => ({ id: category, category, title: category === 'movie' ? '热门电影' : '近期热播', source: '豆瓣', sourceUrl: 'https://m.douban.com/subject_collection/movie_hot_gaia', updatedAt: '2026-10-16T01:00:00Z', stale: false, refreshing: false, failed: false, items });
function mockApi(t) {
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = String(input);
    let data;
    if (url.includes('/player/preferences')) data = options.body ? JSON.parse(options.body) : preferences;
    else if (url.endsWith('/player/sessions')) data = { sessionId: 'fixture', episodes, title: media.title };
    else if (url.includes('/episodes/')) data = { episode: episodes[0], sources: [{ id: 'high', label: '高清', resolution: 'high', delivery: 'direct', mimeType: 'video/mp4', url: '/test.mp4' }], subtitles: [], audioTracks: [] };
    else if (url.includes('/playback-history')) data = { media };
    else if (url.includes('/quark/config')) data = { libraryConfigured: true, isAuthenticated: true };
    else if (url.includes('resource-search')) data = { total: 1, merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/newwork', note: '新片名' }] } };
    else data = { enabled: true, items: [], checkedAt: '', intervalMinutes: 30 };
    return Response.json({ code: 0, data });
  });
}

test('catalog search never searches resources until a card or fallback is selected, ignores late query responses', async t => {
  const pending=new Map(),requests=[];t.mock.method(globalThis,'fetch',url=>{requests.push(String(url));return new Promise(resolve=>pending.set(new URL(String(url),'http://localhost').searchParams.get('q'),resolve))});
  let selected,fallback;const props=reactive({query:'旧片名',active:true,libraryCatalogIds:[],onSelect:item=>selected=item,onSearchResources:q=>fallback=q});const app=mount(Catalog,props);
  try {
    await flush();props.query='新片名';await flush();
    pending.get('新片名')(Response.json({code:0,data:{items:[{...discovered,title:'新片名'}]}}));await flush();
    pending.get('旧片名')(Response.json({code:0,data:{items:[{...discovered,title:'旧片名'}]}}));await flush();
    assert.match(document.querySelector('.catalog-card').textContent,/新片名/);assert.ok(requests.every(url=>url.includes('/api/catalog/search')));assert.equal(selected,undefined);assert.equal(fallback,undefined);
    document.querySelector('.catalog-card').click();assert.equal(selected.title,'新片名');
    document.querySelector('.catalog-fallback button').click();assert.equal(fallback,'新片名');
  } finally {app.unmount();}
});

test('empty catalog and provider failure each provide an explicit direct-resource search action', async t => {
  let fail=false;t.mock.method(globalThis,'fetch',async()=>fail?Response.json({code:503},{status:503}):Response.json({code:0,data:{items:[]}}));
  const props=reactive({query:'未收录',active:true,libraryCatalogIds:[]});const app=mount(Catalog,props);
  try {await flush();assert.match(document.querySelector('.catalog-empty').textContent,/没有找到/);assert.ok(document.querySelector('.catalog-fallback button'));
    fail=true;props.query='接口故障';await flush();assert.match(document.querySelector('[role="alert"]').textContent,/暂时无法加载/);assert.ok(document.querySelector('.catalog-fallback button'));
  }finally{app.unmount();}
});

test('片库分类切换时丢弃晚到结果并保持影片选择身份',async t=>{
 const pending=new Map();t.mock.method(globalThis,'fetch',url=>new Promise(resolve=>pending.set(new URL(String(url),'http://localhost').searchParams.get('category'),resolve)));
 let selected;const props=reactive({active:true,libraryCatalogIds:[],state:{category:'movie',filters:{genre:'',country:'',year:''},sort:'popularity',calendar:false,weekday:1},onSelect:item=>selected=item});props['onUpdate:state']=value=>props.state=value;const app=mount(Browse,props);
 try{await settleBrowse();[...document.querySelectorAll('[aria-label="片库分类"] button')].find(x=>x.textContent==='电视剧').click();await settleBrowse();pending.get('tv')(Response.json({code:0,data:{items:[{...discovered,id:'douban-456',title:'新的剧集',category:'tv'}],nextStart:null}}));await flush();pending.get('movie')(Response.json({code:0,data:{items:[{...discovered,title:'过时电影'}],nextStart:null}}));await flush();assert.match(document.querySelector('.discovery-title').textContent,/新的剧集/);assert.doesNotMatch(document.body.textContent,/过时电影/);document.querySelector('.discovery-card').click();assert.equal(selected.id,'douban-456');}finally{app.unmount();}
});

test('每周放送按所选星期展示且切换日期复用周数据，未评分作品没有零分标签',async t=>{
 const entries=[1,2].map(day=>({...discovered,id:'bangumi-'+day,category:'anime',weekday:day,rating:null,title:`周${day}新番`}));let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({code:0,data:{sections:[{...discoverySection('anime',entries),id:'calendar',title:'本周放送',source:'Bangumi'}]}});});
 const props=reactive({active:true,libraryCatalogIds:[],state:{category:'anime',filters:{genre:'',country:'',year:''},sort:'popularity',calendar:true,weekday:1}});props['onUpdate:state']=value=>props.state=value;const app=mount(Browse,props);
 try{await settleBrowse();assert.equal(document.querySelector('.discovery-title').textContent,'周1新番');[...document.querySelectorAll('[aria-label="放送日期"] button')].find(x=>x.textContent==='周二').click();await flush();assert.equal(document.querySelectorAll('.discovery-card').length,1);assert.equal(document.querySelector('.discovery-title').textContent,'周2新番');assert.equal(document.querySelector('.poster-rating'),null);assert.equal(calls,1);}finally{app.unmount();}
});

test('打开资源浏览文件后播放所点文件，保留片名、分类和提取码，不触发收藏', async t => {
  t.mock.method(globalThis,'fetch',async()=>Response.json({code:0,data:{title:'测试资源',videoCount:1,episodeCount:1,entries:[{fid:'e2',name:'第2集.mp4',parentFid:'0',ancestorFids:[],isVideo:true,isDirectory:false,size:100,sizeFormatted:'100 MB',episodeNumber:2,episodeTitle:'第2集',videoCount:0}]}}));
  const resource = { id: 'resource', title: '推荐影片 2026 1080p', url: 'https://pan.quark.cn/s/fixture', password: '1234', quality: '1080P', datetime: '2026-10-16', linkStatus: 'available', type: 'quark' };
  let playback, saves = 0, plays = 0;
  const app = mount(ResourceModal, { isOpen: true, isAnalyzing: false, media: discoveryMedia(discovered), currentCategory: 'tv', quarkResources: [resource], searchKeyword: discovered.title,
    onPlayResource: (...args) => { playback = args; plays++; }, onSaveToCards: () => { saves++; } });
  try {
    await flush(); assert.equal(document.querySelector('[aria-label="片名或分享链接"]').value, discovered.title);
    assert.equal(document.querySelector('.btn-play'),null);
    document.querySelector('.resource-item').click(); await flush();
    assert.equal(document.querySelector('[aria-label="收藏分类"]').value,'movie');
    document.querySelector('.file-open').click();
    assert.equal(playback[3],'e2'); assert.equal(plays,1);
    assert.equal(playback[0].catalogId, discovered.id); assert.equal(playback[1].password, '1234'); assert.equal(playback[2], 'movie');
    assert.equal(saves, 0);
  } finally { app.unmount(); }
});

test('file browser skips wrapper folders, separates checkbox selection from play, preserves folder scope and removes confirmed empty sources', async () => {
 const entries=[{fid:'wrap',parentFid:'0',ancestorFids:[],isDirectory:true,name:'影片目录',videoCount:2,size:200,sizeFormatted:'200 MB'},
  {fid:'season',parentFid:'wrap',ancestorFids:['wrap'],isDirectory:true,name:'第一季',videoCount:2,size:200,sizeFormatted:'200 MB'},
  ...[1,2].map(n=>({fid:'ep'+n,parentFid:'season',ancestorFids:['wrap','season'],isVideo:true,isDirectory:false,name:n+'.mp4',size:100,sizeFormatted:'100 MB',thumbnail:'/api/test-thumbnail',updatedAt:'2026-10-16T00:00:00Z'}))];
 let saved,played=0;const props=reactive({resource:{url:'https://pan.quark.cn/s/fixture'},initialDetails:{title:'目录',entries,videoCount:2,episodeCount:2},onSave:fids=>saved=fids,onPlay:()=>played++});const app=mount(Details,props);
 try{await flush();assert.equal(document.querySelectorAll('.file-row').length,2);assert.match(document.querySelector('.breadcrumbs').textContent,/第一季/);assert.ok(document.querySelector('.file-row img'));assert.match(document.querySelector('.file-size').textContent,/100 MB/);
 document.querySelector('.file-row input').click();await nextTick();assert.equal(played,0);document.querySelector('.save-selected').click();assert.deepEqual(saved,['ep1']);
 [...document.querySelectorAll('.breadcrumbs button')].find(b=>b.textContent==='全部文件').click();await nextTick();document.querySelector('.file-row input').click();await nextTick();document.querySelector('.save-selected').click();assert.deepEqual(saved,['wrap']);
 }finally{app.unmount()}
 let unavailable;const empty=mount(Details,{resource:{url:'https://pan.quark.cn/s/empty'},initialDetails:{title:'空',entries:[],videoCount:0,episodeCount:0},onUnavailable:resource=>unavailable=resource});
 try{await flush();assert.equal(unavailable.url,'https://pan.quark.cn/s/empty');assert.equal(document.querySelector('.save-all'),null);}finally{empty.unmount()}
});

test('直接播放保留发现元数据和提取码，不把替换片库或任意网址当作播放分享', () => {
  const media = discoveryMedia(discovered);
  const resource = { url: 'https://pan.quark.cn/s/valid?pwd=1234', password: '1234', quality: '1080P' };
  const result = resourcePlaybackMedia(media, resource, 'movie');
  assert.equal(result.catalogId, discovered.id); assert.equal(result.quarkPasscode, '1234'); assert.equal(result.quarkShareUrl, 'https://pan.quark.cn/s/valid');
  assert.equal(result.id, 'discovery:douban-123'); assert.equal(result.quarkFid, undefined);
  assert.throws(() => resourcePlaybackMedia({ ...media, quarkFid: 'saved' }, resource, 'movie'));
  assert.throws(() => resourcePlaybackMedia(media, { ...resource, url: 'https://example.com' }, 'movie'));
});

test('观看记录只展示一次，带进度、继续播放与删除；展开不会复制未看完记录', async () => {
  const entries = Array.from({ length: 32 }, (_, index) => ({ id: `history-${index}`, media: { ...media, title: `影片${index}` }, episodeFid: 'ep1', episodeNumber: 1, position: 120, duration: 600, completed: index === 0, updatedAt: '2026-10-14' }));
  let played, deleted;
  const app = mount(HistoryPage, { history: entries, onPlay: entry => { played = entry; }, onDelete: id => { deleted = id; } });
  try {
    assert.equal(document.querySelector('.continue-history-section'), null);
    assert.equal(document.querySelectorAll('.history-row').length, 30);
    assert.match(document.querySelector('.history-main').getAttribute('aria-label'), /重新播放.*影片0/);
    assert.equal(document.querySelector('.history-page h1'),null);assert.ok(document.querySelector('[aria-label="搜索观看记录"]'));
    assert.match(document.querySelector('.history-main').getAttribute('aria-label'), /已看完/);
    assert.equal(document.querySelector('.history-progress i').style.width, '20%');
    await reachScrollEnd(document.querySelector('.history-page .scroll-load'));
    assert.equal(document.querySelectorAll('.history-row').length, 32);
    assert.equal(new Set([...document.querySelectorAll('.history-copy strong')].map(item => item.textContent)).size, 32);
    document.querySelectorAll('.history-main')[1].click(); assert.equal(played.id, 'history-1');
    document.querySelectorAll('.history-delete')[1].click(); assert.equal(deleted, 'history-1');
  } finally { app.unmount(); }
});

test('名称编辑保留原值，空名称不能提交，失败可重试，提交时阻止关闭', async () => {
  const state = reactive({ open: false, media, saving: false, error: '' });
  let saved, cancels = 0;
  const app = createApp({ render: () => h(TitleEditor, { ...state, onSave: value => { saved = value; }, onCancel: () => { cancels++; } }) });
  document.body.innerHTML = '<div id="mount"></div>'; app.mount('#mount');
  try {
    state.open = true; await nextTick();
    const input = document.querySelector('#media-title-input');
    assert.equal(input.value, media.title);
    input.value = '  正确名称  '; input.dispatchEvent(new window.Event('input', { bubbles: true })); await nextTick();
    document.querySelector('.title-sheet').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(saved, '正确名称');
    state.error = '网络错误'; await nextTick(); assert.equal(document.querySelector('#media-title-error').textContent, '网络错误');
    assert.equal(input.value, '  正确名称  ');
    state.saving = true; await nextTick();
    document.querySelector('.title-backdrop').click(); assert.equal(cancels, 0);
    assert.equal(input.disabled, true);
    state.saving = false; input.value = '  '; input.dispatchEvent(new window.Event('input', { bubbles: true })); await nextTick();
    assert.equal(document.querySelector('.save-title').disabled, true);
  } finally { app.unmount(); }
});

test('settings show no read-only identity; advanced configuration is an admin-only inner page', async t => {
  mockApi(t);
  for (const role of ['admin', 'user']) {
    const app = mount(Account, { user: user(role) });
    try {
      assert.doesNotMatch(document.body.textContent, /private_name|管理员账户|片库账户/);
      assert.equal(document.querySelectorAll('.theme-switch').length, 1);
      assert.equal(document.querySelector('.history-list'),null);
      assert.equal(document.querySelector('.auth-section'), null);
      const advanced = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '高级配置');
      assert.equal(Boolean(advanced), role === 'admin');
      if (advanced) {
        advanced.click(); await flush();
        assert.equal(document.querySelector('h1').textContent, '高级配置');
        assert.ok(document.querySelector('.auth-section'));
        assert.equal(document.querySelector('.theme-switch'), null);
        document.querySelector('[aria-label="返回设置"]').click(); await nextTick();
        assert.ok(document.querySelector('.theme-switch'));
        assert.equal(document.querySelector('.auth-section'), null);
      }
    } finally { app.unmount(); }
  }
});

test('desktop top navigation has one settings entry and no identity or theme controls', () => {
  const app = mount(Navbar, { user: user('admin'), activePage: 'account', currentCategory: 'tv', currentCategoryName: '电视剧', addMedia: async () => true });
  try {
    assert.equal(document.querySelectorAll('.settings-trigger').length, 1);
    assert.equal(document.querySelector('[aria-current="page"]').getAttribute('aria-label'), '设置');
    assert.equal(document.querySelector('.theme-switch'), null);
    assert.doesNotMatch(document.body.textContent, /private_name|管理员|我的$/);
  } finally { app.unmount(); }
});

test('desktop library has one selected top destination and keeps category selection in its page', () => {
  const app = mount(Navbar, { user: user('admin'), activePage: 'library', currentCategory: 'movie', currentCategoryName: '电影', addMedia: async () => true });
  try {
    assert.equal(document.querySelectorAll('[aria-current="page"]').length, 1);
    assert.equal(document.querySelector('[aria-current="page"]').textContent, '收藏');
    assert.equal(document.querySelector('.desktop-sidebar'), null);
    assert.deepEqual([...document.querySelectorAll('.desktop-navigation button')].map(button => button.textContent), ['发现', '收藏', '历史']);
  } finally { app.unmount(); }
});

function mountPlayerControls(sources) {
  document.body.innerHTML='<div class="video-column"><div class="video-stage"><video></video></div></div><div id="mount"></div>';
  const video=document.querySelector('video');video.src='https://quark.example/original.mp4';video.currentTime=42;
  const qualityEvents=[];
  const props=reactive({video,ready:true,expanded:false,nativeFullscreen:false,pictureMode:'contain',sources,selectedSourceId:sources[0]?.id,onQuality:source=>qualityEvents.push(source)});
  const app=createApp({render:()=>h(PlayerControls,props)});app.mount('#mount');
  return {app,video,props,qualityEvents};
}
test('quick buttons and settings panels share rate/quality state without native select popups',async()=>{
 const sources=[{id:'high',label:'超高清 4K 杜比视界・长名称',delivery:'direct'},{id:'low',label:'<img src=x onerror=alert(1)>',delivery:'direct'},{id:'relay',label:'中转',delivery:'proxy'}];
 const view=mountPlayerControls(sources);
 try{
  await flush();const transport=document.querySelector('.xgplayer-controls'),menu=document.querySelector('.player-business-menu');
  assert.equal(transport.querySelectorAll('select').length,0);const quality=transport.querySelector('[aria-label="快捷画质"]');assert.equal(quality.textContent,'画质');assert.equal(transport.querySelector('.xgplayer-definition'),null);assert.equal(transport.querySelector('.xgplayer-playbackrate'),null);
  quality.click();await flush();assert.notEqual(menu.style.display,'none');assert.equal(menu.parentElement,document.querySelector('.video-column'));
  const options=[...menu.querySelectorAll('[aria-label="选择画质"] button')];assert.equal(options.length,2);assert.ok(options[0].textContent.includes(sources[0].label));assert.equal(options[1].textContent,sources[1].label);assert.equal(menu.querySelector('img'),null);
  const original=view.video.src;options[1].click();await flush();assert.deepEqual(view.qualityEvents.map(item=>item.id),['low']);assert.equal(view.video.src,original);assert.equal(view.video.currentTime,42);
  view.props.selectedSourceId='low';quality.click();await flush();const selected=menu.querySelector('[aria-label="选择画质"] [aria-pressed="true"]');assert.ok(selected.textContent.includes(sources[1].label));selected.click();assert.equal(view.qualityEvents.length,1);
  const quickSpeed=transport.querySelector('[aria-label="快捷倍速"]');quickSpeed.click();await flush();[...menu.querySelectorAll('[aria-label="播放速度"] button')].find(b=>b.textContent.trim()==='1.5×').click();await flush();assert.equal(view.video.playbackRate,1.5);assert.equal(view.video.defaultPlaybackRate,1.5);assert.equal(quickSpeed.textContent,'1.5×');
  view.video.playbackRate=.75;view.video.dispatchEvent(new window.Event('ratechange'));await flush();assert.equal(quickSpeed.textContent,'0.75×');quickSpeed.click();await flush();assert.match(menu.querySelector('[aria-label="播放速度"] [aria-pressed="true"]').textContent,/0.75/);
  view.props.sources=[sources[0]];await flush();assert.equal(transport.querySelector('[aria-label="快捷画质"]'),null);
 }finally{view.app.unmount();}
});
test('settings close without click-through, preserve keyboard focus and close for native fullscreen',async()=>{
  const view=mountPlayerControls([{id:'high',label:'超高清',delivery:'direct'}]);
  try {
    await flush();const gear=document.querySelector('[aria-label="播放设置"]'),menu=document.querySelector('.player-business-menu');gear.focus();gear.click();await flush();
    assert.equal(document.activeElement,menu);assert.equal(menu.getAttribute('role'),'dialog');assert.equal(menu.getAttribute('aria-modal'),'true');
    const backdrop=document.querySelector('.player-menu-backdrop');backdrop.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true}));await flush();assert.notEqual(menu.style.display,'none');
    backdrop.click();await flush();assert.equal(menu.style.display,'none');assert.equal(view.video.paused,true);
    gear.focus();gear.click();await flush();menu.querySelector('[aria-label="关闭播放器菜单"]').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();assert.equal(menu.style.display,'none');assert.equal(document.activeElement,gear);
    gear.focus();gear.click();await flush();view.props.nativeFullscreen=true;await flush();assert.equal(menu.style.display,'none');assert.ok(document.querySelector('.video-stage').classList.contains('misty-controls-disabled'));
  } finally {view.app.unmount();}
});

test('an interrupted player changes quality only after an explicit choice and resumes the same video at its saved position', async t => {
  mockApi(t); const baseFetch = globalThis.fetch;
  const sources = [
    { id: 'high', label: '高清', resolution: 'high', delivery: 'direct', mimeType: 'video/mp4', url: '/high.mp4' },
    { id: 'low', label: '流畅', resolution: 'normal', delivery: 'direct', mimeType: 'video/mp4', url: '/low.mp4' },
    { id: 'relay', label: '中转', resolution: 'normal', delivery: 'proxy', mimeType: 'video/mp4', url: '/relay.mp4' }
  ];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).includes('/episodes/')) return Response.json({ code: 0, data: { episode: episodes[0], sources, subtitles: [], audioTracks: [] } });
    if (String(url).includes('/playback-history')) return Response.json({ code: 0, data: { media } });
    return baseFetch(url, options);
  });
  const oldQuality = localStorage.getItem('misty_rain_player_quality'), oldDelivery = localStorage.getItem('misty_rain_player_delivery');
  localStorage.setItem('misty_rain_player_quality', 'high'); localStorage.setItem('misty_rain_player_delivery', 'direct');
  const app = mount(Player, { isOpen: true, media, username: 'quality-recovery' });
  try {
    await flush(); const video = document.querySelector('video');
    Object.defineProperties(video, { duration: { configurable: true, value: 600 }, readyState: { configurable: true, value: 1 }, error: { configurable: true, value: { code: MediaError.MEDIA_ERR_NETWORK } } });
    let attempts = 0; t.mock.method(video, 'play', async () => { attempts++; });
    t.mock.method(video, 'load', () => { video.currentTime = 0; });
    video.currentTime = 113; video.dispatchEvent(new window.Event('error')); await flush();
    const recovery = document.querySelector('select[aria-label="更换画质并重试"]');
    assert.ok(recovery); assert.deepEqual([...recovery.options].map(option => option.value), ['', 'low']);
    assert.match(document.querySelector('.error-state').textContent, /播放中断/);
    assert.ok(document.querySelector('.video-stage').classList.contains('misty-controls-disabled'));
    assert.equal(attempts, 0); assert.match(video.src, /\/high\.mp4$/);
    await flush(); assert.equal(attempts, 0); assert.match(video.src, /\/high\.mp4$/, 'waiting for a choice never changes the source');
    // Some browsers clear currentTime on network failure; recovery retains the saved interruption position.
    video.currentTime = 0; recovery.value = 'low'; recovery.dispatchEvent(new window.Event('change', { bubbles: true })); await flush();
    assert.equal(document.querySelector('video'), video); assert.match(video.src, /\/low\.mp4$/); assert.equal(video.currentTime, 113);
    assert.equal(attempts, 1); assert.equal(document.querySelector('.error-state'), null);
    assert.equal(document.querySelector('.video-stage').classList.contains('misty-controls-disabled'), false);
    assert.equal(localStorage.getItem('misty_rain_player_quality'), 'normal');
  } finally {
    app.unmount();
    oldQuality === null ? localStorage.removeItem('misty_rain_player_quality') : localStorage.setItem('misty_rain_player_quality', oldQuality);
    oldDelivery === null ? localStorage.removeItem('misty_rain_player_delivery') : localStorage.setItem('misty_rain_player_delivery', oldDelivery);
  }
});

test('a single direct quality leaves the interrupted player on the same source with only explicit reconnection', async t => {
  mockApi(t); const baseFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => String(url).includes('/playback-history')
    ? Response.json({ code: 0, data: { media } }) : baseFetch(url, options));
  const app = mount(Player, { isOpen: true, media, username: 'single-quality-recovery' });
  try {
    await flush(); const video = document.querySelector('video'), initialSrc = video.src;
    Object.defineProperty(video, 'error', { configurable: true, value: { code: MediaError.MEDIA_ERR_NETWORK } });
    let attempts = 0; t.mock.method(video, 'play', async () => { attempts++; });
    video.currentTime = 71; video.dispatchEvent(new window.Event('error')); await flush();
    assert.ok(document.querySelector('.error-state')); assert.equal(document.querySelector('.recovery-quality'), null);
    assert.match(document.querySelector('.reload-button').textContent, /重新连接并续播/);
    assert.equal(video.src, initialSrc); assert.equal(video.currentTime, 71); assert.equal(attempts, 0);
  } finally { app.unmount(); }
});

test('one playback settings entry keeps image changes and collapsed preferences separate', async t => {
  mockApi(t);localStorage.removeItem('misty_rain_picture_fit');localStorage.removeItem('misty_rain_picture_mode');
  const app=mount(Player,{isOpen:true,media,username:'fixture'});
  try{
    await flush();const controls=document.querySelector('.xgplayer-controls'),video=document.querySelector('video');
    assert.ok(controls);assert.equal(document.querySelector('.player-panel'),null);assert.equal(document.querySelectorAll('.subtitle-controls').length,1);
    const menu=document.querySelector('.player-business-menu');
    controls.querySelector('[aria-label="播放设置"]').click();await nextTick();
    const picture = label => [...document.querySelectorAll('.picture-options button')].find(b => b.textContent === label);
    video.currentTime=42;const src=video.getAttribute('src');picture('铺满').click();await nextTick();
    assert.equal(video.style.objectFit,'cover');assert.equal(document.querySelector('.video-stage').style.getPropertyValue('--video-ratio'),String(16/9));assert.equal(video.currentTime,42);assert.equal(video.getAttribute('src'),src);
    assert.equal(localStorage.getItem('misty_rain_picture_mode'),'cover');
    picture('裁切').click();await nextTick();assert.equal(video.style.transform,'scale(1.25)');assert.equal(video.currentTime,42);assert.equal(video.getAttribute('src'),src);
    picture('适应').click();await nextTick();assert.equal(video.style.transform,'none');assert.equal(video.style.objectFit,'contain');
    assert.equal(document.querySelector('.player-preferences-content').style.display,'none');document.querySelector('.player-preferences-toggle').click();await nextTick();assert.equal(menu.getAttribute('aria-label'),'播放设置');assert.equal(menu.querySelector('.business-menu-body > div:last-child').style.display,'none');
    document.querySelector('[aria-label="跳过片头片尾"]').click();await flush();assert.equal(document.querySelector('[aria-label="片头时长（秒）"]').value,'30');
    assert.ok(document.querySelector('.watch-details .episode-source-panel'));assert.equal(document.querySelector('.rotated-player'),null);
  }finally{app.unmount();localStorage.removeItem('misty_rain_picture_fit');localStorage.removeItem('misty_rain_picture_mode')}
});


test('Android player keeps one caption picker, pauses in background except PiP, and resumes without a blocking prompt', async t => {
  const previousAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android Chrome' });
  mockApi(t);
  const app = mount(Player, { isOpen: true, media, username: 'fixture' });
  const video = document.querySelector('video');
  let paused = false;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  video.pause = () => { paused = true; video.dispatchEvent(new window.Event('pause')); };
  video.play = async () => { paused = false; video.dispatchEvent(new window.Event('play')); video.dispatchEvent(new window.Event('playing')); };
  try {
    await flush(); await video.play(); await flush();
    assert.equal(document.querySelectorAll('.subtitle-controls').length, 1);
    assert.ok(document.querySelector('.player-business-menu .subtitle-controls'));
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: video });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new window.Event('visibilitychange')); await flush();
    assert.equal(paused, false, 'PiP continues while owning page is hidden');
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: null });
    video.dispatchEvent(new window.Event('leavepictureinpicture')); await flush();
    assert.equal(paused, true, 'leaving PiP in background pauses playback');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new window.Event('visibilitychange')); await flush();
    document.querySelector('.stage-play-button').click(); await flush();
    assert.equal(paused, false); assert.equal(document.querySelector('.play-prompt'), null);
  } finally {
    app.unmount();
    if (previousAgent) Object.defineProperty(navigator, 'userAgent', previousAgent); else delete navigator.userAgent;
    delete document.visibilityState; delete document.pictureInPictureElement;
  }
});

test('Android settings offer browser installation guidance instead of an iOS profile', async () => {
  const previousAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android Chrome' });
  const app = mount(Account, { user: user('user'), history: [] });
  try {
    assert.equal(document.querySelector('a[href*="mobileconfig"]'), null);
    [...document.querySelectorAll('button')].find(button => button.textContent.includes('安装到桌面')).click(); await flush();
    assert.match(document.querySelector('.install-hint').textContent, /Chrome/);
  } finally {
    app.unmount();
    if (previousAgent) Object.defineProperty(navigator, 'userAgent', previousAgent); else delete navigator.userAgent;
  }
});

test('new viewers get Chinese captions automatically; a manual off choice persists when tracks arrive later', async () => {
  const video = document.createElement('video');
  const props = reactive({ video, username: 'automatic-caption-fixture' });
  const app = mount(Subtitles, props);
  try {
    await flush();
    video.textTracks.push({ kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' }, { kind: 'subtitles', label: '中文', language: 'zh', mode: 'disabled' }, { kind: 'metadata', mode: 'hidden' });
    video.textTracks.dispatchEvent(new window.Event('addtrack')); await nextTick();
    assert.equal(video.textTracks[1].mode, 'showing'); assert.equal(video.textTracks[2].mode, 'hidden');
    const picker = document.querySelector('.subtitle-modes button:last-child'); picker.click(); await nextTick();
    video.dispatchEvent(new window.Event('subtitletracksupdated')); await nextTick();
    assert.equal(video.textTracks[1].mode, 'disabled'); assert.equal(picker.getAttribute('aria-pressed'), 'true');
  } finally { app.unmount(); }
});

test('movies display named files instead of an episode number or unlabeled dots', async t => {
  mockApi(t); const app = mount(Player, { isOpen: true, media: { ...media, category: 'movie' }, username: 'movie-label-fixture' });
  try {
    await flush();
    assert.ok(document.querySelector('[aria-label="视频列表"]'));
    assert.doesNotMatch(document.querySelector('.title-copy').textContent, /第.*集/);
    assert.match(document.querySelector('.episodes button').textContent, /1.mp4/);
  } finally { app.unmount(); }
});

test('native fullscreen subtitle choices are respected and retained after exiting', async () => {
  const video = document.createElement('video');
  video.textTracks.push({ kind: 'subtitles', label: '中文', language: 'zh', mode: 'disabled' });
  const props = reactive({ video, username: 'native-caption-fixture', nativeFullscreen: true });
  const app = mount(Subtitles, props);
  try {
    await flush();
    video.textTracks[0].mode = 'showing';
    video.textTracks.dispatchEvent(new window.Event('change'));
    await nextTick();
    assert.equal(video.textTracks[0].mode, 'showing', 'page preferences must not override the native picker');
    props.nativeFullscreen = false; await nextTick();
    assert.equal(video.textTracks[0].mode, 'showing');
    assert.equal(document.querySelector('.subtitle-modes button').getAttribute('aria-pressed'), 'true');
    const key = 'misty_rain_subtitles:native-caption-fixture';
    const choice = localStorage.getItem(key);
    props.nativeFullscreen = true; await nextTick();
    video.textTracks.splice(0);
    video.textTracks.dispatchEvent(new window.Event('removetrack'));
    await nextTick();
    assert.equal(localStorage.getItem(key), choice, 'an unavailable track list is not a user choice to disable subtitles');
  } finally { app.unmount(); }
});

test('captions arriving during native fullscreen start automatically, while a native off choice stays off', async () => {
  const video = document.createElement('video');
  const props = reactive({ video, username: 'late-native-caption-fixture', nativeFullscreen: true });
  const app = mount(Subtitles, props);
  try {
    await flush();
    video.textTracks.push({ kind: 'subtitles', label: '中文', language: 'zh', mode: 'hidden' });
    video.textTracks.dispatchEvent(new window.Event('addtrack')); await nextTick();
    assert.equal(video.textTracks[0].mode, 'showing');
    video.textTracks[0].mode = 'disabled'; video.textTracks.dispatchEvent(new window.Event('change')); await new Promise(r=>setTimeout(r,175)); await nextTick();
    video.dispatchEvent(new window.Event('subtitletracksupdated')); await nextTick();
    assert.equal(video.textTracks[0].mode, 'disabled');
  } finally { app.unmount(); }
});

test('a temporary hidden state in native fullscreen does not become a persisted off preference', async () => {
 const video=document.createElement('video');video.textTracks.push({kind:'subtitles',label:'中文',language:'zh',mode:'disabled'});
 const props=reactive({video,username:'native-handoff-fixture',nativeFullscreen:true});const app=mount(Subtitles,props);
 try{await flush();video.textTracks[0].mode='hidden';video.textTracks.dispatchEvent(new window.Event('change'));await nextTick();assert.equal(video.textTracks[0].mode,'hidden');props.nativeFullscreen=false;await nextTick();assert.equal(video.textTracks[0].mode,'showing');assert.notEqual(localStorage.getItem('misty_rain_subtitles:native-handoff-fixture'),'off');}finally{app.unmount()}
});

test('native selection of an equivalent filtered track preserves its language instead of turning all captions off', async () => {
 const video=document.createElement('video');video.textTracks.push({kind:'subtitles',label:'中文',language:'zh',mode:'disabled'});
 const hls={subtitleTracks:[{name:'中文',lang:'zh'}],subtitleTrack:-1,subtitleDisplay:false,constructor:{Events:{SUBTITLE_TRACKS_UPDATED:'updated',SUBTITLE_TRACK_SWITCH:'switch',SUBTITLE_TRACKS_CLEARED:'cleared'}},on(){},off(){}};
 const app=mount(Subtitles,{video,hls,username:'native-equivalent-fixture',nativeFullscreen:true});
 try{await flush();hls.subtitleDisplay=false;hls.subtitleTrack=-1;video.textTracks[0].mode='showing';video.textTracks.dispatchEvent(new window.Event('change'));await new Promise(r=>setTimeout(r,175));await nextTick();assert.notEqual(localStorage.getItem('misty_rain_subtitles:native-equivalent-fixture'),'off');assert.equal(hls.subtitleDisplay,true);}finally{app.unmount()}
});

test('searching new content updates the save title; replacing an existing source retains its identity', async t => {
  mockApi(t);
  let transfer;
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ setup() { transfer = useQuarkTransfer(); return () => h('div'); } }); app.mount('#mount');
  try {
    await transfer.openTransferModal({ ...media, id: 'new-search', quarkFid: undefined, title: '首次搜索', poster: 'old-poster', catalogId: 'douban-123', year: '2026' });
    await transfer.refreshResources('新片名');
    assert.equal(transfer.currentMedia.value.title, '新片名');
    assert.equal(transfer.currentMedia.value.poster, '');
    assert.equal(transfer.currentMedia.value.catalogId, undefined);
    assert.equal(transfer.currentMedia.value.year, undefined);
    await transfer.openTransferModal(media);
    await transfer.refreshResources('测试影片的别名');
    assert.equal(transfer.currentMedia.value.title, media.title);
    assert.equal(transfer.currentMedia.value.quarkFid, media.quarkFid);
  } finally { transfer.closeTransferModal(); app.unmount(); }
});

test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });

test('three episode views retain sort and current identity, with only whole-series collection', async t => {
  mockApi(t); const collected=[];
  const item={...media,quarkFid:undefined,quarkShareUrl:'https://pan.quark.cn/s/fixture'};
  const app=mount(Player,{isOpen:true,media:item,username:'panel-fixture',collect:async value=>collected.push(value)});
  try {
    await flush();
    const panel=document.querySelector('.watch-details .episode-source-panel');assert.ok(panel);
    assert.equal(document.querySelector('.episode-actions'),null);assert.doesNotMatch(panel.textContent,/收藏本集/);
    assert.equal(panel.querySelectorAll('.resource-thumbnail').length,2);
    panel.querySelector('[aria-label="紧凑列表"]').click();await nextTick();
    assert.equal(panel.querySelector('.resource-thumbnail'),null);assert.ok(panel.querySelector('.view-compact'));
    panel.querySelector('[aria-label="数字格"]').click();await nextTick();
    assert.equal(panel.querySelector('.resource-thumbnail'),null);assert.equal(panel.querySelector('.episodes button').textContent,'1');
    const order=panel.querySelector('[aria-label="选集排序"]');order.value='desc';order.dispatchEvent(new window.Event('change'));await nextTick();
    assert.equal(panel.querySelector('.episodes button').textContent,'2');
    assert.equal(panel.querySelector('.episodes [aria-selected="true"]').textContent,'1');
    assert.equal(localStorage.getItem('misty_rain_episode_view'),'numbers');
    document.querySelector('.watch-summary .collect-series').click();await flush();
    assert.deepEqual(collected,[item]);
  } finally {app.unmount();localStorage.removeItem('misty_rain_episode_order');localStorage.removeItem('misty_rain_episode_view');}
});

const { findPlaybackCandidates } = await compile('src/services/playbackCandidates.ts','playback-candidates');
const { replacementEpisodeIndex } = await compile('src/services/playbackNavigation.ts','playback-switch-navigation');
test('background source prefetch checks only a bounded batch, excludes cancelled/current shares and never transfers',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options={})=>{
  calls.push(String(url));
  if(String(url).includes('/validate')){const items=JSON.parse(options.body).items;assert.ok(items.length<=12);return Response.json({code:0,data:{pending:false,entries:items.map((item,index)=>({...item,status:index===0?'unavailable':'available'}))}});}
  assert.match(String(url),/background=1/);
  return Response.json({code:0,data:{total:20,refreshing:false,merged_by_type:{quark:Array.from({length:20},(_,i)=>({url:`https://pan.quark.cn/s/source${i}`,note:'测试剧 '+i}))}}});
 });
 const result=await findPlaybackCandidates('测试剧','https://pan.quark.cn/s/source0',new AbortController().signal,()=>{});
 assert.equal(result.items.length,5);assert.equal(result.complete,true);assert.ok(!result.items.some(item=>/source[01]$/.test(item.url)));assert.equal(calls.length,2);assert.ok(calls.every(url=>url.includes('resource-search')));
});
test('leaving playback cancels the background HTTP request and prevents later publication',async t=>{
 let requested, published=0; t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_resolve,reject)=>{requested=signal;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});}));
 const controller=new AbortController();const task=findPlaybackCandidates('测试剧','',controller.signal,()=>published++);controller.abort();await assert.rejects(task,{name:'AbortError'});
 assert.equal(requested.aborted,true);assert.equal(published,0);
});
test('a source switch matches season and episode, refusing a missing episode instead of jumping',()=>{
 const list=[{fileName:'s2e2',seasonNumber:2,episodeNumber:2},{fileName:'s1e2',seasonNumber:1,episodeNumber:2}];
 assert.equal(replacementEpisodeIndex(list,{fileName:'old',seasonNumber:1,episodeNumber:2},'tv'),1);
 assert.equal(replacementEpisodeIndex(list,{fileName:'old',seasonNumber:1,episodeNumber:3},'tv'),-1);
 assert.equal(replacementEpisodeIndex(list,{fileName:'s2e2',episodeNumber:0},'tv'),0);
});

test('background source prefetch aborts a stalled request at its twenty-second deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let requestSignal;
 t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_resolve,reject)=>{requestSignal=signal;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})}));
 const task=findPlaybackCandidates('测试剧','',new AbortController().signal,()=>assert.fail('no late publication'));
 t.mock.timers.tick(20_001);await task;assert.equal(requestSignal.aborted,true);
});

test('fullscreen moves the same episode panel and restores its compact view when exiting', async t => {
  mockApi(t);
  const original=document.exitFullscreen;
  const originalRequest=window.HTMLElement.prototype.requestFullscreen;
  window.HTMLElement.prototype.requestFullscreen=async function(){Object.defineProperty(document,'fullscreenElement',{configurable:true,value:this});document.dispatchEvent(new window.Event('fullscreenchange'));};
  document.exitFullscreen=async()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});document.dispatchEvent(new window.Event('fullscreenchange'));};
  const app=mount(Player,{isOpen:true,media,username:'fullscreen-layout'});
  try{
    await flush();const video=document.querySelector('video');Object.defineProperty(video,'readyState',{configurable:true,value:1});
    const panel=document.querySelector('.episode-source-panel');panel.querySelector('[aria-label="紧凑列表"]').click();await flush();
    document.querySelector('[aria-label="全屏播放"]').click();await flush();
    assert.equal(document.querySelectorAll('.episode-source-panel').length,1);assert.ok(panel.closest('.player-business-menu'));
    document.querySelector('[aria-label="选集与片源"]').click();await flush();assert.notEqual(document.querySelector('.player-business-menu').style.display,'none');
    await document.exitFullscreen();await flush();assert.equal(document.querySelector('.watch-details .episode-source-panel'),panel);assert.ok(panel.querySelector('.view-compact'));assert.equal(panel.querySelectorAll('[aria-selected="true"]').length,1);
  }finally{app.unmount();document.exitFullscreen=original;window.HTMLElement.prototype.requestFullscreen=originalRequest;localStorage.removeItem('misty_rain_episode_view');}
});

test('iOS inline zoom keeps captions in the visible viewport and hands them back in native fullscreen',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'userAgent');Object.defineProperty(navigator,'userAgent',{configurable:true,value:'iPhone Safari'});
 localStorage.removeItem('misty_rain_picture_mode');localStorage.removeItem('misty_rain_picture_fit');mockApi(t);
 const app=mount(Player,{isOpen:true,media,username:'ios-crop'});
 try{
  await flush();const video=document.querySelector('video');assert.equal(video.classList.contains('player-captions-active'),true);
  document.querySelector('[aria-label="播放设置"]').click();await nextTick();[...document.querySelectorAll('.picture-options button')].find(button => button.textContent === '裁切').click();await flush();
  assert.equal(video.style.transform,'scale(1.25)');assert.equal(video.classList.contains('player-captions-active'),true);
  video.dispatchEvent(new window.Event('webkitbeginfullscreen'));await flush();assert.equal(video.classList.contains('player-captions-active'),false);
  video.dispatchEvent(new window.Event('webkitendfullscreen'));await flush();assert.equal(video.classList.contains('player-captions-active'),true);
 }finally{app.unmount();localStorage.removeItem('misty_rain_picture_mode');if(descriptor)Object.defineProperty(navigator,'userAgent',descriptor);else delete navigator.userAgent;}
});

test('partial catalog displays an honest notice and refreshes when returning; complete results clear it', async t => {
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({code:0,data:{items:[discovered],partial:calls===1}})});
 const props=reactive({query:'部分片名',active:true,libraryCatalogIds:[]});const app=mount(Catalog,props);
 try {
  await flush();assert.match(document.querySelector('.catalog-notice').textContent,/部分结果/);assert.ok(document.querySelector('.catalog-card'));
  props.active=false;await flush();props.active=true;await flush();
  assert.equal(calls,2);assert.equal(document.querySelector('.catalog-notice'),null);
 }finally{app.unmount();}
});

const chooseFacet = async (label,value) => {
 const group=document.querySelector(`[aria-label="${label}"]`);assert.ok(group,label);
 const button=[...group.querySelectorAll('button')].find(button=>button.textContent===value);assert.ok(button,value);button.click();await flush();
};
const reachScrollEnd=async el=>{
 el.getClientRects=()=>[{width:100,height:2}];el.getBoundingClientRect=()=>({top:10,bottom:12,width:100,height:2});
 window.dispatchEvent(new window.Event('resize'));await flush();
};
const finishBrowseFilters=async()=>{};
const settleBrowse = async () => { await new Promise(resolve=>setTimeout(resolve,210));await flush(); };
test('catalog keyword search stays simple with no discovery tag controls',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({code:0,data:{items:[discovered]}}));const app=mount(Catalog,{query:'测试',active:true,libraryCatalogIds:[]});
 try{await flush();assert.equal(document.querySelector('.catalog-filters'),null);assert.ok(document.querySelector('select[aria-label="影片排序"]'));}finally{app.unmount();}
});
test('browse combines filters, cancels obsolete queries, deduplicates pagination and ignores inactive responses',async t=>{
 const requests=[];let selected;
 t.mock.method(globalThis,'fetch',(url,options)=>{
  const address=new URL(String(url),'http://localhost');
  if(address.pathname.endsWith('/discovery'))return Promise.resolve(Response.json({code:0,data:{sections:[discoverySection('movie')]}}));
  return new Promise(resolve=>requests.push({address,options,resolve}));
 });
 const props=reactive({active:true,libraryCatalogIds:[],state:{category:'movie',filters:{genre:'',country:'',year:''},sort:'popularity',calendar:false,weekday:1},onSelect:item=>selected=item});props['onUpdate:state']=value=>props.state=value;const app=mount(Browse,props);
 try {
  await flush();await chooseFacet('类型筛选','科幻');await chooseFacet('地区筛选','美国');await chooseFacet('年份筛选','2024');await settleBrowse();
  assert.equal(requests.length,1);assert.equal(requests[0].address.searchParams.get('sort'),'popularity');assert.equal(requests[0].address.searchParams.get('genre'),'科幻');assert.equal(requests[0].address.searchParams.get('country'),'美国');
  await chooseFacet('年份筛选','2025');assert.equal(requests[0].options.signal.aborted,true);await settleBrowse();assert.equal(requests.length,2);
  requests[1].resolve(Response.json({code:0,data:{items:[{...discovered,id:'douban-20',title:'新结果'}],partial:false,nextStart:24}}));await flush();
  requests[0].resolve(Response.json({code:0,data:{items:[{...discovered,title:'过时结果'}],partial:false,nextStart:null}}));await flush();
  assert.match(document.querySelector('.discovery-title').textContent,/新结果/);assert.doesNotMatch(document.body.textContent,/过时结果/);
  await reachScrollEnd(document.querySelector('.catalog-browse .scroll-load'));await flush();assert.equal(requests[2].address.searchParams.get('start'),'24');
  requests[2].resolve(Response.json({code:0,data:{items:[{...discovered,id:'douban-20',title:'新结果'},{...discovered,id:'douban-21',title:'下一页'}],partial:false,nextStart:null}}));await flush();
  assert.equal(document.querySelectorAll('.discovery-card').length,2);assert.equal(document.querySelector('.browse-more'),null);
  [...document.querySelectorAll('.discovery-card')].find(card=>card.textContent.includes('下一页')).click();assert.equal(selected.id,'douban-21');
  [...document.querySelectorAll('[aria-label="片库分类"] button')].find(button=>button.textContent==='电视剧').click();await settleBrowse();const last=requests.at(-1);assert.equal(last.address.searchParams.get('category'),'tv');props.active=false;await flush();assert.equal(last.options.signal.aborted,true);
  last.resolve(Response.json({code:0,data:{items:[{...discovered,title:'后台旧结果'}],partial:false,nextStart:null}}));await flush();assert.doesNotMatch(document.body.textContent,/后台旧结果/);
 }finally{app.unmount();}
});
test('browse empty and failed states provide recovery without discarding a loaded page',async t=>{
 let mode='empty';t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('/api/discovery'))return Response.json({code:0,data:{sections:[]}});
  if(mode==='error')return Response.json({code:503},{status:503});
  return Response.json({code:0,data:{items:mode==='empty'?[]:[discovered],partial:false,nextStart:mode==='empty'?null:24}});
 });
 const state=reactive({active:true,libraryCatalogIds:[],state:{category:'movie',filters:{genre:'',country:'',year:''},sort:'popularity',calendar:false,weekday:1}});state['onUpdate:state']=value=>state.state=value;const app=mount(Browse,state);
 try {
  await flush();await chooseFacet('类型筛选','科幻');await settleBrowse();assert.match(document.body.textContent,/暂无匹配影片/);
  mode='loaded';await chooseFacet('地区筛选','美国');await settleBrowse();assert.ok(document.querySelector('.catalog-browse .scroll-load'));
  mode='error';await reachScrollEnd(document.querySelector('.catalog-browse .scroll-load'));await flush();assert.ok(document.querySelector('.discovery-card'));assert.match(document.querySelector('[role="alert"]').textContent,/暂时无法加载/);
 }finally{app.unmount();}
});

test('failed backup source is removed immediately and cannot return on refresh; current video and episode stay unchanged',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});mockApi(t);const baseFetch=globalThis.fetch;
 const item={...media,quarkShareUrl:'https://pan.quark.cn/s/current'};let switches=0;
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  if(String(url).includes('/resource-search/validate'))return Response.json({code:0,data:{pending:false,entries:JSON.parse(options.body).items.map(item=>({...item,status:switches>0&&item.url.endsWith('/bad')?'unavailable':'available'}))}});
  if(String(url).includes('/resource-search'))return Response.json({code:0,data:{total:3,refreshing:false,merged_by_type:{quark:['bad','good1','good2'].map(id=>({url:'https://pan.quark.cn/s/'+id,note:media.title+' '+id}))}}});
  if(String(url).includes('/playback-history'))return Response.json({code:0,data:{media:item}});
  return baseFetch(url,options);
 });
 const app=mount(Player,{isOpen:true,media:item,username:'candidate-rejection',switchSource:async()=>{switches++;throw Object.assign(new Error('资源文件列表未读取完整，请刷新重试'),{code:'QUARK_SHARE_UNAVAILABLE'});}});
 try {
  await flush();t.mock.timers.tick(2000);await flush();
  const video=document.querySelector('video');video.currentTime=42;const source=video.getAttribute('src');
  const active=document.querySelector('.episode-row[aria-selected="true"]').getAttribute('aria-label');
  const bad=document.querySelector('[aria-label="源2"]');assert.ok(bad);bad.click();await flush();
  assert.equal(switches,1);assert.equal(document.querySelector('[aria-label="源2"]'),null);
  assert.match(document.querySelector('.source-status').textContent,/已移除/);assert.equal(video.currentTime,42);assert.equal(video.getAttribute('src'),source);
  assert.equal(document.querySelector('.episode-row[aria-selected="true"]').getAttribute('aria-label'),active);
  document.querySelector('[aria-label="刷新备选片源"]').click();await flush();
  assert.equal(document.querySelector('[aria-label="源2"]'),null);assert.equal(document.querySelectorAll('.source-chip').length,3);
 }finally{app.unmount();}
});
test('an unreadable detail source is removed but authentication errors stay recoverable',async t=>{
 let code='QUARK_SHARE_LIST_INCOMPLETE',removed=0;
 t.mock.method(globalThis,'fetch',async()=>Response.json({code,message:'无法读取'},{status:502}));
 let app=mount(Details,{resource:{url:'https://pan.quark.cn/s/bad'},onUnavailable:()=>removed++});
 await flush();assert.equal(removed,1);app.unmount();
 code='QUARK_AUTH_REQUIRED';app=mount(Details,{resource:{url:'https://pan.quark.cn/s/retry'},onUnavailable:()=>removed++});
 try{await flush();assert.equal(removed,1);assert.match(document.querySelector('[role="alert"]').textContent,/无法读取/);}finally{app.unmount();}
});

test('direct share management uses the existing file picker without a search or automatic save and keeps loaded titles stable',async t=>{
 let reads=0,saves=0,title='';
 t.mock.method(globalThis,'fetch',async(url)=>{assert.match(String(url),/share-details/);reads++;return Response.json({code:0,data:{title:'分享目录',videoCount:1,episodeCount:1,entries:[{fid:'file-1',parentFid:'0',ancestorFids:[],name:'第1集.mp4',isDirectory:false,isVideo:true,isSubtitle:false,size:10,sizeFormatted:'10 MB'}]}});});
 const shared={id:'share-fixture',title:'分享资源',url:'https://pan.quark.cn/s/fixture123',password:'abcd',driveType:'quark',datetime:'',source:'分享链接',quality:'',is4k:false};
 const app=mount(ResourceModal,{isOpen:true,isAnalyzing:false,media:{...media,id:'share-link-fixture',quarkFid:undefined,title:'待识别片名'},currentCategory:'tv',quarkResources:[shared],initialResource:shared,onSaveToCards:()=>saves++,onPreviewTitle:value=>title=value});
 try{await flush();assert.equal(reads,1);assert.equal(saves,0);assert.equal(title,'分享目录');assert.equal(document.querySelectorAll('.file-row').length,1);assert.equal(document.querySelector('.result-search'),null);await flush();assert.equal(reads,1,'title installation must not cause a resource reload loop');}finally{app.unmount();}
});

test('pending resource validation has row skeletons until results or an explicit error, not an empty page',async()=>{
 const state=reactive({isOpen:true,isAnalyzing:false,searchPending:true,media,currentCategory:'tv',quarkResources:[],searchError:''});
 const app=mount(ResourceModal,state);try{assert.ok(document.querySelector('.skeleton-rows'));assert.equal(document.querySelector('.empty-notice'),null);state.searchPending=false;state.searchError='读取失败';await nextTick();assert.equal(document.querySelector('.skeleton-rows'),null);assert.match(document.querySelector('[role=alert]').textContent,/读取失败/);}finally{app.unmount();}
});
test('history initial reads use poster skeletons while refreshes retain already loaded records',async()=>{
 const state=reactive({history:[],loadingHistory:true});const app=mount(HistoryPage,state);
 try{assert.ok(document.querySelector('.skeleton-cards'));state.history=[{id:'fixture',media,position:10,duration:100}];await nextTick();assert.equal(document.querySelector('.skeleton-cards'),null);assert.equal(document.querySelectorAll('.history-row').length,1);}finally{app.unmount();}
});

test('discovery is a recommendation-only page; its series and US shelves open precise catalog presets',async t=>{
 const calls=[],presets=[];
 t.mock.method(globalThis,'fetch',async url=>{const parsed=new URL(String(url),'http://localhost');calls.push(parsed);if(parsed.pathname.endsWith('/discovery'))return Response.json({code:0,data:{sections:[{...discoverySection('tv'),id:'tv',title:'近期热播'},{...discoverySection('movie'),id:'movie'}]}});return Response.json({code:0,data:{items:[{...discovered,id:'douban-901',category:'tv',title:'美剧验证',countries:['美国']}],partial:false,nextStart:null}});});
 const app=mount(Discovery,{active:true,libraryCatalogIds:[],onBrowse:value=>presets.push(value)});
 try{await flush();assert.equal(document.querySelector('.discovery-categories'),null);assert.equal(document.querySelector('.catalog-filters'),null);assert.match(document.body.textContent,/近期热剧/);assert.match(document.body.textContent,/热门美剧/);const us=calls.find(url=>url.pathname.endsWith('/browse'));assert.equal(us.searchParams.get('category'),'tv');assert.equal(us.searchParams.get('country'),'美国');assert.equal(us.searchParams.get('sort'),'popularity');document.querySelector('[aria-label="查看更多美剧"]').click();assert.deepEqual(presets[0],{category:'tv',country:'美国'});document.querySelector('[aria-label="查看更多电影"]').click();assert.equal(presets[1].category,'movie');}finally{app.unmount();}
});

test('leaving a catalog during pagination preserves cards and resuming retries only the interrupted cursor',async t=>{
 const requests=[];
 t.mock.method(globalThis,'fetch',(url,options)=>{const start=Number(new URL(String(url),'http://localhost').searchParams.get('start'));if(start===0){requests.push({start});return Promise.resolve(Response.json({code:0,data:{items:[discovered],nextStart:24,partial:false}}));}return new Promise(resolve=>requests.push({start,options,resolve}));});
 const props=reactive({active:true,libraryCatalogIds:[],state:{category:'movie',filters:{genre:'',country:'',year:''},sort:'popularity',calendar:false,weekday:1}});props['onUpdate:state']=value=>props.state=value;const app=mount(Browse,props);
 try{await settleBrowse();const sentinel=document.querySelector('.catalog-browse .scroll-load');await reachScrollEnd(sentinel);assert.deepEqual(requests.map(r=>r.start),[0,24]);props.active=false;await flush();assert.equal(requests[1].options.signal.aborted,true);assert.equal(document.querySelectorAll('.discovery-card').length,1);props.active=true;await flush();assert.deepEqual(requests.map(r=>r.start),[0,24,24]);requests[2].resolve(Response.json({code:0,data:{items:[{...discovered,id:'douban-902',title:'继续加载'}],nextStart:null,partial:false}}));await flush();requests[1].resolve(Response.json({code:0,data:{items:[{...discovered,id:'douban-903',title:'旧响应'}],nextStart:null,partial:false}}));await flush();assert.equal(document.querySelectorAll('.discovery-card').length,2);assert.doesNotMatch(document.body.textContent,/旧响应/);}finally{app.unmount();}
});


test('iOS defaults to web fullscreen, preserves the video and composes settings and fullscreen Escape exits',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'userAgent');Object.defineProperty(navigator,'userAgent',{configurable:true,value:'iPhone Safari'});
 localStorage.removeItem('misty_rain_picture_mode');mockApi(t);const app=mount(Player,{isOpen:true,media,username:'ios-web'});
 try{
  await flush();const video=document.querySelector('video');Object.defineProperty(video,'readyState',{configurable:true,value:1});video.currentTime=42;const url=video.src;
  document.querySelector('[aria-label="全屏播放"]').click();await flush();assert.ok(document.querySelector('.web-fullscreen[role="dialog"]'));assert.equal(video,document.querySelector('video'));assert.equal(video.src,url);assert.equal(video.currentTime,42);assert.equal(video.controls,false);assert.equal(video.classList.contains('player-captions-active'),true);assert.equal(document.body.style.overflow,'hidden');
  document.querySelector('[aria-label="播放设置"]').click();await flush();document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();assert.ok(document.querySelector('.web-fullscreen'));assert.equal(document.querySelector('.player-business-menu').style.display,'none');assert.equal(document.body.style.overflow,'hidden');
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();assert.equal(document.querySelector('.web-fullscreen'),null);assert.equal(video,document.querySelector('video'));assert.equal(video.currentTime,42);assert.notEqual(document.body.style.overflow,'hidden');
 }finally{app.unmount();if(descriptor)Object.defineProperty(navigator,'userAgent',descriptor);else delete navigator.userAgent;}
});

test('fullscreen settings dock beside the same video and temporarily fit the full picture',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(navigator,'userAgent');Object.defineProperty(navigator,'userAgent',{configurable:true,value:'iPhone Safari'});localStorage.setItem('misty_rain_picture_mode','crop');mockApi(t);const app=mount(Player,{isOpen:true,media,username:'panel-fit'});
 try{await flush();const video=document.querySelector('video');Object.defineProperty(video,'readyState',{configurable:true,value:1});video.currentTime=42;const url=video.src;document.querySelector('[aria-label="全屏播放"]').click();await flush();assert.equal(document.querySelector('.web-fullscreen-exit'),null);assert.equal(video.style.transform,'scale(1.25)');document.querySelector('[aria-label="播放设置"]').click();await flush();assert.ok(document.querySelector('.player-panel-open'));assert.equal(document.querySelector('.player-menu-backdrop'),null);assert.equal(video.style.objectFit,'contain');assert.equal(video.style.transform,'none');document.querySelector('[aria-label="关闭播放器菜单"]').click();await flush();assert.equal(document.querySelector('.player-panel-open'),null);assert.equal(video.style.transform,'scale(1.25)');assert.equal(video.src,url);assert.equal(video.currentTime,42);}finally{app.unmount();localStorage.removeItem('misty_rain_picture_mode');if(descriptor)Object.defineProperty(navigator,'userAgent',descriptor);else delete navigator.userAgent;}
});
