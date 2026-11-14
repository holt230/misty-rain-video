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

test('旧搜索缓存接口被拒绝，不能读取旧结果；同样需要登录', async () => {
  const context = makeContext();
  const calls = [];
  context.resourceSearch = {
    search: () => assert.fail('Cached polling must not search upstream'),
    peek: () => assert.fail('Search must not read old results')
  };
  const request = { method: 'GET', url: '/api/resource-search?kw=仙逆&cached=1', headers: { host: 'localhost' } };
  const response = makeResponse();
  await handleApiRequest(request, response, context);
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, 'RESOURCE_SEARCH_CACHE_DISABLED');
  assert.deepEqual(calls, []);
  context.authService.authenticate = () => { throw Object.assign(new Error('login'), { statusCode: 401 }); };
  const denied = makeResponse();
  await handleApiRequest(request, denied, context);
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(calls, []);
});

test('搜索接口等待本次查询，原样传递关键词，返回本次219集结果', async () => {
  const context = makeContext(); let finish;
  context.resourceSearch = { search: keyword => {
    assert.equal(keyword, '斗破苍穹');
    return new Promise(resolve => { finish = resolve; });
  } };
  const response = makeResponse();
  const pending = handleApiRequest({ method: 'GET', url: '/api/resource-search?kw=' + encodeURIComponent('斗破苍穹'), headers: { host: 'localhost' } }, response, context);
  assert.equal(response.body, '');
  finish({ total: 1, merged_by_type: { quark: [{ note: '斗破苍穹 更新219集', url: 'https://pan.quark.cn/s/test219' }] } });
  await pending;
  assert.match(response.body, /219/);
});
