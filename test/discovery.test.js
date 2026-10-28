import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import { DiscoveryService } from '../server/discoveryService.js';
import { DISCOVERY_FEEDS, fetchDiscoveryFeed, isDiscoveryImageUrl, normalizeBangumiCalendar, normalizeDoubanFeed } from '../server/discoverySources.js';
import { PosterService } from '../server/posterService.js';
import { handleApiRequest } from '../server/api.js';
import { PlaybackHistoryRepository } from '../server/storage.js';

const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-discovery-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const record = (id = 'douban-123', category = 'movie') => ({ id, category, title: '测试影片', provider: 'douban', year: '2026', rating: 8.4, subtitle: '', description: '', sourceUrl: 'https://movie.douban.com/subject/123/', imageUrl: 'https://img2.doubanio.com/view/photo/s_ratio_poster/public/p123.jpg' });
const settle = async service => { await Promise.all([...service.pending.values()]); };

test('当前豆瓣榜单兼容两种海报字段，去重且不把未评分或正版可播当作网盘可用', () => {
  const feed = DISCOVERY_FEEDS.find(item => item.id === 'movie');
  const items = normalizeDoubanFeed({ subject_collection_items: [
    { id: '123', title: '电影', type: 'movie', year: '2026', cover: { url: record().imageUrl }, rating: { value: 0, count: 0 }, has_linewatch: true },
    { id: '124', title: '电影二', type: 'movie', pic: { normal: record().imageUrl,large:'https://img2.doubanio.com/view/photo/l/public/p124.jpg' }, rating: { value: 8.1, count: 20 } },
    { id: '124', title: '电影二', type: 'movie', pic: { normal: record().imageUrl,large:'https://img2.doubanio.com/view/photo/l/public/p124.jpg' }, rating: { value: 8.1, count: 20 } },
    { id: '125', title: '非电影', type: 'tv' }, { id: '../bad', title: '非法', type: 'movie' }
  ] }, feed);
  assert.equal(items.length, 2); assert.equal(items[0].rating, null); assert.equal(items[1].rating, 8.1);
  assert.equal(items[0].ratingCount, 0); assert.equal(items[1].ratingCount, 20);
  assert.equal(items[1].imageUrl,'https://img2.doubanio.com/view/photo/l/public/p124.jpg');
  assert.ok(items.every(item => item.imageUrl)); assert.equal(items[0].year, '2026');
  assert.equal('playable' in items[0], false); assert.equal('has_linewatch' in items[0], false);
});

test('old discovery cache stays visible while new rating-count metadata is refreshed once', async t => {
  const dir = temp(t); let calls = 0;
  fs.writeFileSync(path.join(dir, 'discovery-cache.json'), JSON.stringify({ version: 1, feeds: { movie: {
    items: [record()], updatedAt: 999_000, failed: false
  } } }));
  const service = new DiscoveryService({ dataDir: dir, posterService: {}, now: () => 1_000_000,
    loadFeed: async () => { calls++; return [{ ...record(), ratingCount: 123 }]; } });
  t.after(() => service.stop());
  assert.equal(service.snapshots.movie.items[0].ratingCount, null);
  await service.get('movie'); await settle(service);
  assert.equal(calls, 1); assert.equal((await service.get('movie')).sections[0].items[0].ratingCount, 123);
  const restored = new DiscoveryService({ dataDir: dir, posterService: {}, now: () => 1_000_000,
    loadFeed: async () => { calls++; return []; } });
  t.after(() => restored.stop());
  assert.equal((await restored.get('movie')).sections[0].items[0].ratingCount, 123); assert.equal(calls, 1);
});

test('failed metadata upgrade retains the old chart and retries after cooldown instead of waiting six hours', async t => {
  const dir = temp(t); let clock = 1_000_000, fail = true, calls = 0;
  fs.writeFileSync(path.join(dir, 'discovery-cache.json'), JSON.stringify({ version: 1, feeds: { movie: {
    items: [record()], updatedAt: clock - 1000, failed: false
  } } }));
  const service = new DiscoveryService({ dataDir: dir, posterService: {}, now: () => clock, retryMs: 100,
    loadFeed: async () => { calls++; if (fail) throw new Error('429'); return [{ ...record(), ratingCount: 234 }]; } });
  t.after(() => service.stop());
  await service.get('movie'); await settle(service);
  assert.equal((await service.get('movie')).sections[0].items.length, 1); assert.equal(calls, 1);
  clock += 101; fail = false;
  await service.get('movie'); await settle(service);
  assert.equal(calls, 2); assert.equal(service.snapshots.movie.items[0].ratingCount, 234);
});

