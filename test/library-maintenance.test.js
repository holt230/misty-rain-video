import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryMaintenance } from '../server/libraryMaintenance.js';
import { LibraryMaintenanceRepository, MediaRepository, PlaybackHistoryRepository } from '../server/storage.js';
import { episodeKey, libraryVideoName, missingLibraryEpisodes, validateSourceCandidate } from '../server/libraryPolicy.js';
import { normalizePlaybackEpisodes } from '../server/quarkGateway.js';

const video = (name, extra = {}) => ({ fid: name, file_name: name, file_type: 1, size: 100, ...extra });
const card = { id: 'quark:show', quarkFid: 'show', title: '测试剧', category: 'tv', year: '2026', quarkShareUrl: 'https://pan.quark.cn/s/old', quarkPasscode: '' };

test('标准文件名保留季、上下集和扩展名，旧嵌套目录与新命名共享集数身份', () => {
  const episodes = normalizePlaybackEpisodes([
    video('S01E01.mkv'), video('S02E01.MP4'), video('E02上.mkv', { source_path: '测试剧/第二季' }),
    video('E03.mkv', { source_path: '测试剧/花絮' }), video('广告.mp4'), video('说明.txt')
  ]);
  assert.equal(episodes.length, 5);
  assert.ok(episodes.some(item => item.fileName === 'E03.mkv'));
  assert.ok(episodes.some(item => item.fileName === '广告.mp4'));
  assert.equal(libraryVideoName(episodes[0]), '第02季 第02集（上）.mkv');
  assert.equal(libraryVideoName(episodes[1]), '第02季 第01集.MP4');
  const renamed = normalizePlaybackEpisodes(episodes.map(item => video(libraryVideoName(item))));
  assert.deepEqual(renamed.map(item => episodeKey(item)), episodes.map(item => episodeKey(item)));
  assert.equal(missingLibraryEpisodes(renamed, episodes, card).length, 0);
  assert.equal(normalizePlaybackEpisodes([video('幕后玩家.mkv')]).length, 1);
});

