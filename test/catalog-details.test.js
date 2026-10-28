import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CatalogDetails, normalizeDoubanDetails, normalizeBangumiDetails } from '../server/catalogDetails.js';
import { handleApiRequest } from '../server/api.js';
const core = (id = '123') => ({ id, type: 'tv', title: '测试剧集', original_title: 'A Test', year: '2026', intro: '真实接口字段对应的测试简介',
  genres: ['剧情'], countries: ['中国大陆'], languages: ['汉语普通话'], pubdate: ['2026-01-01'], durations: ['45分钟'], aka: ['测试别名'],
  pic: { large: 'https://img2.doubanio.com/poster.jpg' }, rating: { value: 8.1, count: 240 }, episodes_count: 24,
  directors: [{ name: '导演甲' }], actors: [{ name: '演员甲' }, { name: '演员乙' }], comment_count: 11 });
const modules = { info: {}, credits: { total: 20, items: [{ id: '321', name: '导演甲', category: '导演', avatar: { large: 'https://img2.doubanio.com/a.jpg' } }, { id: '321', name: '导演甲', category: '编剧' }] },
  photos: { total: 50, photos: [{ id: '456', image: { large: { url: 'https://img2.doubanio.com/photo.jpg' } } }, { image: { large: { url: 'http://127.0.0.1/private' } } }] },
  comments: { interests: [{ comment: '测试短评', user: { name: '观众', id: 'secret', location: 'private' }, ip_location: 'private', rating: { value: 5 }, create_time: '2026-01-01 10:00:00' }] } };
const fixtureResponse = url => url.endsWith('/desc') ? new Response('<table><tr><td>类型</td><td>剧情</td></tr></table>') : Response.json(responder(url));
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-details-')); t.after(() => fs.rmSync(dir, { force: true, recursive: true })); return dir; };
function responder(url) {
  if (url.includes('/credits')) return modules.credits;
  if (url.includes('/photos?')) return modules.photos;
  if (url.includes('/interests?')) return modules.comments;
  return core(url.split('/').pop());
}
test('details retain real episode counts, merge credit roles, keep unnamed portraits honest, and omit unrelated personal fields', () => {
  const d = normalizeDoubanDetails(core(), modules);
  assert.equal(d.episodeCount, 24); assert.equal(d.category, 'tv'); assert.equal(d.creditCount, 20); assert.equal(d.credits.length, 3);
  assert.equal(d.credits[0].role, '导演 · 编剧'); assert.equal(d.credits[1].imageUrl, ''); assert.equal(d.photos.length, 1);
  assert.equal(d.partial, false); assert.equal(d.ratingCount, 240); assert.deepEqual(d.aliases, ['测试别名']);
  assert.doesNotMatch(JSON.stringify(d), /ip_location|secret|private/);
  assert.equal(normalizeDoubanDetails(core()).partial, true);
  assert.equal(normalizeDoubanDetails({ ...core(), genres: ['动画'] }).category, 'anime');
  assert.throws(() => normalizeDoubanDetails({ ...core(), type: 'celebrity' }));
});
test('Bangumi subjects stay in their own namespace, with no invented Douban fields', () => {
  const d = normalizeBangumiDetails({ id: 10, type: 2, name: 'Original', name_cn: '动画', date: '2026-02-01', summary: '简介', eps: 12, total_episodes: 16,
    infobox: [{ key: '导演', value: '导演甲' }, { key: '别名', value: [{ v: '别名' }] }], images: { large: 'https://lain.bgm.tv/cover.jpg' } });
  assert.equal(d.id, 'bangumi-10'); assert.equal(d.episodeCount, 12); assert.deepEqual(d.aliases, ['别名']); assert.equal(d.credits.length, 0);
});
test('parallel readers share one metadata request; persistent cache survives restart and never leaks upstream image URLs', async t => {
  const dir = temp(t); let calls = 0; const registered = [];
  const fetcher = async url => { calls++; return fixtureResponse(url); };
  const options = { dataDir: dir, fetcher, discovery: { registerCatalogItems: items => registered.push(...items) } };
  const service = new CatalogDetails(options);
  const results = await Promise.all(Array.from({ length: 12 }, () => service.get('douban-123')));
  assert.equal(calls, 5); assert.ok(results.every(d => d.title === '测试剧集')); assert.match(results[0].poster, /^\/api\/catalog\/detail-images\//);
  assert.doesNotMatch(JSON.stringify(results), /doubanio\.com|imageUrl/);
  const restarted = new CatalogDetails(options); await restarted.get('douban-123'); assert.equal(calls, 5); assert.ok(registered.length); assert.equal('credits' in registered[0], false); assert.ok(registered[0].description.length <= 180);
  await assert.rejects(service.get('douban-../123'), { statusCode: 404 }); assert.equal(calls, 5);
});
test('optional module failure preserves core metadata and retries soon; expired upstream failure serves bounded stale cache', async t => {
  let clock = 1000, failed = 'credits', calls = 0;
  const service = new CatalogDetails({ dataDir: temp(t), now: () => clock, ttlMs: 100, fetcher: async url => {
    calls++; if (failed === 'all' || url.endsWith('/' + failed)) return new Response('', { status: 503 }); return fixtureResponse(url);
  } });
  const first = await service.get('douban-123'); assert.equal(first.partial, true); assert.equal(first.episodeCount, 24);
  await service.get('douban-123'); assert.equal(calls, 5);
  clock += 60_001; failed = ''; assert.equal((await service.get('douban-123')).partial, false); assert.equal(calls, 10);
  clock += 101; failed = 'all'; assert.equal((await service.get('douban-123')).stale, true); assert.equal(calls, 11);
  await service.get('douban-123'); assert.equal(calls, 11);
  clock += 8 * 86400_000; await assert.rejects(service.get('douban-123')); assert.equal(calls, 12);
});
test('new subjects are concurrency bounded and mismatched provider identities cannot poison cache', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const service = new CatalogDetails({ dataDir: temp(t), fetcher: async () => { await gate; return Response.json(core('999')); } });
  const jobs = [1,2,3,4].map(id => assert.rejects(service.get(`douban-${id}`)));
  await assert.rejects(service.get('douban-5'), { statusCode: 503 }); release(); await Promise.all(jobs); assert.equal(service.cache.size, 0);
});
test('detail image handles expire, restrict upstream hosts and validate image bytes', async t => {
  let clock = 1000, calls = 0;
  const service = new CatalogDetails({ dataDir: temp(t), now: () => clock, fetcher: async (_url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.ok(options.signal); return new Response(Buffer.from([255,216,255,0]));
  } });
  assert.equal(service.image('https://127.0.0.1/internal', 'douban'), '');
  assert.equal(service.image('https://img2.doubanio.com.evil.test/a', 'douban'), '');
  const image = service.image(core().pic.large, 'douban'); assert.equal(service.image(core().pic.large, 'douban'), image);
  const id = image.split('/').pop(); const asset = await service.assets.read(id, 'catalog'); assert.equal(asset.contentType, 'image/jpeg'); assert.equal(calls, 1);
  clock += 600_001; await assert.rejects(service.assets.read(id, 'catalog'), { statusCode: 404 }); assert.notEqual(service.image(core().pic.large, 'douban'), image);
});
test('subject metadata and images require authentication before any provider request', async () => {
  let calls = 0;
  const context = { authService: { authenticate() { throw Object.assign(new Error('login'), { statusCode: 401 }); } }, userContext: () => ({}),
    catalogDetails: { get() { calls++; }, assets: { read() { calls++; } } } };
  for (const url of ['/api/catalog/subjects/douban-123', '/api/catalog/detail-images/abc', '/api/catalog/subjects/douban-123/photos?start=0', '/api/catalog/subjects/douban-123/comments?start=0']) {
    const response = { statusCode: 0, setHeader() {}, end() {} };
    await handleApiRequest({ method: 'GET', url, headers: { host: 'localhost' } }, response, context); assert.equal(response.statusCode, 401);
  }
  assert.equal(calls, 0);
});

