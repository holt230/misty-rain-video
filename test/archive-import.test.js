import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { selectArchiveEpisode, requireArchiveCapacity, supportedArchive, mergeArchiveMetadata } from '../server/archivePolicy.js';
import { parseForumResources } from '../server/forumResourceSearch.js';
import { ArchiveImportService } from '../server/archiveImport.js';

const publication={work_title:'仙逆',category:'anime',year:'2023'};
const input={title:'仙逆',category:'anime',episode:167,year:'2023'};
const episode={fid:'v167',fileName:'167.mkv',episodeNumber:167,sourcePath:'/167',size:100};
test('archive import requires supported format, valid account capability and enough space before copying anything',()=>{
 assert.equal(supportedArchive('167.zip'),true);assert.equal(supportedArchive('E167.RAR'),true);assert.equal(supportedArchive('E167.iso'),false);
 for(const cap of [{isAuthenticated:false},{isAuthenticated:true,isSvip:false},{isAuthenticated:true,isSvip:true},{isAuthenticated:true,isSvip:true,freeBytes:200}])assert.throws(()=>requireArchiveCapacity(cap,100));
 assert.doesNotThrow(()=>requireArchiveCapacity({isAuthenticated:true,isSvip:true,freeBytes:300},100));
});
test('补充压缩包时保留原片库的来源、封面和自动更新信息',()=>{
 const original={quarkFid:'old',quarkShareUrl:'https://pan.quark.cn/s/original',quarkPasscode:'1234',quarkSelectionFids:['keep'],poster:'old-poster',catalogId:'old-id'};
 const item={quarkFid:'old',quarkShareUrl:'https://pan.quark.cn/s/archive',quarkArchiveImported:true,quarkArchiveEpisode:1,poster:''};
 const merged=mergeArchiveMetadata(item,{poster:'new-poster',catalogId:'new-id'},original);
 assert.equal(merged.quarkShareUrl,original.quarkShareUrl);assert.equal(merged.quarkPasscode,'1234');
 assert.deepEqual(merged.quarkSelectionFids,['keep']);assert.equal(merged.poster,'old-poster');assert.equal(merged.catalogId,'old-id');
 assert.equal(merged.quarkArchiveImported,undefined);assert.equal(merged.quarkArchiveEpisode,undefined);
});
test('unpacked files must be actual requested episodes with fresh exact publication, correct year and no conflicting work or extras',()=>{
 assert.equal(selectArchiveEpisode([episode],input,publication).fid,'v167');
 for(const files of [[],[{...episode,episodeNumber:166}],[episode,{...episode,fid:'duplicate'}],[{...episode,fileName:'其他作品.E167.mkv'}],[{...episode,sourcePath:'/花絮'}]])assert.throws(()=>selectArchiveEpisode(files,input,publication));
 assert.throws(()=>selectArchiveEpisode([episode],input,{...publication,work_title:'其他作品'}));
 assert.throws(()=>selectArchiveEpisode([episode],input,{...publication,year:'2020'}));
});
test('解压只跳过与已核对压缩包同名的外层目录，正片与集号仍须核对', () => {
 const request={title:'多喜一家人',category:'tv',year:'2026',episode:13};
 const source={work_title:request.title,category:request.category,year:request.year,source:'erxiaopan'};
 const file={fid:'v13',fileName:'13 SDR.mkv',episodeNumber:13,sourcePath:'/13 SDR',duration:2809};
 const select=(episode, archive='13 SDR.zip')=>selectArchiveEpisode([episode],request,source,archive);
 assert.equal(select(file),file);
 assert.throws(()=>select(file,'13 HDR.zip'),{code:'ARCHIVE_EPISODE_UNCONFIRMED'});
 for (const changed of [{sourcePath:'/其他作品/13 SDR'},{sourcePath:'/13 SDR/其他作品'},
  {sourcePath:'/13 SDR/花絮'},{fileName:'其他作品.E13.mkv'},{episodeNumber:14}]) {
  assert.throws(()=>select({...file,...changed}),{code:'ARCHIVE_EPISODE_UNCONFIRMED'});
 }
});
const forum=(title,url)=>({data:[{type:'discussions',id:'188',attributes:{title,createdAt:'2024-11-04T03:25:10Z'},relationships:{firstPost:{data:{id:'1'}}}}],included:[{type:'posts',id:'1',attributes:{contentHtml:'<p><a href="'+url+'">分享链接</a></p>'}}]});
test('发行论坛可识别没有分类标签的同名剧场版，排除连载和花絮',()=>{
 const title='斗破苍穹剧场版 双帝之战';
 const row=name=>forum(name,'https://pan.quark.cn/s/current');
 const post=row('斗破苍穹剧场版 双帝之战\u200b(2026) 4K 夸克网盘下载');
 assert.equal(parseForumResources(post,title,'movie')[0].work_title,title);
 assert.deepEqual(parseForumResources(post,'斗破苍穹','all'),[]);
 assert.deepEqual(parseForumResources(row(`${title}(2026) 4K 花絮`),title,'movie'),[]);
});
test('restored forum source accepts exact anime publication and real share domain, rejects stage films, novels and impostor URLs',()=>{
 const rows=parseForumResources(forum('【动漫】仙逆 (2023) 4K 夸克网盘下载','https://pan.quark.cn/s/current'),'仙逆','anime');
 assert.equal(rows.length,1);assert.equal(rows[0].work_title,'仙逆');assert.equal(rows[0].year,'2023');
 for(const title of ['【动漫】仙逆剧场版 (2023) 4K','【动漫】仙逆小说 (2023)','【动漫】其他作品 (2023)'])assert.deepEqual(parseForumResources(forum(title,'https://pan.quark.cn/s/current'),'仙逆','anime'),[]);
 for(const url of ['https://pan.quark.cn.evil.test/s/fake','http://pan.quark.cn/s/fake','https://user@pan.quark.cn/s/fake'])assert.deepEqual(parseForumResources(forum('【动漫】仙逆 (2023)',url),'仙逆'),[]);
 assert.deepEqual(parseForumResources({data:[]},'仙逆'),[]);
});
test('archive jobs revalidate source, isolate users, coalesce clicks and only write the library after extraction validation',async t=>{
 await fs.mkdir('.local-runtime/tests',{recursive:true});const dir=await fs.mkdtemp('.local-runtime/tests/archive-jobs-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let preparations=0,writes=0,release;
 const gate=new Promise(resolve=>release=resolve),user={username:'one'};
 const gateway={
  getShareDetails:async()=>({title:'仙逆',entries:[{fid:'a167',name:'167.zip',isArchive:true,archiveFormat:'zip',episodeNumber:167}]}),
  prepareArchiveImport:async(_input,_user,{state,checkpoint})=>{preparations++;await checkpoint({...state,owner:'one',stageFid:'tmp'});await gate;return {state:{...state,owner:'one'}};},
  finalizeArchiveImport:async()=>({item:{id:'quark:new',quarkFid:'new',title:'仙逆',category:'anime'},state:{owner:'one',published:true}}),
  cleanupArchiveStage:async()=>true
 };
 const original={quarkFid:'new',quarkPasscode:'1234'};
 const service=new ArchiveImportService(dir,{gateway,resourceSearch:{search:async()=>({merged_by_type:{quark:[{...publication,url:'https://pan.quark.cn/s/source'}]}})},userContext:()=>({mediaRepository:{all:()=>[original],save(item){assert.equal(item.quarkPasscode,'1234');writes++;}}})});
 const args={...input,shareUrl:'https://pan.quark.cn/s/source',archiveFid:'a167'};
 const [first,same]=await Promise.all([service.start(args,user),service.start(args,user)]);
 assert.equal(first.id,same.id);assert.equal(writes,0);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(preparations,1);
 await assert.rejects(service.get(first.id,{username:'other'}),{code:'ARCHIVE_JOB_NOT_FOUND'});
 release();await service.active.get(first.id);
 const finished=await service.get(first.id,user);assert.equal(finished.status,'success');assert.equal(writes,1);
 await service.start(args,user);assert.equal(preparations,1);assert.equal(writes,1);
 assert.doesNotMatch(JSON.stringify(finished),/stageFid|passcode|archivePassword|savedArchive/);
 assert.doesNotMatch(await fs.readFile(`${dir}/archive-jobs/${first.id}.json`,'utf8'),/quarkPasscode/);
});


test('解压后同集错片不会挡住有明确作品名的正片，但两个可确认版本仍需消歧', () => {
  const good = { ...episode, fileName: '仙逆.E167.2160p.mkv' };
  const wrong = { ...episode, fid: 'bad', fileName: '其他剧.E167.mkv', size: 100000 };
  assert.equal(selectArchiveEpisode([wrong, good], input, publication).fid, good.fid);
  assert.throws(() => selectArchiveEpisode([good, { ...good, fid: 'duplicate' }], input, publication), { code: 'ARCHIVE_EPISODE_UNCONFIRMED' });
});
