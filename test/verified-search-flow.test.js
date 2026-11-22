import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { assertVerifiedImport } from '../server/verifiedImport.js';
const compile = async file => { const c=await build({entryPoints:[file],bundle:true,write:false,format:'esm',define:{'import.meta.env.BASE_URL':'"/"'},logLevel:'silent'});return import(`data:text/javascript;base64,${Buffer.from(c.outputFiles[0].text).toString('base64')}`); };
const {searchIntent}=await compile('src/services/searchIntent.ts');
const {verifySearchResults}=await compile('src/services/verifySearchResults.ts');
const {useQuarkTransfer}=await compile('src/composables/useQuarkTransfer.ts');
const resource={id:'source',url:'https://pan.quark.cn/s/test',title:'斗破苍穹年番',workTitle:'斗破苍穹年番',category:'anime',year:'2022',latestEpisode:219};
const file = n => ({fid:'e'+n,name:`第${n}集.mp4`,isVideo:true,episodeNumber:n,size:100});
const details = nums => ({title:'斗破苍穹年番',videoCount:nums.length,entries:nums.map(file)});
const options = extra => ({title:'斗破苍穹',category:'anime',signal:new AbortController().signal,progress(){},...extra});

test('同一动画剧场版按正片核对：完整同音目录和真实片长支持无片名的文件',async()=>{
 const title='斗破苍穹剧场版 双帝之战', category='anime', year='2026';
 const root='D 豆粕藏穷剧场版 双底只占';
 const video={fid:'movie',name:'2026.2160p.WEB-DL.H.265.DDP2.0.mkv',isVideo:true,episodeNumber:0,duration:8142,size:7264892325,ancestorFids:['root'],identityTag:'proof'};
 const source={...resource,title,workTitle:'斗破苍穹·双帝之战',year,category:'movie',source:'quark4k',latestEpisode:0};
 const check=(name=root,row=source,files=[video])=>verifySearchResults([row],options({title,category,year,inspect:async()=>({title:name,videoCount:files.length,entries:[{fid:'root',name,isDirectory:true},...files]})}));
 const [result]=(await check()).resources;
 assert.equal(result.category,'anime');assert.equal(result.verification.complete,true);
 assert.deepEqual(result.verification.selectedFids,['movie']);assert.deepEqual(result.verification.requiredEpisodes,[]);
 for(const bad of [await check('剧.场(1).版'),await check('D 豆粕藏穷剧场版 另一部'),await check(root,{...source,workTitle:'斗破苍穹年番'}),
  await check(root,{...source,source:'unknown'}),await check(root,{...source,runtimeMinutes:100}),await check(root,source,[{...video,duration:180}]),
  await check(root,source,[{...video,name:video.name.replace('2026','2025')}]),await check(root,source,[video,{...video,fid:'other'}])]) assert.equal(bad.resources.length,0);
});

test('只更新目录而没有更新分享标题，不会丢失已核对的压缩包或纳入其他目录', async () => {
 const title='多喜一家人', year='2026', category='tv';
 const root='D 多洗宜家仁 更新至11集', current='D 多洗宜家仁 更新至13集';
 const folders=[['work',current],['dv','4K 杜比视界'],['other','另一家人'],['old','多喜一家人 2025']].map(([fid,name])=>({fid,name,isDirectory:true}));
 const zip=(fid,n,parents)=>({fid,name:`${n} SDR.zip`,ancestorFids:parents,episodeNumber:n,isArchive:true,archiveFormat:'zip',size:100});
 const entries=[...folders,zip('good',13,['work','dv']),zip('other-show',14,['work','other']),zip('old-year',15,['old'])];
 const row={...resource,title,workTitle:title,source:'erxiaopan',category,year};
 const check=async source=>(await verifySearchResults([{...row,source}],options({title,category,year,officialLatest:14,inspect:async()=>({title:root,videoCount:0,entries})}))).resources;
 const [result]=await check('erxiaopan');assert.deepEqual(result.archivePreparation.availableEpisodes,[13]);assert.equal(result.verification,undefined);
 assert.deepEqual(await check('unknown'),[]);
});