test('Douban movie-to-TV canonical redirects retain the subject ID and share the request deadline', async t => {
  const calls = [];
  const service = new CatalogDetails({ dataDir: temp(t), fetcher: async (url, options) => {
    calls.push({ url, signal: options.signal });
    if (url.endsWith('/movie/123')) return new Response(null, { status: 301, headers: { Location: 'https://m.douban.com/rexxar/api/v2/tv/123' } });
    return fixtureResponse(url);
  } });
  const result = await service.get('douban-123'); assert.equal(result.episodeCount, 24); assert.equal(calls.length, 6);
  assert.equal(calls[1].url, 'https://m.douban.com/rexxar/api/v2/tv/123'); assert.equal(calls[0].signal, calls[1].signal);
});
test('security pages, different IDs and redirects from other modules are never followed', async t => {
  for (const location of ['https://sec.douban.com/check', 'https://m.douban.com/rexxar/api/v2/tv/456', 'https://example.com/tv/123']) {
    let calls = 0;
    const service = new CatalogDetails({ dataDir: temp(t), fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: location } }); } });
    await assert.rejects(service.get('douban-123')); assert.equal(calls, 1);
  }
});

test('poster source reads only cached exact-subject metadata and never starts a metadata request',t=>{
 let calls=0;const service=new CatalogDetails({dataDir:temp(t),now:()=>1000,fetcher:async()=>{calls++;throw new Error('no network');}});
 assert.equal(service.cachedPosterSource('douban-123'),undefined);
 service.cache.set('douban-123',{at:1000,detail:{id:'douban-123',provider:'douban',title:'测试',imageUrl:'https://img2.doubanio.com/view/photo/l/public/p123.jpg'}});
 assert.equal(service.cachedPosterSource('douban-123').imageUrl,'https://img2.doubanio.com/view/photo/l/public/p123.jpg');
 assert.equal(service.cachedPosterSource('douban-124'),undefined);
 service.cache.get('douban-123').detail.imageUrl='http://127.0.0.1/secret';assert.equal(service.cachedPosterSource('douban-123'),undefined);assert.equal(calls,0);
});
