import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { QuarkGateway } from '../server/quarkGateway.js';

test('删除影片后，晚到的历史读取和进度回调都不能恢复该记录', async t => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' });
  for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
  const vue = await import('vue');
  const output = path.resolve('node_modules/.cache/history-test/lifecycle.mjs');
  await build({ entryPoints: ['src/composables/usePlaybackHistory.ts'], outfile: output, bundle: true, format: 'esm', external: ['vue'], define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent' });
  const { usePlaybackHistory } = await import(pathToFileURL(output));
  let resolveFetch;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { resolveFetch = resolve; }));
  const enabled = vue.ref(true);
  let state;
  const app = vue.createApp({ setup() { state = usePlaybackHistory(enabled); return () => vue.h('div'); } });
  app.mount(document.querySelector('#app'));
  t.after(() => app.unmount());
  await Promise.resolve(); // The coalesced read starts in a microtask.
  const media = { id: 'quark:deleted', quarkFid: 'deleted', title: '同名影片' };
  const entry = { id: 'history', media, updatedAt: '2026-10-13T00:00:00Z' };
  state.updateLocalHistory(entry);
  state.removeLocalMediaHistory(media);
  resolveFetch(Response.json({ code: 0, data: [entry] }));
  await new Promise(resolve => setImmediate(resolve));
  await vue.nextTick();
  assert.equal(state.history.value.length, 0);
  state.updateLocalHistory(entry);
  assert.equal(state.history.value.length, 0);
  state.updateLocalHistory({ ...entry, id: 'other', media: { ...media, id: 'quark:other', quarkFid: 'other' } });
  assert.equal(state.history.value.length, 1);
});

test('进度写入验证会话所有者和影片，删除会话后拒绝旧请求', t => {
  const gateway = new QuarkGateway({ credentialStore: {} });
  t.after(() => clearInterval(gateway.cleanupTimer));
  gateway.sessions.set('session', { id: 'session', kind: 'drive', driveFid: 'movie', ownerUsername: 'admin', touchedAt: Date.now() });
  gateway.validateHistorySession('session', 'movie');
  assert.throws(() => gateway.validateHistorySession('session', 'other-movie'), error => error.code === 'HISTORY_MEDIA_MISMATCH');
  assert.throws(() => gateway.validateHistorySession('session', 'movie', { username: 'other' }), error => error.statusCode === 403);
  gateway.sessions.delete('session');
  assert.throws(() => gateway.validateHistorySession('session', 'movie'));
});
