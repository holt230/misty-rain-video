import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/services/catalogPlayback.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { prepareCatalogPlayback } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const work = { title: '测试剧', year: '2026', category: 'tv' };
const resource = n => ({ title: '测试剧 2026 全1集', url: 'https://pan.quark.cn/s/test' + n });
const details = { title: '测试剧', videoCount: 1, entries: [{ fid: 'e1', name: 'S01E01.mp4', isVideo: true, episodeNumber: 1 }] };
const defaults = { officialLatest: 1, searching: () => false, cancelled: () => false, progress() {} };

test('checks beyond the first three candidates, skips unavailable and ambiguous shares, and saves only verified content', async () => {
  let inspected = 0, saves = 0;
  const result = await prepareCatalogPlayback(work, {
    ...defaults, resources: () => [1,2,3,4,5].map(resource),
    inspect: async () => {
      inspected++;
      if (inspected < 3) throw Error('unavailable');
      return inspected === 3 ? { ...details, title: '不相关的影片' } : details;
    },
    save: async () => { saves++; return true; }
  });
  assert.equal(result.status, 'saved');
  assert.equal(inspected, 4); assert.equal(saves, 1);
});

test('waits for late search results and never imports after cancellation', async () => {
  let rows = [], pending = true, now = 0, stopped = false, saves = 0;
  const result = await prepareCatalogPlayback(work, {
    ...defaults, resources: () => rows, searching: () => pending, cancelled: () => stopped,
    now: () => now,
    wait: async () => { now += 250; rows = [resource(1)]; pending = false; },
    inspect: async () => { stopped = true; return details; },
    save: async () => { saves++; return true; }
  });
  assert.equal(result.status, 'cancelled'); assert.equal(saves, 0);
});

test('bounds read attempts and never retries a failed write automatically', async () => {
  let inspected = 0;
  const result = await prepareCatalogPlayback(work, {
    ...defaults, resources: () => Array.from({ length: 20 }, (_, n) => resource(n)),
    inspect: async () => { inspected++; throw Error('gone'); },
    save: async () => { throw Error('must not save'); }
  });
  assert.equal(result.status, 'manual'); assert.equal(inspected, 12);
  let writes = 0;
  const failed = await prepareCatalogPlayback(work, {
    ...defaults, resources: () => [resource(1), resource(2)], inspect: async () => details,
    save: async () => { writes++; return false; }
  });
  assert.equal(failed.status, 'failed'); assert.equal(writes, 1);
});

test('authentication errors stop the queue instead of repeatedly querying protected shares', async () => {
  let inspected = 0;
  const result = await prepareCatalogPlayback(work, {
    ...defaults, resources: () => [resource(1), resource(2)],
    inspect: async () => { inspected++; throw Object.assign(Error('auth'), { status: 401 }); },
    save: async () => { throw Error('must not save'); }
  });
  assert.equal(result.status, 'manual'); assert.equal(inspected, 1); assert.match(result.message, /认证/);
});

test('动漫分段来源可直接保存实际219集，不要求从第一集连续完整也不保存虚标全集', async () => {
  const target = { title: '斗破苍穹', category: 'anime' };
  const sources = [1,2].map(n => ({ title: '斗破苍穹年番', workTitle: '斗破苍穹年番', category: 'anime', year: '2022', latestEpisode: 219, url: 'https://pan.quark.cn/s/source' + n }));
  let inspected = 0, saved;
  const video = n => ({ fid: String(n), name: `S05E${n}.mp4`, isVideo: true, episodeNumber: n, size: 100 });
  const result = await prepareCatalogPlayback(target, { ...defaults, resources: () => sources,
    inspect: async () => { inspected++; const entries = inspected === 1 ? [video(219)] : Array.from({ length: 219 }, (_, i) => video(i + 1)); return { title: '斗破苍穹年番', videoCount: entries.length, entries }; },
    save: async (source, fids) => { saved = { source, fids }; return true; } });
  assert.equal(result.status, 'saved'); assert.equal(inspected, 1);
  assert.equal(saved.source.url, sources[0].url); assert.deepEqual(saved.fids, ['219']);
});

