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
  assert.equal(document.querySelector('meta').content, '#fcfcfc');
  assert.equal(localStorage.getItem('misty_rain_theme'), 'light');
  const restored = await import(url + '#restore');
  assert.equal(restored.currentTheme.value, 'light');
  theme.setTheme('dark');
  assert.equal(document.documentElement.style.colorScheme, 'dark');
  delete globalThis.document;
  delete globalThis.localStorage;
});

test('显式跟随系统仍响应系统变化，手动选色后不被覆盖', async t => {
  const dom = new JSDOM('<html><head><meta name="theme-color"></head></html>', { url: 'http://localhost/' });
  const media = new EventTarget();
  media.matches = false;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.window = { matchMedia: () => media };
  t.after(() => { delete globalThis.document; delete globalThis.localStorage; delete globalThis.window; });
  localStorage.setItem('misty_rain_theme', 'system');
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


test('首次访问默认暗色，不改写存储或随系统浅色变化', async t => {
  const dom = new JSDOM('<html><head><meta name="theme-color"></head></html>', { url: 'http://localhost/' });
  const media = new EventTarget(); media.matches = false;
  globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage; globalThis.window = { matchMedia: () => media };
  t.after(() => { delete globalThis.document; delete globalThis.localStorage; delete globalThis.window; });
  const theme = await import(url + '#first-dark'); theme.initializeTheme();
  assert.equal(theme.themePreference.value, 'dark'); assert.equal(theme.currentTheme.value, 'dark');
  assert.equal(document.documentElement.dataset.theme, 'dark'); assert.equal(document.querySelector('meta').content, '#08090b');
  assert.equal(localStorage.getItem('misty_rain_theme'), null);
  media.dispatchEvent(new Event('change')); assert.equal(theme.currentTheme.value, 'dark');
});

test('HTML首屏主题与运行时一致，保留显式system/light/dark且存储不可用时暗色', () => {
  const bootstrap = fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [saved, systemDark, expected] of [[null,false,'dark'], ['light',true,'light'], ['dark',false,'dark'], ['system',false,'light'], ['system',true,'dark'], ['unknown',false,'dark']]) {
    const dom = new JSDOM('<html><head><meta name="theme-color" content="#08090b"></head></html>', { url:'http://localhost/', runScripts:'outside-only' });
    dom.window.matchMedia = () => ({ matches:systemDark });
    if (saved !== null) dom.window.localStorage.setItem('misty_rain_theme', saved);
    dom.window.eval(bootstrap);
    assert.equal(dom.window.document.documentElement.dataset.theme, expected);
    assert.equal(dom.window.document.documentElement.style.colorScheme, expected);
    assert.equal(dom.window.document.querySelector('meta').content, expected === 'dark' ? '#08090b' : '#fcfcfc');
    dom.window.close();
  }
  const blocked = new JSDOM('<html><head><meta name="theme-color" content="#08090b"></head></html>', { url:'http://localhost/', runScripts:'outside-only' });
  Object.defineProperty(blocked.window,'localStorage',{get(){throw new Error('blocked');}});
  blocked.window.eval(bootstrap); assert.equal(blocked.window.document.documentElement.dataset.theme,'dark');
  assert.equal(blocked.window.document.documentElement.style.colorScheme,'dark'); blocked.window.close();
});
