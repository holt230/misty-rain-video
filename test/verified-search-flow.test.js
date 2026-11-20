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
  const result=await verifySearchResults([resource],options({episode:219,inspect}));assert.equal(result.resources.length,0);assert.match(result.message,/未找到/);assert.equal(result.error,undefined);
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
 const mixed=await verifySearchResults([resource],options({inspect:async()=>({...fifth,entries:[...fifth.entries,{...file(1),name:'S01E01.mp4'}]})}));assert.equal(mixed.resources.length,0);
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
      assert.equal((await verify({}, { entries: [{ ...entries[0], name }, ...entries.slice(1)] })).resources.length, 0);
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
  assert.equal((await verify([movie, { ...movie, fid: 'other', name: '其他电影.2026.mkv' }])).resources.length, 0);
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
