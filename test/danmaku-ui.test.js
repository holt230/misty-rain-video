import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from 'vue/compiler-sfc';
import { build } from 'esbuild';

// Compile only this component, not the application. Test the actual renderer and Vue lifecycle.
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'localStorage', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'CustomEvent']) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.VTTCue = class {
  constructor(startTime, endTime, text) { this.startTime = startTime; this.endTime = endTime; this.text = text; }
};
const { createApp, nextTick, reactive, markRaw, h, ref } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/danmaku-ui-');
const file = 'src/components/player/DanmakuControls.vue';
const compiled = compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: 'danmaku-test', inlineTemplate: true });
const output = path.resolve(folder, 'component.mjs');
await build({ stdin: { contents: compiled.content, loader: 'ts', resolveDir: path.resolve('src/components/player'), sourcefile: 'DanmakuControls.vue' }, outfile: output, bundle: true, format: 'esm', platform: 'browser', external: ['vue'], define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',plugins:[{name:'vue-child',setup(b){b.onLoad({filter:/\.vue$/},args=>({contents:compileScript(parse(fs.readFileSync(args.path,'utf8')).descriptor,{id:args.path,inlineTemplate:true}).content,loader:'ts',resolveDir:path.dirname(args.path)}));}}] });
const Component = (await import(pathToFileURL(output))).default;
const input = { mediaKey: 'sample', title: '测试剧', category: 'tv', episodeNumber: 1, episodeTitle: '第1集' };
const source = { platform: 'qq', id: 'j4100jwv4qo', workId: '2:ABCdef', title: '测试剧', year: '2024', episodeTitle: '第1集', segmentSeconds: 30 };
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 35)); await nextTick(); };
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.includes(text));
function mount(handler) {
  localStorage.clear();
  document.body.innerHTML = '<div id="stage"><video></video></div><div id="mount"></div>';
  const video = document.querySelector('video');
  Object.defineProperty(video, 'duration', { configurable: true, value: 180 });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
  Object.defineProperty(video.parentElement, 'clientWidth', { configurable: true, value: 402 });
  const tracks = [];
  Object.defineProperty(video, 'textTracks', { value: tracks });
  video.addTextTrack = (kind, label) => {
    const track = {
      kind, label, cues: [], mode: 'disabled',
      addCue(cue) { this.cues.push(cue); },
      removeCue(cue) { const index = this.cues.indexOf(cue); if (index < 0) throw new Error('Unknown cue'); this.cues.splice(index, 1); }
    };
    tracks.push(track);
    return track;
  };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const data = await handler(String(url), options);
    if (data instanceof Response) return data;
    return new Response(JSON.stringify({ code: 0, data }), { headers: { 'Content-Type': 'application/json' } });
  };
  const props = reactive({ video: markRaw(video), input: { ...input } });
  const component=ref(null);const app = createApp({ render: () => h(Component, {...props,ref:component}) }); app.mount('#mount');
  return { app, props, calls, video, tracks, controls:()=>component.value, get nativeTrack() { return tracks.find(track => track.label === '弹幕'); },
    remount() { this.app.unmount(); this.app = createApp({ render: () => h(Component, props) }); this.app.mount('#mount'); }
  };
}
function defaultResponse(url) {
  if (url.includes('/match')) return { selected: source, candidates: [], status: 'matched' };
  return { comments: [{ time: 1, text: '<img src=x onerror=alert(1)>', color: '#ffffff', mode: 'rtl' }], index: 0, segmentSeconds: 30, fetchedAt: Date.now(), stale: false };
}
const apiError = (code, status = 502) => new Response(JSON.stringify({ code, message: '测试错误详情' }), {
  status, headers: { 'Content-Type': 'application/json' }
});

const enable=async()=>{button('海量').click();await flush();await flush();};
const sourceText=()=>document.querySelector('.danmaku-source')?.textContent || '';
const submit=async value=>{const field=document.querySelector('[aria-label="弹幕片名或链接"]');field.value=value;field.dispatchEvent(new window.Event('input'));await nextTick();field.closest('form').dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();};
const work={id:'2:ABCdef',title:'测试剧',year:'2024',category:'2',categoryLabel:'电视剧',platforms:['qq']};
const choices=(item=work)=>({workId:item.id,title:item.title,year:item.year,category:item.category,episodes:[{key:'1',number:1,title:'第1集',platforms:['qq']}]});
const confirm=async()=>{button('确认关联').click();await flush();await flush();};

