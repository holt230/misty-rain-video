import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ShareAvailability, shareFailureCode } from '../server/shareAvailability.js';
import { QuarkGateway } from '../server/quarkGateway.js';
import { ResourceSearchService } from '../server/resourceSearch.js';
const item = id => ({ url: `https://pan.quark.cn/s/${id}`, password: '' });
const flush = () => new Promise(resolve => setImmediate(resolve));
const error = code => Object.assign(new Error(code), { code });

test('取消/过期分享与提取码、限流、认证、单个文件删除分开处理', () => {
  for (const message of ['好友已取消了分享', '分享链接已过期', '该分享不存在', 'share expired']) assert.equal(shareFailureCode(message), 'QUARK_SHARE_UNAVAILABLE');
  for (const message of ['需要提取码', '提取码错误', 'password required']) assert.equal(shareFailureCode(message), 'QUARK_SHARE_PASSCODE_REQUIRED');
  for (const message of ['请稍后重试', '访问受限', '文件已被删除', '']) assert.equal(shareFailureCode(message), 'QUARK_SHARE_ACCESS_FAILED');
});

test('有效、明确失效、提取码、网络与账号故障分别标记，未知故障不加入失效缓存', async () => {
  const codes = { cancelled: 'QUARK_SHARE_UNAVAILABLE', protected: 'QUARK_SHARE_PASSCODE_REQUIRED', timeout: 'QUARK_NETWORK_ERROR', auth: 'QUARK_AUTH_REQUIRED' };
  const service = new ShareAvailability({ probe: async ({ shareUrl }) => { const code = codes[shareUrl.split('/').pop()]; if (code) throw error(code); } });
  const items = ['valid', ...Object.keys(codes)].map(item);
  await service.inspect(items, { waitMs: 0 }); await flush();
  const result = await service.inspect(items, { waitMs: 0 });
  assert.deepEqual(result.entries.map(entry => entry.status), ['available', 'unavailable', 'restricted', 'deferred', 'unknown']);
  assert.equal(service.isUnavailable(item('cancelled').url), true);
  for (const id of ['protected', 'timeout', 'auth']) assert.equal(service.isUnavailable(item(id).url), false);
});

test('有界并发与同一链接的并发合并，待检查结果不会提前标记有效', async () => {
  let running = 0, highest = 0, calls = 0;
  const releases = [];
  const service = new ShareAvailability({ concurrency: 2, probe: async () => {
    running++; calls++; highest = Math.max(highest, running);
    await new Promise(resolve => releases.push(resolve)); running--;
  } });
  const items = ['a', 'b', 'c'].map(item);
  const first = await service.inspect(items, { waitMs: 0 });
  await service.inspect(items, { waitMs: 0 });
  assert.equal(calls, 2); assert.equal(first.pending, true);
  assert.ok(first.entries.every(entry => entry.status === 'pending'));
  releases.shift()(); await flush(); assert.equal(calls, 3);
  for (const release of releases) release(); await flush();
  assert.equal(highest, 2);
  assert.equal((await service.inspect(items, { waitMs: 0 })).pending, false);
});

test('失效缓存跨重启保留，受限提取码不影响正确提取码，过期后重新检查', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-validity-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let now = 1_000_000, calls = 0;
  const probe = async ({ shareUrl, passcode }) => { calls++; if (shareUrl.endsWith('cancelled')) throw error('QUARK_SHARE_UNAVAILABLE'); if (passcode === 'bad') throw error('QUARK_SHARE_PASSCODE_REQUIRED'); };
  const service = new ShareAvailability({ dataDir, now: () => now, probe });
  await service.inspect([item('cancelled'), { ...item('protected'), password: 'bad' }], { waitMs: 0 }); await flush();
  await service.inspect([{ ...item('protected'), password: 'good' }], { waitMs: 0 }); await flush();
  assert.equal((await service.inspect([{ ...item('protected'), password: 'good' }], { waitMs: 0 })).entries[0].status, 'available');
  const restarted = new ShareAvailability({ dataDir, now: () => now, probe });
  const before = calls;
  assert.equal((await restarted.inspect([item('cancelled')], { waitMs: 0 })).entries[0].status, 'unavailable');
  assert.equal(calls, before);
  now += 30 * 60_000 + 1;
  await restarted.inspect([item('cancelled')], { waitMs: 0 }); await flush(); assert.equal(calls, before + 1);
  assert.equal(fs.statSync(path.join(dataDir, 'share_availability.json')).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(path.join(dataDir, 'share_availability.json'), 'utf8'), /good|bad/);
});

