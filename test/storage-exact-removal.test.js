import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MediaRepository, PlaybackHistoryRepository } from '../server/storage.js';

test('删除一个目录 FID 时保留其他同名卡片和播放记录', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-rain-storage-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const mediaRepository = new MediaRepository(path.join(tempDir, 'media'));
  mediaRepository.save({ id: 'quark:first-fid', quarkFid: 'first-fid', title: '同名影片', category: 'tv' });
  mediaRepository.save({ id: 'quark:second-fid', quarkFid: 'second-fid', title: '同名影片', category: 'movie' });

  const remainingCards = mediaRepository.removeFid('first-fid');
  assert.deepEqual(remainingCards.map(card => card.quarkFid), ['second-fid']);

  const historyRepository = new PlaybackHistoryRepository(path.join(tempDir, 'history'));
  historyRepository.save({ media: { id: 'quark:first-fid', quarkFid: 'first-fid', title: '同名影片' } });
  historyRepository.save({ media: { id: 'quark:second-fid', quarkFid: 'second-fid', title: '同名影片' } });

  const remainingHistory = historyRepository.removeByMediaFid('first-fid');
  assert.deepEqual(remainingHistory.map(entry => entry.media.quarkFid), ['second-fid']);
});
