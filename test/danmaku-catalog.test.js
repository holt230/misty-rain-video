import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DanmakuCatalog, validateWorkId } from '../server/danmaku/catalog.js';
import { DanmakuService } from '../server/danmaku/service.js';
import { DanmakuProviders } from '../server/danmaku/providers.js';
import { parseTencentWorks, parseTencentEpisodes, TencentCatalog } from '../server/danmaku/tencentCatalog.js';

const fixture = JSON.parse(fs.readFileSync('test/fixtures/danmaku/tencent-meirenyu.json', 'utf8'));
const workId = 'qq:2:mzc00200xqdobf5';
const input = { mediaKey: 'meirenyu', title: '美人余', category: 'tv', episodeNumber: 2, episodeTitle: '第2集' };
const response = value => ({ json: () => value });
const directory = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-danmaku-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('主目录未收录美人余时自动找到腾讯真集号，下一集和重启后无需再选作品', async t => {
  const calls = [];
  const request = async url => {
    calls.push(url);
    if (url.includes('360kan')) return response({ code: 0, data: {} });
    if (url.includes('MbSearch')) return response(fixture.search);
    if (url.includes('GetPageData')) return response(fixture.episodes);
    throw Error('unexpected URL');
  };
  const dir = directory(t);
  let service = new DanmakuService(dir, { catalog: new DanmakuCatalog(request), providers: new DanmakuProviders(request) });
  const matched = await service.match('alice', input);
  assert.equal(matched.status, 'matched');
  assert.equal(matched.selected.workId, workId);
  assert.equal(matched.selected.id, 's4102mvt2q0');
  assert.equal(matched.selected.platform, 'qq');
  assert.equal(matched.selected.title, '美人余');
  assert.equal(calls.filter(url => url.includes('MbSearch')).length, 1);
  service = new DanmakuService(dir, { catalog: new DanmakuCatalog(request), providers: new DanmakuProviders(request) });
  const next = await service.match('alice', { ...input, title: '片库中的别名', episodeNumber: 3, episodeTitle: '第3集' });
  assert.equal(next.selected.id, 'k4102osmeu8');
  assert.equal(next.selected.title, '美人余');
  assert.equal(calls.filter(url => url.includes('MbSearch')).length, 1);
});

test('已有主目录结果不触发多余的腾讯请求', async () => {
  const calls = [];
  const catalog = new DanmakuCatalog(async url => {
    calls.push(url);
    return response({ code: 0, data: { longData: { rows: [{ cat_id: '2', en_id: 'ABCdef', titleTxt: '原有电视剧', year: '2026', playlinks: { qq: 'episode' } }] } } });
  });
  assert.equal((await catalog.search('原有电视剧'))[0].id, '2:ABCdef');
  assert.equal(calls.filter(url => url.includes('360kan.com')).length, 1);
  assert.ok(!calls.some(url => url.includes('pbaccess.video.qq.com')), 'Bili discovery does not require redundant Tencent search');
});

test('优酷和爱奇艺正片沿用真实平台，不能被腾讯备用目录替换', async t => {
  for (const platform of ['youku', 'qiyi']) {
    const title = `${platform}平台电视剧`;
    const url = platform === 'youku'
      ? 'https://v.youku.com/v_show/id_XNjU0MjIxOTc4NA==.html'
      : 'https://www.iqiyi.com/v_abc123.html';
    const calls = [];
    const request = async target => {
      calls.push(target);
      if (target.includes('api.so.360kan.com')) return response({ code: 0, data: { longData: { rows: [{ cat_id: '2', en_id: 'ABCdef', titleTxt: title, year: '2026', playlinks: { [platform]: url } }] } } });
      if (target.includes('api.web.360kan.com')) return response({ data: { title, pubdate: '2026', allepidetail: { [platform]: [{ playlink_num: '2', url }] } } });
      if (target.includes('pcw-api.iq.com')) return { bytes: Buffer.from('{"code":"0","data":"1234567890"}') };
      throw Error('不得请求其他平台');
    };
    const service = new DanmakuService(directory(t), { catalog: new DanmakuCatalog(request), providers: new DanmakuProviders(request) });
    const matched = await service.match('alice', { ...input, title });
    assert.equal(matched.selected.platform, platform);
    assert.equal(matched.selected.workId, '2:ABCdef');
    assert.equal(matched.selected.url, url);
    assert.equal(calls.some(target => target.includes('qq.com')), false);
  }
});

test('腾讯搜索聚合的外站链接不能被包装为腾讯作品', () => {
  const item = fixture.search.data.normalList.itemList[0];
  const make = (site, url) => ({
    ret: 0, data: { normalList: { itemList: [{
      ...structuredClone(item),
      videoInfo: { ...item.videoInfo, episodeSites: [{ enName: site, episodeInfoList: [{ id: 's4102mvt2q0', url }] }], playSites: [] }
    }] } }
  });
  assert.equal(parseTencentWorks(make('qiyi', 'https://www.iqiyi.com/v_s4102mvt2q0.html')).length, 0);
  assert.equal(parseTencentWorks(make('qq', 'https://www.iqiyi.com/v_s4102mvt2q0.html')).length, 0);
  assert.equal(parseTencentWorks(make('qq', 'https://v.qq.com/x/cover/mzc00200xqdobf5/f4102i5jti1.html')).length, 0);
  assert.equal(parseTencentWorks(make('qq', 'https://v.qq.com/x/cover/mzc00200xqdobf5/s4102mvt2q0.html')).length, 1);
});

