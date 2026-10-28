import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbeddedSubtitleReader, parseSubtitleIndex } from '../server/embeddedSubtitles.js';
import { mp4Fixture } from './fixtures/embedded-mp4.js';

const rangeFixture = buffer => {
  const ranges = [];
  const read = async range => {
    const [start, requestedEnd] = range.slice(6).split('-').map(Number), end = Math.min(buffer.length - 1, requestedEnd);
    ranges.push([start, end]);
    return new Response(buffer.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${buffer.length}` } });
  };
  return { read, ranges };
};

test('reads MP4 tx3g text/timing/language from exact ranges, reuses metadata and cached windows', async () => {
  const fixture = rangeFixture(mp4Fixture()), reader = new EmbeddedSubtitleReader(fixture.read);
  const first = await reader.read(2);
  assert.equal(first.tracks[0].language, 'zh');
  assert.deepEqual(first.tracks[0].cues[0], { start: 1, end: 4, text: '你好，世界' });
  assert.equal(first.tracks[0].cues.length, 2);
  const calls = fixture.ranges.length;
  assert.strictEqual(await reader.read(50), first); assert.equal(fixture.ranges.length, calls);
  const second = await reader.read(95);
  assert.deepEqual(second.tracks[0].cues, [{ start: 4, end: 99, text: '下一段' }]);
  assert.equal(fixture.ranges.length, calls + 1, 'no second metadata download');
});

test('finds trailing moov without reading mdat and supports 64-bit offsets and delayed edit lists', async () => {
  const fixture = rangeFixture(mp4Fixture({ tailMoov: true, co64: true, shift: 5000 }));
  const result = await new EmbeddedSubtitleReader(fixture.read).read(0);
  assert.equal(result.tracks[0].cues[0].start, 6);
  assert.ok(fixture.ranges.every(([a,b]) => b-a < 1024));
});

test('unsupported image/XML subtitles are not advertised as readable text', async () => {
  const fixture = rangeFixture(mp4Fixture({ codec: 'stpp' }));
  const result = await new EmbeddedSubtitleReader(fixture.read).read(0);
  assert.deepEqual(result.tracks, []);
});

test('servers ignoring Range are canceled instead of downloading a complete video', async () => {
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  const reader = new EmbeddedSubtitleReader(async () => new Response(body));
  await assert.rejects(reader.read(0), { code: 'EMBEDDED_SUBTITLE_UNAVAILABLE' });
  assert.equal(canceled, true);
});

test('invalid sample tables, oversized moov and invalid times fail within bounded reads', async () => {
  const corrupt = mp4Fixture(); const stsz = corrupt.indexOf('stsz'); corrupt.writeUInt32BE(0xffffffff, stsz + 12);
  assert.throws(() => parseSubtitleIndex(corrupt), { code: 'EMBEDDED_SUBTITLE_UNAVAILABLE' });
  const huge = Buffer.alloc(16); huge.writeUInt32BE(20*1024*1024); huge.write('moov',4); let calls = 0;
  const reader = new EmbeddedSubtitleReader(async () => { calls++; return new Response(huge,{status:206,headers:{'Content-Range':'bytes 0-15/20971520'}}); });
  await assert.rejects(reader.read(0)); assert.equal(calls,1);
  for (const time of [-1,NaN,Infinity,172801]) await assert.rejects(reader.read(time));
  assert.equal(calls,1);
});

test('aborted requests and a failed load can be retried without poisoning the cache', async () => {
  const fixture=rangeFixture(mp4Fixture()); let fail=true;
  const reader=new EmbeddedSubtitleReader(async (...args)=>{if(fail)throw new Error('network');return fixture.read(...args)});
  await assert.rejects(reader.read(0)); fail=false;
  assert.equal((await reader.read(0)).tracks.length,1);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(reader.read(95,stopped.signal));
});