test('发布日期加期号的综艺只保留同季上下集，不把加更、花絮、衍生节目或上一季算作正片', async () => {
 const title='日落时分说爱你 第2季', category='variety', year='2026';
 const names=['20261116 第1期上.mkv','20261117(第1期下).mp4','20261121(花絮特辑第1期).mp4','20261118(加更第1期).mp4','20261119(陪你追日落2第1期).mp4','20260231(第2期).mp4'];
 const entries=names.map((name,i)=>({...file(i===5?2:1),fid:`v${i}`,name,episodePart:['上','下'][i]}));
 const row={...resource,title:'日落时分说爱你2',workTitle:'日落时分说爱你2',source:'forum',category,year};
 const check=(root,episode,files=entries)=>verifySearchResults([row],options({title,year,category,episode,inspect:async()=>({title:root,entries:files,videoCount:files.length})}));
 for(const episode of [undefined,1])assert.deepEqual((await check('日落时分说 爱你2',episode)).resources[0].verification.selectedFids,['v0','v1']);
 assert.equal((await check('日落时分说 爱你2',1,entries.slice(0,1))).resources[0].verification.complete,false);
 assert.deepEqual((await check('日落时分说爱你 第一季')).resources,[]);
});

test('前18条全部失效仍能找到下一条；未检查完不能报告没有资源',async()=>{
 const rows=Array.from({length:40},(_,i)=>({...resource,url:`https://pan.quark.cn/s/${String(i).padStart(3,'0')}`}));
 const expired=()=>{throw Object.assign(Error('失效'),{code:'QUARK_SHARE_EXPIRED'})};
 const found=await verifySearchResults(rows,options({episode:219,inspect:async row=>row===rows[18]?details([219]):expired()}));
 assert.deepEqual(found.resources.map(row=>row.url),[rows[18].url]);
 const limited=await verifySearchResults(rows,options({episode:219,inspect:expired}));
 assert.match(limited.error,/未核对完/);
});

test('明确集数语法只提取目标要求，不把年份、季数或正常片名裁剪掉',()=>{
 for(const query of ['斗破苍穹 第219集','斗破苍穹219集','斗破苍穹 EP219'])assert.deepEqual(searchIntent(query),{title:'斗破苍穹',episode:219});
 for(const title of ['请回答1988','斗破苍穹 第二季','第八个嫌疑人','Cube3','Episode1'])assert.deepEqual(searchIntent(title),{title,episode:undefined});
});
test('搜索指定219集只验证这一集，部分分享不能被标成全集但可保存指定集数',async()=>{
 const checked=await verifySearchResults([resource],options({episode:219,inspect:async()=>details([219])}));
 assert.equal(checked.resources.length,1);assert.deepEqual(checked.resources[0].verification.selectedFids,['e219']);assert.deepEqual(checked.resources[0].verification.requiredEpisodes,[219]);
 const full=await verifySearchResults([resource],options({inspect:async()=>details([219])}));assert.equal(full.resources.length,1);assert.equal(full.resources[0].verification.complete,false);assert.match(full.resources[0].verification.notice,/分段资源/);assert.deepEqual(full.resources[0].verification.requiredEpisodes,[219]);
});
test('失效分享、缺少目标集与错误片名不进入保存结果',async()=>{
 for(const inspect of [async()=>{throw Object.assign(new Error('取消分享'),{code:'QUARK_SHARE_UNAVAILABLE',status:422});},async()=>details([218]),async()=>({...details([219]),title:'其他作品'})]){
  const result=await verifySearchResults([resource],options({episode:219,inspect}));assert.equal(result.resources.length,0);assert.match(result.message,/未找到|暂时无法确认/);assert.equal(result.error,undefined);
 }
});
test('认证或网络失败不假报未找到，未核对的结果不允许保存',async()=>{
 const auth=await verifySearchResults([resource],options({inspect:async()=>{throw Object.assign(new Error('auth'),{status:401});}}));assert.equal(auth.needsAuth,true);assert.match(auth.error,/认证/);assert.deepEqual(auth.resources,[]);
 const network=await verifySearchResults([resource],options({inspect:async()=>{throw new Error('网络错误');}}));assert.match(network.error,/网络/);assert.deepEqual(network.resources,[]);
});
test('取消核对后迟到的目录不重新填充结果，搜索全过程不执行保存请求',async t=>{
 const calls=[];let release,shareSignal;
 mockFetch(t,async(url,init)=>{calls.push(String(url));if(String(url).includes('resource-search'))return Response.json({code:0,data:{merged_by_type:{quark:[{url:resource.url,note:resource.title,work_title:resource.workTitle,category:'anime',year:'2022',latest_episode:219}]}}});shareSignal=init.signal;return new Promise(resolve=>{release=resolve;});});
 const view=useQuarkTransfer();const pending=view.openTransferModal({id:'search-test',title:'斗破苍穹 第219集',category:'anime'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.searchPhase.value,'verifying');assert.equal(view.isAnalyzing.value,true);assert.equal(view.quarkResources.value.length,0);
 view.closeTransferModal();assert.equal(shareSignal.aborted,true);release(Response.json({code:0,data:details([219])}));await pending;assert.equal(view.quarkResources.value.length,0);assert.ok(calls.every(url=>!url.includes('media-cards')));
});
test('核对后保存前缺集或分享名称变更均被拒绝，正确剧集可以保存',()=>{
 assert.throws(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'斗破苍穹年番',requiredEpisodes:[219]},[218]),{code:'QUARK_SOURCE_CHANGED'});
 assert.throws(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'其他作品',requiredEpisodes:[219]},[219]),{code:'QUARK_SOURCE_CHANGED'});
 assert.doesNotThrow(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'斗破苍穹年番',requiredEpisodes:[219]},[219]));
});

