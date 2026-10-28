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
globalThis.localStorage = window.localStorage; window.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
const { createApp, h, nextTick } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/site-settings-');
const compile = async entry => {
  const outfile = path.resolve(folder, path.basename(entry, '.vue') + '.mjs');
  // Preserve real module namespaces for Vue's asynchronously loaded components.
  await build({ entryPoints: [entry], outdir: path.resolve(folder), splitting: true, outExtension: { '.js': '.mjs' }, bundle: true, format: 'esm', platform: 'browser', external: ['vue'],
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
const Account = (await compile('src/components/auth/AccountPage.vue')).default;
const flush = async () => { for(let i=0;i<4;i++){await new Promise(r=>setImmediate(r));await nextTick();} };
const state = () => ({ name:'烟雨影视',subtitle:'MISTY RAIN',description:'简介',revision:'one',customIcon:false,iconUrl:'/brand-mark.png',faviconUrl:'/apple-touch-icon.png',touchIconUrl:'/apple-touch-icon.png',defaults:{name:'烟雨影视',subtitle:'MISTY RAIN',description:'简介',iconUrl:'/brand-mark.png'} });
const mount = role => { document.body.innerHTML='<div id="mount"></div>';const app=createApp({render:()=>h(Account,{user:{username:role,folder:role,role}})});app.mount('#mount');return app; };
const button = name => [...document.querySelectorAll('button')].find(el=>el.textContent===name);
test('site settings are absent for ordinary users and open as an admin-only page',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({code:0,data:state()});});
 let app=mount('user');await flush();assert.equal(button('站点设置'),undefined);assert.equal(calls,0);app.unmount();
 app=mount('admin');t.after(()=>app.unmount());button('站点设置').click();await flush();assert.equal(document.querySelector('h1').textContent,'站点设置');assert.equal(document.querySelector('[name="site-name"]').value,'烟雨影视');assert.equal(calls,1);assert.equal(document.querySelector('[name="site-subtitle"]'),null);assert.equal(document.querySelector('[name="site-description"]'),null);
});
test('saving applies branding immediately; optimistic conflict preserves the draft instead of overwriting another admin',async t=>{
 let current=state(),fail=false;
 t.mock.method(globalThis,'fetch',async(_url,options={})=>{
  if(options.method==='PUT'){if(fail)return Response.json({code:'CONFLICT',message:'站点信息已被更新，请重新加载后再保存'},{status:409});const body=JSON.parse(options.body);assert.equal(body.revision,'one');assert.equal('subtitle' in body,false);assert.equal('description' in body,false);current={...current,...body,revision:'two'};}
  return Response.json({code:0,data:current});
 });
 const app=mount('admin');t.after(()=>app.unmount());button('站点设置').click();await flush();
 const name=document.querySelector('[name="site-name"]');name.value='家庭影院';name.dispatchEvent(new window.Event('input',{bubbles:true}));await flush();button('保存').click();await flush();assert.equal(document.title,'家庭影院');
 fail=true;name.value='未保存草稿';name.dispatchEvent(new window.Event('input',{bubbles:true}));await flush();button('保存').click();await flush();assert.match(document.querySelector('[role="alert"]').textContent,/已被更新/);assert.equal(name.value,'未保存草稿');assert.equal(document.title,'家庭影院');
});
