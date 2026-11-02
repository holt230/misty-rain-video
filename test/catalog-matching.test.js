import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
await fs.mkdir('.local-runtime/tests', { recursive: true });
const dir = await fs.mkdtemp('.local-runtime/tests/matching-');
const file = path.resolve(dir, 'matching.mjs');
await build({ entryPoints: ['src/services/catalogMatching.ts'], outfile: file, bundle: true, format: 'esm', logLevel: 'silent' });
const { automaticCatalogCandidates, findCatalogMedia, matchesCatalogTitle, validatesCatalogShare } = await import(pathToFileURL(file));
const work = { catalogId: 'douban:1', title: '九门', category: 'tv', year: '2026' };
const candidate = title => ({ title, url: 'https://pan.quark.cn/s/abcd' });
test('automatic choice rejects wrong year, seasons, title boundaries and commentary compilations', () => {
  const titles = ['九门 2026 1080P', '九门 2021 4K', '九门 第二季 2026', '老九门 2026', '九门 2026 解说', '九门 全季合集 2026', '九门 4K'];
  assert.deepEqual(automaticCatalogCandidates(work, titles.map(candidate)).map(item => item.title), [titles[0]]);
  assert.equal(matchesCatalogTitle(work, '九门', false), true);
  assert.equal(matchesCatalogTitle(work, '九门 (2021)', false), false);
  assert.equal(automaticCatalogCandidates({ ...work, year: '' }, [candidate(titles[0])]).length, 0);
});
test('library identity respects editions and stable catalog links', () => {
  const base = { title: '九门', category: 'tv', quarkFid: 'one' };
  assert.equal(findCatalogMedia(work, [{ ...base, year: '2021' }]), undefined);
  assert.equal(findCatalogMedia(work, [base]), undefined);
  assert.equal(findCatalogMedia(work, [base, { ...base, quarkFid: 'two' }]), undefined);
  assert.equal(findCatalogMedia(work, [{ ...base, title: '自定义名字', catalogId: 'douban:1' }]).quarkFid, 'one');
});
test('share verification rejects empty content and explicit conflicting seasons in files or directories', () => {
  const share = { title: '九门', videoCount: 1, entries: [{ name: '第01集.mkv', isVideo: true }] };
  assert.equal(validatesCatalogShare(work, share), true);
  assert.equal(validatesCatalogShare(work, { ...share, entries: [] }), false);
  assert.equal(validatesCatalogShare(work, { ...share, entries: [{ name: 'S02 第01集.mkv', isVideo: true }] }), false);
  assert.equal(validatesCatalogShare(work, { ...share, entries: [...share.entries, { name: '第二季', isDirectory: true }] }), false);
  for (const name of ['九门.S02E01.mkv', '九门_S02_E01.mkv', '九门S02E01.mkv', 'Season.02']) {
    assert.equal(validatesCatalogShare(work, { ...share, entries: [{ name, isVideo: true }] }), false, name);
  }
  assert.equal(matchesCatalogTitle(work, '九门 S02E01 2026 1080P'), false);
});
test.after(() => fs.rm(dir, { recursive: true, force: true }));