test('详情读取确认取消后，先前未完成的有效响应不能把失效链接恢复', async () => {
  let resolve;
  const service = new ShareAvailability({ probe: () => new Promise(done => { resolve = done; }) });
  await service.inspect([item('race')], { waitMs: 0 });
  service.markUnavailable(item('race').url); resolve(); await flush();
  assert.equal((await service.inspect([item('race')], { waitMs: 0 })).entries[0].status, 'unavailable');
});

test('新查询与历史缓存都排除已经确认失效的链接', async () => {
  const availability = new ShareAvailability({ probe: async () => {} });
  const search = new ResourceSearchService({ urls: ['https://fixture.example/search'], source: 'plugin', followUpDelaysMs: [],
    exclude: row => availability.isUnavailable(row.url),
    fetchImpl: async () => Response.json({ code: 0, data: { merged_by_type: { quark: [item('valid'), item('cancelled')] } } }) });
  assert.equal((await search.search('测试剧')).total, 2);
  availability.markUnavailable(item('cancelled').url);
  assert.equal((await search.search('测试剧')).total, 1);
  assert.equal(search.peek('测试剧').total, 1);
});

test('校验拒绝非夸克网址、额外路径与超量输入，不能充当任意网址代理', async () => {
  let calls = 0;
  const service = new ShareAvailability({ probe: async () => { calls++; } });
  for (const url of ['http://pan.quark.cn/s/a', 'https://127.0.0.1/s/a', 'https://pan.quark.cn@evil.test/s/a', 'https://pan.quark.cn/s/a/other']) {
    await assert.rejects(service.inspect([{ url }]), { code: 'INVALID_QUARK_SHARE' });
  }
  await assert.rejects(service.inspect(Array.from({ length: 101 }, (_, i) => item('a' + i))), { code: 'INVALID_SHARE_CHECK_BATCH' });
  assert.equal(calls, 0);
});

test('内容探测读取目录，保留明确失败代码且从不转存', async t => {
  const calls = [];
  let message = '';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(message ? { code: 41012, message } : String(url).includes('/token') ? { code: 0, data: { stoken: 'private-token' } } : { code:0,metadata:{_total:1,_page:1,_size:100},data:{list:[{fid:'video',file_name:'01.mp4',file_type:1}]} }, { status: message ? 404 : 200 });
  });
  const gateway = new QuarkGateway({ credentialStore: { getCookie: () => 'private-cookie' } });
  await gateway.probeShare({ shareUrl: item('test').url, passcode: '1234' });
  assert.equal(calls.length, 2); assert.match(calls[1].url,/sharepage\/detail/); assert.match(calls[0].url, /sharepage\/token/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { pwd_id: 'test', passcode: '1234' });
  assert.equal(calls[0].init.signal.aborted, false);
  message = '好友已取消了分享'; await assert.rejects(gateway.probeShare({ shareUrl: item('test').url }), { code: 'QUARK_SHARE_UNAVAILABLE' });
  message = '提取码错误'; await assert.rejects(gateway.probeShare({ shareUrl: item('test').url }), { code: 'QUARK_SHARE_PASSCODE_REQUIRED' });
});

