import test from 'node:test';
import assert from 'node:assert/strict';
import { QuarkGateway, normalizePlaybackEpisodes } from '../server/quarkGateway.js';
const video=(fid,name=`${String(fid).padStart(2,'0')}.mp4`,extra={})=>({fid:String(fid),file_name:name,file_type:1,format_type:'video/mp4',size:100,duration:0,...extra});
const titles=count=>Array.from({length:count},(_,i)=>video(i+1));
const input={shareUrl:'https://pan.quark.cn/s/fixture',title:'测试剧'};
function fixture(t,{items=titles(24),cap=100,total=true,repeated=false,emptyPage=0}={}){
 const reads=[];t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(input);
  if(url.pathname.endsWith('/share/sharepage/token'))return Response.json({code:0,data:{stoken:'fixture-token',title:'测试剧'}});
  assert.ok(url.pathname.endsWith('/share/sharepage/detail'),'read-only fixture must never transfer files');
  // Quark ignores page/size: reproducing that behavior catches the original bug.
  const requested=Number(url.searchParams.get('_page'))||1,page=repeated?1:requested;
  const size=Math.min(Number(url.searchParams.get('_size'))||10,cap);
  reads.push({page:requested,size,legacyPage:url.searchParams.has('page'),legacySize:url.searchParams.has('size')});
  return Response.json({code:0,metadata:{_page:page,_size:size,...total?{_total:items.length}:{}},data:{list:requested===emptyPage?[]:items.slice((page-1)*size,page*size)}});
 });
 const gateway=new QuarkGateway({credentialStore:{getCookie:()=> 'fixture-cookie'}});t.after(()=>clearInterval(gateway.cleanupTimer));return {gateway,reads};
}
test('24-file share details and playback both read all files instead of the default ten',async t=>{
 const {gateway,reads}=fixture(t);const detail=await gateway.getShareDetails(input);const playback=await gateway.createPlaybackSession(input);
 assert.equal(detail.videoCount,24);assert.equal(detail.episodeCount,24);assert.equal(playback.episodes.length,24);
 assert.deepEqual(new Set(detail.entries.map(item=>item.fid)),new Set(playback.episodes.map(item=>item.fid)));
 assert.ok(reads.every(read=>read.size===100&&!read.legacyPage&&!read.legacySize));assert.equal(reads.length,2);
});
test('provider page-size caps and directories over 100 videos are fully paginated in both read paths',async t=>{
 const {gateway,reads}=fixture(t,{items:titles(205),cap:37});
 const detail=await gateway.getShareDetails(input),playback=await gateway.createPlaybackSession(input);
 assert.equal(detail.videoCount,205);assert.equal(playback.episodes.length,205);
 assert.deepEqual(reads.map(read=>read.page),[1,2,3,4,5,6,1,2,3,4,5,6]);
});
test('when total is absent, the provider page size determines whether the directory is complete',async t=>{
 const {gateway,reads}=fixture(t,{cap:10,total:false});
 assert.equal((await gateway.getShareDetails(input)).videoCount,24);assert.deepEqual(reads.map(read=>read.page),[1,2,3]);
});
for(const options of [{cap:10,repeated:true},{cap:10,emptyPage:2}])test('incomplete or repeating upstream pages fail explicitly instead of publishing a partial episode list '+JSON.stringify(options),async t=>{
 const {gateway,reads}=fixture(t,options);await assert.rejects(gateway.getShareDetails(input),{code:'QUARK_SHARE_LIST_INCOMPLETE'});
 await assert.rejects(gateway.createPlaybackSession(input),{code:'QUARK_SHARE_LIST_INCOMPLETE'});assert.equal(reads.length,4);assert.equal(gateway.sessions.size,0);
});
test('playback retains short, unnumbered, ancillary and alternate files; only duplicate FIDs and non-video attachments disappear',async t=>{
 const items=[video('low','S01E01.720p.mp4',{duration:60}),video('high','S01E01.4K.mp4',{duration:3600}),video('second','02.mp4'),
  video('named','大结局.mp4'),video('extra','花絮.mp4'),video('nested','01.mp4',{source_path:'花絮'}),
  video('s2','S02E01.mp4'),video('sub','02.srt'),{fid:'folder',file_name:'03.mp4',file_type:0},video('low','S01E01.720p.mp4')];
 const result=normalizePlaybackEpisodes(items);assert.equal(result.length,7);assert.equal(result.find(item=>item.fid==='extra').ancillary,true);assert.equal(result.find(item=>item.fid==='low').ancillary,false);assert.equal(result.filter(item=>item.episodeNumber===1).length,4);
 const {gateway}=fixture(t,{items:items.slice(0,-1).filter(item=>item.file_type!==0)});const detail=await gateway.getShareDetails(input),session=await gateway.createPlaybackSession({...input,episodeFid:'low'});
 assert.equal(session.episodes.length,detail.videoCount);assert.ok(session.episodes.some(item=>item.fid==='low'));assert.ok(session.episodes.some(item=>item.fid==='high'));
});