test('Bangumi 放送按日期分组，中文名优先，规范化 HTTPS 图片并过滤非动画条目', () => {
  const items = normalizeBangumiCalendar([{ weekday: { id: 5 }, items: [
    { id: 12, name: 'Original', name_cn: '新番', type: 2, air_date: '2026-10-01', images: { common: 'http://lain.bgm.tv/pic/cover/c/test.jpg' }, rating: { score: 7.7 } },
    { id: 13, name: '音乐', type: 3 }, { id: 14, name: '成人', type: 2, nsfw: true }
  ] }]);
  assert.equal(items.length, 1); assert.equal(items[0].title, '新番'); assert.equal(items[0].weekday, 5);
  assert.equal(items[0].subtitle, '周五播出'); assert.match(items[0].imageUrl, /^https:/);
  const crowded = normalizeBangumiCalendar([
    { weekday: { id: 1 }, items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, type: 2, name: '周一新番' })) },
    { weekday: { id: 7 }, items: [{ id: 1000, type: 2, name: '周日新番' }] }
  ]);
  assert.equal(crowded.length, 31); assert.ok(crowded.some(item => item.weekday === 7));
});

test('推荐并发请求合并，上游最多两个并发；缓存跨重启复用，失败保留上次数据并退避', async t => {
  const dir = temp(t); let clock = 1000, calls = 0, active = 0, maximum = 0, fail = false;
  const loadFeed = async feed => { calls++; maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 10)); active--; if (fail) throw new Error('429'); return [record(`douban-${DISCOVERY_FEEDS.indexOf(feed) + 1}`, feed.category)]; };
  const service = new DiscoveryService({ dataDir: dir, posterService: {}, loadFeed, now: () => clock, ttlMs: 100, retryMs: 50 });
  t.after(() => service.stop());
  await Promise.all(Array.from({ length: 8 }, () => service.get('all'))); await settle(service);
  assert.equal(calls, 4); assert.ok(maximum <= 2);
  const fresh = await service.get('all'); assert.equal(fresh.sections.length, 4); assert.ok(fresh.sections.every(s => s.items.length === 1));
  assert.doesNotMatch(JSON.stringify(fresh), /imageUrl|img2\.doubanio/); assert.match(fresh.sections[0].items[0].poster, /^\/api\/discovery\/posters\//);
  const restarted = new DiscoveryService({ dataDir: dir, posterService: {}, loadFeed, now: () => clock, ttlMs: 100, retryMs: 50 }); t.after(() => restarted.stop());
  await restarted.get('all'); assert.equal(calls, 4);
  fail = true; clock += 101; await restarted.get('all'); await settle(restarted);
  const stale = await restarted.get('all'); assert.ok(stale.sections.every(s => s.stale && s.failed && s.items.length === 1));
  assert.equal(calls, 8); await restarted.get('all'); assert.equal(calls, 8);
  fail = false; clock += 51; await restarted.get('all'); await settle(restarted);
  assert.equal(calls, 12); assert.ok((await restarted.get('all')).sections.every(s => !s.stale && !s.failed));
  await assert.rejects(restarted.get('unknown'), { statusCode: 400 });
});

test('冷启动坏响应不会留下假数据，失败缓存和空列表重启后仍遵守退避', async t => {
  const dir = temp(t); let calls = 0;
  fs.writeFileSync(path.join(dir, 'discovery-cache.json'), '{broken');
  const options = { dataDir: dir, posterService: {}, now: () => 1000, loadFeed: async () => { calls++; return []; } };
  const service = new DiscoveryService(options); t.after(() => service.stop());
  const empty = await service.get('movie'); assert.equal(empty.sections[0].items.length, 0); assert.equal(empty.sections[0].failed, true);
  const restored = new DiscoveryService(options); t.after(() => restored.stop());
  await restored.get('movie'); assert.equal(calls, 1);
});