test('真实目录只有212至214和219时普通搜索展示真实范围，指定219仍能保存，220明确未找到',async()=>{
 const data={...details([212,213,214,219]),title:'D 斗破苍穹'};
 const basic=await verifySearchResults([resource],options({inspect:async()=>data}));
 assert.equal(basic.resources.length,1);const verified=basic.resources[0].verification;
 assert.match(verified.summary,/212～214、219/);assert.match(verified.notice,/分段资源/);assert.doesNotMatch(verified.notice,/缺少|215/);
 assert.deepEqual(verified.requiredEpisodes,[212,213,214,219]);assert.deepEqual(verified.selectedFids,['e212','e213','e214','e219']);
 const selected=await verifySearchResults([resource],options({episode:219,inspect:async()=>data}));assert.deepEqual(selected.resources[0].verification.selectedFids,['e219']);
 const absent=await verifySearchResults([resource],options({episode:220,inspect:async()=>data}));assert.equal(absent.resources.length,0);assert.match(absent.message,/未找到.*220/);
});

test('无视频的真实返回不能误报为片名不符，混淆名称不能凭来源标题冒充已确认',async()=>{
 const noVideo={title:'D .陡.坡.沧.琼.念.反（2022）',videoCount:0,entries:[{fid:'not-video',name:'E219.mp3',isVideo:false,episodeNumber:0}]};
 const result=await verifySearchResults([resource],options({inspect:async()=>noVideo}));assert.equal(result.resources.length,0);assert.match(result.message,/没有识别到正片视频/);assert.doesNotMatch(result.message,/片名或版本不符/);
 const ambiguous=await verifySearchResults([resource],options({inspect:async()=>({...details([219]),title:'DOUP'})}));assert.equal(ambiguous.resources.length,0);
});

test('未指定季数可以核对单一第五季；明确第一季或混合季数不得混存',async()=>{
 const fifth={title:'斗破苍穹 第五季',videoCount:1,entries:[{...file(219),name:'斗破苍穹.S05E219.mkv'}]};
 const generic=await verifySearchResults([resource],options({episode:219,inspect:async()=>fifth}));assert.equal(generic.resources.length,1);
 const explicit=await verifySearchResults([resource],options({title:'斗破苍穹 第一季',episode:219,inspect:async()=>fifth}));assert.equal(explicit.resources.length,0);
 const mixed=await verifySearchResults([resource],options({inspect:async()=>({...fifth,entries:[...fifth.entries,{...file(1),name:'S01E01.mp4'}]})}));assert.deepEqual(mixed.resources[0].verification.requiredEpisodes, [219]);
});

