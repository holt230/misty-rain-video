import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_CHANNELS = [
  'Quark_Movies',
  'ucquark',
  'yydf_hzl',
  'leoziyuan',
  'Q_dongman',
  'QuarkFree',
  'guoman4K',
  'yunpanquark',
  'Q_dianying',
  'q_dianshiju',
  'kuakedongman',
  'PanjClub',
  'Oscar_4Kmovies'
].join(',');

const DEFAULT_PLUGINS = [
  'erxiaopan',
  'wanou',
  'quarktv',
  'quark4k',
  'quarksoo',
  'pansearch',
  'hunhepan'
].join(',');

const wait = delay => new Promise(resolve => setTimeout(resolve, delay));

export const probeBundledSearch = async (endpoint, { fetchImpl = globalThis.fetch, expectedPlugins = [] } = {}) => {
  try {
    const response = await fetchImpl(`${endpoint.replace(/\/api\/search$/, '')}/api/health`, {
      headers: { 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(700)
    });
    if (!response.ok) return { ready: false, missingPlugins: [] };
    const status = await response.json();
    const plugins = Array.isArray(status.plugins) ? status.plugins.filter(name => typeof name === 'string') : [];
    return {
      ready: status.status === 'ok',
      plugins,
      missingPlugins: expectedPlugins.filter(name => !plugins.includes(name))
    };
  } catch {
    return { ready: false, missingPlugins: [] };
  }
};

export const startBundledResourceSearch = async ({ appDir, dataDir, port = 8888, spawnImpl = spawn, fetchImpl = globalThis.fetch, delay = wait }) => {
  const binaryPath = path.resolve(appDir, 'bin', 'pansou');
  if (!fs.existsSync(binaryPath)) {
    console.warn('[resource-search] 当前运行环境未包含内置检索引擎；未显式配置搜索来源时，搜索会报告不可用');
    return null;
  }

  // Isolate the upgraded engine's cache format and source set from the May build.
  // Keep old files intact so rolling the application image back remains safe.
  let cachePath = path.resolve(dataDir, 'search-cache-v2');
  try {
    fs.mkdirSync(cachePath, { recursive: true });
    fs.accessSync(cachePath, fs.constants.W_OK);
  } catch {
    cachePath = path.resolve('/tmp', 'misty-rain-search-cache-v2');
    fs.mkdirSync(cachePath, { recursive: true });
    console.warn('[resource-search] 数据卷缓存目录不可写，本次运行改用临时缓存');
  }
  const endpoint = `http://127.0.0.1:${port}/api/search`;
  const enabledPlugins = process.env.RESOURCE_SEARCH_PLUGINS || DEFAULT_PLUGINS;
  const expectedPlugins = enabledPlugins.split(',').map(value => value.trim()).filter(Boolean);
  const child = spawnImpl(binaryPath, [], {
    cwd: appDir,
    env: {
      ...process.env,
      PORT: String(port),
      CHANNELS: process.env.RESOURCE_SEARCH_CHANNELS || DEFAULT_CHANNELS,
      ENABLED_PLUGINS: enabledPlugins,
      AUTH_ENABLED: 'false',
      CACHE_ENABLED: 'false',
      CACHE_PATH: cachePath,
      CACHE_MAX_SIZE: process.env.RESOURCE_SEARCH_CACHE_MB || '128',
      CACHE_TTL: process.env.RESOURCE_SEARCH_CACHE_TTL || '120',
      ASYNC_PLUGIN_ENABLED: 'true',
      // This flag also enables plugin search itself. Keep it on, but wait for
      // the current bounded batch and disable cache/background backfill.
      ASYNC_RESPONSE_TIMEOUT: '20',
      PLUGIN_TIMEOUT: '20',
      PLUGIN_BATCH_TIMEOUT_SECONDS: '20',
      PLUGIN_BACKFILL_ENABLED: 'false',
      TG_BACKFILL_ENABLED: 'false',
      ASYNC_MAX_BACKGROUND_WORKERS: '12',
      ASYNC_MAX_BACKGROUND_TASKS: '60',
      ASYNC_CACHE_TTL_HOURS: '2',
      // This engine only serves the app over loopback. Some bundled versions
      // write the uncompressed body before their compression middleware writes
      // it again, yielding concatenated JSON (or JSON followed by gzip bytes).
      ENABLE_COMPRESSION: 'false'
    },
    stdio: ['ignore', 'inherit', 'inherit']
  });

  let exited = false;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.once('exit', (code, signal) => {
    exited = true;
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[resource-search] 内置检索引擎退出：code=${code ?? '-'} signal=${signal || '-'}`);
    }
  });
  child.once('error', error => {
    console.error(`[resource-search] 内置检索引擎启动失败：${error.message}`);
  });

  let health = { ready: false, missingPlugins: [] };
  for (let attempt = 0; attempt < 36 && !exited; attempt += 1) {
    health = await probeBundledSearch(endpoint, { expectedPlugins, fetchImpl });
    if (health.ready) break;
    await delay(250);
  }

  if (health.ready) console.log(`[resource-search] 内置检索引擎已就绪：${endpoint}；插件：${health.plugins.join(',')}`);
  else console.warn('[resource-search] 内置检索引擎未能及时就绪；搜索不会自动改用备用来源');
  if (health.missingPlugins.length) console.error(`[resource-search] 配置的检索插件未加载：${health.missingPlugins.join(',')}，请检查引擎镜像与插件配置`);

  return {
    endpoint,
    ...health,
    stop: async () => {
      if (!exited) child.kill('SIGTERM');
      const timeout = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 3_000);
      try { await closed; } finally { clearTimeout(timeout); }
    }
  };
};
