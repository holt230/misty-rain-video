import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DanmakuCatalog,automaticWork} from '../server/danmaku/catalog.js';
import {DanmakuService,validateInput} from '../server/danmaku/service.js';
const cid='mzc00200aaogpgh',workId='4:PkbpaZ7nMYSzDD';
const input={mediaKey:'share:91cc8e68c923',title:'仙逆',category:'tv',episodeNumber:163,episodeTitle:'第 163 集'};
const work={id:workId,title:'仙逆',year:'2023',category:'4',categoryLabel:'动漫',platforms:['qq']};
const json=data=>({json:()=>data});
function setup(t){
 const dir=fs.mkdtempSync('.local-runtime/tests/share-category-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let offline=false;const calls=[];
 const request=async(url,options)=>{calls.push(url);if(url.includes('bilibili.com'))throw Error('unavailable');
  if(url.includes('/index?'))return json({code:0,data:{longData:{rows:[{cat_id:'4',en_id:'PkbpaZ7nMYSzDD',titleTxt:'仙逆',year:'2023',playlinks:{qq:'https://v.qq.com/x/cover/'+cid+'/r0047gdjpw6.html'}}]}}});
  if(url.includes('/v1/detail'))return json({data:{title:'仙逆',pubdate:'2023',allepidetail:{qq:[{playlink_num:1,url:`https://v.qq.com/x/cover/${cid}/r0047gdjpw6.html`},{playlink_num:129,url:`https://v.qq.com/x/cover/${cid}/v4101yic3cc.html`}]}}});
  if(url.includes('PageServer')){if(offline)throw Error('offline');assert.equal(JSON.parse(options.body).page_params.cid,cid);return json({ret:0,data:{module_list_datas:[{module_datas:[{item_data_lists:{item_datas:[[1,'r0047gdjpw6'],[129,'v4101yic3cc'],[163,'i4102jtkn2v']].map(([n,vid])=>({item_params:{cid,title:String(n),play_title:`仙逆 第${n}话`,vid,is_trailer:'0'}}))}}]}]}});}
  throw Error('Unexpected '+url);
 };
 const catalog=new DanmakuCatalog(request),service=new DanmakuService(dir,{catalog});return{catalog,service,calls,set offline(value){offline=value}};
}

test('unclassified share category is not authoritative, while known category and ambiguous title remain strict',()=>{
 assert.equal(validateInput(input).categoryConfirmed,false);assert.equal(automaticWork(validateInput(input),[work]),null);
 assert.equal(automaticWork(validateInput({...input,categoryConfirmed:true}),[work]),null);
 assert.equal(automaticWork(validateInput({...input,mediaKey:'quark:confirmed'}),[work]),null);
 assert.equal(automaticWork(validateInput(input),[work,{...work,id:'2:OtherId',category:'2'}]),null);
 assert.equal(automaticWork(validateInput({...input,title:'仙逆第二季'}),[work]),null);
 assert.throws(()=>validateInput({...input,categoryConfirmed:'false'}));
});

test('real share history scenario resolves episode163 from its same Tencent cover and remembers it',async t=>{
 const v=setup(t);const first=await v.service.match('fixture',input);assert.equal(first.status,'choose');await v.service.select('fixture',{...input,workId});const result=await v.service.match('fixture',input);assert.equal(result.selected.id,'i4102jtkn2v');assert.equal(result.selected.workId,workId);assert.equal(result.selected.episodeNumber,163);assert.equal(result.selected.title,'仙逆');
 const calls=v.calls.length;assert.equal((await v.service.match('fixture',input)).selected.id,'i4102jtkn2v');assert.equal(v.calls.length,calls);
 const options=await v.catalog.options(workId);assert.equal(options.category,'4');assert.deepEqual(options.episodes.map(e=>e.number),[1,129,163]);assert.deepEqual(options.episodes.at(-1).platforms,['qq']);
});

test('official catalogue outage preserves known options with partial status and cannot masquerade as a missing episode',async t=>{
 const v=setup(t);v.offline=true;const options=await v.catalog.options(workId);assert.equal(options.partial,true);assert.deepEqual(options.episodes.map(e=>e.number),[1,129]);
 await assert.rejects(v.service.sourceForWork(input,workId),{code:'DANMAKU_SOURCE_UNAVAILABLE'});
});

test('genuine absent episodes and multiple-cover catalogues are never renumbered or guessed',async t=>{
 const v=setup(t);await assert.rejects(v.catalog.episode(workId,'qq',164),{code:'DANMAKU_EPISODE_NOT_FOUND'});
 const base=await v.catalog.details(workId);const mixed={...base,episodes:[...base.episodes,{platform:'qq',number:2,url:'https://v.qq.com/x/cover/other0000000000/s4102mvt2q0.html'}]};const count=v.calls.length;assert.equal(await v.catalog.completeTencent(mixed),mixed);assert.equal(v.calls.length,count);
});
