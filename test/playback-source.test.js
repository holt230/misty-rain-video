import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';
import { JSDOM } from 'jsdom';

const { code } = await transform(fs.readFileSync('src/services/playbackSource.ts', 'utf8'), { loader: 'ts', format: 'esm' });
const { configureVideoRequest, describeNativeAudioTracks, enableOnlyAudioTrack, findStereoAudioTrack,
  playbackSourceLabel, selectInitialPlaybackSource } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const direct = { id: 'dv', resolution: 'dolby_vision', label: '4K', width: 3840, height: 2160, delivery: 'direct', isHls: false };
const hls4k = { ...direct, id: 'hls4k', resolution: '4k', delivery: 'proxy', isHls: true };
const compatible = { ...hls4k, id: 'super', resolution: 'super', label: '超高清', width: 1440, height: 810 };

test('原生直连移除 crossorigin，切回代理/HLS 恢复匿名 CORS', () => {
  const video = new JSDOM('<video crossorigin="anonymous"></video>').window.document.querySelector('video');
  configureVideoRequest(video, direct);
  assert.equal(video.hasAttribute('crossorigin'), false);
  assert.equal(video.crossOrigin, null);
  configureVideoRequest(video, compatible);
  assert.equal(video.crossOrigin, 'anonymous');
  configureVideoRequest(video, { ...direct, isHls: true });
  assert.equal(video.crossOrigin, 'anonymous');
});

test('Safari 原生 HLS 直连不启用 CORS，非原生客户端仍保留 CORS', () => {
  const video = new JSDOM('<video crossorigin="anonymous"></video>').window.document.querySelector('video');
  const native = { ...hls4k, delivery: 'direct' };
  video.canPlayType = () => 'maybe';
  configureVideoRequest(video, native);
  assert.equal(video.hasAttribute('crossorigin'), false);
  video.canPlayType = () => '';
  configureVideoRequest(video, native);
  assert.equal(video.crossOrigin, 'anonymous');
});

test('原生 HLS 设备优先转码直连，旧的杜比视界偏好不会锁定 MKV', () => {
  const native4k = { ...hls4k, delivery: 'direct' };
  const nativeSuper = { ...compatible, delivery: 'direct' };
  const all = [direct, native4k, nativeSuper];
  assert.equal(selectInitialPlaybackSource(all, { mobile: true, preferNativeHls: true, preferred: 'dolby_vision', preferredDelivery: 'direct' }), nativeSuper);
  assert.equal(selectInitialPlaybackSource(all, { preferNativeHls: true, preferred: '4k', preferredDelivery: 'direct' }), native4k);
  assert.equal(selectInitialPlaybackSource([...all, compatible], { preferNativeHls: true, preferred: 'super', preferredDelivery: 'proxy' }), compatible);
});

test('混合直连和 HLS 来源时，旧的超高清偏好不会继续锁定中转', () => {
  for (const mobile of [false, true]) {
    assert.equal(selectInitialPlaybackSource([direct, hls4k, compatible], { preferred: 'super', mobile }), direct);
  }
});

test('直连提供多个画质时，手机仍优先较低开销的超高清', () => {
  const efficient = { ...compatible, delivery: 'direct', isHls: false };
  assert.equal(selectInitialPlaybackSource([direct, efficient], { mobile: true }), efficient);
});

test('用户明确选择的中转画质仍可保留', () => {
  assert.equal(selectInitialPlaybackSource([direct, compatible], { preferred: 'super', preferredDelivery: 'proxy' }), compatible);
});

test('不自动选择格式兼容性未知的原文件，空列表安全返回', () => {
  const original = { ...direct, id: 'original', resolution: 'original', width: 0, height: 0 };
  assert.equal(selectInitialPlaybackSource([hls4k, compatible, original]), compatible);
  assert.equal(selectInitialPlaybackSource([]), undefined);
});

test('两个 4K 选项能够区分杜比视界和中转', () => {
  assert.equal(playbackSourceLabel(direct), '4K 杜比视界 · 直连');
  assert.equal(playbackSourceLabel(hls4k), '4K · 中转');
});

test('原生播放器将同一来源的真实音轨与声道对应，并且只启用选中的立体声', () => {
  const native = [{ id: '2', label: '', language: 'und', enabled: true }, { id: '3', label: '', language: 'und', enabled: false }];
  const metadata = [{ id: '1', channels: '6', codec: 'aac' }, { id: '2', channels: '2', codec: 'aac' }];
  const tracks = describeNativeAudioTracks(native, metadata);
  assert.deepEqual(tracks.map(track => [track.id, track.channels]), [['2', '6'], ['3', '2']]);
  const stereo = findStereoAudioTrack(tracks, 0);
  assert.equal(stereo, 1);
  assert.equal(enableOnlyAudioTrack(native, stereo), true);
  assert.deepEqual(native.map(track => track.enabled), [false, true]);
  assert.equal(enableOnlyAudioTrack(native, 0), true);
  assert.deepEqual(native.map(track => track.enabled), [true, false]);
});

test('音轨清单不一致或立体声属于另一语言时保留当前音轨', () => {
  const metadata = [{ channels: '6', language: 'zh' }, { channels: '2', language: 'en' }];
  assert.equal(findStereoAudioTrack(metadata, 0), -1);
  assert.equal(describeNativeAudioTracks([{ id: '1' }], metadata)[0].channels, '');
  const native = [{ id: '1', language: 'und' }, { id: '2', language: 'und' }];
  assert.equal(findStereoAudioTrack(describeNativeAudioTracks(native, metadata), 0), -1);
});
