import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';
import { resolveShareSelection, entriesInSelection, groupShareTransfers } from '../server/shareSelection.js';
import { QuarkGateway } from '../server/quarkGateway.js';

const { code } = await transform(fs.readFileSync('src/services/shareSelection.ts', 'utf8'), { loader: 'ts', format: 'esm' });
const { toggleShareEntry, compactShareSelection } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const folder = (fid, name) => ({ fid, file_name: name, file_type: 0, share_fid_token: `token:${fid}` });
const file = (fid, name) => ({ fid, file_name: name, file_type: 1, size: 100, share_fid_token: `token:${fid}` });
const rawTree = () => new Map([
  ['0', [folder('series', '测试剧'), file('readme', '说明.txt')]],
  ['series', [folder('s1', '第一季'), folder('s2', '第二季')]],
  ['s1', [file('e1', 'S01E01.mp4'), file('e2', 'S01E02.mp4')]],
  ['s2', [file('e3', 'S02E03.mp4'), file('e4', 'S02E04.mp4')]]
]);

const flattened = () => [...rawTree()].flatMap(([parentFid, items]) => items.map(item => ({
  ...item, parentFid,
  ancestorFids: parentFid === '0' ? [] : parentFid === 'series' ? ['series'] : ['series', parentFid]
})));

const createGateway = t => {
  const tree = rawTree();
  const drive = new Map([['0', []]]);
  const writes = [];
  const listReads = [];
  let counter = 0;
  const reply = data => Response.json({ code: 0, data });
  const clone = (item, parentFid) => {
    const copied = { ...item, fid: `saved-${++counter}`, pdir_fid: parentFid };
    drive.get(parentFid).push(copied);
    if (item.file_type === 0) {
      drive.set(copied.fid, []);
      for (const child of tree.get(item.fid) || []) clone(child, copied.fid);
    }
    return copied.fid;
  };
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.pathname.endsWith('/share/sharepage/token')) return reply({ stoken: 'private-token', title: '测试资源' });
    if (url.pathname.endsWith('/share/sharepage/detail')) {
      const parent = url.searchParams.get('pdir_fid');
      listReads.push(parent);
      const items=tree.get(parent)||[];
      const page=Number(url.searchParams.get('_page'))||1, size=Number(url.searchParams.get('_size'))||10;
      return Response.json({code:0,metadata:{_page:page,_size:size,_total:items.length},data:{list:items.slice((page-1)*size,page*size)}});
    }
    if (url.pathname.endsWith('/file/sort')) return reply({ list: drive.get(url.searchParams.get('pdir_fid')) || [] });
    if (url.pathname.endsWith('/file') && init.method === 'POST') {
      const item = folder(`drive-${++counter}`, body.file_name);
      drive.get(body.pdir_fid).push(item);
      drive.set(item.fid, []);
      writes.push({ type: 'create', parent: body.pdir_fid, name: body.file_name });
      return reply(item);
    }
    if (url.pathname.endsWith('/share/sharepage/save')) {
      writes.push({ type: 'save', ...body });
      const all = [...tree.values()].flat();
      return reply({ save_as: { save_as_top_fids: body.fid_list.map(fid => clone(all.find(item => item.fid === fid), body.to_pdir_fid)) } });
    }
    if (url.pathname.endsWith('/file/rename')) {
      const item = [...drive.values()].flat().find(item => item.fid === body.fid);
      item.file_name = body.file_name;
      writes.push({ type: 'rename', ...body });
      return reply({});
    }
    if (url.pathname.endsWith('/file/delete')) {
      for (const [fid, items] of drive) drive.set(fid, items.filter(item => !body.filelist.includes(item.fid)));
      writes.push({ type: 'trash', ...body });
      return reply({});
    }
    throw new Error(`Unexpected mock request ${url.pathname}`);
  });
  const gateway = new QuarkGateway({
    credentialStore: { getCookie: () => 'test-cookie', saveCookie: () => {} },
    libraryConfigStore: { get: () => ({ rootFolderName: '烟雨影视' }) }
  });
  t.after(() => clearInterval(gateway.cleanupTimer));
  return { gateway, tree, drive, writes, listReads };
};
const shareInput = { shareUrl: 'https://pan.quark.cn/s/test123', title: '测试剧', category: 'tv' };

