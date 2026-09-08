import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localAccessConfig } from './local-access-config.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(project, '.local-runtime');
const socketPath = path.join(runtime, 'control.sock');
const configPath = path.join(runtime, '.env.local');
const logPath = path.join(runtime, 'service.log');
const binary = path.join(runtime, 'cloudflared');
const action = process.argv[2] || 'start';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function control(method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: '/', method, timeout: 1500 }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('本地控制服务响应超时')));
    request.on('error', reject);
    request.end();
  });
}

function display(state) {
  console.log(`本地服务：${state.localReady ? state.localUrl : '正在启动'}`);
  console.log(`${state.tunnelMode === 'named' ? '固定' : '临时'}外网：${state.publicUrl || '正在连接，请稍后运行 status'}`);
  console.log(`登录配置：${configPath}`);
  console.log(`运行日志：${logPath}`);
}

async function serve() {
  process.loadEnvFile(configPath);
  const users = JSON.parse(process.env.APP_USERS_JSON || '[]');
  if (!users.length || users.some(user => !String(user.password || ''))) {
    throw new Error('请在 .local-runtime/.env.local 为每个账号设置非空密码');
  }
  const port = Number(process.env.PORT || 5200);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
  const tunnelConfig = localAccessConfig(process.env, runtime);
  if (tunnelConfig.tokenFile && !fs.readFileSync(tunnelConfig.tokenFile, 'utf8').trim()) {
    throw new Error('固定隧道令牌文件为空');
  }
  process.env.APP_BASE_PATH = `${tunnelConfig.basePath}/`;
  const entry = fs.readFileSync(path.join(project, 'dist', 'index.html'), 'utf8');
  if (!entry.includes(`src="${tunnelConfig.basePath}/assets/`)) {
    throw new Error(`前端资源路径不匹配，请先使用 APP_BASE_PATH=${process.env.APP_BASE_PATH} 构建前端`);
  }
  const localOrigin = `http://127.0.0.1:${port}`;
  const state = { localUrl: `${localOrigin}${tunnelConfig.basePath}/`, localReady: false, publicUrl: '', tunnelMode: tunnelConfig.mode };
  const children = new Set();
  let closing = false;
  const controller = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(state));
    if (request.method === 'POST') void shutdown();
  });
  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    controller.close();
    for (const child of children) child.kill('SIGTERM');
    for (let i = 0; i < 60 && children.size; i++) await sleep(200);
    for (const child of children) child.kill('SIGKILL');
    fs.rmSync(path.join(runtime, 'public-url.txt'), { force: true });
    process.exit(code);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  const launch = (command, args, options = {}) => {
    const child = spawn(command, args, { cwd: project, stdio: ['ignore', 'inherit', 'inherit'], ...options });
    children.add(child);
    child.once('error', error => {
      console.error(error.message);
      children.delete(child);
      void shutdown(1);
    });
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (!closing) {
        console.error(`子进程退出：${path.basename(command)} (${code ?? signal})`);
        void shutdown(1);
      }
    });
    return child;
  };
  await new Promise((resolve, reject) => {
    controller.once('error', reject);
    controller.listen(socketPath, resolve);
  });
  fs.chmodSync(socketPath, 0o600);
  try {
    const app = launch(process.execPath, ['server.js'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' }
    });
    for (let i = 0; i < 60 && !closing; i++) {
      await sleep(250);
      try {
        const response = await fetch(`${localOrigin}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && app.exitCode === null && app.signalCode === null) {
          state.localReady = true;
          break;
        }
      } catch { /* 等待服务监听端口。 */ }
    }
    if (closing) return;
    if (!state.localReady) throw new Error('本地服务启动超时');
    console.log(`本地服务：${state.localUrl}`);
    const tunnelArgs = tunnelConfig.mode === 'named'
      ? tunnelConfig.args
      : [...tunnelConfig.args, '--url', localOrigin];
    const tunnel = launch(binary, tunnelArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const onOutput = chunk => {
      process.stdout.write(chunk);
      tail = (tail + chunk.toString()).slice(-16000);
      const match = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      const publicUrl = tunnelConfig.mode === 'named'
        ? (tail.includes('Registered tunnel connection') ? tunnelConfig.publicUrl : '')
        : (match ? `${match[0]}${tunnelConfig.basePath}/` : '');
      if (publicUrl && state.publicUrl !== publicUrl) {
        state.publicUrl = publicUrl;
        fs.writeFileSync(path.join(runtime, 'public-url.txt'), `${state.publicUrl}\n`, { mode: 0o600 });
      }
    };
    tunnel.stdout.on('data', onOutput);
    tunnel.stderr.on('data', onOutput);
  } catch (error) {
    console.error(error.message);
    await shutdown(1);
  }
}

async function main() {
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  if (action === 'serve') return serve();
  if (!['start', 'stop', 'status'].includes(action)) throw new Error('用法：node scripts/local-access.mjs {start|stop|status}');
  let current;
  try { current = await control(); } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
  }
  if (action === 'status') {
    if (current) display(current);
    else console.log('本地外网服务未运行');
    return;
  }
  if (action === 'stop') {
    if (!current) return console.log('本地外网服务未运行');
    await control('POST');
    for (let i = 0; i < 70; i++) {
      await sleep(200);
      try { await control(); } catch { return console.log('已发送停止指令，服务正在退出'); }
    }
    throw new Error('停止超时，请查看日志');
  }
  if (current) return display(current);
  fs.accessSync(path.join(project, 'dist', 'index.html'));
  fs.accessSync(binary, fs.constants.X_OK);
  if (!fs.existsSync(configPath)) {
    const password = crypto.randomBytes(18).toString('base64url');
    const users = [{ username: 'admin', password, role: 'admin', folder: 'admin' }];
    fs.writeFileSync(configPath, `HOST=127.0.0.1\nPORT=5200\nAPP_USERS_JSON='${JSON.stringify(users)}'\n`, { mode: 0o600, flag: 'wx' });
  }
  fs.rmSync(socketPath, { force: true });
  fs.rmSync(path.join(runtime, 'public-url.txt'), { force: true });
  const log = fs.openSync(logPath, 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
    cwd: project, detached: true, stdio: ['ignore', log, log]
  });
  fs.closeSync(log);
  child.unref();
  child.once('error', error => console.error(error.message));
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`启动失败，请查看 ${logPath}`);
    try {
      current = await control();
      if (current.publicUrl) return display(current);
    } catch { /* 等待后台进程创建控制入口。 */ }
  }
  if (current) display(current);
  else throw new Error(`启动超时，请查看 ${logPath}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
