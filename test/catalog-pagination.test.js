import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { CatalogService } from '../server/catalog.js';
import { handleApiRequest } from '../server/api.js';

const row = n => ({ id: String(n + 100), title: '影片' + n, card_subtitle: '2026 / 中国大陆', type: 'tv', pic: { normal: 'https://img2.doubanio.com/test.jpg' } });
const rows = (start, count = 24) => Array.from({ length: count }, (_, i) => row(start + i));
async function directory(t) {
  await fs.mkdir('.local-runtime/tests', { recursive: true });
  const dir = await fs.mkdtemp('.local-runtime/tests/catalog-pages-');
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
test('pages use distinct offsets, coalesce requests, survive restart and register later-page artwork', async t => {
  const dir = await directory(t), requested = [];
  const fetcher = async url => {
    const start = Number(new URL(url).searchParams.get('start')); requested.push(start);
    return Response.json({ total: 52, items: rows(start, start === 48 ? 4 : 24) });
  };
  const service = new CatalogService(dir, { fetcher });
  const first = await service.get('tv');
  const [second, same] = await Promise.all([service.get('tv', 2, first.revision), service.get('tv', 2, first.revision)]);
  assert.deepEqual(requested, [0, 24]); assert.deepEqual(second, same); assert.equal(second.items[0].title, '影片24'); assert.equal(second.hasMore, true);
  const last = await service.get('tv', 3, first.revision); assert.equal(last.items.length, 4); assert.equal(last.hasMore, false);
  assert.equal((await service.workItem('124')).title, '影片24');
  const restarted = new CatalogService(dir, { fetcher: () => { throw Error('must use cache'); } });
  assert.equal((await restarted.get('tv', 2, first.revision)).items[0].title, '影片24');
});
test('hasMore follows source offsets and totals rather than the number remaining after category filtering', async t => {
  const service = new CatalogService(await directory(t), { fetcher: async url => {
    const start = Number(new URL(url).searchParams.get('start'));
    return Response.json({ total: 48, items: rows(start).map((item, i) => ({ ...item, type: i < 4 ? 'tv' : 'movie' })) });
  } });
  const first = await service.get('movie'); assert.equal(first.items.length, 20); assert.equal(first.hasMore, true);
  const second = await service.get('movie', 2, first.revision); assert.equal(second.items.length, 20); assert.equal(second.hasMore, false);
});
test('later-page failures back off without switching provider, advancing pages or clearing page one', async t => {
  let calls = 0, fail = true, now = 1700000000000;
  const service = new CatalogService(await directory(t), { now: () => now, fetcher: async url => {
    calls++; const current = new URL(url); assert.ok(current.pathname.includes('rexxar'));
    const start = Number(current.searchParams.get('start'));
    if (start && fail) throw Error('offline');
    return Response.json({ total: 48, items: rows(start) });
  } });
  const first = await service.get('tv');
  const failed = await service.get('tv', 2, first.revision); assert.equal(failed.loadError, true); assert.equal(failed.items.length, 0);
  await service.get('tv', 2, first.revision); assert.equal(calls, 2); assert.equal((await service.get('tv')).items.length, 24);
  now += 61_000; fail = false;
  assert.equal((await service.get('tv', 2, first.revision)).items.length, 24); assert.equal(calls, 3);
});
test('legacy pagination keeps its provider and empty later pages are a successful end', async t => {
  const requests = [];
  const service = new CatalogService(await directory(t), { fetcher: async url => {
    requests.push(new URL(url)); if (url.includes('rexxar')) throw Error('primary down');
    const start = Number(new URL(url).searchParams.get('page_start'));
    return Response.json({ subjects: start ? [] : rows(0).map(({ type, ...item }) => item) });
  } });
  const first = await service.get('tv');
  const last = await service.get('tv', 2, first.revision);
  assert.equal(requests.length, 3); assert.equal(requests[2].searchParams.get('page_start'), '24');
  assert.equal(last.items.length, 0); assert.equal(last.hasMore, false); assert.equal(last.loadError, false);
});
test('repeated upstream pages end browsing instead of creating an infinite loading loop', async t => {
  const service = new CatalogService(await directory(t), { fetcher: async () => Response.json({ total: 200, items: rows(0) }) });
  const first = await service.get('tv');
  assert.equal((await service.get('tv', 2, first.revision)).hasMore, false);
});
test('a reordered first page rejects old revisions and late old pages cannot poison a new revision', async t => {
  let version = 0, release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const service = new CatalogService(await directory(t), { fetcher: async url => {
    const start = Number(new URL(url).searchParams.get('start')), generation = version;
    if (start === 48 && generation === 0) { entered(); await new Promise(resolve => { release = resolve; }); }
    return Response.json({ total: 200, items: rows(generation * 1000 + start) });
  } });
  const first = await service.get('tv'); await service.get('tv', 2, first.revision);
  const pending = service.get('tv', 3, first.revision); const rejected = assert.rejects(pending, error => error.code === 'CATALOG_CHANGED');
  await started; version = 1; await service.refresh('tv'); release(); await rejected;
  const next = await service.get('tv'); assert.notEqual(first.revision, next.revision);
  await assert.rejects(service.get('tv', 2, first.revision), error => error.statusCode === 409);
  const second = await service.get('tv', 2, next.revision); assert.equal(second.items[0].title, '影片1024'); assert.equal(second.loadError, false);
});
test('invalid channel, page and revision cannot issue upstream requests', async t => {
  let calls = 0;
  const service = new CatalogService(await directory(t), { fetcher: async () => { calls++; return Response.json({ items: rows(0) }); } });
  for (const page of [0, -1, 1.5, 51, NaN]) await assert.rejects(service.get('tv', page), /分页/);
  await assert.rejects(service.get('../secret', 2), /未知/); await assert.rejects(service.get('tv', 2, '../bad'), /版本/);
  assert.equal(calls, 0);
  const context = { authService: { authenticate: () => ({ username: 'test', folder: 'test' }) }, userContext: () => ({}), catalog: service };
  for (const page of ['abc', '-1', '1.1', '1e2', '51']) {
    const response = { setHeader() {}, end() {} };
    await handleApiRequest({ url: '/api/catalog?channel=tv&page=' + page, method: 'GET', headers: { host: 'localhost' } }, response, context);
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls, 0);
});