test('重新输入另一片名清除旧年份、作品关联和待替换片库标识',async t=>{
 mockFetch(t,async(url)=>String(url).includes('resource-search')?Response.json({code:0,data:{total:0,merged_by_type:{quark:[]}}}):assert.fail('没有结果无需核对'));
 const view=useQuarkTransfer();await view.openTransferModal({id:'old',title:'旧剧',category:'tv',year:'2020',catalogId:'douban:old',quarkFid:'old-fid',poster:'old-cover'});
 await view.refreshResources('新动漫 第219集','anime');
 assert.equal(view.currentMedia.value.title,'新动漫');assert.equal(view.currentMedia.value.category,'anime');
 for(const key of ['year','catalogId','quarkFid'])assert.equal(view.currentMedia.value[key],undefined);
 assert.equal(view.currentMedia.value.poster,'');view.closeTransferModal();
});

test('官方已更新到更高集数时不把旧目录当作当前全集，动漫仍显示实际分段',async()=>{
 const result=await verifySearchResults([resource],options({officialLatest:220,inspect:async()=>details([219])}));
 assert.equal(result.resources[0].verification.latestEpisode,219);assert.equal(result.resources[0].verification.complete,false);
 assert.deepEqual(result.resources[0].verification.requiredEpisodes,[219]);
});

test('准确发布标题可以核对有明确发布者标记的短目录名，其他作品和模糊拼音仍拒绝',async()=>{
 const published={...resource,title:'【国漫】牧神记 (2024) 更新109集',workTitle:undefined,year:undefined,source:'public_guoman4K',latestEpisode:109};
 const inspect=async title=>({title,videoCount:1,entries:[{...file(109),name:'109 4K.mp4'}]});
 const accepted=await verifySearchResults([published],{...options({title:'牧神记',episode:109}),inspect:()=>inspect('M 牧神')});
 assert.equal(accepted.resources.length,1);assert.deepEqual(accepted.resources[0].verification.selectedFids,['e109']);
 for(const title of ['M 其他作品','M 牧神的新故事','牧神','mushen']){
  const result=await verifySearchResults([published],{...options({title:'牧神记',episode:109}),inspect:()=>inspect(title)});assert.equal(result.resources.length,0,title);
 }
 const wrongPost=await verifySearchResults([{...published,title:'其他作品',source:'public_guoman4K'}],{...options({title:'牧神记'}),inspect:()=>inspect('M 牧神')});assert.equal(wrongPost.resources.length,0);
});

const mockFetch=(t,handler)=>t.mock.method(globalThis,'fetch',(url,init)=>String(url).includes('/official-progress')?Promise.resolve(Response.json({code:0,data:{status:'unknown',works:[],checkedAt:'',message:'官方进度暂未确认'}})):handler(url,init));

test('已核实的电视剧目录别名显示实际集数，并拒绝错剧、错年份和混季', async () => {
  for (const [title, directory, count] of [['多喜一家人', '多喜', 10], ['折月亮', '【Z】折丨Y越亮', 27]]) {
    const indexed = { ...resource, title, workTitle: title, category: 'tv', source: 'erxiaopan', year: '2026', latestEpisode: count };
    const entries = Array.from({ length: count }, (_, index) => ({ ...file(index + 1),
      name: `${String(index + 1).padStart(2, '0')}-4K.mp4` }));
    const verify = (overrides = {}, data = {}) => verifySearchResults([{ ...indexed, ...overrides }], options({
      title, category: 'tv', year: '2026', officialLatest: count,
      inspect: async () => ({ title: directory, videoCount: entries.length, entries, ...data })
    }));
    const result = await verify();
    assert.equal(result.resources[0]?.verification.episodeCount, count, title);
    assert.equal(result.resources[0].verification.complete, true);
    assert.equal((await verify({}, { entries: entries.slice(1) })).resources[0].verification.complete, false);
    for (const overrides of [{ source: 'other' }, { year: '2025' }, { category: 'anime' }, { workTitle: `${title} 第二季` }]) {
      assert.equal((await verify(overrides)).resources.length, 0);
    }
    for (const name of ['其他电视剧.E01.mp4', 'S02E01.mp4', `${title}.2025.E01.mp4`]) {
      const partial = (await verify({}, { entries: [{ ...entries[0], name }, ...entries.slice(1)] })).resources[0].verification;
      assert.equal(partial.complete, false);
      assert.deepEqual(partial.requiredEpisodes, entries.slice(1).map(entry => entry.episodeNumber));
    }
    assert.equal((await verify({}, { title: `${directory}合集` })).resources.length, 0);
  }
});

