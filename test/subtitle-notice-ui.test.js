import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
window.scrollTo = () => {};
globalThis.localStorage = window.localStorage; globalThis.location = window.location;
const { createApp, h, nextTick } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/subtitle-notice-');
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
const Controls = (await compile('src/components/player/SubtitleControls.vue')).default;
const { reactive, markRaw } = await import('vue');
const flush = async () => { for(let i=0;i<4;i++){await new Promise(r=>setImmediate(r));await nextTick();} };
const message = '字幕连接中断，正在重试…';
function mount({ trackList = [], storedPreference, ...overrides }={}) {
 localStorage.clear(); document.body.innerHTML='<button id="outside">画面</button><div id="mount"></div>';
 if (storedPreference) localStorage.setItem('misty_rain_subtitles:notice-fixture', storedPreference);
 const eventful=track=>{const target=new window.EventTarget();for(const method of ['addEventListener','removeEventListener','dispatchEvent'])track[method]=target[method].bind(target);return track;};
 const video=document.createElement('video'),tracks=trackList.map(eventful),events=new window.EventTarget();
 tracks.push=(...items)=>Array.prototype.push.apply(tracks,items.map(eventful));
 for(const method of ['addEventListener','removeEventListener','dispatchEvent'])tracks[method]=events[method].bind(events);
 Object.defineProperty(video,'textTracks',{value:tracks});
 const props=reactive({video:markRaw(video),username:'notice-fixture',readError:message,loading:false,fullscreen:false,contextKey:'episode-1:source-1',compact:true,iconOnly:true,...overrides});
 let retries=0; const app=createApp({render:()=>h(Controls,{...props,onRetryEmbedded:()=>retries++})});app.mount('#mount');
 return{app,props,video,get retries(){return retries}};
}
const status=()=>document.querySelector('.subtitle-status');
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const select=async text=>{button(text).click();await flush();};
const event=name=>new window.Event(name);
const settle=async()=>{await new Promise(r=>setTimeout(r,175));await flush();};
const selected=()=>[...document.querySelectorAll('button[aria-pressed="true"]')].map(b=>b.textContent.trim());
const key='misty_rain_subtitles:notice-fixture';
const chinese=()=>({kind:'subtitles',label:'中文',language:'zh',mode:'disabled'});
const english=()=>({kind:'subtitles',label:'English',language:'en',mode:'disabled'});

test('subtitle settings use in-panel choices and a local retry instead of native selects or timed popups',async()=>{
 const view=mount();try{
  await flush();assert.equal(document.querySelector('select'),null);assert.deepEqual(selected(),['自动']);assert.ok(status());
  button('重试').click();await flush();assert.equal(view.retries,1);assert.equal(localStorage.length,0);
  await select('关闭');assert.equal(status(),null);assert.equal(localStorage.getItem(key),'off');
  view.props.readError='';view.props.loading=true;await select('自动');assert.ok(document.querySelector('[aria-label="正在读取字幕"]'));
  view.props.loading=false;await flush();assert.match(document.body.textContent,/本集暂无可选字幕/);
 }finally{view.app.unmount()}
});

test('automatic prefers late Chinese and an explicit off survives late loading and episode changes',async()=>{
 const en=english(),zh=chinese();const view=mount({readError:'',trackList:[en]});try{
  await flush();assert.equal(en.mode,'showing');view.video.textTracks.push(zh);view.video.textTracks.dispatchEvent(event('addtrack'));await flush();assert.equal(zh.mode,'showing');assert.equal(en.mode,'disabled');
  await select('关闭');assert.equal(zh.mode,'disabled');zh.mode='showing';view.props.contextKey='episode-2';await flush();assert.equal(zh.mode,'disabled');
  view.video.textTracks.push({...chinese(),mode:'hidden'});view.video.textTracks.dispatchEvent(event('addtrack'));await flush();assert.ok(view.video.textTracks.every(t=>t.mode==='disabled'));assert.deepEqual(selected(),['关闭']);
 }finally{view.app.unmount()}
});