test('数据抓取拒绝错误、空数据和超大响应，不把 HTML 错误页当推荐', async () => {
  const feed = DISCOVERY_FEEDS[0];
  for (const response of [new Response('denied', { status: 429 }), new Response('<html>login</html>'), Response.json({ subjects: [] }), Response.json({ subject_collection_items: [] }), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    await assert.rejects(fetchDiscoveryFeed(feed, { fetcher: async () => response }));
  }
});

test('海报只下载已收录的白名单图片，拒绝恶意重定向；封面身份与同名不同作品隔离', async t => {
  assert.equal(isDiscoveryImageUrl('https://img2.doubanio.com.attacker.test/x', 'douban'), false);
  assert.equal(isDiscoveryImageUrl('https://img2.doubanio.com:444/x', 'douban'), false);
  assert.equal(isDiscoveryImageUrl('https://user:password@img2.doubanio.com/x', 'douban'), false);
  assert.equal(isDiscoveryImageUrl('http://127.0.0.1/x', 'douban'), false);
  const posters = new PosterService(temp(t));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/secret' } }); });
  await assert.rejects(posters.resolveCatalogPoster(record())); assert.equal(calls.length, 1);
  t.mock.method(globalThis, 'fetch', async () => new Response(Buffer.from('image-fixture'), { headers: { 'Content-Type': 'image/jpeg' } }));
  const first = await posters.resolveCatalogPoster(record());
  const other = await posters.resolveCatalogPoster(record('douban-124'));
  assert.notEqual(first.poster, other.poster);
  const library = await posters.enrich([{ ...record(), poster: '', catalogId: 'douban-123', title: '自定义片名' }]);
  assert.equal(library[0].poster, first.poster);
  const reloaded = new PosterService(path.dirname(posters.cachePath)); assert.equal(reloaded.catalogPoster('douban-123').poster, first.poster);
});

test('并发海报请求合并并限流，未知 ID 不触发下载，失败短期复用', async t => {
  let active = 0, maximum = 0, calls = 0, fail = false;
  const posters = { catalogPoster: () => null, resolveCatalogPoster: async () => {
    calls++; maximum = Math.max(maximum, ++active); await new Promise(r => setTimeout(r, 10)); active--; if (fail) throw new Error('down'); return { poster: '/api/media-posters/example.jpg' };
  } };
  const service = new DiscoveryService({ dataDir: temp(t), posterService: posters, loadFeed: async () => Array.from({ length: 6 }, (_, i) => record(`douban-${i + 1}`)) }); t.after(() => service.stop());
  await service.get('movie'); await settle(service);
  await Promise.all(Array.from({ length: 12 }, (_, i) => service.poster(`douban-${i % 6 + 1}`)));
  assert.equal(calls, 6); assert.ok(maximum <= 3);
  await assert.rejects(service.poster('douban-999'), { statusCode: 404 }); assert.equal(calls, 6);
  fail = true; await assert.rejects(service.poster('douban-1'), { statusCode: 503 });
  await assert.rejects(service.poster('douban-1'), { statusCode: 503 }); assert.equal(calls, 7);
});

test('发现页直接播放后保存进片库，继续观看使用同一记录；删除另一目录不会误删进度', t => {
  const history = new PlaybackHistoryRepository(temp(t));
  const media = { id: 'discovery:douban-123', catalogId: 'douban-123', title: '同一影片' };
  const first = history.save({ media, episodeFid: 'shared-episode', position: 80, duration: 200 });
  const saved = history.save({ media: { ...media, id: 'quark:mine', quarkFid: 'mine' }, episodeFid: 'saved-episode', position: 90, duration: 200 });
  assert.equal(saved.id, first.id); assert.equal(history.all().length, 1); assert.equal(history.all()[0].position, 90);
  history.removeByMediaFid('different-copy'); history.removeUnlinkedCatalog('douban-123'); assert.equal(history.all().length, 1);
  history.removeByMediaFid('mine'); assert.equal(history.all().length, 0);
  history.save({ media, episodeFid: 'shared-episode', position: 80 }); history.removeUnlinkedCatalog('douban-123'); assert.equal(history.all().length, 0);
});

const response = () => ({ statusCode: 0, headersSent: false, body: '', setHeader() {}, end(value) { this.body = String(value || ''); this.headersSent = true; } });
test('发现数据和海报均要求登录，直接播放失败也记住已取消的分享', async () => {
  let reads = 0; const removed = [];
  const context = { authService: { authenticate() { throw Object.assign(new Error('login'), { statusCode: 401 }); }, assertSameOrigin() {} },
    userContext: () => ({}), discovery: { get: () => { reads++; return { sections: [] }; }, poster: () => { reads++; } },
    quarkGateway: { createPlaybackSession: async () => { throw Object.assign(new Error('cancelled'), { code: 'QUARK_SHARE_UNAVAILABLE', statusCode: 422 }); } },
    shareAvailability: { markUnavailable: url => removed.push(url) } };
  for (const url of ['/api/discovery', '/api/discovery/posters/douban-1', '/api/catalog/browse?genre=科幻']) {
    const res = response(); await handleApiRequest({ method: 'GET', url, headers: { host: 'localhost' } }, res, context); assert.equal(res.statusCode, 401);
  }
  assert.equal(reads, 0);
  context.authService.authenticate = () => ({ username: 'user', role: 'user', folder: 'user' });
  const res = response(); await handleApiRequest({ method: 'GET', url: '/api/discovery', headers: { host: 'localhost' } }, res, context); assert.equal(res.statusCode, 200);
  const request = Object.assign(Readable.from([Buffer.from(JSON.stringify({ shareUrl: 'https://pan.quark.cn/s/cancelled' }))]), { method: 'POST', url: '/api/player/sessions', headers: { host: 'localhost' } });
  await handleApiRequest(request, response(), context); assert.deepEqual(removed, ['https://pan.quark.cn/s/cancelled']);
});

test('catalog matching includes registered titles and aliases, not only current charts',t=>{
 const service=new DiscoveryService({dataDir:temp(t),posterService:{}});t.after(()=>service.stop());
 service.registerCatalogItems([{...record(),title:'沙丘',aliases:['Dune']},
  {...record('douban-124','tv'),title:'闹鬼酒店 第一季',aliases:['Haunted Hotel']}]);
 assert.deepEqual(service.matchingCatalogItems('Dune').map(item=>item.id),['douban-123']);
 assert.deepEqual(service.matchingCatalogItems('酒店').map(item=>item.id),['douban-124']);
 assert.deepEqual(service.matchingCatalogItems('Hotel Haunted').map(item=>item.id),['douban-124']);
 assert.equal(service.matchingCatalogItems('无关电影').length,0);
});

test('same-subject detail artwork upgrades a small cached cover once; failed upgrades keep the usable cover and back off', async t => {
  const posters=new PosterService(temp(t));let calls=0,fail=false;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return fail?new Response('down',{status:503}):new Response(Buffer.from('image-fixture'),{headers:{'Content-Type':'image/jpeg'}});});
  const small=record(),large={...small,imageUrl:'https://img2.doubanio.com/view/photo/l/public/p123.jpg'};
  const original=await posters.resolveCatalogPoster(small);assert.equal(calls,1);
  const [upgraded,duplicate]=await Promise.all([posters.resolveCatalogPoster(large,{preferSource:true}),posters.resolveCatalogPoster(large,{preferSource:true})]);
  assert.equal(calls,2);assert.notEqual(upgraded.poster,original.poster);assert.equal(duplicate.poster,upgraded.poster);
  await posters.resolveCatalogPoster(large,{preferSource:true});assert.equal(calls,2);
  assert.equal((await posters.resolveCatalogPoster(small)).poster,upgraded.poster,'a feed thumbnail never downgrades cached detail artwork');
  fail=true;const unavailable={...large,imageUrl:'https://img2.doubanio.com/view/photo/l/public/p456.jpg'};
  assert.equal((await posters.resolveCatalogPoster(unavailable,{preferSource:true})).poster,upgraded.poster);
  assert.equal((await posters.resolveCatalogPoster(unavailable,{preferSource:true})).poster,upgraded.poster);assert.equal(calls,3);
  const restored=new PosterService(path.dirname(posters.cachePath));assert.equal((await restored.resolveCatalogPoster(large,{preferSource:true})).poster,upgraded.poster);assert.equal(calls,3);
});

test('preferred artwork cannot cross a catalog identity boundary',async t=>{
 const service=new DiscoveryService({dataDir:temp(t),posterService:{catalogPoster:()=>({poster:'cached'}),resolveCatalogPoster:async()=>({poster:'cached'})}});t.after(()=>service.stop());
 await assert.rejects(service.poster('douban-123',record('douban-124')),{statusCode:400});
 service.imageRetries.set('douban-123',Date.now()+60_000);assert.equal((await service.poster('douban-123',record())).poster,'cached','an earlier cold miss cannot hide a now-available cover');
});