test('仙逆真实失败结构：3个失效分享和1个无正片目录明确汇总，不误报认证失败或存在可保存结果', async () => {
 const rows = [0,1,2,3].map(n => ({ ...resource, id:'xianni'+n, url:'https://pan.quark.cn/s/xianni'+n, title:'仙逆', workTitle:'仙逆', year:undefined }));
 const result = await verifySearchResults(rows, options({ title:'仙逆', inspect:async row => {
  if(row.id!=='xianni3')throw Object.assign(new Error('分享地址已失效'),{code:'QUARK_SHARE_UNAVAILABLE',status:422});
  return {title:'仙尼2026-7',videoCount:0,episodeCount:0,entries:[]};
 } }));
 assert.equal(result.resources.length,0);assert.equal(result.needsAuth,undefined);
 assert.match(result.message,/本次核对 4 个分享/);assert.match(result.message,/3 个已失效/);assert.match(result.message,/1 个未识别到正片视频/);
});

test('电视剧同集多画质压缩包仍能提供明确的解压入口，不能被标成已验证可播放',async()=>{
 const item={...resource,title:'折月亮',workTitle:'折月亮',category:'tv',year:'2026',source:'quark4k'};
 const result=await verifySearchResults([item],options({title:'折月亮',category:'tv',episode:27,inspect:async()=>({title:'Z 这越亮',videoCount:0,entries:[
  {fid:'small',name:'27.zip',isArchive:true,archiveFormat:'zip',isVideo:false,episodeNumber:27,size:100},
  {fid:'large',name:'27.zip',isArchive:true,archiveFormat:'zip',isVideo:false,episodeNumber:27,size:200}
 ]})}));
 assert.equal(result.resources.length,1);assert.equal(result.resources[0].archivePreparation.archiveFid,'large');
 assert.equal(result.resources[0].verification,undefined);
});


test('全集档案按实际编号去重显示范围，保留单集操作语义，不能冒充已验证视频', async () => {
 const item={...resource,title:'尚公主',workTitle:'尚公主',category:'tv',year:'2026',source:'quark4k',latestEpisode:40};
 const archives=Array.from({length:40},(_,i)=>({fid:'zip'+(i+1),name:(i+1)+'.zip',isArchive:true,archiveFormat:'zip',isVideo:false,episodeNumber:i+1,size:100}));
 const inspect=async()=>({title:'S 商公猪 40集全',videoCount:0,entries:[...archives,...archives.map(a=>({...a,fid:a.fid+'large',size:200}))]});
 const checked=await verifySearchResults([item],options({title:'尚公主',category:'tv',officialLatest:40,inspect}));
 const found=checked.resources[0];
 assert.equal(found.verification,undefined);assert.equal(found.archivePreparation.archiveFid,'zip40large');
 assert.deepEqual(found.archivePreparation.availableEpisodes,Array.from({length:40},(_,i)=>i+1));
 assert.deepEqual(found.archivePreparation.missingEpisodes,[]);
 assert.match(found.archivePreparation.summary,/1～40/);assert.match(found.archivePreparation.notice,/检查并补齐/);
 assert.equal(found.archivePreparation.batchEligible,true);
 const absent=await verifySearchResults([item],options({title:'尚公主',category:'tv',officialLatest:40,inspect:async()=>({title:'S 商公猪',videoCount:0,entries:archives.filter(a=>a.episodeNumber!==17)})}));
 assert.deepEqual(absent.resources[0].archivePreparation.missingEpisodes,[17]);
 assert.match(absent.resources[0].archivePreparation.notice,/第 17 集暂未找到/);
 const selected=await verifySearchResults([item],options({title:'尚公主',category:'tv',episode:5,inspect}));
 assert.deepEqual(selected.resources[0].archivePreparation.availableEpisodes,[5]);
 assert.equal(selected.resources[0].archivePreparation.episode,5);
 assert.equal(selected.resources[0].archivePreparation.batchEligible,false);
});

