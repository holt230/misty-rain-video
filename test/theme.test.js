import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync('src/services/theme.ts', 'utf8').replace("from 'vue'", `from ${JSON.stringify(import.meta.resolve('vue'))}`);
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

test('主题切换改变文档与浏览器主题色，并从存储恢复', async () => {
  const dom = new JSDOM('<html><head><meta name="theme-color"></head></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const theme = await import(url);
  theme.setTheme('light');
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.querySelector('meta').content, '#f4f6fa');
  assert.equal(localStorage.getItem('misty_rain_theme'), 'light');
  const restored = await import(url + '#restore');
  assert.equal(restored.currentTheme.value, 'light');
  theme.setTheme('dark');
  assert.equal(document.documentElement.style.colorScheme, 'dark');
  delete globalThis.document;
  delete globalThis.localStorage;
});

test('默认跟随系统变化，手动选色后不被系统变化覆盖', async t => {
  const dom = new JSDOM('<html><head><meta name="theme-color"></head></html>', { url: 'http://localhost/' });
  const media = new EventTarget();
  media.matches = false;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.window = { matchMedia: () => media };
  t.after(() => { delete globalThis.document; delete globalThis.localStorage; delete globalThis.window; });
  const theme = await import(url + '#system');
  theme.initializeTheme();
  assert.equal(theme.themePreference.value, 'system');
  assert.equal(theme.currentTheme.value, 'light');
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.equal(document.documentElement.dataset.theme, 'dark');
  theme.setTheme('light');
  media.dispatchEvent(new Event('change'));
  assert.equal(document.documentElement.dataset.theme, 'light');
  theme.setTheme('system');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(localStorage.getItem('misty_rain_theme'), 'system');
});

test('横屏锁定黑色浏览器底色，主题变化和多播放器释放后恢复最新偏好', async t => {
  const dom = new JSDOM('<html><head><meta name="theme-color"></head></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  t.after(() => { dom.window.close(); delete globalThis.document; delete globalThis.localStorage; });
  const theme = await import(url + '#playback');
  theme.setTheme('light');
  const first = theme.acquirePlaybackChrome();
  assert.equal(document.documentElement.classList.contains('immersive-playback'), true);
  assert.equal(document.documentElement.style.colorScheme, 'dark');
  assert.equal(document.querySelector('meta').content, '#000000');
  assert.equal(theme.currentTheme.value, 'light');
  assert.equal(localStorage.getItem('misty_rain_theme'), 'light');
  const second = theme.acquirePlaybackChrome();
  first(); first();
  assert.equal(document.querySelector('meta').content, '#000000');
  theme.setTheme('dark');
  theme.setTheme('light');
  assert.equal(document.documentElement.style.colorScheme, 'dark');
  second();
  assert.equal(document.documentElement.classList.contains('immersive-playback'), false);
  assert.equal(document.documentElement.style.colorScheme, 'light');
  assert.equal(document.querySelector('meta').content, '#f4f6fa');
});