test('off makes no requests; toolbar cycles and off/on reuses the confirmed source and comments',async()=>{
 const view=mount(defaultResponse);try{
  await flush();assert.equal(view.calls.length,0);view.controls().cycleMode();await flush();await flush();assert.equal(view.controls().mode,'normal');assert.ok(document.querySelector('.danmaku-overlay').childElementCount);
  view.controls().cycleMode();await flush();assert.equal(view.controls().mode,'low');view.controls().cycleMode();await flush();assert.equal(view.controls().mode,'off');assert.equal(document.querySelector('.danmaku-overlay').childElementCount,0);
  const matches=view.calls.filter(c=>c.url.includes('/match')).length;view.controls().cycleMode();await flush();await flush();assert.equal(view.calls.filter(c=>c.url.includes('/match')).length,matches);assert.ok(sourceText().includes('测试剧'));assert.equal(document.querySelectorAll('.danmaku-overlay img').length,0);
 }finally{view.app.unmount()}
});

test('choosing a work is a draft; one explicit confirmation enables and remembers it',async()=>{
 const view=mount(url=>url.includes('/match')?{selected:null,candidates:[work],status:'choose'}:url.includes('/options')?choices():url.includes('/select')?source:defaultResponse(url));try{
  button('搜索片名').click();await flush();assert.ok(document.querySelector('[aria-label="弹幕片名或链接"]'));assert.ok(document.querySelector('.danmaku-work'));
  document.querySelector('.danmaku-work').click();await flush();assert.equal(view.calls.filter(c=>c.url.includes('/select')).length,0);await confirm();assert.equal(view.controls().mode,'low');assert.ok(sourceText().includes('测试剧'));assert.ok(document.querySelector('.danmaku-overlay').childElementCount);
 }finally{view.app.unmount()}
});

test('search and failed replacement retain the active source, video time and renderer; retry targets the same choice',async()=>{
 let selection=0;const other={...work,id:'2:OtherId',title:'其他作品'};
 const view=mount((url,opts)=>{if(url.includes('/match'))return JSON.parse(opts.body).query?{selected:null,candidates:[other],status:'choose'}:{selected:source,candidates:[],status:'matched'};if(url.includes('/options'))return choices(other);if(url.includes('/select'))return ++selection===1?apiError('DANMAKU_SOURCE_UNAVAILABLE'):{...source,workId:other.id,title:other.title};return defaultResponse(url)});try{
  await enable();view.video.currentTime=42;const renderer=document.querySelector('.danmaku-overlay').firstChild;
  button('更换').click();await flush();assert.equal(document.querySelector('.danmaku-overlay').firstChild,renderer);document.querySelector('.danmaku-work').click();await flush();await confirm();assert.ok(document.querySelector('.danmaku-status')); assert.equal(document.querySelector('.danmaku-overlay').firstChild,renderer);assert.equal(view.video.currentTime,42);
  button('重试').click();await flush();await flush();assert.match(sourceText(),/其他作品/);assert.equal(selection,2);const calls=view.calls.filter(c=>c.url.includes('/select')).map(c=>JSON.parse(c.options.body));assert.deepEqual(calls[0],calls[1]);
 }finally{view.app.unmount()}
});

test('closing a draft search never replaces the active source and an aborted late result is ignored',async()=>{
 let finish;const view=mount((url,opts)=>url.includes('/match')&&JSON.parse(opts.body).query?new Promise(r=>{finish=r}):defaultResponse(url));try{
  await enable();button('更换').click();await flush();view.controls().back();await flush();finish({selected:{...source,title:'wrong'},candidates:[work],status:'matched'});await flush();assert.match(sourceText(),/测试剧/);assert.doesNotMatch(sourceText(),/wrong/);
 }finally{view.app.unmount()}
});

test('ambiguous automatic matches expose candidates immediately; year is included and no platform is forced',async()=>{
 const view=mount(url=>url.includes('/match')?{selected:null,candidates:[work,{...work,id:'2:OtherId',year:'2020'}],status:'choose'}:url.includes('/options')?choices():url.includes('/select')?source:defaultResponse(url));view.props.input.year='2024';try{
  await enable();assert.equal(document.querySelectorAll('.danmaku-work').length,2);document.querySelector('.danmaku-work').click();await flush();await confirm();assert.match(sourceText(),/第1集/);const body=JSON.parse(view.calls.find(c=>c.url.includes('/select')).options.body);assert.equal(body.platform,undefined);assert.equal(body.year,'2024');
 }finally{view.app.unmount()}
});

