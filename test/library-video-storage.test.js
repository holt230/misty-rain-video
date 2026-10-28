import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { QuarkGateway } from '../server/quarkGateway.js';
import { LibraryMaintenance } from '../server/libraryMaintenance.js';
import { LibraryMaintenanceRepository, MediaRepository, PlaybackHistoryRepository } from '../server/storage.js';

const user = { username: 'viewer', folder: 'viewer', role: 'user' };
const folder = (fid, file_name, pdir_fid) => ({ fid, file_name, pdir_fid, file_type: 0, dir: true });
const video = (fid, file_name, pdir_fid, size = 100) => ({ fid, file_name, pdir_fid, file_type: 1, size, share_fid_token: `token-${fid}` });

function fakeDrive(t) {
  const drive = new Map([
    ['root', folder('root', '烟雨视频', '0')], ['user', folder('user', 'viewer', 'root')],
    ['category', folder('category', '电视剧', 'user')]
  ]);
  const share = new Map([
    ['nested', folder('nested', '测试剧', '0')],
    ['ep1', video('ep1', '测试剧.E01.mkv', 'nested')],
    ['ep2', video('ep2', '测试剧.E02.MP4', 'nested', 200)],
    ['ep1low', video('ep1low', '测试剧.E01.低清.mp4', 'nested', 50)],
    ['extras', folder('extras', '花絮', 'nested')],
    ['extra', video('extra', 'E99.mp4', 'extras')],
    ['text', video('text', '转存说明.txt', '0')],
    ['poster', video('poster', '海报.jpg', '0')]
  ]);
  const saves = [];
  const renames = [];
  const deletions = [];
  let id = 0;
  let onSave;
  let tokenResult;
  let tokenStatus = 200;
  let detailResult;
  let detailStatus = 200;
  let renameFailure = false;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    assert.ok(['drive-pc.quark.cn', 'drive.quark.cn'].includes(url.hostname));
    const body = init.body ? JSON.parse(init.body) : {};
    const ok = data => Response.json({ code: 0, data });
    if (url.pathname.endsWith('/share/sharepage/token')) {
      if (typeof tokenResult === 'function') return tokenResult(body);
      if (tokenResult instanceof Error) throw tokenResult;
      return tokenResult ? Response.json(tokenResult, { status: tokenStatus }) : ok({ stoken: 'fake', title: '测试剧' });
    }
    if (url.pathname.endsWith('/share/sharepage/detail')) return detailResult
      ? Response.json(detailResult, { status: detailStatus })
      : ok({ list: [...share.values()].filter(item => item.pdir_fid === url.searchParams.get('pdir_fid')) });
    if (url.pathname.endsWith('/file/sort')) return ok({ list: [...drive.values()].filter(item => item.pdir_fid === url.searchParams.get('pdir_fid')) });
    if (url.pathname.endsWith('/file')) {
      const created = folder(`folder-${++id}`, body.file_name, body.pdir_fid);
      drive.set(created.fid, created); return ok(created);
    }
    if (url.pathname.endsWith('/share/sharepage/save')) {
      if (onSave) await onSave();
      const saved = body.fid_list.map(fid => {
        const source = share.get(fid);
        assert.equal(source.file_type, 1, 'Only video files should be saved');
        saves.push(fid);
        const item = { ...source, fid: `saved-${++id}`, pdir_fid: body.to_pdir_fid };
        drive.set(item.fid, item); return item.fid;
      });
      // Deliberately return the reverse order to catch index-based renaming.
      return ok({ save_as: { save_as_top_fids: saved.reverse() } });
    }
    if (url.pathname.endsWith('/file/rename')) {
      if (renameFailure) return Response.json({ code: 9, message: 'rename unavailable' });
      renames.push(body.fid);
      drive.get(body.fid).file_name = body.file_name; return ok({});
    }
    if (url.pathname.endsWith('/file/delete')) {
      for (const fid of body.filelist) { deletions.push(fid); drive.delete(fid); }
      return ok({});
    }
    throw new Error(`Unexpected fake route: ${url.pathname}`);
  });
  const gateway = new QuarkGateway({ credentialStore: { getCookie: () => 'fake-cookie', saveCookie: () => {} } });
  t.after(() => clearInterval(gateway.cleanupTimer));
  const input = { title: '测试剧', category: 'tv', quarkShareUrl: 'https://pan.quark.cn/s/fake' };
  return { drive, share, gateway, input, saves, renames, deletions,
    setOnSave: value => { onSave = value; },
    setToken: (value, status = 200) => { tokenResult = value; tokenStatus = status; },
    setDetail: (value, status = 200) => { detailResult = value; detailStatus = status; },
    failRename: () => { renameFailure = true; } };
}