test('同一电视剧分享同时含视频和压缩包时保留两种实际覆盖，用于自动补全', async () => {
 const item={...resource,title:'折月亮',workTitle:'折月亮',category:'tv',year:'2026',source:'quark4k',latestEpisode:27};
 const entries=[{...file(27),name:'折月亮.E27.mp4'},...Array.from({length:26},(_,i)=>({
  fid:'zip'+(i+1),name:(i+1)+'.zip',isArchive:true,archiveFormat:'zip',isVideo:false,episodeNumber:i+1,size:100
 }))];
 const result=await verifySearchResults([item],options({title:'折月亮',category:'tv',officialLatest:27,inspect:async()=>({title:'折月亮',videoCount:1,entries})}));
 assert.equal(result.resources.length,1);
 assert.equal(result.resources[0].verification.complete,false);
 assert.deepEqual(result.resources[0].verification.requiredEpisodes,[27]);
 assert.equal(result.resources[0].batchEligible,true);
 assert.equal(result.resources[0].archivePreparation.batchEligible,true);
 assert.equal(result.resources[0].archivePreparation.availableEpisodes.length,26);
});

test('电影分享根目录乱命名时，用发布片名与视频中的官方别名、年份共同核对', async () => {
  const title = '给阿嬷的情书';
  const root = 'G 给阿.MDQS 1080P';
  const published = { ...resource, title, workTitle: title, workTitleAliases: ['Dear You'], year: '2026', category: 'movie', source: 'erxiaopan' };
  const movie = { fid: 'film', name: 'Dear.You.2026.1080p.H264.mkv', isVideo: true, episodeNumber: 0, size: 5682931662, ancestorFids: ['root'] };
  const verify = (files, row = published, directory = root) => verifySearchResults([row], options({ title, category: 'movie', year: '2026',
    inspect: async () => ({ title: directory, videoCount: files.length, entries: [{ fid: 'root', name: directory, isDirectory: true }, ...files] }) }));
  const result = await verify([movie]);
  assert.deepEqual(result.resources[0].verification.selectedFids, ['film']);
  for (const name of ['Dear.You.2025.1080p.mkv', 'Dear.You.1080p.mkv', 'Dear.You.2026.Trailer.mkv', 'Dear.You.2.2026.mkv', '4K.H264.mkv']) {
    assert.equal((await verify([{ ...movie, name }])).resources.length, 0, name);
  }
  assert.deepEqual((await verify([movie, { ...movie, fid: 'other', name: '其他电影.2026.mkv' }])).resources[0].verification.selectedFids, ['film']);
  assert.equal((await verify([movie], { ...published, year: '2025' })).resources.length, 0);
  assert.equal((await verify([movie], { ...published, source: 'unknown' })).resources.length, 0);
  assert.equal((await verify([movie], published, '其他版本 2025')).resources.length, 0);
});

