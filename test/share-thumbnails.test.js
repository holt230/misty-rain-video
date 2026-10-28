import test from 'node:test';
import assert from 'node:assert/strict';
import {ShareThumbnails} from '../server/shareThumbnails.js';
import {QuarkGateway} from '../server/quarkGateway.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qcoAAAAASUVORK5CYII=','base64');
test('share thumbnails use opaque owner-scoped handles, deduplicate reads and expire without exposing upstream signatures',async()=>{
 let now=0,calls=0;const store=new ShareThumbnails(async()=>{calls++;return new Response(png)},()=>now);
 const url=store.register('https://cdn.example.test/image?private-signature=secret','admin');assert.doesNotMatch(url,/secret|example/);const id=url.split('/').at(-1);
 await assert.rejects(store.read(id,'user'),{statusCode:403});assert.equal(calls,0);
 const [a,b]=await Promise.all([store.read(id,'admin'),store.read(id,'admin')]);assert.equal(calls,1);assert.equal(a.contentType,'image/png');assert.deepEqual(a.bytes,b.bytes);
 now=600001;await assert.rejects(store.read(id,'admin'),{statusCode:404});store.cleanup();assert.equal(store.bytes,0);
 assert.equal(store.register('http://cdn.example.test/image','admin'),'');assert.equal(store.register('https://user:pass@cdn.example.test/image','admin'),'');
});
test('non-image and oversized upstream content are not served as a thumbnail',async()=>{
 for(const [body,status] of [[Buffer.from('<html>not an image</html>'),415],[Buffer.alloc(2*1024*1024+1),413]]){const store=new ShareThumbnails(async()=>new Response(body));const id=store.register('https://cdn.example.test/image','admin').split('/').at(-1);await assert.rejects(store.read(id,'admin'),{statusCode:status});assert.equal(store.bytes,0);}
});

test('failed thumbnail handles back off across remounts, preserve access checks, then recover after the cooldown',async()=>{
 let now=0,calls=0,healthy=false;
 const store=new ShareThumbnails(async()=>{calls++;return healthy?new Response(png):new Response('upstream denied',{status:403})},()=>now);
 const id=store.register('https://cdn.example.test/failing-image','owner').split('/').at(-1);
 await assert.rejects(store.read(id,'owner'),{statusCode:502});
 await assert.rejects(store.read(id,'other'),{statusCode:403});
 for(let attempt=0;attempt<5;attempt++)await assert.rejects(store.read(id,'owner'),{statusCode:502});
 assert.equal(calls,1,'switching list views must not immediately repeat a failed upstream image request');
 now=30001;healthy=true;
 assert.equal((await store.read(id,'owner')).contentType,'image/png');assert.equal(calls,2);
 await store.read(id,'owner');assert.equal(calls,2);
 const fresh=store.register('https://cdn.example.test/failing-image','owner').split('/').at(-1);
 await store.read(fresh,'owner');assert.equal(calls,3,'fresh handles have independent state');
});

test('thumbnail queue pressure does not poison a handle that has not reached the upstream',async()=>{
 let release;const ready=new Promise(resolve=>release=resolve);
 const store=new ShareThumbnails(async()=>{await ready;return new Response(png)});
 const ids=Array.from({length:36},(_,i)=>store.register(`https://cdn.example.test/image-${i}`,'owner').split('/').at(-1));
 const pending=ids.slice(0,35).map(id=>store.read(id,'owner'));
 await assert.rejects(store.read(ids[35],'owner'),{statusCode:503});
 release();await Promise.all(pending);
 assert.equal((await store.read(ids[35],'owner')).contentType,'image/png');
});

test('thumbnail CDN requests retain URL validation but omit playback headers and cookies',async t=>{
 const gateway=new QuarkGateway({credentialStore:{getCookie:()=> 'private-cookie'}});t.after(()=>clearInterval(gateway.cleanupTimer));
 t.mock.method(globalThis,'fetch',async(_url,options)=>{assert.equal(options.headers.Referer,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers['User-Agent'],undefined);return new Response(png)});
 const id=gateway.shareThumbnails.register('https://thumb-c-zb.cdn.yun.cn/image','admin').split('/').at(-1);
 assert.equal((await gateway.shareThumbnails.read(id,'admin')).contentType,'image/png');
 await assert.rejects(gateway.fetchMedia('https://127.0.0.1/image',undefined,'thumbnail'));
});

test('private Quark API thumbnails authenticate, but redirects never forward those credentials to a CDN',async t=>{
 const gateway=new QuarkGateway({credentialStore:{getCookie:()=> 'private-cookie'}});t.after(()=>clearInterval(gateway.cleanupTimer));
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push({url,headers:options.headers});
  return new URL(url).hostname==='drive-pc.quark.cn'
   ? new Response(null,{status:302,headers:{Location:'https://thumb-c-zb.cdn.yun.cn/image'}})
   : new Response(png);
 });
 const id=gateway.shareThumbnails.register('https://drive-pc.quark.cn/1/clouddrive/file/video/quick?fid=example','owner').split('/').at(-1);
 assert.equal((await gateway.shareThumbnails.read(id,'owner')).contentType,'image/png');
 assert.equal(calls.length,2);
 assert.equal(calls[0].headers.Cookie,'private-cookie');assert.equal(calls[0].headers.Referer,'https://pan.quark.cn/');assert.ok(calls[0].headers['User-Agent']);
 assert.equal(calls[0].headers.Accept,'image/*');
 assert.equal(calls[1].headers.Cookie,undefined);assert.equal(calls[1].headers.Referer,undefined);assert.equal(calls[1].headers['User-Agent'],undefined);
});

test('thumbnail authentication is limited to the configured Quark API origin',async t=>{
 const gateway=new QuarkGateway({credentialStore:{getCookie:()=> 'private-cookie'}});t.after(()=>clearInterval(gateway.cleanupTimer));
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(options.headers);return new Response(png)});
 for(const url of ['https://drive-pc.quark.cn.attacker.test/image','https://other.quark.cn/image'])await gateway.fetchMedia(url,undefined,'thumbnail');
 assert.ok(calls.every(headers=>headers.Cookie===undefined&&headers.Referer===undefined&&headers['User-Agent']===undefined));
});
