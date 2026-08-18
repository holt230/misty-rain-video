import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiContext, handleApiRequest } from './server/api.js';
import { startBundledResourceSearch } from './server/bundledResourceSearch.js';
import { handleMobileConfigRequest } from './server/mobileConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || '0.0.0.0';
const dataDir = path.resolve(__dirname, 'data');
const distDir = path.resolve(__dirname, 'dist');
const bundledResourceSearch = await startBundledResourceSearch({ appDir: __dirname, dataDir });
if (bundledResourceSearch?.ready) {
  const configuredUrls = String(process.env.RESOURCE_SEARCH_URLS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => value !== bundledResourceSearch.endpoint);
  process.env.RESOURCE_SEARCH_URLS = [bundledResourceSearch.endpoint, ...configuredUrls].join(',');
}
const apiContext = createApiContext({ dataDir });

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const setPageSecurityHeaders = response => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
};

const resolveStaticFile = pathname => {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.resolve(distDir, cleanPath || 'index.html');
  if (candidate !== distDir && !candidate.startsWith(`${distDir}${path.sep}`)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  const indexPath = path.resolve(distDir, 'index.html');
  return fs.existsSync(indexPath) ? indexPath : null;
};

const server = http.createServer(async (request, response) => {
  try {
    if (handleMobileConfigRequest(request, response, { distDir })) return;
    if (await handleApiRequest(request, response, apiContext)) return;
    setPageSecurityHeaders(response);

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const filePath = resolveStaticFile(url.pathname);
    if (!filePath) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('前端资源尚未构建');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.statusCode = 200;
    response.setHeader('Content-Type', mimeTypes[extension] || 'application/octet-stream');
    const isAppEntry = path.basename(filePath) === 'index.html' || extension === '.webmanifest';
    if (isAppEntry) {
      response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('Expires', '0');
    } else {
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('服务暂时不可用');
    } else if (!response.destroyed) {
      response.destroy(error);
    }
  }
});

server.listen(port, host, () => {
  console.log(`[烟雨影视] 服务已启动：http://${host}:${port}`);
});

let isShuttingDown = false;
const shutdown = signal => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[烟雨影视] 收到 ${signal}，正在安全停止服务...`);
  bundledResourceSearch?.stop();
  server.close(error => {
    if (error) {
      console.error('[烟雨影视] 停止服务失败', error);
      process.exitCode = 1;
    }
  });
  setTimeout(() => {
    console.error('[烟雨影视] 等待连接关闭超时，强制退出');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
