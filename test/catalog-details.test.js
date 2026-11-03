import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { CatalogService } from '../server/catalog.js';
import { CatalogDetailsService, normalizeCredits, normalizeComments } from '../server/catalogDetails.js';
import { handleApiRequest } from '../server/api.js';

const subject = { id: '123', title: '测试剧', year: '2026', intro: '真实剧情\n第二段', genres: ['剧情'], countries: ['中国大陆'], languages: ['汉语'], pubdate: ['2026-11-03'], durations: ['45分钟'], episodes_count: 20, directors: [{ name: '导演甲' }], actors: [{ name: '演员甲' }] };
const credits = { directors: [{ id: '11', name: '导演甲', character: '导演', avatar: { normal: 'https://img2.doubanio.com/director.jpg' } }], actors: [{ id: '22', name: '演员甲', latin_name: 'Actor A', character: '饰 主角', avatar: { normal: 'https://img3.doubanio.com/actor.jpg' } }] };
const person = { id: '90022', title: '演员甲', latin_title: 'Actor A', extra: { short_info: '演员 / 代表作甲', info: [['出生日期', '1990年1月1日'], ['出生地', '中国'], ['无值', {}]] } };
const json = value => Response.json(value);
const offline = () => { throw new Error('offline'); };
async function directory(t) {
  await fs.mkdir('.local-runtime/tests', { recursive: true });
  const dir = await fs.mkdtemp('.local-runtime/tests/catalog-detail-');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function service(t, fetcher, now) {
  const catalog = new CatalogService(await directory(t), { fetcher, ...(now ? { now } : {}) });
  await catalog.ready;
  catalog.feeds.set('tv', { items: [{ catalogId: 'douban:123', title: '测试剧', category: 'tv' }] });
  return catalog;
}
const upstream = async (url, options) => {
  assert.equal(options.redirect, 'error');
  assert.ok(!('Cookie' in options.headers));
  if (url.endsWith('/celebrities')) return json(credits);
  if (url.endsWith('/celebrity/22')) return json(person);
  return json(subject);
};

test('credits normalize role and identity, deduplicate and discard unsafe images and missing names', () => {
  const rows = normalizeCredits([credits.actors[0], credits.actors[0], { id: '../../bad', name: '无编号人物', avatar: { normal: 'https://127.0.0.1/secret' } }, { id: '33', name: '<b>名字</b>', avatar: { normal: 'https://img3.doubanio.com.evil.test/x.jpg' } }, null], '演员');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].role, '饰 主角'); assert.equal(rows[0].avatar, '/api/catalog/people/22/portrait');
  assert.equal(rows[1].id, ''); assert.equal(rows[1].avatar, ''); assert.equal(rows[2].name, '名字'); assert.equal(rows[2].photoUrl, '');
});

test('parallel detail reads coalesce, persist across restart and never expose upstream portrait addresses', async t => {
  let calls = 0;
  const catalog = await service(t, async (...args) => { calls++; return upstream(...args); });
  const [a, b] = await Promise.all([catalog.detail('123', 'tv'), catalog.detail('123', 'tv')]);
  assert.equal(calls, 2); assert.deepEqual(a, b); assert.equal(a.summary, subject.intro); assert.equal(a.episodeCount, 20);
  assert.equal(a.actors[0].name, '演员甲'); assert.equal(a.directors[0].role, '导演');
  assert.ok(!JSON.stringify(a).includes('doubanio.com')); assert.equal(a.stale, false);
  const restarted = new CatalogDetailsService(catalog.directory, { fetcher: offline });
  const cached = await restarted.work('123', { title: '测试剧', category: 'tv' });
  assert.equal(cached.summary, subject.intro); assert.equal(cached.message, '');
  assert.equal((await restarted.personSeed('22')).name, '演员甲');
});

