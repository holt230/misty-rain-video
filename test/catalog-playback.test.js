import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/services/catalogPlayback.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { prepareCatalogPlayback } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const work = { title: '测试剧', year: '2026', category: 'tv' };
const resource = n => ({ title: '测试剧 2026 全1集', url: 'https://pan.quark.cn/s/test' + n });
const details = { title: '测试剧', videoCount: 1, entries: [{ fid: 'e1', name: 'S01E01.mp4', isVideo: true, episodeNumber: 1 }] };
const defaults = { searching: () => false, cancelled: () => false, progress() {} };

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

test('自动找全集跳过虚标219但实际仅1集的来源，仅保存真实连续全集', async () => {
  const target = { title: '斗破苍穹', category: 'anime' };
  const sources = [1,2].map(n => ({ title: '斗破苍穹年番', workTitle: '斗破苍穹年番', category: 'anime', year: '2022', latestEpisode: 219, url: 'https://pan.quark.cn/s/source' + n }));
  let inspected = 0, saved;
  const video = n => ({ fid: String(n), name: `S05E${n}.mp4`, isVideo: true, episodeNumber: n, size: 100 });
  const result = await prepareCatalogPlayback(target, { ...defaults, resources: () => sources,
    inspect: async () => { inspected++; const entries = inspected === 1 ? [video(219)] : Array.from({ length: 219 }, (_, i) => video(i + 1)); return { title: '斗破苍穹年番', videoCount: entries.length, entries }; },
    save: async (source, fids) => { saved = { source, fids }; return true; } });
  assert.equal(result.status, 'saved'); assert.equal(inspected, 2);
  assert.equal(saved.source.url, sources[1].url); assert.equal(saved.fids, undefined);
});

test('没有完整来源时明确报告缺集且不执行入库', async () => {
  const source = { title: '斗破苍穹年番', workTitle: '斗破苍穹年番', category: 'anime', year: '2022', latestEpisode: 219, url: 'https://pan.quark.cn/s/partial' };
  const result = await prepareCatalogPlayback({ title: '斗破苍穹', category: 'anime' }, { ...defaults, resources: () => [source],
    inspect: async () => ({ title: '斗破苍穹年番', videoCount: 1, entries: [{ fid: '219', name: '219.mp4', isVideo: true, episodeNumber: 219 }] }),
    save: async () => assert.fail('Incomplete sources must not be imported') });
  assert.equal(result.status, 'manual'); assert.match(result.message, /缺 218 集/); assert.match(result.message, /未执行入库/);
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