test('父文件夹和子文件重复选择只转存一次，文件夹覆盖其完整子树', () => {
  const entries = flattened();
  const selected = resolveShareSelection(entries, ['s1', 'e1', 'e1']);
  assert.deepEqual(selected.map(item => item.fid), ['s1']);
  assert.deepEqual(entriesInSelection(entries, selected).map(item => item.fid), ['s1', 'e1', 'e2']);
  assert.deepEqual(groupShareTransfers(selected)[0].ancestorFids, ['series']);
});

test('勾选整个目录后取消一集，保留其它文件并生成正确的保存范围', () => {
  const entries = flattened().map(item => ({ ...item, isDirectory: item.file_type === 0 }));
  const parent = entries.find(item => item.fid === 'series');
  const e2 = entries.find(item => item.fid === 'e2');
  let selected = toggleShareEntry(entries, new Set(), parent);
  selected = toggleShareEntry(entries, selected, e2);
  assert.deepEqual(compactShareSelection(entries, selected).sort(), ['e1', 's2']);
  assert.equal(selected.has('e2'), false);
  assert.equal(selected.has('e3'), true);
});

test('空选择、伪造标识和失效文件不触发全部保存', async t => {
  const { gateway, writes } = createGateway(t);
  for (const selection of [[], null, 'e1', ['foreign-file'], [{}]]) {
    await assert.rejects(gateway.importShare({ ...shareInput, quarkSelectionFids: selection }),
      error => ['QUARK_SELECTION_INVALID', 'QUARK_SELECTION_STALE'].includes(error.code));
  }
  assert.deepEqual(writes, []);
});

test('详情返回文件层级和集数，不暴露分享文件Token', async t => {
  const { gateway, writes } = createGateway(t);
  const result = await gateway.getShareDetails(shareInput);
  assert.equal(result.videoCount, 4);
  assert.equal(result.episodeCount, 4);
  assert.equal(result.entries.find(item => item.fid === 'e1').episodeTitle, '第 1 季 · 第 1 集');
  assert.equal(result.entries.find(item => item.fid === 's1').videoCount, 2);
  assert.deepEqual(result.entries.find(item => item.fid === 'e3').ancestorFids, ['series', 's2']);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
  assert.equal(JSON.stringify(result).includes('token:'), false);
  assert.deepEqual(writes, []);
});

test('跨文件夹选集平铺到影片目录、保留季数且只传服务端读取的文件凭证', async t => {
  const { gateway, drive, writes } = createGateway(t);
  const result = await gateway.importShare({ ...shareInput, quarkSelectionFids: ['e1', 'e3'] });
  const saves = writes.filter(item => item.type === 'save');
  assert.deepEqual(saves.flatMap(item => item.fid_list).sort(), ['e1', 'e3']);
  for (const save of saves) assert.deepEqual(save.fid_token_list, save.fid_list.map(fid => `token:${fid}`));
  assert.ok(saves.every(item => item.pdir_fid === '0'));
  const parentNames = saves.map(item => [...drive.values()].flat().find(folder => folder.fid === item.to_pdir_fid).file_name);
  assert.ok(parentNames.every(name => name === '测试剧'));
  assert.deepEqual(drive.get(result.item.quarkFid).map(item => item.file_name).sort(), ['第01季 第01集.mp4', '第02季 第03集.mp4']);
  assert.equal(result.savedFids.length, 2);
});

test('文件夹和其中的单集同时勾选，只转存一份目录内正片', async t => {
  const { gateway, writes } = createGateway(t);
  await gateway.importShare({ ...shareInput, quarkSelectionFids: ['s1', 'e1'] });
  assert.deepEqual(writes.filter(item => item.type === 'save').flatMap(item => item.fid_list).sort(), ['e1', 'e2']);
});

