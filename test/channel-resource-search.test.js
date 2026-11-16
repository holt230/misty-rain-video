import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelResourceSearch, parseChannelResults } from '../server/channelResourceSearch.js';
import { ResourceSearchService } from '../server/resourceSearch.js';

const post = (heading, link, id = 1) => `<div class="tgme_widget_message" data-post="guoman4K/${id}"><div class="tgme_widget_message_text">${heading}<br><br>简介：仅此一条来源的描述<br><a href="${link}">链接</a><br>标签：#国漫</div><time datetime="2026-11-${String(id).padStart(2, '0')}T00:00:00Z"></time></div>`;
const page = (...posts) => `<main class="tgme_channel_history">${posts.join('')}</main>`;
const link = id => `https://pan.quark.cn/s/${id}`;
const empty = () => ({ total: 0, merged_by_type: { quark: [] } });

test('公开消息只保留标题与本条分享，最新同链接去重，EP/SxxExx/话数均识别', () => {
  const rows = parseChannelResults(page(
    post('名称：斗破苍穹（2025）更至EP218', link('same'), 1),
    post('名称：斗破苍穹（2025）更至EP219', link('same'), 2),
    post('斗破苍穹 S01E01 - E220', link('next'), 3),
    post('【已停更】<br>完美世界 更新288话', link('wm'), 4),
    post('其他影片', 'https://pan.quark.cn.evil.example/s/fake', 5)
  ), 'guoman4K');
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.url === link('same')).latest_episode, 219);
  assert.equal(rows.find(row => row.url === link('next')).latest_episode, 220);
  assert.equal(rows.find(row => row.url === link('wm')).latest_episode, 288);
  for (const row of rows) {
    assert.doesNotMatch(row.note, /简介|仅此/);
    assert.equal(row.work_title, undefined);
    assert.equal(row.year, undefined);
    assert.equal(row.category, 'anime');
  }
});

test('公开来源空页面、响应结构改变、超时与非匹配分类分别处理', async () => {
  assert.deepEqual(parseChannelResults(page(), 'guoman4K'), []);
  assert.throws(() => parseChannelResults('<html>sign in</html>', 'guoman4K'), { code: 'RESOURCE_SEARCH_INVALID_RESPONSE' });
  let calls = 0;
  const source = new ChannelResourceSearch({ timeoutMs: 10, fetchImpl: async () => { calls++; return new Promise(() => {}); } });
  assert.equal((await source.search('斗破苍穹', { channel: 'guoman4K', category: 'tv' })).total, 0);
  assert.equal(calls, 0);
  await assert.rejects(source.search('斗破苍穹', { channel: 'guoman4K' }), { code: 'RESOURCE_SEARCH_TIMEOUT' });
  assert.equal(calls, 1);
});

test('默认来源在同一轮并行查原词，全部完成才返回，固定次序并跨来源去重', async () => {
  const calls = [], releases = [];
  const later = (source, keyword, category) => {
    calls.push({ source, keyword, category });
    return new Promise(resolve => releases.push(() => resolve({ total: 1, merged_by_type: { quark: [{ url: link(source === 'guoman4K' ? 'index' : source), note: '斗破苍穹' }] } })));
  };
  const service = new ResourceSearchService({ urls: undefined,
    catalogSearch: { search: (keyword, { category }) => later('index', keyword, category) },
    channelSearch: { search: (keyword, { channel, category }) => later(channel, keyword, category) }
  });
  let completed = false;
  const pending = service.search('斗破苍穹', { category: 'anime' }).then(result => { completed = true; return result; });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.keyword === '斗破苍穹' && call.category === 'anime'));
  releases[2](); releases[1](); await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  releases[0]();
  const result = await pending;
  assert.deepEqual(result.merged_by_type.quark.map(row => row.url), [link('index'), link('Quark_Movies')]);
  assert.equal(result.partial, false);
});

test('默认来源部分失败不回旧结果：有新结果标记不完整，全部无结果明确查询未完成', async () => {
  let found = true;
  const service = new ResourceSearchService({
    catalogSearch: { search: async () => found ? { total: 1, merged_by_type: { quark: [{ url: link('current'), note: '斗破苍穹' }] } } : empty() },
    channelSearch: { search: async () => { throw new Error('network'); } }
  });
  assert.equal((await service.search('斗破苍穹')).partial, true);
  found = false;
  await assert.rejects(service.search('斗破苍穹'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
});