test('首次入库只转存正片且平铺命名，不复制分享目录/附件；重试不重复，补集沿用同一 FID', async t => {
  const f = fakeDrive(t);
  const imported = await f.gateway.importShare(f.input, user);
  const fid = imported.item.quarkFid;
  assert.equal(imported.transferredCount, 2);
  assert.deepEqual(new Set(f.saves), new Set(['ep1', 'ep2']));
  const children = () => [...f.drive.values()].filter(item => item.pdir_fid === fid);
  assert.deepEqual(children().map(item => [item.file_name, item.size]).sort(), [['第01集.mkv', 100], ['第02集.MP4', 200]]);
  const originalFids = children().map(item => item.fid);
  assert.equal((await f.gateway.importShare(f.input, user)).transferredCount, 0);
  f.share.set('ep3', video('ep3', '测试剧.E03.mkv', 'nested', 300));
  const updated = await f.gateway.applyLibraryUpdates([imported.item], user);
  assert.equal(updated.transferredCount, 1);
  assert.equal(updated.failedCount, 0);
  assert.equal(updated.items[0].newEpisodeCount, 0);
  assert.deepEqual(children().slice(0, 2).map(item => item.fid), originalFids);
  assert.equal(children().at(-1).file_name, '第03集.mkv');
  assert.equal((await f.gateway.applyLibraryUpdates([imported.item], user)).transferredCount, 0);
  assert.equal(f.deletions.length, 0);
});

test('旧目录继续递归读取，只补缺失集；同集不同画质不重复转存', async t => {
  const f = fakeDrive(t);
  f.drive.set('legacy', folder('legacy', '测试剧', 'category'));
  f.drive.set('old-share', folder('old-share', '原分享杂乱目录', 'legacy'));
  f.drive.set('old-ep', video('old-ep', '第01集.mp4', 'old-share', 10));
  const result = await f.gateway.importShare(f.input, user);
  assert.equal(result.item.quarkFid, 'legacy');
  assert.equal(result.transferredCount, 1);
  assert.deepEqual(f.saves, ['ep2']);
  assert.equal(f.drive.get('old-ep').pdir_fid, 'old-share');
  assert.equal(f.deletions.length, 0);
});

test('只有第一集的新剧也不会顺带转存未编号的介绍视频；电影保留原片名', async t => {
  const f = fakeDrive(t);
  f.share.clear();
  f.share.set('first', video('first', 'E01.mkv', '0'));
  f.share.set('intro', video('intro', '进群领取资源.mp4', '0'));
  const imported = await f.gateway.importShare(f.input, user);
  assert.equal(imported.transferredCount, 1);
  assert.deepEqual(f.saves, ['first']);
  f.share.clear();
  f.share.set('movie', video('movie', '速度与激情7.mkv', '0'));
  const movie = await f.gateway.importShare({ ...f.input, category: 'movie', title: '速度与激情7' }, user);
  assert.equal([...f.drive.values()].find(item => item.pdir_fid === movie.item.quarkFid).file_name, '速度与激情7.mkv');
});

test('多个季的同名同尺寸视频分批转存，保留每一季，不能依靠返回 FID 顺序重命名', async t => {
  const f = fakeDrive(t);
  f.share.clear();
  f.share.set('s1', folder('s1', '第一季', '0'));
  f.share.set('s2', folder('s2', '第二季', '0'));
  f.share.set('s1e1', video('s1e1', 'E01.mkv', 's1'));
  f.share.set('s2e1', video('s2e1', 'E01.mkv', 's2'));
  const imported = await f.gateway.importShare(f.input, user);
  const files = [...f.drive.values()].filter(item => item.pdir_fid === imported.item.quarkFid);
  assert.deepEqual(files.map(item => item.file_name).sort(), ['第01季 第01集.mkv', '第02季 第01集.mkv']);
  assert.equal((await f.gateway.applyLibraryUpdates([imported.item], user)).transferredCount, 0);
});