test('subject-only responses retain plot and names, recover portraits later and preserve prior plot when the subject source fails', async t => {
  let now = 1700000000000, mode = 'subject';
  const catalog = await service(t, async (url, options) => {
    if (mode === 'subject' && url.endsWith('/celebrities')) return offline();
    if (mode === 'credits' && !url.endsWith('/celebrities')) return offline();
    return upstream(url, options);
  }, () => now);
  const partial = await catalog.detail('123', 'tv');
  assert.equal(partial.summary, subject.intro); assert.equal(partial.actors[0].name, '演员甲'); assert.equal(partial.actors[0].id, '');
  assert.match(partial.message, /部分/);
  mode = 'all'; now += 61_000;
  assert.equal((await catalog.detail('123', 'tv')).refreshing, true);
  await catalog.details.pending.get('tv-123');
  assert.equal((await catalog.detail('123', 'tv')).actors[0].id, '22');
  now += 25 * 60 * 60_000; mode = 'credits';
  await catalog.detail('123', 'tv'); await catalog.details.pending.get('tv-123');
  const kept = await catalog.detail('123', 'tv');
  assert.equal(kept.summary, subject.intro); assert.equal(kept.actors[0].role, '饰 主角');
});

test('cold failures back off and stale data survives an upstream outage', async t => {
  let calls = 0, now = 1700000000000, fail = true;
  const catalog = await service(t, async (...args) => { calls++; return fail ? offline() : upstream(...args); }, () => now);
  const empty = await catalog.detail('123', 'tv'); assert.equal(empty.summary, ''); assert.match(empty.message, /无法加载/);
  await catalog.detail('123', 'tv'); assert.equal(calls, 2);
  now += 61_000; fail = false;
  await catalog.detail('123', 'tv'); assert.equal(calls, 4);
  now += 25 * 60 * 60_000; fail = true;
  const stale = await catalog.detail('123', 'tv'); assert.equal(stale.summary, subject.intro); assert.equal(stale.refreshing, true);
  await catalog.details.pending.get('tv-123');
  const result = await catalog.detail('123', 'tv'); assert.equal(result.summary, subject.intro); assert.match(result.message, /上次/);
  const before = calls; await catalog.detail('123', 'tv'); assert.equal(calls, before);
});

test('unregistered works and people cannot trigger upstream requests, and mismatched source IDs cannot replace plot data', async t => {
  let calls = 0;
  const catalog = await service(t, async () => { calls++; return json({ ...subject, id: 'other' }); });
  await assert.rejects(catalog.detail('../../secret', 'tv'), /未找到/);
  await assert.rejects(catalog.detail('999', 'tv'), /未找到/);
  await assert.rejects(catalog.person('999'), /未找到/);
  assert.equal(await catalog.portrait('../../secret'), null); assert.equal(calls, 0);
  const wrong = await catalog.detail('123', 'tv'); assert.equal(wrong.summary, ''); assert.match(wrong.message, /无法加载/);
});

test('person details accept provider personage IDs while preserving the cast identity and cache basic biography', async t => {
  const catalog = await service(t, upstream);
  await catalog.detail('123', 'tv');
  const actor = await catalog.person('22');
  assert.equal(actor.id, '22'); assert.equal(actor.name, '演员甲'); assert.equal(actor.description, '演员 / 代表作甲');
  assert.deepEqual(actor.info.map(x => x.label), ['出生日期', '出生地']);
  const restarted = new CatalogDetailsService(catalog.directory, { fetcher: offline });
  assert.equal((await restarted.person('22')).description, actor.description);
});

test('person-name mismatches fall back to the known cast member, and portraits use only registered image hosts', async t => {
  let imageCalls = 0;
  const catalog = await service(t, async (url, options) => {
    if (url.endsWith('/celebrity/22')) return json({ ...person, title: '其他演员' });
    if (url.endsWith('.jpg')) { imageCalls++; assert.equal(options.redirect, 'error'); return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } }); }
    return upstream(url, options);
  });
  await catalog.detail('123', 'tv');
  const fallback = await catalog.person('22'); assert.equal(fallback.name, '演员甲'); assert.equal(fallback.description, ''); assert.match(fallback.message, /无法加载/);
  assert.equal((await catalog.portrait('22')).buffer.length, 4); await catalog.portrait('22'); assert.equal(imageCalls, 1);
  await fs.writeFile(catalog.details.peopleDirectory + '/33.json', JSON.stringify({ id: '33', photoUrl: 'https://127.0.0.1/secret' }));
  assert.equal(await catalog.portrait('33'), null); assert.equal(imageCalls, 1);
});

