import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { scriptData, artworkUrl, catalogIdFromPath } from '../server/officialCatalogData.js';
import { parseTencentCatalog, parseYoukuCatalog, parseIqiyiCatalog, parseMangoCatalog, OfficialCatalogProviders } from '../server/officialCatalogProviders.js';
import { OfficialCatalogService, mergeOfficialCatalog } from '../server/officialCatalog.js';
import { handleApiRequest } from '../server/api.js';

const art = 'https://pic1.iqiyipic.com/image/test.jpg';
const row = (platform, values = {}) => ({ catalogId: platform + ':source12345', providerId: 'source12345', platform, title: '同一作品', category: 'tv', year: '2026',
  posterUrl: art, backdropUrl: art, sourceUrl: 'https://www.iqiyi.com/v_12345678.html', actors: [], directors: [], genres: [], subtitle: '介绍', summary: '剧情介绍', status: '', ...values });
const html = data => '<script>window.__INITIAL_DATA__=' + JSON.stringify(data) + ';</script>';
async function directory(t) {
  await fs.mkdir('.local-runtime/tests', { recursive: true });
  const dir = await fs.mkdtemp('.local-runtime/tests/official-catalog-');
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
test('SSR data reader supports serializer object initialization, undefined and split assignment without running JS', () => {
  const source = '<script>window.__data__={};window.__data__.value=(function(a){a.name="作品";a.list=[undefined,void 0];return {work:a}})({});</script>';
  assert.equal(scriptData(source, '__data__').value.work.name, '作品');
  for (const expression of [
    'fetch("https://evil.test")', '(function(){globalThis.modified=true;return {}})()',
    '(function(a){a.__proto__={polluted:true};return a})({})', '{get title(){return "bad"}}',
    '(function(a){a.constructor=1;return a})({})', 'window.location'
  ]) assert.throws(() => scriptData('<script>window.__data__=' + expression + '</script>', '__data__'));
  assert.equal(globalThis.modified, undefined); assert.equal({}.polluted, undefined);
});
test('Tencent uses the canonical work title, keeps channel identity, and does not use promotional copy as the query', () => {
  const body = '<script>window.__vikor__context__={};window.__vikor__context__.ssrPayloads={_piniaState:{rows:[' +
    '{type:"focus",reportType:"cid",cid:"mzc002001w361jz",categoryType:"2",mzTitle:"尚公主",sourceTitle:"人气大剧必看",coverPic:"https://tv.puui.qpic.cn/test.jpg"},' +
    '{type:"focus",reportType:"cid",cid:"mzc002001w361jy",categoryType:"1",mzTitle:"其他电影"}]}};</script>';
  assert.equal(parseTencentCatalog(body, 'tv')[0].title, '尚公主');
  assert.equal(parseTencentCatalog(body, 'tv').length, 1);
  assert.equal(parseTencentCatalog(body, 'movie')[0].title, '其他电影');
});
test('Youku accepts work actions and explicit categories, excludes advertising and upgrades only allowlisted artwork to HTTPS', () => {
  const item = { title: '测试动漫', action: { type: 'JUMP_TO_SHOW', value: 'ab1234567890', extra: { category: '动漫' } },
    img: 'http://liangcang-material.alicdn.com/test.jpg', hImg: 'https://evil.test/a.jpg', tags: [{ text: { title: '更新至18话' } }], desc: '简介' };
  const source = html({ moduleList: [{ items: [item, { ...item, title: '广告', mark: { text: '广告' } }] }], navList: [] });
  const rows = parseYoukuCatalog(source, 'anime');
  assert.equal(rows.length, 1); assert.match(rows[0].posterUrl, /^https:/); assert.equal(rows[0].backdropUrl, rows[0].posterUrl);
  assert.equal(parseYoukuCatalog(source, 'tv').length, 0);
});
test('Iqiyi only accepts actual album records, not ads, games, trailers or unrelated channel content', () => {
  const base = { album_id: 5033289882239001, title: '测试剧', channel_id: 2, content_type: 'FEATURE_FILM',
    date: { year: 2026 }, showDate: '2026-11-05', page_url: 'https://www.iqiyi.com/v_1nj820ys5vg.html',
    description: '真实简介', image_url: art, banner_image_url: 'https://evil.test/banner.jpg', starring: [{ name: '演员甲' }] };
  const data = { code: 0, items: [{ video: [{ data: [base, { ...base, isAd: true }, { ...base, isGame: true }, { ...base, content_type: 'TRAILER' }] }] }] };
  const rows = parseIqiyiCatalog(data, 'tv');
  assert.equal(rows.length, 1); assert.equal(rows[0].year, '2026'); assert.equal(rows[0].actors[0].name, '演员甲'); assert.equal(rows[0].backdropUrl, art);
  assert.equal(parseIqiyiCatalog(data, 'movie').length, 0);
});
test('Mango strips decorative promotion suffixes, skips previews, and retains a usable video URL for an album', () => {
  const base = { name: '测试剧🌦️', jumpKind: 1, videoUrl: 'https://www.mgtv.com/b/817372/', imageV: 'https://1img.hitv.com/test.jpg' };
  const data = { code: 200, data: [{ moduleTitle: '热播剧集', DSLList: [{ data: { items: [base,
    { ...base, jumpKind: 12, videoUrl: 'https://www.mgtv.com/b/817372/24769759.html', updateInfo: '更新至20集' },
    { ...base, name: '另一个预告', cornerType: { cornerTitle: '预告' } }] } }] }] };
  const rows = parseMangoCatalog(data, 'tv');
  assert.equal(rows.length, 1); assert.equal(rows[0].title, '测试剧'); assert.equal(rows[0].videoId, '24769759');
  assert.match(rows[0].sourceUrl, /24769759/); assert.equal(rows[0].status, '更新至20集');
});
test('same title releases merge with aliases while different years and seasons remain separate', () => {
  const same = mergeOfficialCatalog([[row('qq', { year: '', order: 1 })], [row('iqiyi', { order: 0 })]]);
  assert.equal(same.length, 1); assert.equal(same[0].year, '2026'); assert.equal(same[0].platforms.length, 2); assert.equal(same[0].catalogAliases.length, 2);
  assert.equal(mergeOfficialCatalog([[row('qq', { year: '' }), row('qq', { year: '2020' }), row('iqiyi')]]).length, 3);
  assert.equal(mergeOfficialCatalog([[row('qq', { title: '作品 第一季' }), row('iqiyi', { title: '作品 第二季' })]]).length, 2);
});
test('platform feeds coalesce, persist, paginate, and platform filtering never returns another platform as a substitute', async t => {
  const dir = await directory(t), calls = [];
  const providers = { fetch: async (platform, channel) => { calls.push(platform + ':' + channel); return Array.from({ length: 30 }, (_, n) => row(platform, { title: '作品' + n, providerId: 'source' + n, catalogId: platform + ':source' + n })); } };
  const service = new OfficialCatalogService(dir, { providers });
  const [a, b] = await Promise.all([service.get('tv'), service.get('tv')]);
  assert.equal(calls.length, 4); assert.equal(a.items.length, 24); assert.equal(a.total, 30); assert.equal(a.hasMore, true); assert.deepEqual(a, b);
  assert.equal('posterUrl' in a.items[0], false); assert.equal(a.items[0].platforms.length, 4);
  const next = await service.get('tv', 2, a.revision); assert.equal(next.items.length, 6); assert.equal(next.hasMore, false);
  const filtered = await service.get('tv', 1, '', 'mango'); assert.ok(filtered.items.every(item => item.platforms.some(source => source.id === 'mango')));
  const restart = new OfficialCatalogService(dir, { providers: { fetch() { assert.fail('fresh cache must not request upstream'); } } });
  assert.equal((await restart.get('tv')).total, 30);
  assert.equal((await restart.workItem(a.items[0].catalogId)).title, a.items[0].title);
  for (const args of [['bad'], ['tv', 0], ['tv', 1, '../bad'], ['tv', 1, '', 'evil']]) await assert.rejects(service.get(...args));
  assert.equal(calls.length, 4);
});
test('a failed platform remains explicitly unavailable without discarding healthy sources or mislabeling their contents', async t => {
  let now = 1700000000000, fail = false;
  const providers = { fetch: async platform => { if (fail && platform === 'mango') throw Error('offline'); return [row(platform, { title: platform })]; } };
  const service = new OfficialCatalogService(await directory(t), { providers, now: () => now });
  await service.get('tv'); fail = true; now += 61 * 60_000;
  const stale = await service.get('tv'); assert.equal(stale.stale, true);
  await Promise.all([...service.platformPending.values()]);
  const feed = await service.get('tv'); assert.equal(feed.total, 4); assert.equal(feed.sources.find(source => source.id === 'mango').status, 'unavailable');
  const selected = await service.get('tv', 1, '', 'mango'); assert.equal(selected.items.length, 1);
  assert.equal(selected.items[0].title, 'mango'); assert.match(selected.message, /暂未更新/);
});

test('已有片库卡片补用唯一匹配的官方海报，保留已有海报并拒绝同名年份歧义', async t => {
  const title = '多喜一家人', oldPoster = 'https://example.test/original.jpg';
  const service = new OfficialCatalogService(await directory(t), { providers: { fetch: async platform => [
    row(platform, { title }), row(platform, { title: '有海报' }),
    row(platform, { title: '同名作品', year: '2020', catalogId: platform + ':old' }),
    row(platform, { title: '同名作品', year: '2026', catalogId: platform + ':new' })
  ] } });
  const feed = await service.get('tv');
  const source = feed.items.find(work => work.title === title);
  const context = {
    authService: { authenticate: () => ({ username: 'viewer' }) },
    userContext: () => ({ mediaRepository: { all: () => [{ quarkFid: 'two', poster: oldPoster }] },
      libraryViewRepository: { categoryFor: () => undefined } }),
    quarkGateway: { listLibrary: async () => [title, '有海报', '同名作品'].map((title, index) => ({
      id: String(index), title, category: 'tv', quarkFid: ['one', 'two', 'three'][index], poster: ''
    })) },
    posterService: { enrich: async cards => cards },
    catalog: service
  };
  let body;
  const response = { setHeader() {}, end: text => { body = JSON.parse(text); } };
  await handleApiRequest({ method: 'GET', url: '/api/media-cards', headers: { host: 'localhost' } }, response, context);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.data.slice(0, 2).map(card => [card.quarkFid, card.poster]), [['one', source.poster], ['two', oldPoster]]);
  assert.match(body.data[2].poster, /images.unsplash.com/);
  assert.equal((await service.workItem(source.catalogId)).title, title);
});
test('first-load failures back off, remain distinct from empty feeds, and cannot be replaced by Douban recommendations', async t => {
  let calls = 0;
  const service = new OfficialCatalogService(await directory(t), { providers: { fetch: async () => { calls++; throw Error('offline'); } } });
  const feed = await service.get('anime'); assert.equal(feed.items.length, 0); assert.equal(feed.loadError, true); assert.equal(calls, 4);
  await service.get('anime'); assert.equal(calls, 4);
});
test('catalog image and ID validation reject user-controlled URLs, credentials, ports and traversal', async () => {
  for (const url of ['https://127.0.0.1/test.jpg', 'https://pic1.iqiyipic.com.evil.test/a.jpg', 'https://user@pic1.iqiyipic.com/a.jpg',
    'https://pic1.iqiyipic.com:8443/a.jpg', 'file:///secret', 'https://pic1.iqiyipic.com/a.svg']) assert.equal(artworkUrl(url), '');
  for (const id of ['../secret', 'work%3A..%2Fsecret', '%ZZ', 'https://evil.test']) assert.equal(catalogIdFromPath(id), '');
  assert.equal(catalogIdFromPath('work%3A' + 'a'.repeat(24)), 'work:' + 'a'.repeat(24));
  let calls = 0; const providers = new OfficialCatalogProviders({ fetcher: async () => { calls++; throw Error(); } });
  await assert.rejects(providers.request('http://127.0.0.1/test')); assert.equal(calls, 0);
});
test('work API accepts encoded new identifiers, preserves legacy identifiers, and forwards the requested platform', async () => {
  const seen = []; let body;
  const context = { authService: { authenticate: () => ({ username: 'test' }) }, userContext: () => ({}),
    catalog: { detail: async id => { seen.push(id); return { title: '测试' }; }, get: async (...args) => { seen.push(args); return { items: [] }; } } };
  for (const url of ['/api/catalog/works/work%3A' + 'a'.repeat(24) + '?category=tv', '/api/catalog/works/123?category=tv', '/api/catalog?channel=tv&platform=iqiyi']) {
    const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
    await handleApiRequest({ url, method: 'GET', headers: { host: 'localhost' } }, res, context); assert.equal(body.code, 0);
  }
  assert.equal(seen[0], 'work:' + 'a'.repeat(24)); assert.equal(seen[1], '123'); assert.equal(seen[2][3], 'iqiyi');
});
test('ambiguous enrichment never attaches another edition or its reviews', async t => {
  const service = new OfficialCatalogService(await directory(t), { providers: {
    fetch: async platform => [row(platform)], metadata: async () => ({}),
    request: async () => [{ title: '同一作品', year: '2026', episode: '20', id: '123' }, { title: '同一作品', year: '2026', episode: '12', id: '124' }]
  } });
  const feed = await service.get('tv'), id = feed.items[0].catalogId;
  const detail = await service.detail(id, 'tv'); assert.equal(detail.catalogId, id); assert.equal(detail.summary, '剧情介绍');
  const comments = await service.comments(id, 'tv'); assert.equal(comments.items.length, 0); assert.match(comments.message, /暂未确认/);
});

test('selecting one platform never waits for or requests another provider', async t => {
  const calls = [];
  const service = new OfficialCatalogService(await directory(t), { providers: { fetch: async platform => {
    calls.push(platform); assert.equal(platform, 'mango'); return [row(platform)];
  } } });
  const feed = await service.get('tv', 1, '', 'mango');
  assert.deepEqual(calls, ['mango']); assert.deepEqual(feed.sources.map(source => source.id), ['mango']);
  assert.equal(feed.items[0].sourceName, '芒果TV');
});