test('选集转存同时保留对应的字幕文件', async t => {
  const { gateway, tree, writes, drive } = createGateway(t);
  tree.get('s1').push(file('sub-e1', 'S01E01.chs.srt'), file('sub-e2', 'S01E02.chs.srt'));
  await gateway.importShare({ ...shareInput, quarkSelectionFids: ['e1'] });
  assert.deepEqual(writes.filter(item => item.type === 'save').flatMap(item => item.fid_list), ['e1', 'sub-e1']);
  const names = [...drive.values()].flat().map(item => item.file_name);
  assert.ok(names.some(name => /^第01季 第01集.*\.srt$/.test(name)));
});

test('保存文件夹时保留未按集数命名的字幕附件', async t => {
  const { gateway, tree, writes } = createGateway(t);
  tree.get('s1').push(file('generic-caption', '中文字幕.srt'));
  await gateway.importShare({ ...shareInput, quarkSelectionFids: ['s1'] });
  assert.ok(writes.filter(item => item.type === 'save').flatMap(item => item.fid_list).includes('generic-caption'));
});

test('未提供选择时递归识别全部正片，跳过分享目录和说明附件', async t => {
  const { gateway, writes, listReads } = createGateway(t);
  await gateway.importShare(shareInput);
  assert.deepEqual(writes.filter(item => item.type === 'save').flatMap(item => item.fid_list).sort(), ['e1', 'e2', 'e3', 'e4']);
  assert.deepEqual([...new Set(listReads)].sort(), ['0', 's1', 's2', 'series']);
});

test('选择保存后只检查所选文件夹的新集数，不补入其它文件夹', async t => {
  const { gateway, tree, writes } = createGateway(t);
  const selection = ['s1'];
  const imported = await gateway.importShare({ ...shareInput, quarkSelectionFids: selection });
  const card = { ...imported.item, quarkShareUrl: shareInput.shareUrl, quarkSelectionFids: selection };
  tree.get('s1').push(file('e5', 'S01E05.mp4'));
  tree.get('s2').push(file('e6', 'S02E06.mp4'));
  const [status] = await gateway.checkLibraryUpdates([card], undefined, { force: true });
  assert.equal(status.newEpisodeCount, 1);
  writes.length = 0;
  await gateway.applyLibraryUpdates([card]);
  assert.deepEqual(writes.filter(item => item.type === 'save').map(item => item.fid_list), [['e5']]);
});

test('重试同一组选集复用原目录，不重复转存', async t => {
  const { gateway, writes } = createGateway(t);
  const input = { ...shareInput, quarkSelectionFids: ['e1', 'e3'] };
  await gateway.importShare(input);
  writes.length = 0;
  const reused = await gateway.importShare(input);
  assert.deepEqual(writes.filter(item => item.type === 'save'), []);
  assert.equal(reused.transferredCount, 0);
});

test('先保存一集再保存该文件夹，只补充其中尚未保存的内容', async t => {
  const { gateway, writes } = createGateway(t);
  await gateway.importShare({ ...shareInput, quarkSelectionFids: ['e1'] });
  writes.length = 0;
  await gateway.importShare({ ...shareInput, quarkSelectionFids: ['s1'] });
  assert.deepEqual(writes.filter(item => item.type === 'save').map(item => item.fid_list), [['e2']]);
});

test('使用所选剧集换源，验证新目录后才切换旧片源', async t => {
  const { gateway, writes } = createGateway(t);
  const original = await gateway.importShare(shareInput);
  writes.length = 0;
  const replaced = await gateway.importShare({ ...shareInput, quarkFid: original.item.quarkFid, quarkSelectionFids: ['e1'] });
  assert.equal(replaced.replacedFid, original.item.quarkFid);
  assert.deepEqual(writes.filter(item => item.type === 'save').map(item => item.fid_list), [['e1']]);
  assert.deepEqual(writes.map(item => item.type).slice(-3), ['rename', 'rename', 'trash']);
});

