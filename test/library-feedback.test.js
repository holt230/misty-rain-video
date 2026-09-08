import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLibraryInput, getLibrarySaveFeedback, LibrarySaveError } from '../src/services/libraryFeedback.ts';

test('分享文案和回车识别为链接，并保留提取码', () => {
  assert.deepEqual(parseLibraryInput('分享:HTTPS://pan.quark.cn/s/abc123?pwd=a1b2'), {
    kind: 'share', url: 'https://pan.quark.cn/s/abc123', passcode: 'a1b2'
  });
  assert.deepEqual(parseLibraryInput('我分享了「影片」\n链接：https://pan.quark.cn/s/abc123/\n提取码：A123'), {
    kind: 'share', url: 'https://pan.quark.cn/s/abc123', passcode: 'A123'
  });
  assert.equal(parseLibraryInput('pan.quark.cn/s/abc123').kind, 'share');
  assert.equal(parseLibraryInput('https://pan.quark.cn/s/abc123#list/share').kind, 'share');
});

test('不完整、其他网盘及相似域名不得误转存或作为片名检索', () => {
  for (const value of ['https://pan.quark.cn/s/', 'https://pan.baidu.com/s/abc', 'https://evilpan.quark.cn/s/abc', 'https://pan.quark.cn.evil.test/s/abc', 'https://pan.quark.cn/s/abc/unknown']) {
    assert.equal(parseLibraryInput(value).kind, 'invalid', value);
  }
  assert.deepEqual(parseLibraryInput('  我的阿勒泰  '), { kind: 'search', keyword: '我的阿勒泰' });
});

test('失效链接、提取码、认证与网络失败提供不同恢复路径', () => {
  assert.match(getLibrarySaveFeedback(new LibrarySaveError('取消了分享', 'QUARK_SHARE_UNAVAILABLE')).message, /更换/);
  assert.match(getLibrarySaveFeedback(new LibrarySaveError('提取码错误', 'QUARK_SHARE_UNAVAILABLE')).title, /提取码/);
  assert.equal(getLibrarySaveFeedback(new LibrarySaveError('认证失败', 'QUARK_AUTH_REQUIRED')).needsAuth, true);
  assert.match(getLibrarySaveFeedback(new TypeError('Failed to fetch')).message, /确认是否已添加成功/);
  assert.match(getLibrarySaveFeedback(new LibrarySaveError('空目录', 'QUARK_SHARE_EMPTY')).title, /没有可播放/);
  assert.equal(getLibrarySaveFeedback(new Error('网盘空间不足')).message, '网盘空间不足');
});
