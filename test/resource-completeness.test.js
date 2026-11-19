import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/services/resourceCompleteness.ts'], bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const { resourceCompleteness } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const entry = n => ({ fid: String(n), name: `第${n}集.mp4`, isVideo: true, episodeNumber: n, size: 100 });
const details = entries => ({ title: '斗破苍穹年番', videoCount: entries.length, entries });
test('来源标记全219但实际仅1集或7集时不能当作全集', () => {
  const one = resourceCompleteness(details([entry(219)]), 'anime', 219);
  assert.equal(one.complete, false); assert.equal(one.available, 1); assert.equal(one.missing.length, 218);
  const seven = resourceCompleteness(details(Array.from({ length: 7 }, (_, i) => entry(213 + i))), 'anime', 219);
  assert.equal(seven.complete, false); assert.equal(seven.missing.length, 212);
});
test('真实1至219连续齐全才通过；重复画质和预告不能填补缺集', () => {
  const entries = Array.from({ length: 219 }, (_, i) => entry(i + 1));
  const full = resourceCompleteness(details(entries), 'anime', 219);
  assert.equal(full.complete, true); assert.equal(full.actualLatest, 219); assert.equal(full.selectedFids.length, 219);
  const partial = resourceCompleteness(details([...entries.filter(x => x.episodeNumber !== 120), { ...entry(119), fid: 'alternate' }, { ...entry(120), name: '第120集 预告.mp4' }]), 'anime', 219);
  assert.equal(partial.complete, false); assert.deepEqual(partial.missing, [120]);
});
test('文件已更新220集时按实际目录确认，不能让过期索引压低结果', () => {
  const full = resourceCompleteness(details(Array.from({ length: 220 }, (_, i) => entry(i + 1))), 'anime', 219);
  assert.equal(full.complete, true); assert.equal(full.actualLatest, 220);
});
test('不知道来源应有集数时不能把目录仅有的一集宣称成最新全集', () => {
  const unknown = resourceCompleteness(details([entry(1)]), 'anime', 0);
  assert.equal(unknown.complete, false); assert.match(unknown.reason, /无法确认/);
});

test('同集优先选文件实际所在的 SDR 发行分组，仍按实际文件核对缺集', () => {
  const video = (n, fid, folder, size) => ({ ...entry(n), fid, ancestorFids: [folder], size });
  const result = resourceCompleteness(details([
    { fid: 'dv', name: '4K 杜比视界', isDirectory: true },
    { fid: 'sdr', name: '1080p SDR', isDirectory: true },
    video(1, 'one-dv', 'dv', 300), video(1, 'one-sdr', 'sdr', 200),
    video(2, 'two-dv', 'dv', 240)
  ]), 'tv', 3);
  assert.deepEqual(result.selectedFids, ['one-sdr', 'two-dv']);
  assert.equal(result.colorFormat, 'dolby-vision');
  assert.deepEqual(result.missing, [3]);
  assert.equal(result.complete, false);
});