test('电视剧自动播放仍优先连续来源，不把只有末集的分享当成完整版本', async () => {
  const source = { title: '测试剧', workTitle: '测试剧', category: 'tv', year: '2026', latestEpisode: 30, url: 'https://pan.quark.cn/s/partial' };
  const result = await prepareCatalogPlayback(work, { ...defaults, resources: () => [source],
    inspect: async () => ({ title: '测试剧', videoCount: 1, entries: [{ fid: '30', name: '30.mp4', isVideo: true, episodeNumber: 30 }] }),
    save: async () => assert.fail('Incomplete sources must not be imported') });
  assert.equal(result.status, 'manual'); assert.match(result.message, /缺 29 集/); assert.match(result.message, /未执行入库/);
});

test('电视剧找到压缩包时先自动核对整部补集计划，不直接保存单集', async () => {
  const source = { title: '测试剧', workTitle: '测试剧', category: 'tv', year: '2026', url: 'https://pan.quark.cn/s/archive',
    batchEligible: true, archivePreparation: { batchEligible: true, episode: 27 } };
  let previews = 0;
  const result = await prepareCatalogPlayback(work, { ...defaults, resources: () => [source],
    inspect: async () => assert.fail('Archive search was already inspected'),
    save: async () => assert.fail('A batch must not start before the plan is shown'),
    previewBatch: async () => { previews++; return true; } });
  assert.equal(result.status, 'planned'); assert.equal(previews, 1);
});

test('已经核对的动漫分段不重复读取也不会因为未全集而被自动流程丢弃',async()=>{
 const source={title:'测试动画',workTitle:'测试动画',category:'anime',url:'https://pan.quark.cn/s/verified',verification:{complete:false,summary:'第219集',episodeCount:1,selectedFids:['219']}};
 let saved;
 const result=await prepareCatalogPlayback({title:'测试动画',category:'anime'},{...defaults,resources:()=>[source],inspect:()=>assert.fail('Already verified'),save:async(_,fids)=>{saved=fids;return true;}});
 assert.equal(result.status,'saved');assert.deepEqual(saved,['219']);
});

test('动漫已核对视频和压缩包并存时仍可直接保存已有视频',async()=>{
 const source={title:'测试动画',workTitle:'测试动画',category:'anime',url:'https://pan.quark.cn/s/mixed',
  archivePreparation:{batchEligible:false,episode:219},verification:{complete:false,summary:'第219集',episodeCount:1,selectedFids:['219']}};
 let saved;
 const result=await prepareCatalogPlayback({title:'测试动画',category:'anime'},{...defaults,resources:()=>[source],inspect:()=>assert.fail('Already verified'),save:async(_,fids)=>{saved=fids;return true;}});
 assert.equal(result.status,'saved');assert.deepEqual(saved,['219']);
});

test('目录请求挂起时按限时取消，不无限等待或保存', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  let signal;
  const pending = prepareCatalogPlayback(work, { ...defaults, resources: () => [resource(1)],
    inspect: async (_resource, value) => { signal = value; return new Promise(() => {}); },
    save: async () => assert.fail('Timed-out source must not save') });
  t.mock.timers.tick(8000);
  const result = await pending;
  assert.equal(signal.aborted, true); assert.equal(result.status, 'manual'); assert.match(result.message, /超时/);
});


test('电视剧发布方标全一集但缺少官方进度时，自动找源不能直接转存', async () => {
  const response = await prepareCatalogPlayback(work, { ...defaults, officialLatest: undefined, resources: () => [resource(1)],
    inspect: async () => details, save: async () => assert.fail('不能用来源标题代替官方进度') });
  assert.equal(response.status, 'manual');
});