test('同一部动漫接受 II 与 2 写法，仍只显示实际文件并排除原作', async () => {
  const { SilentSearchEngine } = await compile('src/services/silentSearchEngine.ts');
  const { rankResourceCandidates } = await compile('src/services/resourceMatching.ts');
  const anime = { ...resource, title: '【国漫】斗罗大陆2：绝世唐门 更新179集', source: 'public_guoman4K', workTitle: undefined };
  const title = '斗罗大陆Ⅱ绝世唐门';
  const remote = new SilentSearchEngine();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ code: 0, data: { merged_by_type: { quark: [{ url: anime.url, note: anime.title, category: 'anime' }] } } });
    assert.equal((await remote.search(title, 'anime')).quarkItems.length, 1);
    assert.equal((await remote.search('斗罗大陆', 'anime')).quarkItems.length, 0);
  } finally { globalThis.fetch = original; }
  assert.equal(rankResourceCandidates([anime], title, 'anime').length, 1);
  assert.equal(rankResourceCandidates([anime], '斗罗大陆', 'anime').length, 0);
  const share = { title: '斗罗大陆2：绝世唐门', videoCount: 1, entries: [file(179)] };
  const accepted = await verifySearchResults([anime], options({ title, episode: 179, inspect: async () => share }));
  assert.deepEqual(accepted.resources[0].verification.requiredEpisodes, [179]);
  const missing = await verifySearchResults([anime], options({ title, episode: 180, inspect: async () => share }));
  assert.equal(missing.resources.length, 0);
});


test('资料的任意作品别名可用于文件核验，只有匿名目录和空白文件名时保持未确认', async () => {
  const title = '肖申克的救赎';
  const { SilentSearchEngine } = await compile('src/services/silentSearchEngine.ts');
  const raw = { url: resource.url, note: title, work_title: title, work_title_aliases: ['The Shawshank Redemption', '月黑高飞'], year: '1994', category: 'movie', source: 'erxiaopan' };
  const original = globalThis.fetch;
  let rows;
  try {
    globalThis.fetch = async () => Response.json({ code: 0, data: { merged_by_type: { quark: [raw] } } });
    rows = (await new SilentSearchEngine().search(title, 'movie')).quarkItems;
  } finally { globalThis.fetch = original; }
  for (const [name, accepted] of [['The.Shawshank.Redemption.1994.1080p.mkv', true], ['月黑高飞.1994.1080p.mp4', true], ['月黑高飞.1995.1080p.mp4', false], ['A.1994.1080p.mp4', false]]) {
    const verified = await verifySearchResults(rows, options({ title, category: 'movie', year: '1994', inspect: async () => ({
      title: '截图存档', videoCount: 1, entries: [{ fid: 'main', isVideo: true, name, size: 2000 }]
    }) }));
    assert.equal(verified.resources.length, Number(accepted), name);
  }
});

test('其他续作也能匹配罗马数字和阿拉伯数字，保留原作和集号边界', async () => {
  const { rankResourceCandidates } = await compile('src/services/resourceMatching.ts');
  const title = '黑客帝国Ⅱ重装上阵';
  const movie = { ...resource, category: 'movie', workTitle: undefined, title: '【电影】黑客帝国2：重装上阵 (2003) 4K' };
  assert.equal(rankResourceCandidates([movie], title, 'movie').length, 1);
  assert.equal(rankResourceCandidates([movie], '黑客帝国', 'movie').length, 0);
  assert.equal(rankResourceCandidates([{ ...resource, title: '【国漫】测试动漫 12集', workTitle: undefined }], '测试动漫', 'anime').length, 1);
});


test('逐文件核对支持发行标签和任意子目录，并只提交已确认的 FID', async () => {
  const title = '肖申克的救赎', category = 'movie', year = '1994';
  const row = { ...resource, title, workTitle: title, workTitleAliases: ['The Shawshank Redemption'], category, year, source: 'erxiaopan' };
  const files = [
    { fid: 'folder', isDirectory: true, name: '上传者自建目录' },
    { fid: 'good', name: 'The.Shawshank.Redemption.1994.2160p.WEB-DL.10bit.DDP5.1.mkv', identityTag: 'checked', size: 2000 },
    { fid: 'wrong', name: '另一部电影.1994.mkv', identityTag: 'other', size: 9000 },
    { fid: 'trailer', name: 'The.Shawshank.Redemption.1994.Trailer.mkv', size: 3000 },
    { fid: 'audio', name: '视频2.mp4', size: 5000 }
  ].map(entry => entry.isDirectory ? entry : { ...entry, isVideo: true, ancestorFids: ['folder'] });
  const result = await verifySearchResults([row], options({ title, category, year, inspect: async () => ({ title: '存档', entries: files, videoCount: 4 }) }));
  assert.deepEqual(result.resources[0].verification.selectedFids, ['good']);
  assert.deepEqual(result.resources[0].verification.fileChecks, ['checked']);
});

