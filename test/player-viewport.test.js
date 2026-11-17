import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/services/playerViewport.ts'], bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const { playerViewport } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const base = { width: 402, height: 874, visualWidth: 402, visualHeight: 760,
  safeArea: { top: 62, right: 0, bottom: 34, left: 0 } };
test('iPhone 16 Pro使用真正可见的视口，不把浏览器工具栏后的区域算进画布', () => {
  const v = playerViewport(base);
  assert.equal(v.height, 760); assert.equal(v.width, 402);
  assert.deepEqual(v.insets, { top: 62, right: 0, bottom: 34, left: 0 });
});
test('安全区为0时不猜测固定留白，画布与控件安全区保持独立', () => {
  const v = playerViewport({ ...base, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } });
  assert.deepEqual(v.insets, { top: 0, right: 0, bottom: 0, left: 0 });
});
test('横屏不交换宽高、不从视频中扣除刘海安全区，并跟随视口偏移', () => {
  const v = playerViewport({ ...base, width: 874, height: 402, visualWidth: 874, visualHeight: 350,
    offsetTop: 12, offsetLeft: 3, safeArea: { top: 0, right: 62, bottom: 21, left: 62 } });
  assert.equal(v.width, 874); assert.equal(v.height, 350); assert.equal(v.top, 12); assert.equal(v.left, 3);
  assert.deepEqual(v.insets, { top: 0, right: 62, bottom: 21, left: 62 });
});
test('无视觉视口的浏览器使用窗口尺寸，非法尺寸和安全区不会产生NaN', () => {
  assert.equal(playerViewport({ ...base, visualHeight: undefined }).height, 874);
  const v = playerViewport({ ...base, width: NaN, height: -10, visualWidth: NaN, visualHeight: 0,
    safeArea: { top: NaN, left: -1, right: 0, bottom: Infinity } });
  assert.equal(v.width, 1); assert.equal(v.height, 1);
  assert.deepEqual(v.insets, { top: 0, left: 0, right: 0, bottom: 0 });
});
