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
  'quarktv',
  'quark4k',
  'quarksoo',
  'qupanshe',
  'qupansou',
  'hdr4k',
  'pansearch',
  'jikepan',
  'hunhepan'
].join(',');

const wait = delay => new Promise(resolve => setTimeout(resolve, delay));

const probeHealth = async endpoint => {
  try {
    const response = await fetch(`${endpoint.replace(/\/api\/search$/, '')}/api/health`, {
      signal: AbortSignal.timeout(700)
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const startBundledResourceSearch = async ({ appDir, dataDir, port = 8888 }) => {
  const binaryPath = path.resolve(appDir, 'bin', 'pansou');
  if (!fs.existsSync(binaryPath)) {
    console.warn('[resource-search] 当前镜像未包含内置检索引擎，将使用远端备用源');
    return null;
  }

  let cachePath = path.resolve(dataDir, 'search-cache');
  try {
    fs.mkdirSync(cachePath, { recursive: true });
    fs.accessSync(cachePath, fs.constants.W_OK);
  } catch {
    cachePath = path.resolve('/tmp', 'misty-rain-search-cache');
    fs.mkdirSync(cachePath, { recursive: true });
    console.warn('[resource-search] 数据卷缓存目录不可写，本次运行改用临时缓存');
  }
  const endpoint = `http://127.0.0.1:${port}/api/search`;
  const child = spawn(binaryPath, [], {
    cwd: appDir,
    env: {
      ...process.env,
      PORT: String(port),
      CHANNELS: process.env.RESOURCE_SEARCH_CHANNELS || DEFAULT_CHANNELS,
      ENABLED_PLUGINS: process.env.RESOURCE_SEARCH_PLUGINS || DEFAULT_PLUGINS,
      AUTH_ENABLED: 'false',
      CACHE_ENABLED: 'true',
      CACHE_PATH: cachePath,
      CACHE_MAX_SIZE: process.env.RESOURCE_SEARCH_CACHE_MB || '128',
      CACHE_TTL: process.env.RESOURCE_SEARCH_CACHE_TTL || '120',
      ASYNC_PLUGIN_ENABLED: 'true',
      ASYNC_RESPONSE_TIMEOUT: '5',
      ASYNC_MAX_BACKGROUND_WORKERS: '12',
      ASYNC_MAX_BACKGROUND_TASKS: '60',
      ASYNC_CACHE_TTL_HOURS: '2',
      ENABLE_COMPRESSION: 'true'
    },
    stdio: ['ignore', 'inherit', 'inherit']
  });

  let exited = false;
  child.once('exit', (code, signal) => {
    exited = true;
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[resource-search] 内置检索引擎退出：code=${code ?? '-'} signal=${signal || '-'}`);
    }
  });
  child.once('error', error => {
    console.error(`[resource-search] 内置检索引擎启动失败：${error.message}`);
  });

  let ready = false;
  for (let attempt = 0; attempt < 36 && !exited; attempt += 1) {
    if (await probeHealth(endpoint)) {
      ready = true;
      break;
    }
    await wait(250);
  }

  if (ready) console.log(`[resource-search] 内置检索引擎已就绪：${endpoint}`);
  else console.warn('[resource-search] 内置检索引擎未能及时就绪，将保留远端备用源');

  return {
    endpoint,
    ready,
    stop: () => {
      if (!exited) child.kill('SIGTERM');
    }
  };
};