test('补集与删除共享目录锁，来源变更后旧任务不转存；手动换源使用平铺视频', async t => {
  const f = fakeDrive(t);
  const imported = await f.gateway.importShare(f.input, user);
  f.share.set('ep3', video('ep3', 'E03.mkv', 'nested'));
  let releaseSave;
  let startedSave;
  const started = new Promise(resolve => { startedSave = resolve; });
  f.setOnSave(() => { startedSave(); return new Promise(resolve => { releaseSave = resolve; }); });
  const pending = f.gateway.applyLibraryUpdates([imported.item], user);
  await started;
  await assert.rejects(f.gateway.trashLibraryItem(imported.item.quarkFid, user), { code: 'LIBRARY_MUTATION_IN_PROGRESS' });
  releaseSave(); await pending;
  f.setOnSave(null);
  f.share.set('ep4', video('ep4', 'E04.mkv', 'nested'));
  const previousSaves = f.saves.length;
  const stale = await f.gateway.applyLibraryUpdates([imported.item], user, { isCurrent: () => false });
  assert.equal(stale.failedCount, 1);
  assert.equal(f.saves.length, previousSaves);
  const replacement = await f.gateway.importShare({ ...f.input, quarkFid: imported.item.quarkFid }, user);
  assert.equal(replacement.replacedFid, imported.item.quarkFid);
  const files = [...f.drive.values()].filter(item => item.pdir_fid === replacement.item.quarkFid);
  assert.equal(files.length, 4);
  assert.ok(files.every(item => /^第\d+集\./.test(item.file_name)));
});

test('重命名失败保留已存视频，后续检查不重复复制；风控不当作分享失效', async t => {
  const f = fakeDrive(t);
  f.failRename();
  await assert.rejects(f.gateway.importShare(f.input, user), { code: 'QUARK_RENAME_FOLDER_FAILED' });
  assert.equal(f.deletions.length, 0);
  const retry = await f.gateway.importShare(f.input, user);
  assert.equal(retry.transferredCount, 0);
  f.setToken({ code: 999, message: '请求频繁，请稍后再试' });
  const [status] = await f.gateway.checkLibraryUpdates([retry.item], user, { force: true });
  assert.equal(status.code, 'QUARK_SHARE_ACCESS_FAILED');
  f.setToken({ code: 999, message: '分享链接已失效' });
  const [unavailable] = await f.gateway.checkLibraryUpdates([retry.item], user, { force: true });
  assert.equal(unavailable.code, 'QUARK_SHARE_UNAVAILABLE');
});

test('HTTP 错误中的取消分享保留失效分类；提取码、限流、认证和服务器异常不触发换源', async t => {
  const f = fakeDrive(t);
  const imported = await f.gateway.importShare(f.input, user);
  const cases = [
    [400, { code: 999, message: '好友已取消了分享' }, 'QUARK_SHARE_UNAVAILABLE'],
    [404, { code: 41012, message: '好友已取消了分享' }, 'QUARK_SHARE_UNAVAILABLE'],
    [404, { code: 999, message: '分享不存在' }, 'QUARK_SHARE_UNAVAILABLE'],
    [410, { code: 999, message: '分享已过期' }, 'QUARK_SHARE_UNAVAILABLE'],
    [422, { code: 999, message_desc: '该分享已取消' }, 'QUARK_SHARE_UNAVAILABLE'],
    [200, { code: 999, message_desc: '好友已取消了分享' }, 'QUARK_SHARE_UNAVAILABLE'],
    [400, { code: 999, message: '提取码不正确' }, 'QUARK_SHARE_PASSCODE_REQUIRED'],
    [200, { code: 999, message: '需要提取码' }, 'QUARK_SHARE_PASSCODE_REQUIRED'],
    [429, { code: 999, message: '请求频繁，请稍后重试' }, 'QUARK_HTTP_ERROR'],
    [500, { code: 999, message: '好友已取消了分享' }, 'QUARK_HTTP_ERROR']
  ];
  for (const [httpStatus, body, code] of cases) {
    f.setToken(body, httpStatus);
    const [status] = await f.gateway.checkLibraryUpdates([imported.item], user, { force: true });
    assert.equal(status.code, code, `${httpStatus}: ${body.message || body.message_desc}`);
    assert.equal(status.updateCheckAvailable, false);
  }
  f.setToken(new Error('network unavailable'));
  const [network] = await f.gateway.checkLibraryUpdates([imported.item], user, { force: true });
  assert.equal(network.code, 'QUARK_NETWORK_ERROR');
  f.setToken({ code: 31001, message: '登录已失效' }, 401);
  await assert.rejects(f.gateway.checkLibraryUpdates([imported.item], user, { force: true }), { code: 'QUARK_AUTH_REQUIRED' });
});

