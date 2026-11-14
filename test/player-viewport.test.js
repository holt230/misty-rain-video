import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/services/playerViewport.ts'], bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const { playerViewport } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const base = { width: 393, height: 808, visualHeight: 764, screenWidth: 393, screenHeight: 852,
  iosStandalone: true, safeArea: { top: 59, right: 0, bottom: 34, left: 0 } };
test('Web Clip较小视觉视口不缩短播放画布，安全区外增加缓冲', () => {
  const v = playerViewport(base);
  assert.equal(v.height, 852); assert.equal(v.width, 393);
  assert.deepEqual(v.insets, { top: 67, right: 0, bottom: 42, left: 0 });
});
test('iPhone安全区暂时返回0时，仍给状态栏与手势区域留出空间', () => {
  const v = playerViewport({ ...base, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } });
  assert.deepEqual(v.insets, { top: 64, right: 0, bottom: 24, left: 0 });
});
test('实际横屏和左右翻转均预留刘海侧，浏览器与桌面不按手机屏幕放大', () => {
  const v = playerViewport({ ...base, width: 852, height: 372, visualHeight: 339, safeArea: { top: 0, right: 44, bottom: 21, left: 59 } });
  assert.equal(v.height, 393);
  assert.deepEqual(v.insets, { top: 12, right: 64, bottom: 29, left: 67 });
  assert.equal(playerViewport({ ...base, iosStandalone: false }).height, 808);
  const split = playerViewport({ ...base, width: 600, screenWidth: 1024, screenHeight: 1366 });
  assert.equal(split.height, 808);
});
