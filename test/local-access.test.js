import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBasePath, handleBasePath } from '../server/basePath.js';
import { localAccessConfig } from '../scripts/local-access-config.mjs';

const response = () => ({ statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, end() { this.ended = true; } });

test('子路径转发保留查询和编码，并设置登录 Cookie 使用的路径前缀', () => {
  const req = { url: '/misty/api/player?url=https%3A%2F%2Fexample.com%2Fa', headers: {} };
  assert.equal(handleBasePath(req, response(), '/misty'), false);
  assert.equal(req.url, '/api/player?url=https%3A%2F%2Fexample.com%2Fa');
  assert.equal(req.headers['x-forwarded-prefix'], '/misty');
});

test('无尾斜杠的入口保留查询参数并跳转到规范路径', () => {
  const res = response();
  assert.equal(handleBasePath({ url: '/misty?webclip=1', headers: {} }, res, '/misty'), true);
  assert.equal(res.statusCode, 308);
  assert.equal(res.headers.Location, '/misty/?webclip=1');
});

test('相似前缀和路径外请求不会落入应用，根健康检查仍可访问', () => {
  for (const url of ['/misty-other/api/auth/login', '/api/auth/login', '/misty/../api/auth/login']) {
    const res = response();
    assert.equal(handleBasePath({ url, headers: {} }, res, '/misty'), true);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(handleBasePath({ url: '/api/health', headers: {} }, response(), '/misty'), false);
  assert.equal(handleBasePath({ url: '/api/auth/login', headers: {} }, response(), ''), false);
});

test('拒绝不合法的部署路径', () => {
  assert.equal(normalizeBasePath('/misty/'), '/misty');
  assert.equal(normalizeBasePath('/'), '');
  for (const value of ['misty', '/a/../misty', '//misty', '/misty?x=1']) {
    assert.throws(() => normalizeBasePath(value));
  }
});

test('固定隧道从 URL 确定子路径，令牌仅通过项目文件读取', () => {
  const config = localAccessConfig({ CLOUDFLARE_TUNNEL_MODE: 'named', APP_PUBLIC_URL: 'https://linlunji.cn/misty' }, '/project/.local-runtime');
  assert.equal(config.basePath, '/misty');
  assert.equal(config.publicUrl, 'https://linlunji.cn/misty/');
  assert.deepEqual(config.args.slice(-3), ['run', '--token-file', '/project/.local-runtime/tunnel-token.txt']);
});

test('拒绝路径不匹配和不安全的固定 URL，默认仍为临时隧道', () => {
  assert.equal(localAccessConfig({}, '/project/.local-runtime').mode, 'quick');
  for (const APP_PUBLIC_URL of ['http://linlunji.cn/misty', 'https://user:password@linlunji.cn/misty', 'https://linlunji.cn/misty?token=123']) {
    assert.throws(() => localAccessConfig({ CLOUDFLARE_TUNNEL_MODE: 'named', APP_PUBLIC_URL }, '/project/.local-runtime'));
  }
  assert.throws(() => localAccessConfig({ CLOUDFLARE_TUNNEL_MODE: 'named', APP_PUBLIC_URL: 'https://linlunji.cn/misty', APP_BASE_PATH: '/other/' }, '/project/.local-runtime'));
});