test('近似片名不会挡住备用目录的精确作品，备用失败仍保留原候选', async t => {
  const primary = { code: 0, data: { longData: { rows: [{ cat_id: '2', en_id: 'ABCdef', titleTxt: '美人余原著解说', year: '2026', playlinks: { qq: 'episode' } }] } } };
  const request = async url => response(url.includes('360kan') ? primary : url.includes('MbSearch') ? fixture.search : fixture.episodes);
  const service = new DanmakuService(directory(t), { catalog: new DanmakuCatalog(request) });
  assert.equal((await service.match('alice', input)).selected.workId, workId);
  const fallback = new DanmakuCatalog(async url => {
    if (url.includes('360kan')) return response(primary);
    throw Error('secondary offline');
  });
  assert.equal((await fallback.search('美人余'))[0].id, '2:ABCdef');
});

test('主目录故障可使用备用目录，备用故障不能伪装成没有弹幕', async () => {
  const fallback = new DanmakuCatalog(async url => {
    if (url.includes('360kan')) throw Error('primary offline');
    return response(fixture.search);
  });
  assert.equal((await fallback.search('美人余'))[0].id, workId);
  const failed = new DanmakuCatalog(async url => {
    if (url.includes('360kan')) return response({ code: 0, data: {} });
    throw Error('secondary offline');
  });
  await assert.rejects(failed.search('美人余'), { code: 'DANMAKU_CATALOG_UNAVAILABLE' });
});

test('同名不同年份不会自动猜测；解说短视频和重复卡片不能制造匹配', async t => {
  const item = fixture.search.data.normalList.itemList[0];
  const search = structuredClone(fixture.search);
  search.data.normalList.itemList.push(structuredClone(item));
  search.data.normalList.itemList.push({ ...structuredClone(item), doc: { id: 'a'.repeat(15), dataType: 1 } });
  assert.equal(parseTencentWorks(search).length, 1);
  search.data.normalList.itemList.push({ ...structuredClone(item), doc: { id: 'b'.repeat(15), dataType: 2 }, videoInfo: { ...item.videoInfo, year: 2020 } });
  const service = new DanmakuService(directory(t), { catalog: new DanmakuCatalog(async url => response(url.includes('360kan') ? { code: 0, data: {} } : search)) });
  const result = await service.match('alice', input);
  assert.equal(result.status, 'choose');
  assert.equal(result.selected, null);
  assert.equal(result.candidates.length, 2);
});

test('分集只接收正片的真实数字集号，不把采访预告或别的专辑混入', () => {
  const cid = 'mzc00200xqdobf5';
  const item = (title, extra = {}) => ({ item_params: { cid, title, vid: 's4102mvt2q0', is_trailer: '0', ...extra } });
  const data = { module_list_datas: [{ module_datas: [{ item_data_lists: { item_datas: [
    item('1'), item('3'), item('2', { is_trailer: '1' }), item('采访1'), item('彩蛋1'),
    item('4', { cid: 'other'.padEnd(15, '0') }), item('5', { vid: '../invalid' })
  ] } }] }] };
  assert.deepEqual(parseTencentEpisodes(data, cid).map(episode => episode.number), [1, 3]);
});

test('分页按服务端目录读取，保留缺集并对冲突集号拒绝猜测', async () => {
  const cid = 'mzc00200xqdobf5';
  const context = `cid=${cid}&page_num=1`;
  const page = (entries, tabs = '') => ({ ret: 0, data: { module_list_datas: [{ module_datas: [{ module_params: { tabs }, item_data_lists: { item_datas: entries.map(([number, vid]) => ({ item_params: { cid, title: String(number), play_title: `美人余 第${number}集`, vid, is_trailer: '0' } })) } }] }] } });
  const catalog = new TencentCatalog(async (_url, options) => {
    const selected = JSON.parse(options.body).page_params.page_context;
    return response(selected === context ? page([[3, 'a410253kbt7'], [4, 'h41022rf96u']]) : page([[1, 'f4102i5jti1'], [4, 's4102mvt2q0']], JSON.stringify([{ page_context: context }])));
  });
  const detail = await catalog.details(workId, cid);
  assert.equal(detail.title, '美人余');
  assert.deepEqual(detail.episodes.map(episode => episode.number), [1, 3]);
});

test('备用目录 ID 严格限制为腾讯专辑，异常响应不会作为空成功', () => {
  assert.deepEqual(validateWorkId(workId), { provider: 'qq', category: '2', id: 'mzc00200xqdobf5' });
  for (const id of ['qq:2:../../secret', 'qq:2:https://evil.com', 'qq:3:mzc00200xqdobf5']) assert.throws(() => validateWorkId(id));
  assert.throws(() => parseTencentWorks({ ret: 0, data: {} }), { code: 'DANMAKU_CATALOG_UNAVAILABLE' });
});