test('episode correction shows real sparse choices and only available platforms',async()=>{
 const view=mount((url,opts)=>url.includes('/options')?{workId:work.id,title:work.title,category:'2',episodes:[{key:'1',number:1,title:'第1集',platforms:['qq']},{key:'3',number:3,title:'第3集',platforms:['qiyi']}]}:url.includes('/select')?{...source,platform:'qiyi',episodeNumber:3,episodeTitle:'第3集'}:defaultResponse(url));try{
  await enable();button('集数与来源').click();await flush();assert.equal(document.querySelectorAll('.danmaku-episodes button').length,1);button('自动').click();await flush();assert.equal(document.querySelectorAll('.danmaku-episodes button').length,2);assert.doesNotMatch(document.querySelector('.source-options').textContent,/优酷|哔哩/);button('爱奇艺').click();await flush();assert.equal(document.querySelectorAll('.danmaku-episodes button').length,1);document.querySelector('.danmaku-episodes button').click();await flush();assert.equal(view.calls.filter(c=>c.url.includes('/select')).length,0);await confirm();
  const body=JSON.parse(view.calls.find(c=>c.url.includes('/select')).options.body);assert.equal(body.episodeNumber,1);assert.equal(body.targetEpisode,3);assert.equal(body.platform,'qiyi');assert.equal(body.scope,'season');assert.match(sourceText(),/第3集/);
 }finally{view.app.unmount()}
});

test('one search accepts a shared episode URL, and a retry keeps the submitted link',async()=>{
 let attempts=0;const view=mount(url=>url.includes('/match')?{selected:null,candidates:[],status:'missing'}:url.includes('/select')?++attempts===1?apiError('DANMAKU_SOURCE_UNAVAILABLE'):{...source,platform:'bilibili',workId:''}:defaultResponse(url));try{
  button('搜索片名').click();await flush();await submit('分享视频 https://www.bilibili.com/video/BV17x411w7KC/?p=2');button('重试').click();await flush();await flush();assert.equal(attempts,2);assert.match(sourceText(),/哔哩哔哩/);const body=JSON.parse(view.calls.filter(c=>c.url.includes('/select')).at(-1).options.body);assert.equal(body.url,'https://www.bilibili.com/video/BV17x411w7KC/?p=2');
 }finally{view.app.unmount()}
});

test('off and episode changes cancel stale matches without replacing the next episode',async()=>{
 const finishes=[];const view=mount((url,opts)=>url.includes('/match')?new Promise(resolve=>finishes.push({resolve,signal:opts.signal})):defaultResponse(url));try{
  button('海量').click();await flush();button('关闭').click();await flush();assert.equal(finishes[0].signal.aborted,true);finishes[0].resolve({selected:source,candidates:[],status:'matched'});await flush();assert.equal(sourceText(),'');
  button('海量').click();await flush();view.props.input={...input,episodeNumber:2,episodeTitle:'第2集'};await flush();finishes[1].resolve({selected:source,candidates:[],status:'matched'});await flush();assert.equal(sourceText(),'');finishes[2].resolve({selected:{...source,episodeTitle:'第2集'},candidates:[],status:'matched'});await flush();await flush();assert.match(sourceText(),/第2集/);
 }finally{view.app.unmount()}
});

test('seeking and retry leave video untouched, offset requests correct segment and native fullscreen hides only DOM comments',async()=>{
 let failed=false;const view=mount(url=>url.includes('index=2')&&!failed?(failed=true,apiError('DANMAKU_UNAVAILABLE',503)):defaultResponse(url));try{
  await enable();view.video.currentTime=65;view.video.dispatchEvent(new window.Event('seeked'));await flush();assert.ok(button('重试'));button('重试').click();await flush();assert.equal(view.video.currentTime,65);assert.ok(view.calls.some(c=>c.url.includes('refresh=1')));
  button('时间校准').click();await flush();view.video.currentTime=29;button('提前 1 秒').click();await flush();assert.ok(view.calls.some(c=>c.url.includes('index=1')));assert.equal(localStorage.getItem('misty_rain_danmaku_offset:sample:2:ABCdef'),'-1');
  view.video.dispatchEvent(new window.Event('webkitbeginfullscreen'));await flush();assert.equal(document.querySelector('.danmaku-overlay').style.visibility,'hidden');assert.equal(view.tracks.length,0);view.video.dispatchEvent(new window.Event('webkitendfullscreen'));await flush();assert.equal(document.querySelector('.danmaku-overlay').style.visibility,'visible');
 }finally{view.app.unmount()}
 assert.equal(document.querySelector('.danmaku-overlay'),null);
});

