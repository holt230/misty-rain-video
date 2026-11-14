import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { probeBundledSearch, startBundledResourceSearch } from '../server/bundledResourceSearch.js';

test('HTTP 200 并不足以判定就绪，核对插件实际注册且内部健康检查禁止压缩', async () => {
  const options = { expectedPlugins: ['erxiaopan', 'wanou'], fetchImpl: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8888/api/health');
    assert.equal(init.headers['Accept-Encoding'], 'identity');
    return Response.json({ status: 'ok', plugins: ['wanou'] });
  } };
  assert.deepEqual(await probeBundledSearch('http://127.0.0.1:8888/api/search', options), {
    ready: true, plugins: ['wanou'], missingPlugins: ['erxiaopan']
  });
  const invalid = await probeBundledSearch('http://127.0.0.1:8888/api/search', {
    fetchImpl: async () => new Response('{"status":"ok"}{"status":"ok"}')
  });
  assert.equal(invalid.ready, false);
});

test('新引擎隔离旧缓存、实际启用新插件、停止时等待子进程退出', async t => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-engine-'));
  t.after(() => fs.rmSync(appDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(appDir, 'bin'));
  fs.writeFileSync(path.join(appDir, 'bin', 'pansou'), 'mock binary');
  const dataDir = path.join(appDir, 'data');
  fs.mkdirSync(path.join(dataDir, 'search-cache'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'search-cache', 'old'), 'preserve');
  const child = new EventEmitter();
  const signals = [];
  child.kill = signal => { signals.push(signal); queueMicrotask(() => { child.emit('exit', 0, signal); child.emit('close', 0, signal); }); };
  let launched;
  const previous = process.env.RESOURCE_SEARCH_PLUGINS;
  delete process.env.RESOURCE_SEARCH_PLUGINS;
  t.after(() => { if (previous === undefined) delete process.env.RESOURCE_SEARCH_PLUGINS; else process.env.RESOURCE_SEARCH_PLUGINS = previous; });
  const engine = await startBundledResourceSearch({ appDir, dataDir,
    spawnImpl: (binary, args, options) => { launched = { binary, args, ...options }; return child; },
    fetchImpl: async () => Response.json({ status: 'ok', plugins: launched.env.ENABLED_PLUGINS.split(',') })
  });
  assert.equal(engine.ready, true);
  assert.deepEqual(engine.missingPlugins, []);
  assert.ok(engine.plugins.includes('erxiaopan'));
  assert.equal(launched.env.ENABLE_COMPRESSION, 'false');
  assert.equal(launched.env.CACHE_ENABLED, 'false');
  assert.equal(launched.env.PLUGIN_BACKFILL_ENABLED, 'false');
  assert.equal(launched.env.TG_BACKFILL_ENABLED, 'false');
  assert.equal(launched.env.ASYNC_RESPONSE_TIMEOUT, '20');
  assert.equal(launched.env.ASYNC_PLUGIN_ENABLED, 'true');
  assert.equal(launched.env.CACHE_PATH, path.join(dataDir, 'search-cache-v2'));
  assert.equal(fs.readFileSync(path.join(dataDir, 'search-cache', 'old'), 'utf8'), 'preserve');
  await engine.stop();
  assert.deepEqual(signals, ['SIGTERM']);
});
