import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { OfficialProgressService } from '../server/officialProgress.js';
import { discoverOfficialPlatforms, officialPlatformUrl, parseYoukuProgress, parseIqiyiWork, parseIqiyiProgress, parseMangoWork, parseMangoProgress, iqiyiVideoId } from '../server/officialPlatforms.js';

const fixture = JSON.parse(fs.readFileSync('test/fixtures/official-progress/platforms.json', 'utf8'));
const candidate = title => discoverOfficialPlatforms(fixture.discovery, title)[0];
const html = data => `<html><script>window.__INITIAL_DATA__ = ${JSON.stringify(data)};</script></html>`;
const compiled = await build({ entryPoints: ['src/services/officialProgress.ts'], bundle: true, write: false, format: 'esm', define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent' });
const { chooseOfficialProgress } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('聚合作品只定位官方入口，不使用聚合总集数作为官方进度', () => {
  const entries = discoverOfficialPlatforms(fixture.discovery, '国色芳华', 'tv');
  assert.equal(entries.length, 1); assert.equal(entries[0].provider, 'hunantv');
  assert.equal(entries[0].url, 'https://www.mgtv.com/b/615428/22328413.html');
  assert.equal(entries[0].latestEpisode, undefined);
  assert.deepEqual(discoverOfficialPlatforms(fixture.discovery, '国色芳华', 'anime'), []);
  assert.deepEqual(discoverOfficialPlatforms(fixture.discovery, '芳华', 'tv'), []);
});

test('三个官方域名和已知路径严格限制，腾讯转跳只解码不执行、不访问外站', () => {
  assert.equal(officialPlatformUrl('https://m.youku.com/alipay_video/id_XNjQ5NzI5MTY0MA==.html', 'youku'), candidate('暗河传').url);
  for (const url of ['https://v.qq.com/search_redirect.html?url=https://evil.example/v_nvusov4apo.html',
    'https://www.iqiyi.com.evil.example/v_nvusov4apo.html', 'https://user@www.iqiyi.com/v_nvusov4apo.html',
    'https://www.iqiyi.com:8443/v_nvusov4apo.html', 'file:///v_nvusov4apo.html', 'https://www.iqiyi.com/a_album.html']) assert.equal(officialPlatformUrl(url, 'qiyi'), undefined);
  assert.equal(officialPlatformUrl('https://v.youku.com/video/id_Xabcd.html', 'hunantv'), undefined);
});

test('优酷已完结电视剧核对38集正片；长篇动漫分页仍用167而非总数169或预告168', () => {
  const tv = parseYoukuProgress(html(fixture.youku), candidate('暗河传'), '暗河传');
  assert.equal(tv.latestEpisode, 38); assert.equal(tv.completed, true); assert.equal(tv.platform, '优酷');
  assert.match(tv.sourceUrl, /XNjUwNTgxMjEyOA==/);
  const anime = parseYoukuProgress(html(fixture.youkuAnime), candidate('师兄啊师兄'), '师兄啊师兄');
  assert.equal(anime.latestEpisode, 167); assert.equal(anime.completed, false);
  const changed = structuredClone(fixture.youkuAnime); changed.moduleList[0].components[0].subtitle = '更新至168/169话';
  assert.throws(() => parseYoukuProgress(html(changed), candidate('师兄啊师兄'), '师兄啊师兄'));
});

test('优酷风控页或错片不能伪装为进度，不执行网页中的JavaScript', () => {
  for (const body of ['<script>window.__INITIAL_DATA__=fetch("https://evil.example")</script>', '<html>请验证</html>']) assert.throws(() => parseYoukuProgress(body, candidate('暗河传'), '暗河传'));
  for (const mutate of [d => d.pageMap.extra.showName = '其他影片', d => d.pageMap.extra.videoId = 'other',
    d => d.moduleList[0].components[0].itemList.at(-1).videoType = '预告', d => d.pageMap.extra.showCategory = '电影']) {
    const data = structuredClone(fixture.youku); mutate(data);
    assert.throws(() => parseYoukuProgress(html(data), candidate('暗河传'), '暗河传'));
  }
});

test('爱奇艺正片ID与专辑相互核对；动漫99集不使用计划104集或预告列表', () => {
  assert.equal(iqiyiVideoId(candidate('唐朝诡事录').url), String(fixture.iqiyiInfo.data.tvId));
  const tv = parseIqiyiWork(fixture.iqiyiInfo, candidate('唐朝诡事录'), '唐朝诡事录');
  assert.equal(parseIqiyiProgress(fixture.iqiyiList, tv).latestEpisode, 36);
  const anime = parseIqiyiWork(fixture.iqiyiAnimeInfo, candidate('大主宰年番'), '大主宰年番');
  assert.equal(anime.year, '2023'); // Discovery incorrectly labels this as 2022.
  const latest = parseIqiyiProgress(fixture.iqiyiAnimeList, anime);
  assert.equal(latest.latestEpisode, 99); assert.equal(latest.completed, false);
  const firstPage = { ...fixture.iqiyiAnimeList, data: { ...fixture.iqiyiAnimeList.data, epsodelist: [] } };
  assert.throws(() => parseIqiyiProgress(firstPage, anime));
});

test('爱奇艺错误专辑、无效正片和伪造剧集URL都不建立进度', () => {
  const work = parseIqiyiWork(fixture.iqiyiInfo, candidate('唐朝诡事录'), '唐朝诡事录');
  for (const mutate of [d => d.data.albumId = 'other', d => d.data.epsodelist.at(-1).contentType = 2,
    d => d.data.epsodelist.at(-1).effective = false, d => d.data.epsodelist.at(-1).playUrl = 'https://evil.example/v_1fwy4mccr9k.html',
    d => d.data.epsodelist.at(-1).tvId = 1234567890]) {
    const data = structuredClone(fixture.iqiyiList); mutate(data); assert.throws(() => parseIqiyiProgress(data, work));
  }
});

test('芒果官方更新32集必须在末页存在正片，彩蛋与预告不能补充集数', () => {
  const work = parseMangoWork(fixture.mangoInfo, candidate('国色芳华'), '国色芳华');
  assert.throws(() => parseMangoProgress(fixture.mangoFirst, work));
  const progress = parseMangoProgress(fixture.mangoLast, work);
  assert.equal(progress.latestEpisode, 32); assert.equal(progress.completed, true); assert.equal(progress.platform, '芒果TV');
  for (const mutate of [d => d.data.list.find(e => e.t1 === '32').isIntact = '0',
    d => d.data.list.find(e => e.t1 === '32').clip_id = 'other', d => d.data.info.title = '其他影片',
    d => d.data.list.find(e => e.t1 === '32').url = 'https://evil.example/video.html']) {
    const data = structuredClone(fixture.mangoLast); mutate(data); assert.throws(() => parseMangoProgress(data, work));
  }
});

test('真实响应贯穿服务，爱奇艺读取第二页、芒果读取末页、优酷读取官方页面，腾讯只定位', async () => {
  const requested = [];
  const service = new OfficialProgressService({ fetchImpl: async input => {
    const url = new URL(input); requested.push(url.href);
    if (url.hostname === 'pbaccess.video.qq.com') return Response.json(fixture.discovery);
    if (url.hostname === 'v.youku.com') return new Response(html(fixture.youku));
    if (url.pathname.includes('/baseinfo/')) return Response.json(fixture.iqiyiAnimeInfo);
    if (url.pathname.endsWith('/avlistinfo')) { assert.equal(url.searchParams.get('page'), '2'); return Response.json(fixture.iqiyiAnimeList); }
    if (url.pathname === '/video/info') return Response.json(fixture.mangoInfo);
    if (url.pathname === '/episode/list') return Response.json(url.searchParams.get('page') === '2' ? fixture.mangoLast : fixture.mangoFirst);
    assert.fail(`Unexpected ${url.hostname}${url.pathname}`);
  } });
  for (const [title, platform, count] of [['暗河传', '优酷', 38], ['大主宰年番', '爱奇艺', 99], ['国色芳华', '芒果TV', 32]]) {
    const data = await service.lookup(title);
    assert.equal(data.status, 'confirmed'); assert.equal(data.works.length, 1);
    assert.equal(data.works[0].platform, platform); assert.equal(data.works[0].latestEpisode, count);
  }
  assert.equal(requested.filter(url => url.includes('MbSearch')).length, 3);
});

test('同版本多平台进度可唯一选择，按已确认最新一集，年份或季数不同仍不能合并', () => {
  const base = { id: 'one', title: '测试剧', category: 'tv', year: '2026', platform: '腾讯视频', latestEpisode: 20 };
  const other = { ...base, id: 'two', platform: '优酷', latestEpisode: 22 };
  const resources = [{ title: '测试剧', workTitle: '测试剧', category: 'tv', year: '2026' }];
  assert.equal(chooseOfficialProgress({ works: [base, other] }, '测试剧', 'tv', resources).id, 'two');
  assert.equal(chooseOfficialProgress({ works: [base, { ...other, year: '2025' }] }, '测试剧', 'tv', [{ ...resources[0], year: undefined }]), undefined);
});

test('单个平台无法访问不清空同轮已确认的平台，也不使用该平台的聚合总集数', async () => {
  const data = structuredClone(fixture.discovery);
  const first = data.data.normalList.itemList.find(row => row.videoInfo.title === '暗河传');
  first.videoInfo.episodeSites.push({ enName: 'qiyi', totalEpisode: 999, episodeInfoList: [{ url: 'https://www.iqiyi.com/v_nvusov4apo.html' }] });
  const service = new OfficialProgressService({ fetchImpl: async input => {
    const url = new URL(input);
    if (url.hostname === 'pbaccess.video.qq.com') return Response.json(data);
    if (url.hostname === 'v.youku.com') return new Response(html(fixture.youku));
    throw new Error('offline');
  } });
  const result = await service.lookup('暗河传');
  assert.equal(result.works.length, 1); assert.equal(result.works[0].latestEpisode, 38); assert.equal(result.works[0].platform, '优酷');
});

test('同批次慢平台触发总期限也保留已经核对成功的平台',async()=>{
 const doupo=JSON.parse(fs.readFileSync('test/fixtures/official-progress/doupo.json','utf8'));
 doupo.data.areaBoxList[0].itemList[0].videoInfo.playSites=[{enName:'youku',episodeInfoList:[{url:candidate('暗河传').url}]}];
 const service=new OfficialProgressService({timeoutMs:20,fetchImpl:async input=>new URL(input).hostname==='pbaccess.video.qq.com'?Response.json(doupo):new Promise(()=>{})});
 const result=await service.lookup('斗破苍穹');
 assert.equal(result.status,'confirmed');assert.equal(result.works.length,1);assert.equal(result.works[0].latestEpisode,219);
});
