import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CatalogResourceSearch, parseResourceIndex, parseResourceDetail } from '../server/catalogResourceSearch.js';
import { isExactWorkTitle } from '../server/searchTitles.js';
import { configuredSearchUrls, needsBundledSearch } from '../server/searchConfig.js';
import { ResourceSearchService } from '../server/resourceSearch.js';

const index = fs.readFileSync('test/fixtures/resource-index/doupo-index.html', 'utf8');
const detail = fs.readFileSync('test/fixtures/resource-index/doupo-detail.html', 'utf8');
const html = body => new Response(body, { headers: { 'Content-Type': 'text/html' } });

test('真实六条来源卡片只匹配年番219集，不接受同名电影、衍生剧或简介命中', () => {
  const parsed = parseResourceIndex(index, '斗破苍穹', 'anime');
  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].title, '斗破苍穹年番');
  assert.equal(parsed.matches[0].latestEpisode, 219);
  assert.equal(parsed.matches[0].category, 'anime');
  assert.equal(parseResourceIndex(index, '斗破苍穹', 'tv').matches.length, 0);
  assert.equal(parseResourceIndex(index, '斗破苍穹3：除恶', 'movie').matches[0].title, '斗破苍穹3：除恶');
});

test('完整作品名匹配保留年番与明确季数，不把主演、衍生名和别的作品当作同名', () => {
  for (const title of ['斗破苍穹', '斗破苍穹年番', '斗破苍穹 第二季']) assert.equal(isExactWorkTitle('斗破苍穹', title), true);
  for (const title of ['斗破苍穹3：除恶', '斗破苍穹之少年归来', '斗破苍穹 云韵壁纸', '其他影片：斗破苍穹', '斗破苍穹三年之约']) assert.equal(isExactWorkTitle('斗破苍穹', title), false);
  assert.equal(isExactWorkTitle('斗破苍穹三年之约', '斗破苍穹 三年之约'), true);
});

test('保留独立的作品名、分类、年份和219集原始更新信息，不把下载按钮第1集当更新集数', () => {
  const work = parseResourceIndex(index, '斗破苍穹', 'anime').matches[0];
  const rows = parseResourceDetail(detail, work);
  assert.equal(rows.length, 1); assert.equal(rows[0].work_title, '斗破苍穹年番');
  assert.equal(rows[0].latest_episode, 219); assert.equal(rows[0].update_text, '更新至第219集');
  assert.equal(rows[0].year, '2022'); assert.equal(rows[0].category, 'anime');
  assert.equal(rows[0].note, '斗破苍穹年番');
});

test('只发原词索引和匹配详情两个请求，不等待其余5个不相关详情', async () => {
  const requested = [];
  const search = new CatalogResourceSearch({ fetchImpl: async url => {
    requested.push(url);
    if (url.includes('/vod/search/')) return html(index);
    assert.equal(url, 'https://www.2xiaopan.one/index.php/vod/detail/id/120.html');
    return html(detail);
  } });
  const result = await search.search('斗破苍穹', { category: 'anime' });
  assert.equal(requested.length, 2); assert.ok(requested[0].includes(encodeURIComponent('斗破苍穹')));
  assert.equal(result.total, 1); assert.equal(result.merged_by_type.quark[0].latest_episode, 219);
});

test('明确不同分类或未匹配只查索引，成功空结果不发详情或兜底查询', async () => {
  let calls = 0;
  const search = new CatalogResourceSearch({ fetchImpl: async () => { calls++; return html(index); } });
  assert.equal((await search.search('斗破苍穹', { category: 'tv' })).total, 0);
  assert.equal(calls, 1);
});

test('页面改变、详情错配或失败均不伪装成旧结果，超时受整轮限制', async () => {
  assert.throws(() => parseResourceIndex('<html>challenge</html>', '斗破苍穹'), { code: 'RESOURCE_SEARCH_INVALID_RESPONSE' });
  const work = parseResourceIndex(index, '斗破苍穹').matches[0];
  assert.throws(() => parseResourceDetail(detail.replace('斗破苍穹年番', '别的影片'), work), { code: 'RESOURCE_SEARCH_INVALID_RESPONSE' });
  const search = new CatalogResourceSearch({ timeoutMs: 20, fetchImpl: async () => new Promise(() => {}) });
  await assert.rejects(search.search('斗破苍穹'), { code: 'RESOURCE_SEARCH_TIMEOUT' });
});

test('索引不能把详情抓取转发到外部域名，错误夸克域名不会进入结果', () => {
  const poisoned = index.replace('/index.php/vod/detail/id/120.html', 'https://evil.example/').replace('href="/index.php/vod/detail/id/120.html" title="斗破苍穹年番"', 'href="https://evil.example/" title="斗破苍穹年番"');
  // Replace every source detail link to prevent following the poisoned work URL.
  const blocked = poisoned.replaceAll('href="/index.php/vod/detail/id/120.html"', 'href="https://evil.example/"');
  assert.equal(parseResourceIndex(blocked, '斗破苍穹').matches.length, 0);
  const work = parseResourceIndex(index, '斗破苍穹').matches[0];
  assert.equal(parseResourceDetail(detail.replace('pan.quark.cn', 'pan.quark.cn.evil.example'), work).length, 0);
});

test('旧Compose自带聚合地址自动迁移，管理员自定义地址保持显式选择而非兜底', () => {
  assert.equal(configuredSearchUrls('http://127.0.0.1:8888/api/search,https://so.252035.xyz/api/search'), undefined);
  assert.equal(needsBundledSearch(configuredSearchUrls('http://127.0.0.1:8888/api/search,https://so.252035.xyz/api/search')), false);
  assert.deepEqual(configuredSearchUrls('https://custom.example/search'), ['https://custom.example/search']);
  assert.equal(needsBundledSearch(['http://127.0.0.1:8888/api/search']), true);
  assert.deepEqual(configuredSearchUrls('not-a-url'), []);
});

test('不同类型的在途搜索隔离，默认不启动或请求20秒聚合器', async () => {
  const calls = [];
  const service = new ResourceSearchService({ forumSearch:{search:async()=>({total:0,merged_by_type:{quark:[]}})}, publicFeedSearch: { search: async () => ({ total: 0, merged_by_type: { quark: [] } }) }, channelSearch: { search: async () => ({ total: 0, merged_by_type: { quark: [] } }) }, catalogSearch: { search: async (keyword, options) => { calls.push({ keyword, category: options.category }); return { total: 0, merged_by_type: { quark: [] } }; } } });
  await Promise.all([service.search('斗破苍穹', { category: 'anime' }), service.search('斗破苍穹', { category: 'tv' })]);
  assert.equal(calls.length, 2); assert.deepEqual(calls.map(x => x.category), ['anime', 'tv']);
});