test('danmaku stays inside the visible picture in portrait web fullscreen and resizes for cover mode',async()=>{
 const view=mount(defaultResponse);
 try{
  Object.defineProperty(view.video,'videoWidth',{configurable:true,value:1920});Object.defineProperty(view.video,'videoHeight',{configurable:true,value:1080});
  Object.defineProperty(view.video.parentElement,'clientWidth',{configurable:true,value:390});Object.defineProperty(view.video.parentElement,'clientHeight',{configurable:true,value:844});view.video.parentElement.getBoundingClientRect=()=>({width:390,height:844});view.video.dispatchEvent(new window.Event('loadedmetadata'));await nextTick();
  const overlay=document.querySelector('.danmaku-overlay');assert.ok(parseFloat(overlay.style.top)>300);assert.equal(overlay.style.width,'374px');assert.ok(parseFloat(overlay.style.height)<100);
  view.props.fit='cover';await nextTick();assert.equal(overlay.style.top,'10px');assert.ok(parseFloat(overlay.style.height)>300);
 }finally{view.app.unmount();}
});


test('rotated danmaku uses untransformed stage dimensions and region/font preferences persist',async()=>{
 const view=mount(defaultResponse);
 try{
  Object.defineProperty(view.video,'videoWidth',{configurable:true,value:1920});Object.defineProperty(view.video,'videoHeight',{configurable:true,value:1080});
  Object.defineProperty(view.video.parentElement,'clientWidth',{configurable:true,value:844});Object.defineProperty(view.video.parentElement,'clientHeight',{configurable:true,value:390});view.video.parentElement.getBoundingClientRect=()=>({width:390,height:844});view.video.dispatchEvent(new window.Event('loadedmetadata'));await nextTick();
  const overlay=document.querySelector('.danmaku-overlay');assert.ok(parseFloat(overlay.style.left)>75);assert.ok(parseFloat(overlay.style.top)<20);assert.ok(parseFloat(overlay.style.width)>670);
  button('显示样式').click();await nextTick();[...document.querySelectorAll('[aria-label="弹幕显示区域"] button')].find(b=>b.textContent==='全屏').click();await nextTick();assert.ok(parseFloat(overlay.style.height)>350);assert.equal(localStorage.getItem('misty_rain_danmaku_area'),'full');
  [...document.querySelectorAll('[aria-label="弹幕字号"] button')].find(b=>b.textContent==='大').click();await nextTick();assert.equal(localStorage.getItem('misty_rain_danmaku_font'),'large');
 }finally{view.app.unmount();}
});

test('a missing confirmed episode keeps its work visible and offers correction without an endless retry prompt',async()=>{
 const saved={workId:work.id,title:work.title,year:work.year,platform:'qq',offset:0};
 const view=mount(url=>url.includes('/match')?{selected:null,candidates:[],status:'missing',binding:saved,message:'本集暂无弹幕，已保留本季关联'}:url.includes('/options')?choices():defaultResponse(url));
 try{await enable();assert.match(sourceText(),/测试剧/);assert.match(document.body.textContent,/已保留本季关联/);assert.equal(button('重试'),undefined);button('集数与来源').click();await flush();assert.ok(button('确认关联'));assert.equal(view.calls.filter(c=>c.url.includes('/select')).length,0);}finally{view.app.unmount();}
});

test('single-episode scope is explicit and cancelling a draft preserves playback and the active source',async()=>{
 const view=mount(url=>url.includes('/options')?choices():url.includes('/select')?{...source,seriesLinked:false}:defaultResponse(url));
 try{await enable();view.video.currentTime=42;const renderer=document.querySelector('.danmaku-overlay').firstChild;
  button('集数与来源').click();await flush();view.controls().back();await flush();assert.equal(document.querySelector('.danmaku-overlay').firstChild,renderer);assert.equal(view.video.currentTime,42);assert.equal(view.calls.filter(c=>c.url.includes('/select')).length,0);
  button('集数与来源').click();await flush();const checkbox=document.querySelector('.association-scope input');checkbox.checked=false;checkbox.dispatchEvent(new window.Event('change'));await flush();await confirm();
  const chosen=JSON.parse(view.calls.find(c=>c.url.includes('/select')).options.body);assert.equal(chosen.scope,'episode');assert.equal(view.video.currentTime,42);
 }finally{view.app.unmount();}
});

test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });
