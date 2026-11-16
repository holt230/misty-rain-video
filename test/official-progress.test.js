import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { OfficialProgressService, parseOfficialProgress, confirmOfficialLatest } from '../server/officialProgress.js';
const doupo=JSON.parse(fs.readFileSync('test/fixtures/official-progress/doupo.json','utf8'));
const xianni=JSON.parse(fs.readFileSync('test/fixtures/official-progress/xianni.json','utf8'));
const compiled=await build({entryPoints:['src/services/officialProgress.ts'],bundle:true,write:false,format:'esm',define:{'import.meta.env.BASE_URL':'"/"'},logLevel:'silent'});
const {chooseOfficialProgress,readOfficialProgress}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

test('真实腾讯目录：斗破为219正片而非230目录条目，仙逆168为预告只取167',()=>{
 const finished=parseOfficialProgress(doupo,'斗破苍穹','anime');
 assert.equal(finished.length,1);assert.equal(finished[0].latestEpisode,219);assert.equal(finished[0].completed,true);
 const ongoing=parseOfficialProgress(xianni,'仙逆','anime');
 assert.equal(ongoing[0].latestEpisode,167);assert.equal(ongoing[0].completed,false);
 assert.match(ongoing[0].sourceUrl,/^https:\/\/v\.qq\.com\//);
});

test('不把同名电视剧、短视频、外站剧集和别的专辑当作官方动漫进度',()=>{
 assert.deepEqual(parseOfficialProgress(doupo,'斗破苍穹','tv'),[]);
 for(const mutate of [r=>r.doc.dataType=1,r=>r.videoInfo.title='斗破苍穹总集篇',r=>r.videoInfo.episodeSites[0].enName='qiyi',r=>r.videoInfo.episodeSites[0].episodeInfoList.forEach(e=>e.url=e.url.replace('v.qq.com','evil.example'))]){
  const d=structuredClone(doupo);mutate(d.data.areaBoxList[0].itemList[0]);assert.deepEqual(parseOfficialProgress(d,'斗破苍穹'),[]);
 }
});

test('多个官方版本按实际作品名与类型对应，不拿真人剧或旧季度进度替代年番',()=>{
 const work=parseOfficialProgress(doupo,'斗破苍穹')[0];
 const other={...work,id:'other',title:'斗破苍穹',category:'tv',latestEpisode:45,year:'2018'};
 const data={works:[work,other]};
 assert.equal(chooseOfficialProgress(data,'斗破苍穹','all',[{workTitle:'斗破苍穹年番',title:'斗破苍穹年番',category:'anime',year:'2022'}]).id,work.id);
 assert.equal(chooseOfficialProgress(data,'斗破苍穹','all',[]),undefined);
 assert.equal(chooseOfficialProgress(data,'斗破苍穹','tv',[]).id,'other');
 assert.equal(chooseOfficialProgress({works:[{...work,title:'斗破苍穹 第1季'}]},'斗破苍穹','anime',[{workTitle:'斗破苍穹年番',category:'anime',title:'斗破苍穹年番'}]),undefined);
});

test('官方搜索只给出前11集时读取最后分页，不把第一页或预告当作最新',async()=>{
 const work={id:'324olz7ilvo2j5f',title:'吞噬星空',latestEpisode:11,completed:false};
 const context=`cid=${work.id}&episode_begin=241&episode_end=250`;
 const episode=(n,trailer='0')=>({item_params:{cid:work.id,title:String(n),vid:`x${String(n).padStart(10,'0')}`,is_trailer:trailer}});
 const first={module_list_datas:[{module_datas:[{module_params:{desk_module_type:'episode_list',is_all_data:'true',has_next:'false',sub_title:'更新至249集',tabs:JSON.stringify([{begin:1,end:30,selected:true,page_context:`cid=${work.id}`},{begin:241,end:250,page_context:context}])},item_data_lists:{item_datas:[episode(1),episode(11)]}}]}]};
 const last={module_list_datas:[{module_datas:[{item_data_lists:{item_datas:[episode(248),episode(249),episode(250,'1')]}}]}]};
 const calls=[];
 const confirmed=await confirmOfficialLatest({page:async(_id,selected)=>{calls.push(selected);return selected===context?last:first;}},work);
 assert.equal(confirmed.latestEpisode,249);assert.equal(calls.length,2);
 await assert.rejects(confirmOfficialLatest({page:async(_id,selected)=>{if(selected===context)throw new Error('network');return first;}},work));
});

test('官方访问失败不回旧进度，不制造总集数，也不无限阻塞搜索',async()=>{
 let ok=true;
 const service=new OfficialProgressService({timeoutMs:10,fetchImpl:async()=>ok?Response.json(doupo):new Promise(()=>{})});
 assert.equal((await service.lookup('斗破苍穹')).works[0].latestEpisode,219);
 ok=false;const failed=await service.lookup('斗破苍穹');assert.equal(failed.status,'unavailable');assert.deepEqual(failed.works,[]);
});

test('客户端官方接口挂起也受限，取消后返回未知且不阻塞新搜索',async t=>{
 const controller=new AbortController();let upstreamSignal;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{upstreamSignal=init.signal;return new Promise(()=>{});});
 const pending=readOfficialProgress('斗破苍穹','anime',controller.signal);
 controller.abort();const result=await pending;
 assert.equal(upstreamSignal.aborted,true);assert.equal(result.status,'unavailable');assert.deepEqual(result.works,[]);
});
