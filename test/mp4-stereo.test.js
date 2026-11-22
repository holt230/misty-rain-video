import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { inspectMp4Stereo, stereoResponse } from '../server/mp4Stereo.js';
import { handleApiRequest } from '../server/api.js';
import { QuarkGateway } from '../server/quarkGateway.js';

function box(type, ...parts) {
  const data = Buffer.concat(parts), header = Buffer.alloc(8);
  header.writeUInt32BE(8 + data.length);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, data]);
}

function audio(channels, { enabled = true, group = channels, language = 21956 } = {}) {
  const tkhd = Buffer.alloc(84), mdhd = Buffer.alloc(24), handler = Buffer.alloc(24), stsd = Buffer.alloc(8);
  tkhd[3] = enabled ? 3 : 2;
  tkhd.writeUInt16BE(group, 34);
  mdhd.writeUInt16BE(language, 20);
  handler.write('soun', 8);
  stsd.writeUInt32BE(1, 4);
  const asc = Buffer.from([5, 2, 0x12, channels << 3]);
  const decoder = Buffer.concat([Buffer.from([4, 17, 0x40]), Buffer.alloc(12), asc]);
  const esds = box('esds', Buffer.alloc(4), Buffer.from([3, 3 + decoder.length, 0, 1, 0]), decoder);
  const entry = box('mp4a', Buffer.alloc(28), esds);
  return box('trak', box('tkhd', tkhd), box('mdia', box('mdhd', mdhd), box('hdlr', handler),
    box('minf', box('stbl', box('stsd', stsd, entry)))));
}

function movie(...audioTracks) {
  const handler = Buffer.alloc(24);
  handler.write('vide', 8);
  return Buffer.concat([box('ftyp', Buffer.from('isom')), box('mdat', Buffer.alloc(10000, 22)),
    box('moov', box('trak', box('mdia', box('hdlr', handler))), ...audioTracks)]);
}