test('多个季包含相同集号时，详情保留各季的文件与实际集数', async t => {
  const { gateway, tree } = createGateway(t);
  tree.set('s2', [file('e3', 'S02E01.mp4'), file('e4', 'S02E02.mp4')]);
  const details = await gateway.getShareDetails(shareInput);
  assert.equal(details.episodeCount, 4);
  assert.equal(details.entries.filter(entry => entry.episodeNumber === 1).length, 2);
});


test('movie years in brackets are not mistaken for thousands of episodes', async t => {
  const { gateway, tree } = createGateway(t);
  tree.set('0', [file('year', '潜伏6（2026）1080p.mkv'), file('episode', '动画 第2026集.mp4')]);
  const details = await gateway.getShareDetails(shareInput);
  assert.notEqual(details.entries.find(item => item.fid === 'year').episodeNumber, 2026);
  assert.equal(details.entries.find(item => item.fid === 'episode').episodeNumber, 2026);
});

test('details expose actual thumbnails, aggregate folder sizes and dates; playback retains every version so the clicked file stays selectable', async t => {
  const {gateway,tree}=createGateway(t);
  tree.set('0',[folder('wrap','第一季')]);
  tree.set('wrap',[
    {...file('low','S01E01.720p.mp4'),size:1000,video_width:1280,video_height:720,thumbnail:'https://cdn.example.test/low?token=private',updated_at:1760000000000},
    {...file('high','S01E01.4K.mp4'),size:4000,video_width:3840,video_height:2160}
  ]);
  const details=await gateway.getShareDetails(shareInput);
  assert.equal(details.totalSize,5000);assert.equal(details.entries.find(item=>item.fid==='wrap').size,5000);
  const low=details.entries.find(item=>item.fid==='low');assert.match(low.thumbnail,/^\/api\/quark\/share-thumbnails\//);assert.ok(low.updatedAt);assert.doesNotMatch(JSON.stringify(details),/cdn.example|token=private/);
  const selected=await gateway.createPlaybackSession({...shareInput,episodeFid:'low'});
  assert.ok(selected.episodes.some(e=>e.fid==='low'));assert.ok(selected.episodes.some(e=>e.fid==='high'));assert.equal(selected.episodes.length,2);
  await assert.rejects(gateway.createPlaybackSession({...shareInput,episodeFid:'foreign'}),{code:'EPISODE_NOT_FOUND'});
});

test('playback episodes expose owner-scoped renewable thumbnails without extra directory scans or transfers',async t=>{
 const f=createGateway(t);
 f.tree.get('s1')[0].big_thumbnail='https://cdn.example.test/episode.png?private-signature=secret';
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qcoAAAAASUVORK5CYII=','base64');
 let imageReads=0;f.gateway.fetchMedia=async()=>{imageReads++;return new Response(png)};
 const session=await f.gateway.createPlaybackSession({shareUrl:'https://pan.quark.cn/s/fixture',title:'测试剧'});
 const episode=session.episodes.find(item=>item.fid==='e1');assert.match(episode.thumbnail,/\/episodes\/e1\/thumbnail$/);assert.doesNotMatch(JSON.stringify(session),/private-signature|cdn.example/);
 const reads=f.listReads.length;
 assert.equal((await f.gateway.getEpisodeThumbnail(session.sessionId,'e1')).contentType,'image/png');
 await f.gateway.getEpisodeThumbnail(session.sessionId,'e1');assert.equal(imageReads,1);assert.equal(f.listReads.length,reads);assert.equal(f.writes.length,0);
 await assert.rejects(f.gateway.getEpisodeThumbnail(session.sessionId,'e1',{username:'other',role:'user',folder:'other'}),{statusCode:403});
 f.gateway.sessions.get(session.sessionId).thumbnailHandles.get('e1').expires=0;
 await f.gateway.getEpisodeThumbnail(session.sessionId,'e1');assert.equal(imageReads,2);
 f.gateway.shareThumbnails.remove(f.gateway.sessions.get(session.sessionId).thumbnailHandles.get('e1').id);
 await f.gateway.getEpisodeThumbnail(session.sessionId,'e1');assert.equal(imageReads,3);
 await assert.rejects(f.gateway.getEpisodeThumbnail(session.sessionId,'missing'),{statusCode:404});
});