test('编号视频和压缩包共享作品与季别检查，识别同音发行目录但排除错片子目录', async () => {
  const title = '无声的回响', category = 'tv', year = '2026';
  const row = { ...resource, title, workTitle: title, year, category, source: 'quark4k' };
  const entries = [{ fid: 'q', name: '4K HDR Vivid 60帧率', isDirectory: true }, { fid: 'bad', name: '其他剧', isDirectory: true }];
  for (const [id, episode, parent] of [['one', 1, 'q'], ['other', 2, 'bad']]) {
    for (const ext of ['mp4', 'zip']) entries.push({ fid: id + ext, name: `${episode}.${ext}`, episodeNumber: episode,
      isVideo: ext === 'mp4', isArchive: ext === 'zip', archiveFormat: ext, ancestorFids: [parent], size: 10 });
  }
  const check = (directory, source = row) => verifySearchResults([source], options({ title, category, year, officialLatest: 2,
    inspect: async () => ({ title: directory, videoCount: 2, entries }) }));
  const result = (await check('W 吴生的会想 更新至03集')).resources[0];
  assert.deepEqual(result.verification.requiredEpisodes, [1]);
  assert.deepEqual(result.archivePreparation.availableEpisodes, [1]);
  assert.equal(result.verification.complete, false);
  assert.equal((await check('完全无关')).resources.length, 0);
  assert.equal((await check('W 吴生的会想 更新至03集', { ...row, year: '2025' })).resources.length, 0);
});

test('综艺简称只在季号、发布日期和期号一致时认可，并报告真实期数', async () => {
  const title = '奔跑吧', category = 'variety', year = '2026';
  const row = { ...resource, title: '奔跑吧 第十季', workTitle: '奔跑吧 第十季', year, category, source: 'erxiaopan', latestEpisode: 12 };
  const data = [{ ...file(12), name: '2026-07-10 2160p.60fps.第12期：节目小标题.mp4' },
    { ...file(6), name: '2025.06.19-第6期.mp4' }];
  const check = directory => verifySearchResults([row], options({ title, category, year,
    inspect: async () => ({ title: directory, videoCount: 2, entries: data }) }));
  const result = (await check('奔跑10年')).resources[0];
  assert.deepEqual(result.verification.requiredEpisodes, [12]);
  assert.equal(result.verification.episodeCount, 1);
  assert.equal((await check('奔跑9年')).resources.length, 0);
});

test('电影短名只凭大小和时长不能确认；同目录唯一视频、具名字幕和分钟数可相互印证', async () => {
  const title = '示例', category = 'movie', year = '2026';
  const row = { ...resource, title, workTitle: title, year, category, runtimeMinutes: 110, source: 'erxiaopan' };
  const video = { fid: 'm', name: '2160P.10bit.mkv', isVideo: true, duration: 6601, identityTag: 'v', sidecarTag: 's.proof', parentFid: 'root' };
  const text = { fid: 'sub', name: '示例.2026.zh-Hans.srt', isSubtitle: true, parentFid: 'root' };
  const check = entries => verifySearchResults([row], options({ title, category, year, inspect: async () => ({ title: '匿名', videoCount: 1, entries }) }));
  assert.deepEqual((await check([video, text])).resources[0].verification.fileChecks, ['s.proof']);
  for (const entries of [[video], [video, text, { ...text, fid: 'conflict', name: '其他电影.srt' }], [video, { ...text, parentFid: 'elsewhere' }], [{ ...video, name: '其他作品.mkv' }, text],
    [{ ...video, duration: 4700 }, text], [{ ...video, sidecarTag: undefined }, text]]) assert.equal((await check(entries)).resources.length, 0);
});