test('empty sources are excluded for five minutes; incomplete reads are deferred only briefly and recover',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'content-health-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 let now=100000,calls=0;
 const service=new ShareAvailability({dataDir,now:()=>now,probe:async()=>{calls++;}});
 service.recordFailure(item('empty'),error('QUARK_VIDEO_NOT_FOUND'));
 service.recordFailure(item('incomplete'),error('QUARK_SHARE_LIST_INCOMPLETE'));
 const first=await service.inspect([item('empty'),item('incomplete')],{waitMs:0});assert.deepEqual(first.entries.map(e=>e.status),['unavailable','deferred']);assert.equal(calls,0);
 assert.equal(service.isUnavailable(item('incomplete').url),false);
 const restarted=new ShareAvailability({dataDir,now:()=>now,probe:async()=>{calls++;}});
 assert.deepEqual((await restarted.inspect([item('empty'),item('incomplete')],{waitMs:0})).entries.map(e=>e.status),['unavailable','deferred']);
 now+=30001;await restarted.inspect([item('incomplete')],{waitMs:0});await flush();assert.equal((await restarted.inspect([item('incomplete')],{waitMs:0})).entries[0].status,'available');
 assert.equal(restarted.isUnavailable(item('empty').url),true);now+=5*60000;assert.equal(restarted.isUnavailable(item('empty').url),false);
});
test('an actual failed directory read wins over an older successful probe; a later complete read recovers the source',async()=>{
 let resolve;const service=new ShareAvailability({probe:()=>new Promise(done=>{resolve=done})});
 await service.inspect([item('race')],{waitMs:0});service.recordFailure(item('race'),error('QUARK_SHARE_LIST_INCOMPLETE'));resolve();await flush();
 assert.equal((await service.inspect([item('race')],{waitMs:0})).entries[0].status,'deferred');
 service.recordContents(item('race'),24);assert.equal((await service.inspect([item('race')],{waitMs:0})).entries[0].status,'available');
 service.recordContents(item('race'),0);assert.equal(service.isUnavailable(item('race').url),true);
 service.recordContents(item('race'),24);assert.equal(service.isUnavailable(item('race').url),false);
});
test('old token-only positive cache is rechecked for video content after upgrade',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'content-version-'));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
 const first=new ShareAvailability({dataDir,probe:async()=>{}});await first.inspect([item('old')],{waitMs:0});await flush();
 const file=path.join(dataDir,'share_availability.json'),data=JSON.parse(fs.readFileSync(file));delete data.version;fs.writeFileSync(file,JSON.stringify(data));
 let calls=0;const restarted=new ShareAvailability({dataDir,probe:async()=>{calls++;throw error('QUARK_VIDEO_NOT_FOUND')}});
 await restarted.inspect([item('old')],{waitMs:0});await flush();assert.equal(calls,1);assert.equal(restarted.isUnavailable(item('old').url),true);
});

test('actual empty details and failed session reads feed the shared validation cache',async()=>{
 const {handleApiRequest}=await import('../server/api.js');const {Readable}=await import('node:stream');
 const availability=new ShareAvailability({probe:async()=>{}});
 const context={authService:{authenticate:()=>({username:'user',folder:'user',role:'user'}),assertSameOrigin(){}},userContext:()=>({}),shareAvailability:availability,
  quarkGateway:{getShareDetails:async()=>({videoCount:0,entries:[]}),createPlaybackSession:async()=>{throw error('QUARK_SHARE_LIST_INCOMPLETE')}}};
 const response=()=>({statusCode:0,headersSent:false,setHeader(){},end(){this.headersSent=true;}});
 for(const [route,id] of [['/api/quark/share-details','empty'],['/api/player/sessions','incomplete']]){
  const request=Object.assign(Readable.from([Buffer.from(JSON.stringify({shareUrl:item(id).url}))]),{method:'POST',url:route,headers:{host:'localhost'}});
  await handleApiRequest(request,response(),context);
 }
 const results=await availability.inspect([item('empty'),item('incomplete')],{waitMs:0});assert.deepEqual(results.entries.map(entry=>entry.status),['unavailable','deferred']);
});

test('a fresh inconclusive authentication failure also retires an older positive result without globally invalidating the link',async()=>{
 const service=new ShareAvailability({probe:async()=>{}});service.recordContents(item('auth'),24);
 service.recordFailure(item('auth'),error('QUARK_AUTH_REQUIRED'));
 assert.equal((await service.inspect([item('auth')],{waitMs:0})).entries[0].status,'unknown');assert.equal(service.isUnavailable(item('auth').url),false);
});
