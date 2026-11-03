import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { CatalogService, normalizeCatalog } from '../server/catalog.js';
import { handleApiRequest } from '../server/api.js';

const row = { id: '123456', title: '测试剧 第二季', card_subtitle: '2026 / 中国大陆 / 剧情 / 导演 / 演员', pic: { normal: 'https://img2.doubanio.com/view/photo/s_ratio_poster/public/test.jpg' }, rating: { value: 8.2 }, episodes_info: '更新至12集' };
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
async function directory(t) {
  await fs.mkdir('.local-runtime/tests', { recursive: true });
  const directory = await fs.mkdtemp('.local-runtime/tests/catalog-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
test('normalizes real provider fields without treating a provider playable flag as local playback', () => {
  const [item] = normalizeCatalog([{ ...row, playable: true }, row, { ...row, id: '../../bad' }, null], 'tv');
  assert.equal(item.year, '2026'); assert.equal(item.rating, 8.2); assert.equal(item.quarkFid, undefined);
  assert.equal(item.catalogId, 'douban:123456'); assert.equal(item.category, 'tv');
  assert.equal(item.poster, '/api/catalog/posters/123456');
  assert.equal(normalizeCatalog([{ ...row, rate: '', rating: undefined }], 'movie')[0].rating, undefined);
  for (const cover of ['https://127.0.0.1/a.jpg', 'https://img2.doubanio.com.evil.test/a.jpg', 'https://user:pass@img2.doubanio.com/a.jpg']) {
    assert.equal(normalizeCatalog([{ ...row, pic: { normal: cover } }], 'movie')[0].posterUrl, '');
  }
});
test('collapses concurrent requests, persists snapshots and serves fresh data without upstream calls', async t => {
  const dir = await directory(t); let calls = 0;
  const service = new CatalogService(dir, { fetcher: async () => { calls++; return response({ items: [row] }); } });
  const feeds = await Promise.all([service.get('tv'), service.get('tv'), service.get('tv')]);
  assert.equal(calls, 1); assert.equal(feeds[0].items.length, 1); assert.equal(feeds[0].stale, false);
  assert.equal('posterUrl' in feeds[0].items[0], false);
  const restarted = new CatalogService(dir, { fetcher: () => { throw Error('must use cache'); } });
  assert.equal((await restarted.get('tv')).items[0].title, row.title);
});
test('stale feed survives failure; first-load failures back off; unsupported channel cannot reach upstream', async t => {
  let now = 1700000000000, fail = false, calls = 0;
  const service = new CatalogService(await directory(t), { now: () => now, fetcher: async () => {
    calls++; if (fail) throw Error('offline'); return response({ items: [row] });
  } });
  await service.get('tv'); now += 7 * 60 * 60_000; fail = true;
  const stale = await service.get('tv');
  assert.equal(stale.items.length, 1); assert.equal(stale.stale, true);
  assert.equal(stale.refreshing, true);
  await service.pending.get('tv');
  const failed = await service.get('tv'); assert.match(failed.message, /上次/);
  assert.equal(failed.refreshing, false);
  const previous = calls; await service.get('tv'); assert.equal(calls, previous);
  assert.equal((await service.get('movie')).items.length, 0);
  const failedCalls = calls; await service.get('movie'); assert.equal(calls, failedCalls);
  await assert.rejects(service.get('__proto__'), /未知/);
});
test('fallback retains provenance and anime requests the animation type rather than the variety category', async t => {
  const urls = [];
  const service = new CatalogService(await directory(t), { fetcher: async url => {
    urls.push(new URL(url)); if (urls.length === 1) throw Error('primary unavailable');
    return response({ subjects: [{ id: row.id, title: row.title, cover: row.pic.normal, rate: '8.2' }] });
  } });
  const feed = await service.get('anime');
  assert.equal(urls[0].searchParams.get('category'), 'tv');
  assert.equal(urls[0].searchParams.get('type'), 'tv_animation');
  assert.equal(feed.items[0].category, 'anime');
  assert.match(feed.items[0].subtitle, /日本动画/);
});
test('poster fetch is limited to catalog images, rejects redirects and retains artwork after a film leaves the feed', async t => {
  const dir = await directory(t); let imageCalls = 0;
  const service = new CatalogService(dir, { fetcher: async (url, options) => {
    if (url.includes('rexxar')) return response({ items: [row] });
    imageCalls++; assert.equal(options.redirect, 'error');
    return new Response(new Uint8Array([255,216,255,217]), { headers: { 'content-type': 'image/jpeg' } });
  } });
  await service.get('tv');
  assert.equal(await service.poster('../../secret'), null);
  assert.equal(await service.poster('9999'), null);
  assert.equal((await service.poster(row.id)).contentType, 'image/jpeg');
  assert.equal((await service.poster(row.id)).buffer.length, 4);
  assert.equal(imageCalls, 1);
  service.feeds.clear();
  assert.equal((await service.poster(row.id)).buffer.length, 4);
});
test('catalog endpoints require the existing application session', async () => {
  let reads = 0, body;
  const context = {
    authService: { authenticate() { throw Object.assign(Error('需要登录'), { statusCode: 401, code: 'APP_AUTH_REQUIRED' }); } },
    catalog: { get() { reads++; } }
  };
  const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
  await handleApiRequest({ url: '/api/catalog?channel=tv', method: 'GET', headers: { host: 'localhost' } }, res, context);
  assert.equal(res.statusCode, 401); assert.equal(body.code, 'APP_AUTH_REQUIRED'); assert.equal(reads, 0);
});
