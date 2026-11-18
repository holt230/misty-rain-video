import assert from 'node:assert/strict';
import test from 'node:test';
import { QuarkGateway } from '../server/quarkGateway.js';

const shareUrl = 'https://pan.quark.cn/s/pagination123';
const file = (episode, extension = 'mp4') => ({ fid: `ep${episode}`, file_name: `${episode}.${extension}`, file_type: 1, size: 100 });

function setup(t, entries, { cap = 100, repeat = false, emptyPage = 0, metadata = true, hiddenEpisodes = new Set() } = {}) {
  const reads = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/share/sharepage/token')) {
      return Response.json({ code: 0, data: { title: '测试剧', stoken: 'private-token' } });
    }
    assert.equal(init.method, 'GET', 'Directory inspection must not write to the drive');
    assert.ok(url.pathname.endsWith('/share/sharepage/detail'));
    const requested = Number(url.searchParams.get('_page')) || 1;
    const size = Math.min(Number(url.searchParams.get('_size')) || 10, cap);
    const page = repeat ? 1 : requested;
    reads.push({ page: requested, size });
    const list = requested === emptyPage ? [] : entries.slice((page - 1) * size, page * size).filter(item => !hiddenEpisodes.has(Number(item.fid.slice(2))));
    return Response.json({ code: 0, data: { list }, ...(metadata ? { metadata: { _total: entries.length, _size: size, _page: requested } } : {}) });
  });
  const gateway = new QuarkGateway({ credentialStore: { getCookie: () => 'test-cookie' } });
  t.after(() => clearInterval(gateway.cleanupTimer));
  return { gateway, reads };
}

test('40集ZIP目录不被默认每页10条截断', async t => {
  const { gateway, reads } = setup(t, Array.from({ length: 40 }, (_, i) => file(i + 1, 'zip')));
  const details = await gateway.getShareDetails({ shareUrl });
  assert.equal(details.archiveCount, 40);
  assert.deepEqual(details.entries.map(item => item.episodeNumber), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.deepEqual(reads, [{ page: 1, size: 100 }]);
});

test('219集跨三页读取，末页和所需集数均保留', async t => {
  const { gateway, reads } = setup(t, Array.from({ length: 219 }, (_, i) => file(i + 1)));
  const details = await gateway.getShareDetails({ shareUrl });
  assert.equal(details.videoCount, 219);
  assert.equal(details.entries.at(-1).episodeNumber, 219);
  assert.deepEqual(reads.map(item => item.page), [1, 2, 3]);
});

test('上游限制每页10条时依据总数继续读取，不因短页提前结束', async t => {
  const { gateway, reads } = setup(t, Array.from({ length: 25 }, (_, i) => file(i + 1)), { cap: 10 });
  assert.equal((await gateway.getShareDetails({ shareUrl })).videoCount, 25);
  assert.deepEqual(reads.map(item => item.page), [1, 2, 3]);
});

test('上游重复返回第一页时报读取未完成，不把重复文件当作全集', async t => {
  const { gateway } = setup(t, Array.from({ length: 120 }, (_, i) => file(i + 1)), { repeat: true });
  await assert.rejects(gateway.getShareDetails({ shareUrl }), { code: 'QUARK_SHARE_LIST_INCOMPLETE' });
});

test('目录总数包含隐藏文件时读取所有原始分页，只返回实际可访问的视频', async t => {
  const hiddenEpisodes = new Set(Array.from({ length: 110 }, (_, i) => i + 11));
  const { gateway, reads } = setup(t, Array.from({ length: 219 }, (_, i) => file(i + 1)), { hiddenEpisodes });
  const details = await gateway.getShareDetails({ shareUrl });
  assert.equal(details.videoCount, 109);
  assert.equal(details.entries.at(-1).episodeNumber, 219);
  assert.deepEqual(reads.map(item => item.page), [1, 2, 3]);
});

test('整页被夸克隐藏时仍读取后续页，隐藏文件不算作已找到', async t => {
  const { gateway, reads } = setup(t, Array.from({ length: 219 }, (_, i) => file(i + 1)), { emptyPage: 2 });
  const details = await gateway.getShareDetails({ shareUrl });
  assert.equal(details.videoCount, 119);
  assert.deepEqual(reads.map(item => item.page), [1, 2, 3]);
});

test('旧响应没有分页元数据时继续读取整页直到短页', async t => {
  const { gateway, reads } = setup(t, Array.from({ length: 101 }, (_, i) => file(i + 1)), { metadata: false });
  assert.equal((await gateway.getShareDetails({ shareUrl })).videoCount, 101);
  assert.deepEqual(reads.map(item => item.page), [1, 2]);
});
