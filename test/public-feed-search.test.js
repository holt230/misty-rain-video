import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { parsePublicFeed, PublicFeedResourceSearch } from '../server/publicFeedResourceSearch.js';
import { ResourceSearchService } from '../server/resourceSearch.js';
const fixture=JSON.parse(fs.readFileSync('test/fixtures/public-feed/doupo.json','utf8'));

test('真实公开网页文本解析出斗破苍穹219集分享，不使用媒体或广告内容',()=>{
 const result=parsePublicFeed({...fixture,sponsored_messages:[{message:'无关影视',url:'https://pan.quark.cn/s/ad'}]});
 assert.equal(result.length,1);assert.match(result[0].note,/斗破苍穹.*219/);
 assert.equal(result[0].latest_episode,219);assert.equal(result[0].url,'https://pan.quark.cn/s/7162c13a74d7');
 assert.equal(result[0].category,'anime');assert.match(result[0].source_url,/^https:\/\/tg\.i-c-a\.su\//);
 assert.equal(result[0].work_title,undefined);assert.equal(result[0].year,undefined);
});
test('错误频道、无效响应和外部伪造链接不得进入结果',()=>{
 assert.throws(()=>parsePublicFeed({messages:[]}),{code:'RESOURCE_SEARCH_INVALID_RESPONSE'});
 assert.throws(()=>parsePublicFeed({...fixture,chats:{}}),{code:'RESOURCE_SEARCH_INVALID_RESPONSE'});
 assert.throws(()=>parsePublicFeed({...fixture,chats:[{id:1,username:'other'}]}),{code:'RESOURCE_SEARCH_INVALID_RESPONSE'});
 const wrongPeer=structuredClone(fixture);wrongPeer.messages[0].peer_id=1;assert.deepEqual(parsePublicFeed(wrongPeer),[]);
 const wrongUrl=structuredClone(fixture);wrongUrl.messages[0].message=wrongUrl.messages[0].message.replaceAll('pan.quark.cn','pan.quark.cn.evil.example');assert.deepEqual(parsePublicFeed(wrongUrl),[]);
});
test('每次读取本轮网页，只按提交片名过滤，不改词、不填入固定链接或缓存结果',async()=>{
 const calls=[];let hasContent=true;
 const search=new PublicFeedResourceSearch({fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json(hasContent?fixture:{...fixture,messages:[]});}});
 assert.equal((await search.search('斗破苍穹',{category:'anime'})).total,1);
 assert.equal((await search.search('其他片名',{category:'anime'})).total,0);
 hasContent=false;assert.equal((await search.search('斗破苍穹')).total,0);assert.equal(calls.length,3);
 assert.ok(calls.every(call=>new URL(call.url).hostname==='tg.i-c-a.su'&&call.init.redirect==='error'));
 assert.equal((await search.search('尚公主',{category:'tv'})).skipped,true);assert.equal(calls.length,3);
});
test('网页查询超时和验证页明确失败，不当作空结果',async()=>{
 const timed=new PublicFeedResourceSearch({timeoutMs:10,fetchImpl:async()=>new Promise(()=>{})});
 await assert.rejects(timed.search('斗破苍穹'),{code:'RESOURCE_SEARCH_TIMEOUT'});
 await assert.rejects(new PublicFeedResourceSearch({fetchImpl:async()=>new Response('<html>challenge</html>')}).search('斗破苍穹'),{code:'RESOURCE_SEARCH_INVALID_RESPONSE'});
});
test('原索引只给非视频分享时，同轮公开网页的匹配分享仍交给真实文件核对',async()=>{
 const search=new ResourceSearchService({channels:[],catalogSearch:{search:async()=>({total:1,merged_by_type:{quark:[{url:'https://pan.quark.cn/s/nonvideo',note:'斗破苍穹年番'}]}})},publicFeedSearch:new PublicFeedResourceSearch({fetchImpl:async()=>Response.json(fixture)})});
 const result=await search.search('斗破苍穹',{category:'anime'});
 assert.equal(result.total,2);assert.equal(result.partial,false);
 assert.deepEqual(result.sources.map(({name,status,count})=>({name,status,count})),[{name:'erxiaopan',status:'success',count:1},{name:'public_guoman4K',status:'success',count:1}]);
 assert.equal(result.merged_by_type.quark[1].url,'https://pan.quark.cn/s/7162c13a74d7');
});
