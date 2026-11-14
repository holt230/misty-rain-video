import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/services/resourceMatching.ts'], bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const { matchResource, rankResourceCandidates, resourceEpisode } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const resource = (title, i) => ({ title, id: String(i), url: 'https://pan.quark.cn/s/test' + i, datetime: '2026-02-25' });
test('截图同名电影与特别篇不会压过动漫年番和更新正篇', () => {
  const notes = ['斗破苍穹3：除恶 (2024)[4K][剧情 动作 奇幻][附前2部]', '斗破苍穹 三年之约.2160p.q',
    '斗破苍穹 特别篇1.2160p.q', '斗破苍穹年番 更新至176集 1080P', '国漫斗破苍穹 4K 更新176集'];
  const results = rankResourceCandidates(notes.map(resource), '斗破苍穹', 'anime');
  assert.deepEqual(results.filter(x => !x.match.otherVersion).map(x => x.resource.title), [notes[4], notes[3]]);
  assert.equal(results.find(x => x.resource.title === notes[0]).match.inferred, 'movie');
});
test('标题后面的小说改编简介不会过滤正片，简介中提到关键词不会冒充同名影片', () => {
  assert.equal(matchResource('斗破苍穹', '斗破苍穹 年番 更新176集 ·📜介绍：改编自天蚕土豆的同名小说。', 'anime').matches, true);
  assert.equal(matchResource('斗破苍穹', '其他动画 4K ·剧情简介：类似斗破苍穹的故事', 'anime').matches, false);
  assert.equal(matchResource('斗破苍穹', '斗破苍穹 4K 壁纸', 'anime').matches, false);
  assert.equal(matchResource('仙逆', '剑仙逆世 第七季', 'anime').matches, false);
});
test('主动搜索特别篇时保留目标版本，未知类别不武断删掉，分类冲突单独标记', () => {
  assert.equal(matchResource('斗破苍穹 三年之约', '斗破苍穹 三年之约 2160P', 'anime').otherVersion, false);
  assert.equal(matchResource('仙逆剧场版', '仙逆剧场版 神临之战 4K', 'anime').matches, true);
  assert.equal(matchResource('斗破苍穹', '斗破苍穹', 'anime').otherVersion, false);
  assert.equal(matchResource('斗破苍穹', '斗破苍穹 真人版 全42集', 'anime').conflict, true);
  assert.equal(matchResource('仙逆', '仙逆剧场版 动画电影', 'movie').conflict, false);
});
test('从实际标题读取219集，支持更新至、集数区间与EP，不把年份和4K当集数', () => {
  for (const title of ['斗破苍穹 更新219集', '斗破苍穹 更新至219', '斗破苍穹 第001-219集', '斗破苍穹 S05E219', '斗破苍穹 EP219']) assert.equal(resourceEpisode(title), 219, title);
  assert.equal(resourceEpisode('斗破苍穹 (2024) 4K 60fps'), 0);
  const result = rankResourceCandidates([resource('斗破苍穹 年番 更新176集 4K',0),resource('斗破苍穹 最新更新219集 1080P',1)],'斗破苍穹','anime');
  assert.match(result[0].resource.title,/219/);
});