test('manual language follows regional tags; a missing language temporarily falls back without overwriting intent',async()=>{
 const zh=chinese(),en=english();const view=mount({readError:'',trackList:[zh,en],storedPreference:'embedded:language:en'});try{
  await flush();assert.equal(en.mode,'showing');assert.deepEqual(selected(),['英语']);
  view.video.textTracks.splice(1,1);view.props.contextKey='episode-2';await flush();assert.equal(zh.mode,'showing');assert.match(document.body.textContent,/本集暂无英语/);assert.equal(localStorage.getItem(key),'embedded:language:en');
  const next={...english(),language:'en-US'};view.video.textTracks.push(next);view.video.textTracks.dispatchEvent(event('addtrack'));await flush();assert.equal(next.mode,'showing');assert.equal(zh.mode,'disabled');assert.deepEqual(selected(),['英语']);
 }finally{view.app.unmount()}
});

test('automatic remains automatic after repeated native fullscreen and transient hidden/disabled exit states',async()=>{
 const zh=chinese();const view=mount({readError:'',trackList:[zh]});try{
  await flush();for(const mode of ['showing','hidden','disabled']){
   view.props.nativeFullscreen=true;await flush();await settle();zh.mode=mode;view.video.textTracks.dispatchEvent(event('change'));view.props.nativeFullscreen=false;await flush();await settle();
   assert.equal(zh.mode,'showing');assert.deepEqual(selected(),['自动']);assert.equal(localStorage.getItem(key),null);
  }
 }finally{view.app.unmount()}
});

test('stable system picker language and off choices persist, but late tracks do not reactivate off',async()=>{
 const zh=chinese(),en=english();const view=mount({readError:'',trackList:[zh,en]});try{
  await flush();view.props.nativeFullscreen=true;await flush();await settle();zh.mode='disabled';en.mode='showing';view.video.textTracks.dispatchEvent(event('change'));await settle();
  assert.equal(localStorage.getItem(key),'language:en');assert.deepEqual(selected(),['英语']);view.props.nativeFullscreen=false;await flush();assert.equal(en.mode,'showing');
  view.props.nativeFullscreen=true;await flush();await settle();en.mode='disabled';view.video.textTracks.dispatchEvent(event('change'));await settle();assert.equal(localStorage.getItem(key),'off');
  view.video.textTracks.push(chinese());view.video.textTracks.dispatchEvent(event('addtrack'));await flush();view.props.nativeFullscreen=false;await flush();assert.ok(view.video.textTracks.every(t=>t.mode==='disabled'));assert.deepEqual(selected(),['关闭']);
 }finally{view.app.unmount()}
});

test('native list removal and source replacement cannot become an off preference',async()=>{
 const view=mount({readError:'',trackList:[chinese()]});try{
  await flush();view.props.nativeFullscreen=true;await flush();await settle();view.video.textTracks.splice(0);view.video.textTracks.dispatchEvent(event('removetrack'));await settle();
  assert.equal(localStorage.getItem(key),null);view.props.contextKey='source-2';view.video.textTracks.push(chinese());view.video.textTracks.dispatchEvent(event('addtrack'));await flush();assert.equal(view.video.textTracks[0].mode,'showing');
 }finally{view.app.unmount()}
});

test('one language row owns duplicate sources; changing account resets only the new account intent',async()=>{
 const zh=chinese(),duplicate=chinese();const view=mount({readError:'',trackList:[zh,duplicate,english()]});try{
  await flush();assert.equal([...document.querySelectorAll('.subtitle-languages button')].filter(b=>b.textContent==='中文').length,1);assert.equal(view.video.textTracks.filter(t=>t.mode==='showing').length,1);
  await select('关闭');view.props.username='second-account';await flush();assert.deepEqual(selected(),['自动']);assert.equal(zh.mode,'showing');assert.equal(localStorage.getItem(key),'off');
 }finally{view.app.unmount()}
});

test('unmount cancels a pending native-picker write',async()=>{
 const zh=chinese();const view=mount({readError:'',trackList:[zh]});await flush();view.props.nativeFullscreen=true;await flush();await settle();zh.mode='disabled';view.video.textTracks.dispatchEvent(event('change'));view.app.unmount();await settle();assert.equal(localStorage.getItem(key),null);
});
test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });
