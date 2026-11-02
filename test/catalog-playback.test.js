import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/services/catalogPlayback.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { prepareCatalogPlayback } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const work = { title: '测试剧', year: '2026', category: 'tv' };
const resource = n => ({ title: '测试剧 2026', url: 'https://pan.quark.cn/s/test' + n });
const details = { title: '测试剧', videoCount: 1, entries: [{ name: 'S01E01.mp4', isVideo: true }] };
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