test('metadata fetches are bounded and oversized responses are rejected', async t => {
  const metadata = new CatalogDetailsService(await directory(t), { fetcher: async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(metadata.active <= 3);
    return json(subject);
  } });
  await Promise.all(Array.from({ length: 8 }, () => metadata.json('tv/123')));
  assert.equal(metadata.active, 0); assert.equal(metadata.queue.length, 0);
  metadata.fetcher = async () => new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } });
  await assert.rejects(metadata.json('tv/123'), /过大/);
});

test('detail, person and portrait endpoints require the application session', async () => {
  for (const url of ['/api/catalog/works/123?category=tv', '/api/catalog/people/22', '/api/catalog/people/22/portrait', '/api/catalog/works/123/comments?category=tv&start=0']) {
    let body;
    const context = { authService: { authenticate() { throw Object.assign(Error('需要登录'), { statusCode: 401, code: 'APP_AUTH_REQUIRED' }); } } };
    const response = { setHeader() {}, end(value) { body = JSON.parse(value); } };
    await handleApiRequest({ url, method: 'GET', headers: { host: 'localhost' } }, response, context);
    assert.equal(response.statusCode, 401); assert.equal(body.code, 'APP_AUTH_REQUIRED');
  }
});

test('public short reviews are sanitized and bounded without retaining user identifiers or locations', () => {
  const row = { id: '123456', comment: '<b>真实短评</b>\n下一段', user: { id: 'private-id', name: '<i>用户甲</i>', loc: { name: '某地' } }, rating: { value: 4 }, vote_count: 12, create_time: '2026-11-03 12:00:00' };
  const [result] = normalizeComments([row, row, { ...row, id: '../secret' }, { ...row, id: '2', comment: '' }]);
  assert.equal(result.text, '真实短评\n下一段'); assert.equal(result.author, '用户甲'); assert.equal(result.rating, 4); assert.equal(result.upvotes, 12);
  assert.ok(!JSON.stringify(result).includes('private-id')); assert.ok(!('user' in result));
  assert.equal(normalizeComments([{ ...row, rating: { value: 10 } }])[0].rating, undefined);
});

test('short-review pages use distinct cached offsets and retry only the requested page after an upstream failure', async t => {
  let calls = 0, now = 1700000000000, fail = false;
  const catalog = await service(t, async url => {
    calls++; if (fail) return offline();
    const start = Number(new URL(url).searchParams.get('start'));
    return json({ start, total: 20, interests: Array.from({ length: 10 }, (_, i) => ({ id: String(start + i + 1), comment: '短评 ' + (start + i), user: { name: '观众' }, rating: { value: 5 } })) });
  }, () => now);
  const first = await catalog.comments('123', 'tv', 0); assert.equal(first.items.length, 10); assert.equal(first.hasMore, true);
  await catalog.comments('123', 'tv', 0); assert.equal(calls, 1);
  fail = true;
  const failed = await catalog.comments('123', 'tv', 10); assert.equal(failed.items.length, 0); assert.match(failed.message, /无法/);
  fail = false; now += 61_000;
  const second = await catalog.comments('123', 'tv', 10); assert.equal(second.items[0].id, '11'); assert.equal(second.hasMore, false);
  assert.equal((await catalog.comments('123', 'tv', 0)).items[0].id, '1');
  const before = calls;
  for (const start of [-10, 1, 100, NaN]) await assert.rejects(catalog.comments('123', 'tv', start), /分页/);
  await assert.rejects(catalog.comments('999', 'tv', 0), /未找到/);
  assert.equal(calls, before);
});
