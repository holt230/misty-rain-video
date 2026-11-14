import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ResourceSearchService } from '../server/resourceSearch.js';
const data = (...ids) => ({ code: 0, data: { total: ids.length, merged_by_type: { quark: ids.map(id => ({ url: `https://pan.quark.cn/s/${id}`, note: '斗破苍穹 更新219集' })) } } });
const reply = (...ids) => Response.json(data(...ids));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const create = options => new ResourceSearchService({ urls: ['http://127.0.0.1:8888/api/search'], timeoutMs: 1000, ...options });

test('每次搜索都请求原关键词并强制刷新，不改词、不返回上次搜索结果', async () => {
  const calls = [];
  const service = create({ fetchImpl: async (url, options) => { calls.push({url,options}); return reply('result' + calls.length); } });
  assert.equal((await service.search('《斗破苍穹》')).merged_by_type.quark[0].url, 'https://pan.quark.cn/s/result1');
  assert.equal((await service.search('斗破苍穹')).merged_by_type.quark[0].url, 'https://pan.quark.cn/s/result2');
  assert.equal(calls.length, 2);
  for (const {url,options} of calls) {
    assert.equal(url.searchParams.get('kw'), '斗破苍穹'); assert.equal(url.searchParams.get('refresh'), 'true');
    assert.equal(url.searchParams.get('src'), 'all'); assert.equal(options.headers['Accept-Encoding'], 'identity');
  }
});

test('等待本次所有来源完成后返回，不提前宣告搜索结束', async () => {
  const slow = gate(); let settled = false;
  const service = create({ urls: ['https://one.example/search','https://two.example/search'], fetchImpl: async url => url.hostname === 'one.example' ? reply('fast') : slow.promise });
  const pending = service.search('斗破苍穹').then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  slow.resolve(reply('slow219')); const result = await pending;
  assert.equal(result.total, 2); assert.equal(result.partial, false);
});

test('来源失败或真实为空时不回退旧结果，不读取历史磁盘缓存', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'search-fresh-')); t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,'resource_search_cache.json');
  fs.writeFileSync(file,JSON.stringify([['斗破苍穹',{createdAt:Date.now(),data:data('old176').data,isEmpty:false}]]));
  let mode = 'ok';
  const service = create({dataDir:dir, fetchImpl:async()=>mode==='fail'?new Response('',{status:503}):mode==='empty'?reply():reply('current219')});
  assert.equal((await service.search('斗破苍穹')).total,1);
  mode='fail'; await assert.rejects(service.search('斗破苍穹'),{code:'RESOURCE_SEARCH_UNAVAILABLE'});
  mode='empty'; assert.equal((await service.search('斗破苍穹')).total,0);
  assert.match(fs.readFileSync(file,'utf8'),/old176/);
});

test('只保留本次成功来源的数据，部分故障且无结果时报告失败而非未找到', async () => {
  let empty = false;
  const service=create({urls:['https://good.example/search','https://bad.example/search'],fetchImpl:async url=>url.hostname==='bad.example'?new Response('',{status:429}):empty?reply():reply('current')});
  const result=await service.search('斗破苍穹'); assert.equal(result.partial,true); assert.equal(result.total,1); assert.match(result.message,/本次/);
  empty=true; await assert.rejects(service.search('斗破苍穹'),{code:'RESOURCE_SEARCH_UNAVAILABLE'});
});

test('同一在途搜索合并，结束后再次点击会真实重搜', async () => {
  const pending=gate();let calls=0;
  const service=create({fetchImpl:async()=>{calls++;return calls===1?pending.promise:reply('new');}});
  const a=service.search('斗破苍穹'),b=service.search('斗破苍穹');assert.equal(calls,1);
  pending.resolve(reply('first'));assert.deepEqual(await a,await b);
  await service.search('斗破苍穹');assert.equal(calls,2);assert.equal(service.inFlight.size,0);
});

test('请求头或正文挂起都有截止时间，超时后释放搜索名额', async () => {
  for(const fetchImpl of [async()=>new Promise(()=>{}),async()=>({ok:true,json:()=>new Promise(()=>{})})]){
    const service=create({timeoutMs:15,fetchImpl});
    await assert.rejects(service.search('斗破苍穹'),{code:'RESOURCE_SEARCH_TIMEOUT'});assert.equal(service.inFlight.size,0);
  }
});

test('拒绝旧缓存标记、未完成响应、无效JSON和业务错误，不伪装成空结果', async () => {
  for(const fetchImpl of [async()=>new Response('{bad'),async()=>Response.json({code:0,data:{}}),
    async()=>Response.json({code:500,data:{total:0}}),
    ...['stale','refreshing','from_cache','fromCache'].map(flag=>async()=>Response.json({code:0,data:{...data('old').data,[flag]:true}}))]){
    await assert.rejects(create({fetchImpl}).search('斗破苍穹'),{code:'RESOURCE_SEARCH_UNAVAILABLE'});
  }
  assert.equal((await create({fetchImpl:async()=>Response.json({code:0,data:{total:0}})}).search('斗破苍穹')).total,0);
});

test('规范化与去重只接受真实夸克域名，分享密码保留', async () => {
  const rows=[{url:'https://pan.quark.cn/s/valid?x=1',note:'斗破苍穹 更新219集',password:'abcd'},
    {url:'https://pan.quark.cn/s/valid',note:'duplicate'},{url:'https://pan.qoark.cn/s/fake',note:'bad'},null];
  const result=await create({fetchImpl:async()=>Response.json({code:0,data:{merged_by_type:{quark:rows}}})}).search('斗破苍穹');
  assert.equal(result.total,1);assert.equal(result.merged_by_type.quark[0].password,'abcd');
});

test('来源交错合并且最多500条，不让单一来源占满新结果', async () => {
  const crowded=Array.from({length:600},(_,i)=>({url:'https://pan.quark.cn/s/old'+i,note:'斗破苍穹 特别篇'}));
  const service=create({urls:['https://one.example/search','https://two.example/search'],fetchImpl:async url=>url.hostname==='one.example'?Response.json({code:0,data:{merged_by_type:{quark:crowded}}}):reply('latest219')});
  const result=await service.search('斗破苍穹');assert.equal(result.total,500);assert.equal(result.merged_by_type.quark[1].url,'https://pan.quark.cn/s/latest219');
});

test('搜索并发有上限，后台任务为手动搜索保留名额', async () => {
  const hold=gate();const service=create({fetchImpl:async()=>hold.promise.then(response=>response.clone())});
  const first=service.search('一',{priority:'background'}),second=service.search('二',{priority:'background'});
  await assert.rejects(service.search('三',{priority:'background'}),{code:'RESOURCE_SEARCH_BUSY'});
  const manual=service.search('三');hold.resolve(reply());await Promise.all([first,second,manual]);assert.equal(service.inFlight.size,0);
});

test('无效片名不发请求，默认只有内置搜索端点，无隐式公共备用源', async t => {
  const saved=process.env.RESOURCE_SEARCH_URLS;delete process.env.RESOURCE_SEARCH_URLS;
  t.after(()=>{if(saved===undefined)delete process.env.RESOURCE_SEARCH_URLS;else process.env.RESOURCE_SEARCH_URLS=saved;});
  let calls=0;const service=new ResourceSearchService({fetchImpl:async()=>{calls++;return reply();}});
  assert.deepEqual(service.urls,['http://127.0.0.1:8888/api/search']);
  await assert.rejects(service.search('  '),{code:'RESOURCE_SEARCH_KEYWORD_REQUIRED'});assert.equal(calls,0);
});
