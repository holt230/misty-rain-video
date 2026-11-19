import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArchiveBatchService } from '../server/archiveBatch.js';
import { ArchiveImportService } from '../server/archiveImport.js';

const user = { username: 'viewer', folder: 'viewer', role: 'user' };
const url = 'https://pan.quark.cn/s/verified';
const input = { title: '折月亮', category: 'tv', year: '2026', shareUrl: url, quarkFid: 'old-library' };
const row = { url, work_title: '折月亮', category: 'tv', year: '2026' };
const official = { works: [{ title: '折月亮', category: 'tv', year: '2026', latestEpisode: 27, platform: '爱奇艺' }] };

async function fixture(t, { failEpisode = 0, holdFirst = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'misty-archive-batch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const stored = new Set(Array.from({ length: 9 }, (_, index) => index + 19));
  const calls = [], saved = new Map(), active = new Map();
  const entries = [
    { fid: 'hdr', name: '4K HDR', isDirectory: true },
    { fid: 'dv', name: '4K DV', isDirectory: true },
    ...['hdr', 'dv'].flatMap(quality => Array.from({ length: 27 }, (_, index) => ({
      fid: `${quality}-${index + 1}`, parentFid: quality, ancestorFids: [quality], name: `${index + 1}.zip`,
      isArchive: true, episodeNumber: index + 1, size: quality === 'hdr' ? 10 : 20
    })))
  ];
  let release, markStarted;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  const gateway = {
    async describeArchiveLibrary(request, who) {
      assert.equal(who.username, user.username);
      if (request.quarkFid && request.quarkFid !== 'old-library') throw Object.assign(new Error('wrong folder'), { code: 'ARCHIVE_TARGET_CHANGED' });
      return { quarkFid: 'old-library', episodes: [...stored].map(episodeNumber => ({ episodeNumber })) };
    },
    async getArchiveCapabilities() { return { isAuthenticated: true, isSvip: true, freeBytes: 100000 }; },
    async getShareDetails() { return { title: 'Z 这越亮', entries }; }
  };
  const archiveImport = {
    active,
    async start(request) {
      calls.push(request); const id = `child-${request.episode}`;
      const task = (async () => {
        markStarted();
        if (holdFirst && request.episode === 1) await gate;
        if (request.episode === failEpisode && calls.filter(call => call.episode === failEpisode).length === 1) {
          saved.set(id, { id, status: 'failed', message: '解压失败', error: { code: 'QUARK_ARCHIVE_FAILED', message: '解压失败' } });
          return;
        }
        stored.add(request.episode);
        saved.set(id, { id, status: 'success', media: { quarkFid: 'old-library' }, cleanupPending: false });
      })().finally(() => active.delete(id));
      active.set(id, task);
      return { id, status: 'running' };
    },
    async get(id) { return saved.get(id) || { id, status: 'running' }; }
  };
  const service = new ArchiveBatchService(dir, { gateway, archiveImport,
    catalog: { knownPlatforms: async () => [] }, officialProgress: { lookup: async () => official },
    resourceSearch: { search: async () => ({ merged_by_type: { quark: [row] } }) } });
  return { service, gateway, archiveImport, entries, stored, calls, release, started, dir };
}

test('已有19～27集时只补1～18集，选择同一较小画质并保留原片库目录', async t => {
  const f = await fixture(t);
  const preview = await f.service.preview(input, user);
  assert.equal(preview.officialLatest, 27);
  assert.deepEqual(preview.existingEpisodes, Array.from({ length: 9 }, (_, index) => index + 19));
  assert.deepEqual(preview.plannedEpisodes, Array.from({ length: 18 }, (_, index) => index + 1));
  assert.equal(preview.totalArchiveBytes, 180);
  assert.deepEqual(preview.qualities, ['4K HDR']);
  assert.equal(preview.canStart, true);
  const job = await f.service.start({ ...input, token: preview.token }, user);
  await f.service.active.get(job.id);
  const result = await f.service.get(job.id, user);
  assert.equal(result.status, 'success'); assert.equal(result.targetFid, 'old-library');
  assert.equal(result.completedEpisodes.length, 18); assert.equal(f.stored.size, 27);
  assert.deepEqual(f.calls.map(call => call.episode), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.ok(f.calls.every(call => call.quarkFid === 'old-library' && call.archiveFid.startsWith('hdr-')));
  assert.doesNotMatch(JSON.stringify(result), /archiveFid|shareUrl|passcode/);
});

test('来源缺一集或容量不足时只给出原因，不启动部分补集', async t => {
  const f = await fixture(t);
  for (let i = f.entries.length - 1; i >= 0; i--) if (f.entries[i].episodeNumber === 17) f.entries.splice(i, 1);
  const missing = await f.service.preview(input, user);
  assert.deepEqual(missing.missingEpisodes, [17]); assert.equal(missing.canStart, false);
  await assert.rejects(f.service.start({ ...input, token: missing.token }, user), { code: 'ARCHIVE_BATCH_INCOMPLETE' });
  assert.equal(f.calls.length, 0);
  f.gateway.getArchiveCapabilities = async () => ({ isAuthenticated: true, isSvip: true, freeBytes: 1 });
  f.entries.push({ fid: 'hdr-17', parentFid: 'hdr', ancestorFids: ['hdr'], name: '17.zip', isArchive: true, episodeNumber: 17, size: 10 });
  const noSpace = await f.service.preview(input, user);
  assert.equal(noSpace.canStart, false); assert.match(noSpace.reason, /空间/);
  assert.equal(f.calls.length, 0);
});

test('片库补集覆盖相同优先 SDR 标注，少一集时仍优先能找齐的版本', async t => {
  const f = await fixture(t);
  f.entries.find(item => item.fid === 'dv').name = '1080P SDR';
  const compatible = await f.service.preview(input, user);
  assert.deepEqual(compatible.qualities, ['1080P SDR']);
  assert.equal(compatible.totalArchiveBytes, 360);
  f.entries.splice(f.entries.findIndex(item => item.fid === 'dv-1'), 1);
  const complete = await f.service.preview(input, user);
  assert.deepEqual(complete.qualities, ['4K HDR']);
  assert.deepEqual(complete.missingEpisodes, []);
});

test('预览后片源变化必须重新核对，不能使用过时计划启动', async t => {
  const f = await fixture(t), preview = await f.service.preview(input, user);
  f.entries.find(entry => entry.fid === 'hdr-1').size = 11;
  await assert.rejects(f.service.start({ ...input, token: preview.token }, user), { code: 'ARCHIVE_PLAN_CHANGED' });
  assert.equal(f.calls.length, 0);
});

test('一集失败后可继续原任务，只补剩余剧集并保留进度', async t => {
  const f = await fixture(t, { failEpisode: 3 }), preview = await f.service.preview(input, user);
  const job = await f.service.start({ ...input, token: preview.token }, user);
  await f.service.active.get(job.id);
  const result = await f.service.get(job.id, user);
  assert.equal(result.status, 'failed'); assert.deepEqual(result.completedEpisodes, [1, 2]);
  assert.deepEqual(f.calls.map(call => call.episode), [1, 2, 3]);
  const newUrl = 'https://pan.quark.cn/s/replacement';
  f.service.resourceSearch.search = async () => ({ merged_by_type: { quark: [{ ...row, url: newUrl }] } });
  f.service.officialProgress.lookup = async () => { throw Error('official temporarily unavailable'); };
  await assert.rejects(f.service.resume(job.id, { username: 'other' }), { code: 'ARCHIVE_JOB_NOT_FOUND' });
  const [resumed, duplicate] = await Promise.all([f.service.resume(job.id, user), f.service.resume(job.id, user)]);
  assert.equal(resumed.id, job.id); assert.equal(duplicate.id, job.id);
  assert.equal(resumed.total, 18); assert.deepEqual(resumed.completedEpisodes, [1, 2]);
  await f.service.active.get(job.id);
  const done = await f.service.get(job.id, user);
  assert.equal(done.status, 'success'); assert.equal(done.completedEpisodes.length, 18);
  assert.equal(f.stored.size, 27);
  assert.deepEqual(f.calls.slice(3).map(call => call.episode), Array.from({ length: 16 }, (_, index) => index + 3));
  assert.ok(f.calls.slice(3).every(call => call.shareUrl === newUrl && call.quarkFid === 'old-library'));
});

test('任务隔离账号，可在当前集完成后停止，重复点击不会开启第二个任务', async t => {
  const f = await fixture(t, { holdFirst: true }), preview = await f.service.preview(input, user);
  const [first, duplicate] = await Promise.all([
    f.service.start({ ...input, token: preview.token }, user), f.service.start({ ...input, token: preview.token }, user)
  ]);
  assert.equal(first.id, duplicate.id); await f.started;
  await assert.rejects(f.service.stop(first.id, { username: 'other' }), { code: 'ARCHIVE_JOB_NOT_FOUND' });
  await f.service.stop(first.id, user); f.release(); await f.service.active.get(first.id);
  const result = await f.service.get(first.id, user);
  assert.equal(result.status, 'paused'); assert.deepEqual(result.completedEpisodes, [1]);
  assert.equal(f.calls.length, 1); assert.equal(f.stored.has(1), true);
  const restarted = new ArchiveBatchService(f.dir, {
    gateway: f.gateway, archiveImport: f.archiveImport, catalog: f.service.catalog,
    officialProgress: f.service.officialProgress, resourceSearch: f.service.resourceSearch
  });
  const resumed = await restarted.resume(first.id, user);
  assert.equal(resumed.id, first.id); assert.deepEqual(resumed.completedEpisodes, [1]);
  await restarted.active.get(first.id);
  assert.equal((await restarted.get(first.id, user)).status, 'success');
  assert.deepEqual(f.calls.map(call => call.episode), Array.from({ length: 18 }, (_, index) => index + 1));
});

test('官方集数不能唯一确认时不会把资源标题当作全集证明', async t => {
  const f = await fixture(t);
  f.service.officialProgress.lookup = async () => ({ works: [official.works[0], { ...official.works[0], year: '2025' }] });
  await assert.rejects(f.service.preview({ ...input, year: '' }, user), { code: 'OFFICIAL_PROGRESS_UNAVAILABLE' });
  assert.equal(f.calls.length, 0);
});

test('同名同年的多个真实来源可以补齐缺口，其他年份不会混入', async t => {
  const f = await fixture(t), otherUrl = 'https://pan.quark.cn/s/other';
  for (let i = f.entries.length - 1; i >= 0; i--) if (f.entries[i].episodeNumber === 17) f.entries.splice(i, 1);
  let otherYear = '2026';
  f.service.resourceSearch.search = async () => ({ merged_by_type: { quark: [row, { ...row, url: otherUrl, year: otherYear }] } });
  f.gateway.getShareDetails = async ({ shareUrl }) => shareUrl === url ? { entries: f.entries } : { entries: [
    { fid: 'other-folder', name: '4K HDR', isDirectory: true },
    { fid: 'other-17', parentFid: 'other-folder', ancestorFids: ['other-folder'], name: '17.zip', isArchive: true, episodeNumber: 17, size: 11 }
  ] };
  const compatible = await f.service.preview(input, user);
  assert.equal(compatible.canStart, true); assert.deepEqual(compatible.missingEpisodes, []);
  assert.equal(compatible.plannedEpisodes.length, 18);
  otherYear = '2025';
  const differentEdition = await f.service.preview(input, user);
  assert.equal(differentEdition.canStart, false); assert.deepEqual(differentEdition.missingEpisodes, [17]);
});

test('已核实目录别名的直接视频可与压缩包组合补全集，并追加到原目录', async t => {
  const f = await fixture(t), otherUrl = 'https://pan.quark.cn/s/video';
  for (let i = f.entries.length - 1; i >= 0; i--) if (f.entries[i].episodeNumber === 17) f.entries.splice(i, 1);
  f.service.resourceSearch.search = async () => ({ merged_by_type: { quark: [row, { ...row, source: 'erxiaopan', url: otherUrl }] } });
  const directory = '【Z】折丨Y越亮';
  const folder = { fid: 'folder-video', name: directory, isDirectory: true };
  f.gateway.getShareDetails = async ({ shareUrl }) => shareUrl === url ? { title: '折月亮', entries: f.entries } : { title: directory, entries: [
    folder,
    { fid: 'video-17', parentFid: 'folder-video', ancestorFids: ['folder-video'], name: '17-4K.mp4', isVideo: true, episodeNumber: 17, size: 15 }
  ] };
  let direct;
  f.gateway.importShare = async request => { direct = request; f.stored.add(17); return { item: { quarkFid: 'old-library', title: '折月亮', category: 'tv' } }; };
  let persisted;
  f.service.userContext = () => ({ mediaRepository: { all: () => [{ quarkFid: 'old-library', quarkShareUrl: 'old-source' }], save: item => { persisted = item; } } });
  folder.name = '其他电视剧';
  const mismatched = await f.service.preview(input, user);
  assert.equal(mismatched.canStart, false);
  assert.deepEqual(mismatched.missingEpisodes, [17]);
  folder.name = directory;
  const preview = await f.service.preview(input, user);
  assert.equal(preview.canStart, true); assert.equal(preview.totalVideoBytes, 15); assert.deepEqual(preview.missingEpisodes, []);
  const job = await f.service.start({ ...input, token: preview.token }, user); await f.service.active.get(job.id);
  assert.equal((await f.service.get(job.id, user)).status, 'success');
  assert.equal(direct.appendToFid, 'old-library'); assert.deepEqual(direct.quarkSelectionFids, ['video-17']);
  assert.deepEqual(direct.quarkRequiredEpisodes, [17]); assert.equal(persisted.quarkShareUrl, 'old-source');
  assert.equal(direct.quarkVerifiedShareTitle, directory);
});

test('服务重启后未完成任务标记暂停，已完成集数和原目录保留', async t => {
  const f = await fixture(t);
  const id = 'a'.repeat(32);
  await f.service.persist({ id, owner: user.username, input: { title: input.title, category: 'tv' }, targetFid: 'old-library',
    officialLatest: 27, items: [{ episode: 1 }, { episode: 2 }], completedEpisodes: [1], currentEpisode: 2,
    cleanupPendingCount: 0, status: 'running', message: '处理中' });
  const restored = new ArchiveBatchService(f.dir, { gateway: f.gateway, archiveImport: f.archiveImport,
    catalog: f.service.catalog, officialProgress: f.service.officialProgress, resourceSearch: f.service.resourceSearch });
  const job = await restored.get(id, user);
  assert.equal(job.status, 'paused'); assert.equal(job.targetFid, 'old-library');
  assert.deepEqual(job.completedEpisodes, [1]); assert.match(job.message, /已保存的剧集仍在片库/);
  assert.equal(f.calls.length, 0);
});

test('批量任务串联真实单集任务服务，逐集核对后保留原来源和目录', async t => {
  const f = await fixture(t);
  let copied = 0, cleaned = 0;
  let record = { quarkFid: 'old-library', title: '折月亮', category: 'tv', year: '2026',
    quarkShareUrl: 'https://pan.quark.cn/s/original', poster: 'old-poster' };
  const userContext = () => ({ mediaRepository: { all: () => [record], save: item => { record = { ...record, ...item }; } } });
  f.gateway.prepareArchiveImport = async (request, who, { state, checkpoint }) => {
    copied++; const next = { ...state, owner: who.username, prepared: true, episode: request.episode };
    await checkpoint(next); return { state: next };
  };
  f.gateway.finalizeArchiveImport = async (prepared, request, publication, _who, { checkpoint }) => {
    assert.equal(publication.work_title, '折月亮'); assert.equal(request.quarkFid, 'old-library');
    f.stored.add(request.episode);
    const state = { ...prepared.state, published: true, targetFid: 'old-library' }; await checkpoint(state);
    return { item: { quarkFid: 'old-library', title: '折月亮', category: 'tv', quarkShareUrl: url,
      quarkArchiveImported: true, quarkArchiveEpisode: request.episode }, state };
  };
  f.gateway.cleanupArchiveStage = async () => { cleaned++; return true; };
  f.service.userContext = userContext;
  f.service.archiveImport = new ArchiveImportService(f.dir, { gateway: f.gateway,
    resourceSearch: f.service.resourceSearch, userContext });
  const preview = await f.service.preview(input, user);
  const job = await f.service.start({ ...input, token: preview.token }, user); await f.service.active.get(job.id);
  assert.equal((await f.service.get(job.id, user)).status, 'success');
  assert.equal(copied, 18); assert.equal(cleaned, 18); assert.equal(f.stored.size, 27);
  assert.equal(record.quarkFid, 'old-library'); assert.equal(record.quarkShareUrl, 'https://pan.quark.cn/s/original');
  assert.equal(record.poster, 'old-poster'); assert.equal(record.quarkArchiveImported, undefined);
});
