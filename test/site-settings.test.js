import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { Readable } from 'node:stream';
import test from 'node:test';
import { SiteSettings, validateSiteIcon } from '../server/siteSettings.js';
import { handleApiRequest } from '../server/api.js';
import { handleMobileConfigRequest } from '../server/mobileConfig.js';
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-settings-')); t.after(() => fs.rmSync(dir, { force:true, recursive:true })); return dir; };
const crc32 = bytes => { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return(crc^0xffffffff)>>>0; };
const chunk = (type,data) => { const bytes=Buffer.alloc(data.length+12); bytes.writeUInt32BE(data.length,0);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes; };
const png = size => { const head=Buffer.alloc(13);head.writeUInt32BE(size,0);head.writeUInt32BE(size,4);head[8]=8;head[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(Buffer.alloc((size*4+1)*size))),chunk('IEND',Buffer.alloc(0))]); };
const icons = () => Object.fromEntries([180,192,512].map(size => [size,'data:image/png;base64,'+png(size).toString('base64')]));
const input = store => ({ revision:store.revision,name:'家庭影院' });
const response = () => ({ statusCode:0,headers:{},body:'',setHeader(key,value){this.headers[key]=value;},end(value){this.body=value||'';} });

test('admin settings and validated icons persist atomically; text-only save retains icon and reset restores default assets', t => {
  const dir=temp(t),store=new SiteSettings(dir);const original=store.public();const updated=store.update({...input(store),icons:icons()});
  assert.equal(updated.name,'家庭影院');assert.equal(updated.customIcon,true);assert.match(updated.iconUrl,/^\/api\/site\/icon\/512.png\?v=/);
  const restored=new SiteSettings(dir);assert.deepEqual(restored.public(),updated);assert.equal(restored.icon(180,dir).readUInt32BE(16),180);
  const renamed=restored.update({...input(restored),name:'新的名称'});assert.equal(renamed.customIcon,true);
  assert.throws(()=>restored.update({...input(restored),revision:original.revision}),{statusCode:409});assert.equal(restored.public().name,'新的名称');
  const reset=restored.update({...input(restored),...restored.defaults,icons:null});assert.equal(reset.customIcon,false);assert.equal(reset.iconUrl,'/brand-mark.png');
  assert.equal(fs.statSync(path.join(dir,'site-settings.json')).mode&0o777,0o600);
});
test('invalid images, malformed PNG, wrong dimensions, oversized text and missing names never change persisted state', t => {
  const store=new SiteSettings(temp(t));store.update(input(store));const before=store.public();
  for(const value of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA', 'https://example.com/icon.png']) assert.throws(()=>validateSiteIcon(value,180));
  assert.throws(()=>validateSiteIcon('data:image/png;base64,'+png(192).toString('base64'),180));
  const broken=png(180);broken[32]^=1;assert.throws(()=>validateSiteIcon('data:image/png;base64,'+broken.toString('base64'),180));
  for(const patch of [{name:''},{name:'a'.repeat(33)},{name:'line\nbreak'},{icons:{180:'no'}}]) assert.throws(()=>store.update({...input(store),...patch}));
  assert.deepEqual(store.public(),before);
});
test('HTML bootstrap safely escapes settings and manifest retains stable PWA identity/base-relative assets', t => {
  const store=new SiteSettings(temp(t));store.update({...input(store),name:'影院</script><x>',subtitle:'A & B',description:'"<img onerror=bad>',icons:icons()});
  const html=store.html(fs.readFileSync('index.html','utf8').replaceAll('%BASE_URL%','/video/'),'/video');
  assert.match(html,/<title>影院&lt;\/script&gt;&lt;x&gt;<\/title>/);assert.doesNotMatch(html,/<img onerror=bad>/);
  assert.match(html,/href="\/video\/api\/site\/icon\/180.png\?v=/);
  const data=JSON.parse(html.match(/id="site-settings">([^<]*)<\/script>/)[1]);assert.equal(data.name,'影院</script><x>');assert.equal('icons' in data,false);assert.equal('subtitle' in data,false);assert.equal('description' in data,false);assert.doesNotMatch(html,/<meta name="description"/);
  const template=JSON.parse(fs.readFileSync('public/manifest.webmanifest','utf8'));const manifest=store.manifest(template);
  assert.equal(manifest.id,template.id);assert.equal(manifest.start_url,template.start_url);assert.equal(manifest.scope,template.scope);assert.equal(manifest.name,data.name);assert.equal('description' in manifest,false);
  assert.deepEqual(manifest.icons.map(i=>i.sizes),['192x192','512x512']);assert.ok(manifest.icons.every(i=>!i.src.startsWith('/')));
});
test('iOS Web Clip uses the configured label and icon with XML escaping', t => {
  const store=new SiteSettings(temp(t));store.update({...input(store),name:'家庭 & 影院',icons:icons()});
  const res=response();handleMobileConfigRequest({method:'GET',url:'/install/ios.mobileconfig',headers:{host:'localhost','x-forwarded-prefix':'/video'}},res,{distDir:temp(t),siteSettings:store});
  assert.equal(res.statusCode,200);assert.match(res.body,/<key>Label<\/key><string>家庭 &amp; 影院<\/string>/);assert.ok(res.body.includes(store.value.icons[180]));assert.match(res.body,/http:\/\/localhost\/video\/launch\/ios/);
});
test('public reads expose no uploaded bytes, and only same-origin admin writes are accepted', async t => {
  const store=new SiteSettings(temp(t));let role='user', authenticated=false, origin=true;
  const context={siteSettings:store,authService:{authenticate(){if(!authenticated)throw Object.assign(new Error('login'),{statusCode:401});return{role,folder:'test'};},assertSameOrigin(){if(!origin)throw Object.assign(new Error('origin'),{statusCode:403});}},userContext:()=>({})};
  const read=response();await handleApiRequest({method:'GET',url:'/api/site-settings',headers:{host:'localhost'}},read,context);assert.equal(read.statusCode,200);assert.doesNotMatch(read.body,/data:image|base64/);
  const write=async()=>{const req=Object.assign(Readable.from([Buffer.from(JSON.stringify(input(store)))]),{method:'PUT',url:'/api/site-settings',headers:{host:'localhost'}});const res=response();await handleApiRequest(req,res,context);return res;};
  assert.equal((await write()).statusCode,401);authenticated=true;assert.equal((await write()).statusCode,403);
  role='admin';origin=false;assert.equal((await write()).statusCode,403);origin=true;assert.equal((await write()).statusCode,200);assert.equal(store.public().name,'家庭影院');
});

test('legacy subtitle and description do not enter the settings contract; name and icon survive loading and saving',t=>{
 const dir=temp(t);fs.writeFileSync(path.join(dir,'site-settings.json'),JSON.stringify({version:1,settings:{name:'已有影院',subtitle:'旧副标题',description:'旧简介',icons:icons()}}));
 const store=new SiteSettings(dir);assert.equal(store.public().name,'已有影院');assert.equal(store.public().customIcon,true);assert.equal('subtitle' in store.public(),false);assert.equal('description' in store.public().defaults,false);
 const saved=store.update({revision:store.revision,name:'新影院'});assert.equal(saved.customIcon,true);const disk=JSON.parse(fs.readFileSync(path.join(dir,'site-settings.json'),'utf8'));assert.equal(disk.settings.subtitle,'');assert.equal(disk.settings.description,'');assert.equal(new SiteSettings(dir).public().name,'新影院');
});
