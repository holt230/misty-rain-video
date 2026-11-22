// Inspect small byte ranges of a progressive MP4. Only the excluded tracks' box types
// is changed in transit; all sample data, chunk offsets and HTTP byte positions stay valid.
const blockSize = 8192;
const maxReads = 24;
const trackType = Buffer.from('trak');
const unusedType = Buffer.from('free');

function requireLayout(condition) {
  if (!condition) throw new Error('Unsupported MP4 layout');
}

function byteRange(response) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
  if (!match) return null;
  const [start, end, size] = match.slice(1).map(Number);
  return [start, end, size].every(Number.isSafeInteger) && start <= end && end < size ? { start, end, size } : null;
}

function validator(response) {
  return response.headers.get('etag') || response.headers.get('last-modified') || '';
}

const identityEncoding = response => !response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity';

async function readExactly(response, length) {
  const reader = response.body.getReader();
  const buffer = Buffer.alloc(length);
  let position = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      requireLayout(position + value.length <= length);
      buffer.set(value, position);
      position += value.length;
    }
    requireLayout(position === length);
    return buffer;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function descriptor(bytes, start, end, tag) {
  requireLayout(bytes[start++] === tag);
  let size = 0;
  for (let i = 0; i < 4 && start < end; i++) {
    const digit = bytes[start++];
    size = size * 128 + (digit & 127);
    if (!(digit & 128)) {
      requireLayout(start + size <= end);
      return { start, end: start + size };
    }
  }
  throw new Error('Invalid MPEG-4 descriptor');
}

function aacChannels(bytes) {
  const es = descriptor(bytes, 4, bytes.length, 3);
  requireLayout(es.start + 3 <= es.end && !(bytes[es.start + 2] & 0xe0));
  const config = descriptor(bytes, es.start + 3, es.end, 4);
  requireLayout(config.start + 13 <= config.end && bytes[config.start] === 0x40);
  const asc = descriptor(bytes, config.start + 13, config.end, 5);
  requireLayout(asc.start + 2 <= asc.end);
  const bits = bytes.readUInt16BE(asc.start);
  requireLayout((bits >> 11) === 2 && ((bits >> 7) & 15) < 13); // AAC-LC with indexed sample rate.
  return (bits >> 3) & 15;
}