function rangeResponse(bytes, range, { revision = '"sample"', method = 'GET' } = {}) {
  const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', etag: revision };
  let start = 0, end = bytes.length - 1;
  if (range) {
    const [, first, last] = /^bytes=(\d+)-(\d*)$/.exec(range);
    start = Number(first);
    if (last) end = Math.min(Number(last), end);
    headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`;
  }
  headers['content-length'] = String(end - start + 1);
  const body = method === 'HEAD' ? null : bytes.subarray(start, end + 1);
  return new Response(body, { status: range ? 206 : 200, headers });
}

const inspect = bytes => inspectMp4Stereo(r => rangeResponse(bytes, r), AbortSignal.timeout(1000));

test('only same-language AAC stereo + surround tracks that are both on in different groups qualify', async () => {
  const surround = audio(6), stereo = audio(2);
  const bytes = movie(surround, stereo), plan = await inspect(bytes);
  assert.deepEqual(plan.offsets, [bytes.indexOf(surround) + 4]);
  for (const sample of [movie(stereo), movie(surround), movie(stereo, stereo),
    movie(stereo, audio(6, { group: 2 })), movie(stereo, audio(6, { enabled: false })),
    movie(stereo, audio(6, { language: 1 })), movie(stereo, surround, audio(1)),
    Buffer.concat([bytes, box('moof')]), bytes.subarray(0, 48)]) {
    assert.equal(await inspect(sample), null);
  }
  assert.equal(await inspectMp4Stereo(() => new Response(bytes), AbortSignal.timeout(100)), null);
});

test('a surround/stereo pair with disabled alternates keeps only the active stereo, without changing range offsets', async () => {
  const surround = audio(6, { group: 1 });
  const inactive = [audio(2, { group: 2, enabled: false }), audio(2, { group: 3, enabled: false })];
  const bytes = movie(surround, ...inactive, audio(2, { group: 4 })), plan = await inspect(bytes);
  assert.deepEqual(plan.offsets, [surround, ...inactive].map(track => bytes.indexOf(track) + 4));
  const expected = Buffer.from(bytes);
  for (const offset of plan.offsets) expected.write('free', offset);
  const splits = [0, ...plan.offsets.flatMap(offset => [offset + 1, offset + 3]), bytes.length];
  const pieces = [];
  for (let i = 1; i < splits.length; i++) {
    const start = splits[i - 1], end = splits[i] - 1;
    const res = stereoResponse(rangeResponse(bytes, `bytes=${start}-${end}`), plan);
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-length'), String(end - start + 1));
    assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
    assert.equal(res.headers.has('etag'), false);
    pieces.push(Buffer.from(await res.arrayBuffer()));
  }
  assert.deepEqual(Buffer.concat(pieces), expected);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 1; i < splits.length; i++) controller.enqueue(bytes.subarray(splits[i - 1], splits[i]));
      controller.close();
    }
  });
  const transformed = stereoResponse(new Response(stream, { headers: rangeResponse(bytes).headers }), plan);
  assert.deepEqual(Buffer.from(await transformed.arrayBuffer()), expected);
  assert.equal(await inspect(expected), null);
  assert.throws(() => stereoResponse(rangeResponse(bytes, null, { revision: '"different"' }), plan), { code: 'PLAY_SOURCE_CHANGED' });
});

test('normal playback stays direct, only a confirmed session can serve the isolated stream, cached probes coalesce', async t => {
  const gateway = new QuarkGateway({ credentialStore: {} });
  const sessions = gateway.sessions;
  const insert = (id, owner, bytes) => {
    const src = { id: 'source', upstreamUrl: `https://media.example.test/${id}.mp4`, savedFid: id,
      delivery: 'direct', directOnly: true, resolvedAt: Date.now(), mimeType: 'video/mp4', isHls: false };
    sessions.set(id, { id, ownerUsername: owner, sources: new Map([['source', src]]), touchedAt: Date.now() });
    return bytes;
  };
  const bytes = insert('double', 'admin', movie(audio(6), audio(2)));
  const healthy = insert('single', 'admin', movie(audio(2)));
  let calls = 0;
  gateway.fetchMedia = async (url, range, profile, cookie, options = {}) => {
    calls++;
    return rangeResponse(url.includes('double') ? bytes : healthy, range, options);
  };
  const server = http.createServer((request, response) => handleApiRequest(request, response, {
    authService: { authenticate: () => ({ username: request.headers['x-user'] || 'admin' }), assertSameOrigin() {} },
    userContext: () => ({}), quarkGateway: gateway
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); clearInterval(gateway.cleanupTimer); });
  const url = 'http://127.0.0.1:' + server.address().port + '/api/player/sessions/';
  const stream = (id, suffix = '', options = {}) => fetch(url + id + '/streams/source' + suffix, { redirect: 'manual', ...options });
  assert.equal((await stream('double')).status, 302);
  assert.equal(calls, 0);
  assert.equal((await stream('double', '?audio=stereo')).status, 409);
  assert.equal((await stream('double', '/stereo', { method: 'POST', headers: { 'x-user': 'other' } })).status, 403);
  const probe = async id => (await (await stream(id, '/stereo', { method: 'POST' })).json()).data.available;
  assert.deepEqual(await Promise.all([probe('double'), probe('double')]), [true, true]);
  const afterProbe = calls;
  assert.equal(await probe('double'), true);
  assert.equal(calls, afterProbe);
  const head = await stream('double', '?audio=stereo', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  const out = await stream('double', '?audio=stereo', { headers: { Range: 'bytes=0-' } });
  assert.equal(out.status, 206);
  assert.equal(await inspect(Buffer.from(await out.arrayBuffer())), null);
  assert.equal((await stream('double')).status, 302);
  assert.equal(await probe('single'), false);
  assert.equal((await stream('single')).status, 302);
});
