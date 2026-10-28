import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceSearchKeyword, resourceTitleRelevance } from '../server/searchTitle.js';
import { ResourceSearchService } from '../server/resourceSearch.js';
import { validateSourceCandidate } from '../server/libraryPolicy.js';

test('partial titles, punctuation and separated fragments match; exact titles rank above partials', () => {
  for (const [query, title] of [['庆余', '庆余年 第二季 4K'], ['闹鬼 酒店', '闹鬼酒店 第二季'],
    ['《兰 香 · 如 故》', '兰香如故 1080P'], ['酒店', '酒店风云'], ['酒店', '闹鬼酒店 第二季'], ['权力 游戏', '权力的游戏 第三季'],
    ['doctor who', 'Doctor Who S02 WEB-DL']]) assert.ok(resourceTitleRelevance(query, title) > 0, `${query} / ${title}`);
  assert.ok(resourceTitleRelevance('兰香如故', '兰香如故') > resourceTitleRelevance('兰香如故', '兰香如故 前传'));
  for (const [query, title] of [['仙逆', '剑仙逆世'], ['仙', '仙逆'], ['who', 'whole story'], ['兰香如故', '其他电视剧']])
    assert.equal(resourceTitleRelevance(query, title), 0);
});

test('season spelling is tolerant while an explicitly different season is excluded', () => {
  for (const title of ['庆余年 S02 4K', '庆余年 第二季 全集', '庆余年 season 2'])
    assert.ok(resourceTitleRelevance('庆余年 第 2 季', title) > 0);
  assert.equal(resourceTitleRelevance('庆余年 第二季', '庆余年 第一季'), 0);
  assert.equal(resourceTitleRelevance('Doctor Who S02', 'Doctor Who S03'), 0);
  assert.ok(resourceTitleRelevance('庆余年 第二季', '庆余年 第一季 第二季 合集') > 0);
  assert.equal(resourceSearchKeyword('《闹 鬼 · 酒 店》第 二 季'), '闹鬼酒店');
  assert.equal(resourceSearchKeyword('Doctor Who Season 2'), 'doctor who');
  // Loose user-facing results cannot loosen unattended resource replacement.
  assert.equal(validateSourceCandidate({ card: { title: '庆余年 第二季', category: 'tv' }, shareTitle: '庆余年 前传',
    episodes: [{ fileName: 'E01.mkv', episodeNumber: 1 }], localEpisodes: [{ episodeNumber: 1 }] }), false);
});

test('provider receives one normalized query per channel with existing timeout and request coalescing', async () => {
  const calls = [];
  const service = new ResourceSearchService({ urls: ['https://public.test/api/search'], source: 'all', aggregationMs: 0,
    timeoutMs: 100, completionTimeoutMs: 100, fetchImpl: async (url, options) => {
      calls.push(url.searchParams.get('kw')); assert.ok(options.signal);
      return Response.json({ total: 1, merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/season2', note: '庆余年 S02' }] } });
    } });
  const [first, duplicate] = await Promise.all([service.search('庆 余 年 第二季'), service.search('庆 余 年 第二季')]);
  assert.deepEqual(first, duplicate); assert.deepEqual(calls, ['庆余年']);
  await service.search('庆 余 年 第二季'); assert.equal(calls.length, 1);
});
