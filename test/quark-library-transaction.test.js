import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireLibraryMutationLocks,
  switchLibrarySourceFolders,
  waitForVideoEpisodes
} from '../server/quarkGateway.js';

test('换源切换失败时恢复旧目录名称', async () => {
  const operations = [];
  await assert.rejects(
    switchLibrarySourceFolders({
      replacementFid: 'old-fid',
      stagedFid: 'staged-fid',
      mediaTitle: '测试影片',
      backupName: '_烟雨系统_备份_测试影片',
      renameItem: async (fid, name) => {
        operations.push(['rename', fid, name]);
        if (fid === 'staged-fid') throw new Error('switch rejected');
      },
      trashItems: async fids => operations.push(['trash', ...fids])
    }),
    error => error?.code === 'LIBRARY_REPLACEMENT_FAILED'
  );

  assert.deepEqual(operations, [
    ['rename', 'old-fid', '_烟雨系统_备份_测试影片'],
    ['rename', 'staged-fid', '测试影片'],
    ['rename', 'old-fid', '测试影片']
  ]);
});

test('旧目录恢复失败时返回可识别的严重错误', async () => {
  let oldRenameCount = 0;
  await assert.rejects(
    switchLibrarySourceFolders({
      replacementFid: 'old-fid',
      stagedFid: 'staged-fid',
      mediaTitle: '测试影片',
      backupName: '_烟雨系统_备份_测试影片',
      renameItem: async fid => {
        if (fid === 'staged-fid') throw new Error('switch rejected');
        if (fid === 'old-fid' && ++oldRenameCount > 1) throw new Error('rollback rejected');
      },
      trashItems: async () => {}
    }),
    error => error?.code === 'LIBRARY_REPLACEMENT_ROLLBACK_FAILED'
      && error?.details?.switchError === 'switch rejected'
      && error?.details?.rollbackError === 'rollback rejected'
  );
});

test('新目录生效后旧备份清理失败不回滚换源', async () => {
  const operations = [];
  const result = await switchLibrarySourceFolders({
    replacementFid: 'old-fid',
    stagedFid: 'staged-fid',
    mediaTitle: '测试影片',
    backupName: '_烟雨系统_备份_测试影片',
    renameItem: async (fid, name) => operations.push(['rename', fid, name]),
    trashItems: async fids => {
      operations.push(['trash', ...fids]);
      throw new Error('temporary failure');
    }
  });

  assert.equal(result.cleanupPending, true);
  assert.deepEqual(operations, [
    ['rename', 'old-fid', '_烟雨系统_备份_测试影片'],
    ['rename', 'staged-fid', '测试影片'],
    ['trash', 'old-fid']
  ]);
});

test('目录验证会重试瞬时读取错误，但不会吞掉认证错误', async () => {
  let attempts = 0;
  const delays = [];
  const episodes = await waitForVideoEpisodes({
    scan: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('network unavailable'), {
          code: 'QUARK_NETWORK_ERROR',
          statusCode: 502
        });
      }
      return [{ fid: 'episode-1' }];
    },
    delay: async attempt => delays.push(attempt)
  });

  assert.deepEqual(episodes, [{ fid: 'episode-1' }]);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [1]);

  let authAttempts = 0;
  await assert.rejects(waitForVideoEpisodes({
    scan: async () => {
      authAttempts += 1;
      throw Object.assign(new Error('authentication rejected'), {
        code: 'QUARK_AUTH_REQUIRED',
        statusCode: 401
      });
    },
    delay: async () => {}
  }), error => error?.code === 'QUARK_AUTH_REQUIRED');
  assert.equal(authAttempts, 1);
});

test('影片目录锁按全部键原子获取并可释放', () => {
  const locks = new Set();
  const release = acquireLibraryMutationLocks(locks, ['title:admin:tv:测试', 'fid:admin:old-fid']);
  assert.equal(locks.size, 2);

  assert.throws(
    () => acquireLibraryMutationLocks(locks, ['title:admin:movie:测试', 'fid:admin:old-fid']),
    error => error?.code === 'LIBRARY_MUTATION_IN_PROGRESS'
  );
  assert.equal(locks.has('title:admin:movie:测试'), false);

  release();
  assert.equal(locks.size, 0);
  const releaseAgain = acquireLibraryMutationLocks(locks, ['fid:admin:old-fid']);
  releaseAgain();
  assert.equal(locks.size, 0);
});
