import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { handleApiRequest } from '../server/api.js';

const makeRequest = (url, body) => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
  method: 'POST', url, headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' }
});
const makeResponse = () => ({
  statusCode: 0, headersSent: false, body: '', setHeader() {},
  end(body) { this.body = String(body); this.headersSent = true; }
});

const makeContext = () => {
  let saved = { quarkSelectionFids: ['old-choice'] };
  const calls = [];
  const item = { id: 'quark:media', quarkFid: 'media', title: '测试剧', category: 'tv', poster: '' };
  return {
    calls, saved: () => saved,
    authService: {
      authenticate: () => ({ username: 'admin', folder: 'admin', role: 'admin' }),
      assertSameOrigin: () => calls.push('origin')
    },
    userContext: () => ({
      mediaRepository: {
        all: () => [saved], save: value => { saved = { ...saved, ...value }; }
      },
      libraryViewRepository: { categoryFor: () => null }
    }),
    posterService: { enrich: async cards => cards },
    quarkGateway: {
      listLibrary: async () => [item],
      importShare: async input => { calls.push(input); return { item, transferredCount: 1 }; },
      getShareDetails: async input => { calls.push(input); return { title: '测试资源', entries: [] }; }
    }
  };
};

test('资源详情只允许登录用户读取，并检查请求来源', async () => {
  for (const boundary of ['authenticate', 'assertSameOrigin']) {
    const context = makeContext();
    const response = makeResponse();
    context.authService[boundary] = () => { throw Object.assign(new Error('forbidden'), { statusCode: 403 }); };
    await handleApiRequest(makeRequest('/api/quark/share-details', { shareUrl: 'https://pan.quark.cn/s/test' }), response, context);
    assert.equal(response.statusCode, 403);
    assert.equal(context.calls.some(call => typeof call === 'object'), false);
  }
});

test('详情API传递分享链接和提取码', async () => {
  const context = makeContext();
  const response = makeResponse();
  const input = { shareUrl: 'https://pan.quark.cn/s/test', passcode: '1234' };
  await handleApiRequest(makeRequest('/api/quark/share-details', input), response, context);
  assert.deepEqual(context.calls, ['origin', input]);
  assert.equal(JSON.parse(response.body).data.title, '测试资源');
});

test('选集保存传递并持久化范围，随后全部保存清除旧范围', async () => {
  const context = makeContext();
  const base = { id: 'new', title: '测试剧', category: 'tv', quarkShareUrl: 'https://pan.quark.cn/s/test' };
  await handleApiRequest(makeRequest('/api/media-cards', { ...base, quarkSelectionFids: ['s1', 'e1'] }), makeResponse(), context);
  assert.deepEqual(context.saved().quarkSelectionFids, ['s1', 'e1']);
  assert.deepEqual(context.calls[1].quarkSelectionFids, ['s1', 'e1']);
  await handleApiRequest(makeRequest('/api/media-cards', base), makeResponse(), context);
  assert.equal(context.saved().quarkSelectionFids, undefined);
});

test('搜索补充接口只读现有缓存，不触发上游请求；同样需要登录', async () => {
  const context = makeContext();
  const calls = [];
  context.resourceSearch = {
    search: () => assert.fail('Cached polling must not search upstream'),
    peek: keyword => { calls.push(keyword); return { total: 1, refreshing: true }; }
  };
  const request = { method: 'GET', url: '/api/resource-search?kw=仙逆&cached=1', headers: { host: 'localhost' } };
  const response = makeResponse();
  await handleApiRequest(request, response, context);
  assert.equal(JSON.parse(response.body).data.total, 1);
  assert.deepEqual(calls, ['仙逆']);
  context.authService.authenticate = () => { throw Object.assign(new Error('login'), { statusCode: 401 }); };
  const denied = makeResponse();
  await handleApiRequest(request, denied, context);
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(calls, ['仙逆']);
});

test('批量链接校验使用登录及来源检查，普通账号也可查询但不能绕过认证', async () => {
  const context = makeContext();
  let probes = 0;
  context.shareAvailability = { inspect: async (items, options) => { probes++; assert.equal(items[0].url, 'https://pan.quark.cn/s/test'); assert.equal(options.force, true); return { entries: [], pending: false }; } };
  const body = { items: [{ url: 'https://pan.quark.cn/s/test' }], force: true };
  const success = makeResponse();
  await handleApiRequest(makeRequest('/api/resource-search/validate', body), success, context);
  assert.equal(success.statusCode, 200); assert.equal(probes, 1);
  context.authService.assertSameOrigin = () => { throw Object.assign(new Error('origin'), { statusCode: 403 }); };
  const denied = makeResponse();
  await handleApiRequest(makeRequest('/api/resource-search/validate', body), denied, context);
  assert.equal(denied.statusCode, 403); assert.equal(probes, 1);
});

test('详情失败只有明确取消会加入共享失效缓存，临时故障不删除候选', async () => {
  const context = makeContext();
  const removed = [];
  context.shareAvailability = { markUnavailable: url => removed.push(url) };
  const input = { shareUrl: 'https://pan.quark.cn/s/test' };
  for (const code of ['QUARK_NETWORK_ERROR', 'QUARK_SHARE_PASSCODE_REQUIRED', 'QUARK_SHARE_UNAVAILABLE']) {
    context.quarkGateway.getShareDetails = async () => { throw Object.assign(new Error('failed'), { code, statusCode: 422 }); };
    await handleApiRequest(makeRequest('/api/quark/share-details', input), makeResponse(), context);
  }
  assert.deepEqual(removed, [input.shareUrl]);
});

test('保存时确认分享取消也会记录失效，下一次检索不能恢复链接', async () => {
  const context = makeContext();
  const removed = [];
  context.shareAvailability = { markUnavailable: url => removed.push(url) };
  context.quarkGateway.importShare = async () => { throw Object.assign(new Error('好友已取消了分享'), { code: 'QUARK_SHARE_UNAVAILABLE', statusCode: 422 }); };
  const response = makeResponse();
  await handleApiRequest(makeRequest('/api/library/import', { quarkShareUrl: 'https://pan.quark.cn/s/cancelled' }), response, context);
  assert.equal(response.statusCode, 422);
  assert.deepEqual(removed, ['https://pan.quark.cn/s/cancelled']);
});