test('分享读取途中取消在 HTTP 200 或 400 下也计为失效，预览与更新检查一致', async t => {
  const f = fakeDrive(t);
  const imported = await f.gateway.importShare(f.input, user);
  for (const httpStatus of [200, 400]) {
    f.setDetail({ code: 999, message: '好友已取消了分享' }, httpStatus);
    const [status] = await f.gateway.checkLibraryUpdates([imported.item], user, { force: true });
    assert.equal(status.code, 'QUARK_SHARE_UNAVAILABLE');
    await assert.rejects(f.gateway.getShareDetails({ shareUrl: f.input.quarkShareUrl }), { code: 'QUARK_SHARE_UNAVAILABLE' });
  }
});

test('生产 HTTP 404/code 41012 取消响应经真实 Gateway 连续复查后自动关联补集，保留目录和原视频', async t => {
  const f = fakeDrive(t);
  const imported = await f.gateway.importShare(f.input, user);
  const originalFiles = [...f.drive.values()].filter(item => item.pdir_fid === imported.item.quarkFid).map(item => item.fid);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'library-http-relink-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = {
    mediaRepository: new MediaRepository(directory),
    playbackHistory: new PlaybackHistoryRepository(directory),
    maintenanceRepository: new LibraryMaintenanceRepository(directory)
  };
  data.mediaRepository.save(imported.item);
  data.playbackHistory.save({ media: imported.item, episodeFid: originalFiles[0], position: 30 });
  f.share.set('ep3', video('ep3', '测试剧.E03.mkv', 'nested', 300));
  f.setToken(body => body.pwd_id === 'fake'
    ? Response.json({ code: 41012, message: '好友已取消了分享' }, { status: 404 })
    : Response.json({ code: 0, data: { stoken: 'new-token', title: '测试剧' } }));
  let searches = 0;
  let clock = 1_800_000;
  const service = new LibraryMaintenance({
    authService: { users: [user], publicUser: value => value },
    userContext: () => data,
    quarkGateway: f.gateway,
    resourceSearch: { search: async (keyword, options) => {
      searches += 1;
      assert.equal(keyword, '测试剧');
      assert.deepEqual(options, { force: true, priority: 'background' });
      return { merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/new' }] } };
    } }
  }, { intervalMs: 30 * 60_000, now: () => clock });
  for (let i = 1; i <= 3; i += 1) {
    await service.runOnce();
    if (i < 3) {
      assert.equal(searches, 0);
      assert.equal(service.status(user).items[0].unavailableCount, i);
    }
    clock += 30 * 60_000;
  }
  assert.equal(searches, 1);
  assert.equal(service.status(user).items[0].status, 'relinked');
  assert.equal(service.status(user).items[0].addedCount, 1);
  const saved = data.mediaRepository.all()[0];
  assert.equal(saved.quarkShareUrl, 'https://pan.quark.cn/s/new');
  assert.equal(saved.quarkFid, imported.item.quarkFid);
  for (const fid of originalFiles) assert.equal(f.drive.get(fid).pdir_fid, imported.item.quarkFid);
  assert.equal(data.playbackHistory.all()[0].episodeFid, originalFiles[0]);
  assert.equal(f.deletions.length, 0);
});

test('自动关联先校验完整候选，拒绝去重可能掩盖的混合片源，只提交来源元数据', async t => {
  const f = fakeDrive(t);
  const imported = await f.gateway.importShare(f.input, user);
  const prior = structuredClone([...f.drive.values()]);
  let committed;
  const options = { isCurrent: () => true, commit: (_card, next) => { committed = next; return next; } };
  const candidate = { url: 'https://pan.quark.cn/s/new', password: '1234' };
  assert.ok(await f.gateway.relinkLibrarySource(imported.item, candidate, user, options));
  assert.equal(committed.quarkShareUrl, candidate.url);
  assert.equal(committed.quarkPasscode, '1234');
  assert.deepEqual([...f.drive.values()], prior);
  committed = null;
  f.share.set('mixed', folder('mixed', '其他电视剧', '0'));
  f.share.set('mixedep', video('mixedep', 'E01.mkv', 'mixed', 1));
  assert.equal(await f.gateway.relinkLibrarySource(imported.item, candidate, user, options), false);
  assert.equal(committed, null);
  f.share.delete('mixedep');
  assert.equal(await f.gateway.relinkLibrarySource(imported.item, candidate, user, { ...options, isCurrent: () => false }), false);
  assert.equal(committed, null);
});