test('候选核对片名、年份、季数和覆盖集数，拒绝搜索备注、合集和同名续集', () => {
  const localEpisodes = normalizePlaybackEpisodes([video('第01集.mkv'), video('第02集.mkv')]);
  const episodes = normalizePlaybackEpisodes([video('测试剧.E01.mkv'), video('测试剧.E02.mkv'), video('测试剧.E03.mkv')]);
  const check = (overrides = {}) => validateSourceCandidate({ card, shareTitle: '测试剧（2026）更新至3集 4K', episodes, localEpisodes, ...overrides });
  assert.equal(check(), true);
  assert.equal(check({ shareTitle: '另一个剧' }), false);
  assert.equal(check({ shareTitle: '测试剧 第二季' }), false);
  assert.equal(check({ shareTitle: '测试剧（2024）' }), false);
  assert.equal(check({ episodes: episodes.filter(item => item.episodeNumber !== 2) }), false);
  assert.equal(check({ episodes: normalizePlaybackEpisodes([video('S02E01.mkv'), video('S02E02.mkv')]) }), false);
  assert.equal(check({ episodes: episodes.map(item => ({ ...item, sourcePath: '测试剧/其他电视剧' })) }), false);
  assert.equal(check({ episodes: normalizePlaybackEpisodes([video('其他剧.E01.mkv'), video('其他剧.E02.mkv')]) }), false);
  assert.equal(check({ localEpisodes: [] }), false);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'library-maintenance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const users = [{ username: 'one', folder: 'one', role: 'user' }, { username: 'two', folder: 'two', role: 'user' }];
  const data = new Map(users.map(user => [user.folder, {
    mediaRepository: new MediaRepository(path.join(directory, user.folder)),
    playbackHistory: new PlaybackHistoryRepository(path.join(directory, user.folder)),
    maintenanceRepository: new LibraryMaintenanceRepository(path.join(directory, user.folder))
  }]));
  data.get('one').mediaRepository.save(card);
  data.get('one').playbackHistory.save({ media: card, episodeFid: 'original', position: 30 });
  let clock = 1_800_000;
  const calls = [];
  let status = { updateCheckAvailable: true, newEpisodeCount: 1 };
  const context = {
    authService: { users, publicUser: user => ({ ...user }) },
    userContext: user => data.get(user.folder),
    quarkGateway: {
      listLibrary: async user => user.folder === 'one' ? [{ ...card, quarkShareUrl: undefined }] : [],
      checkLibraryUpdates: async () => [{ ...status }],
      applyLibraryUpdates: async ([item], user, options) => {
        assert.equal(options.isCurrent(item), true);
        calls.push(['append', user.folder, item.quarkFid]);
        return { transferredCount: 1, failedCount: 0 };
      },
      relinkLibrarySource: async (item, candidate, user, options) => {
        assert.equal(options.isCurrent(item), true);
        calls.push(['relink', user.folder, item.quarkFid]);
        return options.commit(item, { quarkShareUrl: candidate.url, quarkPasscode: '' });
      }
    },
    resourceSearch: { search: async () => { calls.push(['search']); return { merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/new' }] } }; } }
  };
  const service = new LibraryMaintenance(context, { intervalMs: 30 * 60_000, now: () => clock });
  return { service, context, data, users, calls, tick: (ms = 30 * 60_000) => { clock += ms; },
    setStatus: value => { status = value; } };
}

test('后台补集保留 FID 和播放历史；重启读取进度、不提前重复执行，状态隔离且不含来源凭据', async t => {
  const f = fixture(t);
  await f.service.runOnce();
  assert.deepEqual(f.calls, [['append', 'one', 'show']]);
  assert.equal(f.data.get('one').playbackHistory.all()[0].episodeFid, 'original');
  assert.equal(f.service.status(f.users[1]).items.length, 0);
  assert.doesNotMatch(JSON.stringify(f.service.status(f.users[0])), /quarkShareUrl|quarkPasscode|fingerprint/);
  const restarted = new LibraryMaintenance(f.context, { now: () => 1_800_000 });
  await restarted.runOnce();
  assert.equal(f.calls.length, 1);
  f.tick();
  f.setStatus({ updateCheckAvailable: true, newEpisodeCount: 0 });
  await f.service.runOnce();
  assert.equal(f.calls.length, 1);
});

test('来源连续三次失效才检索关联，保持原文件目录；网络或认证错误不触发换源', async t => {
  const f = fixture(t);
  f.setStatus({ updateCheckAvailable: false, code: 'QUARK_SHARE_UNAVAILABLE' });
  await f.service.runOnce(); f.tick(); await f.service.runOnce();
  assert.equal(f.calls.length, 0);
  f.tick(); await f.service.runOnce();
  assert.deepEqual(f.calls, [['search'], ['relink', 'one', 'show'], ['append', 'one', 'show']]);
  assert.equal(f.data.get('one').mediaRepository.all()[0].quarkShareUrl, 'https://pan.quark.cn/s/new');
  assert.equal(f.data.get('one').mediaRepository.all()[0].quarkFid, 'show');
  assert.equal(f.data.get('one').playbackHistory.all()[0].episodeFid, 'original');
  f.calls.length = 0;
  for (const code of ['QUARK_NETWORK_ERROR', 'QUARK_AUTH_REQUIRED', 'QUARK_SHARE_ACCESS_FAILED']) {
    f.setStatus({ updateCheckAvailable: false, code });
    for (let i = 0; i < 4; i += 1) { f.tick(6 * 60 * 60_000); await f.service.runOnce(); }
  }
  assert.equal(f.calls.length, 0);
});

test('改名后的后台片源检索和维护状态都使用用户修正的名称', async t => {
  const f = fixture(t);
  f.data.get('one').libraryViewRepository = { titleFor: fid => fid === 'show' ? '正确片名' : '' };
  const searched = [];
  f.context.resourceSearch.search = async title => { searched.push(title); return { merged_by_type: { quark: [] } }; };
  f.setStatus({ updateCheckAvailable: false, code: 'QUARK_SHARE_UNAVAILABLE' });
  await f.service.runOnce(); f.tick(); await f.service.runOnce(); f.tick(); await f.service.runOnce();
  assert.deepEqual(searched, ['正确片名']);
  assert.equal(f.service.status(f.users[0]).items[0].title, '正确片名');
  assert.equal(f.data.get('one').mediaRepository.all()[0].quarkFid, 'show');
});

test('失败退避、来源人工变更重置失败计数；重叠运行和停止不会再调度写操作', async t => {
  const f = fixture(t);
  f.setStatus({ updateCheckAvailable: false, code: 'QUARK_NETWORK_ERROR' });
  for (let i = 0; i < 4; i += 1) { await f.service.runOnce(); f.tick(); }
  const entry = f.data.get('one').maintenanceRepository.read().items.show;
  assert.equal(entry.failures, 4);
  assert.equal(entry.nextCheckAt - Date.parse(entry.checkedAt), 60 * 60_000);
  f.data.get('one').mediaRepository.save({ ...card, quarkShareUrl: 'https://pan.quark.cn/s/manual' });
  f.setStatus({ updateCheckAvailable: false, code: 'QUARK_SHARE_UNAVAILABLE' });
  await f.service.runOnce();
  assert.equal(f.data.get('one').maintenanceRepository.read().items.show.unavailableCount, 1);
  let finish;
  let lists = 0;
  f.context.quarkGateway.listLibrary = async () => { lists += 1; return new Promise(resolve => { finish = resolve; }); };
  const pending = f.service.runOnce();
  await f.service.runOnce();
  assert.equal(lists, 1);
  f.service.stop(); finish([]); await pending;
  await f.service.runOnce();
  assert.equal(lists, 1);
});

test('升级错误分类后旧异常在首次巡检复查，不继承六小时退避，也不把旧失败当作确认失效', async t => {
  const f = fixture(t);
  await f.service.runOnce();
  f.calls.length = 0;
  const state = f.data.get('one').maintenanceRepository.read();
  const legacy = state.items.show;
  legacy.status = 'retrying';
  legacy.failures = 12;
  legacy.unavailableCount = 2;
  legacy.nextCheckAt = Date.parse(legacy.checkedAt) + 6 * 60 * 60_000;
  delete legacy.failurePolicyVersion;
  f.data.get('one').maintenanceRepository.write(state);
  f.setStatus({ updateCheckAvailable: false, code: 'QUARK_SHARE_UNAVAILABLE' });
  await f.service.runOnce();
  const updated = f.data.get('one').maintenanceRepository.read().items.show;
  assert.equal(updated.unavailableCount, 1);
  assert.equal(updated.failures, 1);
  assert.equal(updated.nextCheckAt - Date.parse(updated.checkedAt), 30 * 60_000);
  assert.match(f.service.status(f.users[0]).items[0].message, /1\/3/);
  assert.equal(f.service.status(f.users[0]).items[0].code, 'QUARK_SHARE_UNAVAILABLE');
  assert.equal(f.calls.length, 0);
  await f.service.runOnce();
  assert.equal(f.data.get('one').maintenanceRepository.read().items.show.unavailableCount, 1);
});

test('每轮验证至多五条但继续后续候选，第六条可关联；已确认失效后不延长候选发现间隔', async t => {
  const f = fixture(t);
  f.setStatus({ updateCheckAvailable: false, code: 'QUARK_SHARE_UNAVAILABLE' });
  const candidates = Array.from({ length: 6 }, (_, index) => ({ url: `https://pan.quark.cn/s/candidate${index + 1}` }));
  const checked = [];
  f.context.resourceSearch.search = async () => ({ merged_by_type: { quark: candidates } });
  f.context.quarkGateway.relinkLibrarySource = async (item, candidate, _user, options) => {
    assert.equal(options.isCurrent(item), true);
    checked.push(candidate.url);
    return candidate.url === candidates[5].url && options.commit(item, { quarkShareUrl: candidate.url, quarkPasscode: '' });
  };
  for (let i = 0; i < 3; i += 1) { await f.service.runOnce(); f.tick(); }
  assert.deepEqual(checked, candidates.slice(0, 5).map(item => item.url));
  const state = f.data.get('one').maintenanceRepository.read().items.show;
  assert.equal(state.nextCheckAt - Date.parse(state.checkedAt), 30 * 60_000);
  await f.service.runOnce();
  assert.deepEqual(checked, candidates.map(item => item.url));
  assert.equal(f.data.get('one').mediaRepository.all()[0].quarkShareUrl, candidates[5].url);
  assert.equal(f.service.status(f.users[0]).items[0].status, 'relinked');
  assert.equal(f.service.status(f.users[0]).items[0].unavailableCount, 0);
});

test('候选检索失败不抹掉原来源已确认失效的记录，下轮继续检索而非重数三次', async t => {
  const f = fixture(t);
  f.setStatus({ updateCheckAvailable: false, code: 'QUARK_SHARE_UNAVAILABLE' });
  let searches = 0;
  const normalSearch = f.context.resourceSearch.search;
  f.context.resourceSearch.search = async (...args) => {
    searches += 1;
    if (searches === 1) throw Object.assign(new Error('搜索超时'), { code: 'RESOURCE_SEARCH_TIMEOUT' });
    return normalSearch(...args);
  };
  for (let i = 0; i < 3; i += 1) { await f.service.runOnce(); f.tick(); }
  const failed = f.data.get('one').maintenanceRepository.read().items.show;
  assert.equal(failed.unavailableCount, 3);
  assert.equal(failed.nextCheckAt - Date.parse(failed.checkedAt), 30 * 60_000);
  assert.match(f.service.status(f.users[0]).items[0].message, /原来源已确认不可用/);
  await f.service.runOnce();
  assert.equal(searches, 2);
  assert.equal(f.service.status(f.users[0]).items[0].status, 'relinked');
});

test('精确来源比较与交换不会覆盖手动换源、其他同名 FID，或复活已删除卡片', t => {
  const f = fixture(t);
  const repo = f.data.get('one').mediaRepository;
  repo.save({ ...card, quarkShareUrl: 'https://pan.quark.cn/s/manual' });
  assert.equal(repo.relinkSource(card, { quarkShareUrl: 'https://pan.quark.cn/s/new' }), false);
  assert.equal(repo.all()[0].quarkShareUrl, 'https://pan.quark.cn/s/manual');
  repo.removeFid(card.quarkFid);
  assert.equal(repo.relinkSource(card, { quarkShareUrl: 'https://pan.quark.cn/s/new' }), false);
  repo.save({ ...card, quarkFid: 'another' });
  assert.equal(repo.matchesSource(card), false);
});

test('选集范围变更使旧任务失效，限定来源不可用时不自动扩大到全部剧集', async t => {
  const f = fixture(t);
  const repo = f.data.get('one').mediaRepository;
  repo.save({ ...card, quarkSelectionFids: ['season-one'] });
  assert.equal(repo.matchesSource(card), false);
  assert.equal(repo.relinkSource(card, { quarkShareUrl: 'https://pan.quark.cn/s/new' }), false);
  f.setStatus({ updateCheckAvailable: false, code: 'QUARK_SHARE_UNAVAILABLE' });
  for (let i = 0; i < 4; i += 1) { await f.service.runOnce(); f.tick(); }
  assert.equal(f.calls.length, 0);
  assert.match(f.service.status(f.users[0]).items[0].message, /保留你的选集范围/);
});
