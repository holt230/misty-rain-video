import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CatalogDetailContent, parseSubjectInfo, normalizePhotos, normalizeComments } from '../server/catalogDetailContent.js';
import { normalizeDoubanDetails } from '../server/catalogDetails.js';
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-content-')); t.after(() => fs.rmSync(dir, { force: true, recursive: true })); return dir; };
const photo = id => ({ id, image: { normal: { url: `https://img2.doubanio.com/s/${id}.jpg` }, large: { url: `https://img2.doubanio.com/l/${id}.jpg` } } });
const owner = json => ({ get: async id => ({ id, subjectType: 'tv' }), json, image: url => url ? '/api/catalog/detail-images/opaque' : '' });
test('structured info fills writers, full premiere dates, genres and IMDb without rendering provider markup', () => {
  const info = parseSubjectInfo('<table><tr><td>编剧</td><td>甲 &amp; 乙 / 丙</td></tr><tr><td>类型</td><td>剧情 / 冒险</td></tr><tr><td>主演</td><td>演员乙</td></tr><tr><td>上映</td><td>2026-01-01(中国大陆) / 2026-01-03(美国)</td></tr><tr><td>IMDb</td><td>tt1234567</td></tr></table>');
  const d = normalizeDoubanDetails({ id: '123', title: '测试', type: 'movie', genres: ['剧情'], actors: [{ name: '演员甲' }] }, { info });
  assert.deepEqual(d.writers, ['甲 & 乙', '丙']); assert.deepEqual(d.genres, ['剧情', '冒险']); assert.equal(d.premieres.length, 2);
  assert.equal(d.imdb, 'tt1234567'); assert.equal(d.credits.length, 4); assert.ok(d.credits.some(p => p.role === '编剧')); assert.equal(parseSubjectInfo('<script>alert(1)</script>').imdb, '');
});
test('photo and comment normalization keeps stable IDs and strips private profile fields', () => {
  const images = normalizePhotos({ photos: [photo('123'), { id: '2', image: { large: { url: 'https://localhost/private' } } }] });
  assert.equal(images.length, 1); assert.match(images[0].imageUrl, /\/s\//); assert.match(images[0].fullImageUrl, /\/l\//);
  const comments = normalizeComments({ interests: [{ id: '456', user: { name: '观众', id: 'private-user', location: 'private-place' }, comment: '内容', ip_location: 'private-ip', rating: { value: 5 }, vote_count: 30 }] });
  assert.equal(comments[0].id, '456'); assert.equal(comments[0].votes, 30); assert.doesNotMatch(JSON.stringify(comments), /private/);
});
test('pages use the canonical subject kind, merge concurrent reads and persist across restart with opaque images', async t => {
  let calls = 0; const dir = temp(t);
  const provider = owner(async url => { calls++; assert.match(url, /\/tv\/123\/photos\?type=S&start=24&count=24$/); return { start: 24, total: 80, photos: [photo('25'), photo('26')] }; });
  const service = new CatalogDetailContent(provider, { dataDir: dir });
  const pages = await Promise.all(Array.from({ length: 6 }, () => service.get('douban-123', 'photos', 24)));
  assert.equal(calls, 1); assert.equal(pages[0].nextStart, 26); assert.equal(pages[0].items.length, 2); assert.doesNotMatch(JSON.stringify(pages), /doubanio|imageUrl/);
  const restarted = new CatalogDetailContent(provider, { dataDir: dir }); await restarted.get('douban-123', 'photos', 24); assert.equal(calls, 1);
});
test('invalid offsets, unknown modules and mismatched page offsets fail without unsafe upstream requests', async t => {
  let calls = 0; const service = new CatalogDetailContent(owner(async () => { calls++; return { start: 0, total: 80, photos: [photo('1')] }; }), { dataDir: temp(t) });
  for (const start of [-1, '1&url=https://evil', 10001, 1.5]) await assert.rejects(service.get('douban-123', 'photos', start), { statusCode: 400 });
  await assert.rejects(service.get('bangumi-123', 'photos', 0), { statusCode: 404 }); await assert.rejects(service.get('douban-123', 'private', 0), { statusCode: 404 }); assert.equal(calls, 0);
  await assert.rejects(service.get('douban-123', 'photos', 24)); assert.equal(calls, 1);
});
test('empty pages stop pagination; failures retain existing pages with bounded staleness and retry cooldown', async t => {
  let clock = 1000, fail = false, calls = 0;
  const service = new CatalogDetailContent(owner(async () => { calls++; if (fail) throw new Error('503'); return { start: 0, total: 100, interests: [] }; }), { dataDir: temp(t), now: () => clock });
  assert.equal((await service.get('douban-123', 'comments')).nextStart, null);
  clock += 6 * 3600_000; fail = true; assert.equal((await service.get('douban-123', 'comments')).stale, true);
  await service.get('douban-123', 'comments'); assert.equal(calls, 2);
  clock += 8 * 86400_000; await assert.rejects(service.get('douban-123', 'comments')); assert.equal(calls, 3);
});