export async function inspectMp4Stereo(fetchRange, signal) {
  const blocks = [];
  let size = 0, revision = '';
  async function read(pos, length) {
    signal.throwIfAborted();
    requireLayout(length > 0 && length <= blockSize && (!size || pos + length <= size));
    const cached = blocks.find(b => b.pos <= pos && pos + length <= b.pos + b.bytes.length);
    if (cached) return cached.bytes.subarray(pos - cached.pos, pos - cached.pos + length);
    requireLayout(blocks.length < maxReads);
    const response = await fetchRange(`bytes=${pos}-${pos + blockSize - 1}`, signal);
    const range = byteRange(response);
    if (response.status !== 206 || !identityEncoding(response) || !range || range.start !== pos
      || range.end !== Math.min(pos + blockSize, range.size) - 1
      || (size && (range.size !== size || validator(response) !== revision))) {
      await response.body?.cancel();
      throw new Error('Inconsistent MP4 byte range');
    }
    size = range.size;
    revision = validator(response);
    const bytes = await readExactly(response, range.end - pos + 1);
    blocks.push({ pos, bytes });
    requireLayout(length <= bytes.length);
    return bytes.subarray(0, length);
  }
  async function boxes(start, end) {
    const found = [];
    while (start < end) {
      requireLayout(found.length < 96 && end - start >= 8);
      const header = await read(start, 8);
      let length = header.readUInt32BE(0), data = start + 8;
      if (length === 1) {
        length = Number((await read(data, 8)).readBigUInt64BE(0));
        data += 8;
      }
      if (!length) length = end - start;
      requireLayout(Number.isSafeInteger(length) && length >= data - start && length <= end - start);
      found.push({ type: header.toString('latin1', 4, 8), start, data, end: start + length });
      start += length;
    }
    return found;
  }
  const one = (items, type) => {
    const matches = items.filter(item => item.type === type);
    requireLayout(matches.length === 1);
    return matches[0];
  };
  const contents = box => boxes(box.data, box.end);
  const field = (box, offset, length) => {
    requireLayout(box.data + offset + length <= box.end);
    return read(box.data + offset, length);
  };
  try {
    await read(0, 8);
    const top = await boxes(0, size);
    requireLayout(top[0]?.type === 'ftyp' && !top.some(b => ['moof', 'sidx'].includes(b.type)));
    const movie = await contents(one(top, 'moov'));
    requireLayout(!movie.some(b => b.type === 'mvex'));
    const tracks = [];
    for (const track of movie.filter(b => b.type === 'trak')) {
      const entries = await contents(track);
      requireLayout(!entries.some(b => b.type === 'tref'));
      const media = await contents(one(entries, 'mdia'));
      const handler = await field(one(media, 'hdlr'), 8, 4);
      if (handler.toString('ascii') !== 'soun') continue;
      const info = await field(one(entries, 'tkhd'), 0, 48);
      const flags = info.readUIntBE(1, 3);
      requireLayout(info[0] <= 1 && (!(flags & 1) || (flags & 3) === 3) && tracks.length < 8);
      const mdhd = one(media, 'mdhd');
      const version = (await field(mdhd, 0, 1))[0];
      requireLayout(version <= 1);
      const language = (await field(mdhd, version ? 32 : 20, 2)).readUInt16BE();
      requireLayout(!media.some(b => b.type === 'elng'));
      tracks.push({ offset: track.start + 4, group: info.readUInt16BE(info[0] ? 46 : 34), language, media, enabled: Boolean(flags & 1) });
    }
    // The provider can include disabled alternates; only the active pair can establish a duplicate.
    const active = tracks.filter(track => track.enabled);
    if (active.length !== 2) return null;
    const [first, second] = active;
    if (!first.group || !second.group || first.group === second.group || first.language !== second.language) return null;
    for (const track of active) {
      const minf = await contents(one(track.media, 'minf'));
      const samples = one(await contents(one(minf, 'stbl')), 'stsd');
      requireLayout((await field(samples, 4, 4)).readUInt32BE() === 1);
      const entry = one(await boxes(samples.data + 8, samples.end), 'mp4a');
      const audioVersion = (await field(entry, 8, 2)).readUInt16BE();
      requireLayout(audioVersion <= 1);
      const extension = await boxes(entry.data + (audioVersion ? 44 : 28), entry.end);
      requireLayout(!extension.some(b => b.type === 'sinf'));
      const esds = one(extension, 'esds');
      track.channels = aacChannels(await field(esds, 0, esds.end - esds.data));
    }
    const surround = active.find(t => t.channels === 6);
    const stereo = active.find(t => t.channels === 2);
    if (!surround || !stereo) return null;
    return { offsets: tracks.filter(track => track !== stereo).map(track => track.offset), size, revision };
  } catch {
    return null;
  }
}

export function stereoResponse(upstream, plan) {
  if (upstream.status !== 200 && upstream.status !== 206) return upstream;
  const range = upstream.status === 206 ? byteRange(upstream) : { start: 0, size: Number(upstream.headers.get('content-length')) };
  if (!identityEncoding(upstream) || range?.size !== plan.size || (plan.revision && validator(upstream) !== plan.revision)) {
    upstream.body?.cancel().catch(() => {});
    throw Object.assign(new Error('播放文件已变化，请重新连接'), { statusCode: 409, code: 'PLAY_SOURCE_CHANGED' });
  }
  let cursor = range.start;
  const body = upstream.body?.pipeThrough(new TransformStream({
    transform(bytes, controller) {
      let output;
      for (const offset of plan.offsets) {
        const from = Math.max(cursor, offset), to = Math.min(cursor + bytes.length, offset + 4);
        if (from >= to) continue;
        output ||= new Uint8Array(bytes);
        for (let pos = from; pos < to; pos++) {
          requireLayout(bytes[pos - cursor] === trackType[pos - offset]);
          output[pos - cursor] = unusedType[pos - offset];
        }
      }
      cursor += bytes.length;
      controller.enqueue(output || bytes);
    }
  }));
  const headers = new Headers(upstream.headers);
  headers.delete('etag');
  headers.delete('last-modified');
  headers.set('cache-control', 'private, no-store');
  return new Response(body, { status: upstream.status, headers });
}
