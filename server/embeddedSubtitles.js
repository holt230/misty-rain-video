// Read only MP4 metadata and the text samples near the playhead. Never download
// or transcode the movie to discover captions (some files are several GB).
const MAX_METADATA = 12 * 1024 * 1024;
const MAX_SAMPLES = 30_000;
const WINDOW_SECONDS = 90;
const fail = () => Object.assign(new Error('当前视频的内嵌字幕暂时无法读取'), { code: 'EMBEDDED_SUBTITLE_UNAVAILABLE', statusCode: 422 });
const valid = value => { if (!value) throw fail(); };
const integer = value => { valid(Number.isSafeInteger(value) && value >= 0); return value; };
let activeReads = 0;
const waiting = [];
async function withReadSlot(task, signal) {
  signal?.throwIfAborted();
  if (activeReads >= 2) {
    valid(waiting.length < 8);
    await new Promise((resolve, reject) => {
      const entry = { resolve: () => { signal?.removeEventListener('abort', abort); resolve(); } };
      const abort = () => { const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); reject(signal.reason); };
      waiting.push(entry); signal?.addEventListener('abort', abort, { once: true });
    });
  } else activeReads++;
  try { signal?.throwIfAborted(); return await task(); }
  finally { const next = waiting.shift(); if (next) next.resolve(); else activeReads--; }
}

function boxes(buffer, start = 0, end = buffer.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    valid(offset + 8 <= end);
    let size = buffer.readUInt32BE(offset), header = 8;
    if (size === 1) { valid(offset + 16 <= end); size = integer(Number(buffer.readBigUInt64BE(offset + 8))); header = 16; }
    if (size === 0) size = end - offset;
    valid(size >= header && offset + size <= end);
    result.push({ type: buffer.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}
const child = (buffer, box, type) => boxes(buffer, box.start, box.end).find(item => item.type === type);
const required = (buffer, box, type) => { const item = child(buffer, box, type); valid(item); return item; };
const bytes = (box, count) => valid(box.end - box.start >= count);
function table(buffer, box, width, limit = MAX_SAMPLES) {
  bytes(box, 8);
  const count = buffer.readUInt32BE(box.start + 4);
  valid(count <= limit && box.start + 8 + count * width <= box.end);
  return Array.from({ length: count }, (_, index) => box.start + 8 + index * width);
}

export function parseSubtitleIndex(buffer) {
  const moov = boxes(buffer).find(box => box.type === 'moov'); valid(moov);
  const mvhd = required(buffer, moov, 'mvhd'); bytes(mvhd, 24);
  const movieScale = buffer.readUInt32BE(mvhd.start + (buffer[mvhd.start] === 1 ? 20 : 12)); valid(movieScale);
  const tracks = [];
  for (const trak of boxes(buffer, moov.start, moov.end).filter(box => box.type === 'trak')) {
    const mdia = required(buffer, trak, 'mdia'), hdlr = required(buffer, mdia, 'hdlr'); bytes(hdlr, 12);
    if (!['sbtl', 'subt', 'text'].includes(buffer.toString('ascii', hdlr.start + 8, hdlr.start + 12))) continue;
    const stbl = required(buffer, required(buffer, mdia, 'minf'), 'stbl');
    const stsd = required(buffer, stbl, 'stsd'); bytes(stsd, 8);
    const descriptions = boxes(buffer, stsd.start + 8, stsd.end);
    if (descriptions.length !== 1 || descriptions[0].type !== 'tx3g') continue;
    const mdhd = required(buffer, mdia, 'mdhd'), version = buffer[mdhd.start];
    valid(version <= 1); bytes(mdhd, version === 1 ? 36 : 24);
    const scale = buffer.readUInt32BE(mdhd.start + (version === 1 ? 20 : 12)); valid(scale);
    const languageCode = buffer.readUInt16BE(mdhd.start + (version === 1 ? 32 : 20));
    const language = [10, 5, 0].map(shift => String.fromCharCode(((languageCode >> shift) & 31) + 96)).join('');
    let shift = 0;
    const edts = child(buffer, trak, 'edts'), elst = edts && child(buffer, edts, 'elst');
    if (elst) {
      const v = buffer[elst.start]; valid(v <= 1);
      const entries = table(buffer, elst, v === 1 ? 20 : 12, 2); let mediaEdits = 0;
      for (const p of entries) {
        const duration = v === 1 ? integer(Number(buffer.readBigUInt64BE(p))) : buffer.readUInt32BE(p);
        const mediaTime = v === 1 ? Number(buffer.readBigInt64BE(p + 8)) : buffer.readInt32BE(p + 4);
        valid(Number.isSafeInteger(mediaTime) && buffer.readInt16BE(p + (v === 1 ? 16 : 8)) === 1 && buffer.readInt16BE(p + (v === 1 ? 18 : 10)) === 0);
        if (mediaTime === -1 && mediaEdits === 0) shift += duration / movieScale;
        else { valid(mediaTime >= 0 && ++mediaEdits === 1); shift -= mediaTime / scale; }
      }
    }
    // Composition offsets/encryption/fragmented text need a different decoder.
    if (child(buffer, stbl, 'ctts') || child(buffer, stbl, 'senc')) continue;
    const stsz = required(buffer, stbl, 'stsz'); bytes(stsz, 12);
    const fixedSize = buffer.readUInt32BE(stsz.start + 4), count = buffer.readUInt32BE(stsz.start + 8);
    valid(count <= MAX_SAMPLES && (fixedSize || stsz.start + 12 + count * 4 <= stsz.end));
    const sizes = Array.from({ length: count }, (_, i) => fixedSize || buffer.readUInt32BE(stsz.start + 12 + i * 4));
    valid(sizes.every(size => size >= 2 && size <= 64 * 1024));
    const stts = required(buffer, stbl, 'stts'), times = []; let time = shift;
    for (const p of table(buffer, stts, 8)) {
      const n = buffer.readUInt32BE(p), duration = buffer.readUInt32BE(p + 4) / scale;
      valid(times.length + n <= count);
      for (let i = 0; i < n; i++) { times.push({ start: time, end: time + duration }); time += duration; }
    }
    valid(times.length === count);
    const offsets = child(buffer, stbl, 'co64') || required(buffer, stbl, 'stco');
    const chunks = table(buffer, offsets, offsets.type === 'co64' ? 8 : 4).map(p => offsets.type === 'co64' ? integer(Number(buffer.readBigUInt64BE(p))) : buffer.readUInt32BE(p));
    const stsc = required(buffer, stbl, 'stsc');
    const runs = table(buffer, stsc, 12).map(p => ({ first: buffer.readUInt32BE(p), count: buffer.readUInt32BE(p + 4), description: buffer.readUInt32BE(p + 8) }));
    valid(!count || runs[0]?.first === 1);
    valid(runs.every((run, i) => run.count > 0 && run.count <= count && run.description === 1 && (i === 0 || run.first > runs[i - 1].first)));
    const samples = []; let sampleIndex = 0, runIndex = 0;
    for (let chunk = 0; chunk < chunks.length; chunk++) {
      while (runIndex + 1 < runs.length && runs[runIndex + 1].first <= chunk + 1) runIndex++;
      const run = runs[runIndex]; valid(run && sampleIndex + run.count <= count);
      let offset = chunks[chunk];
      for (let i = 0; i < run.count; i++) {
        samples.push({ ...times[sampleIndex], offset, size: sizes[sampleIndex] });
        offset = integer(offset + sizes[sampleIndex++]);
      }
    }
    valid(sampleIndex === count);
    const number = tracks.length + 1;
    const locale = /^(zho|chi)$/.test(language) ? 'zh' : language === 'eng' ? 'en' : language === 'jpn' ? 'ja' : language;
    const label = ({ zh: '中文', en: 'English', ja: '日本語' })[locale] || `字幕 ${number}`;
    tracks.push({ id: `embedded-${number}`, label, language: /^[a-z]{2,3}$/.test(locale) ? locale : 'und', samples });
    if (tracks.length >= 4) break;
  }
  return tracks;
}

async function readRange(fetchRange, start, end, signal) {
  integer(start); integer(end); valid(end >= start && end - start < MAX_METADATA);
  const response = await fetchRange(`bytes=${start}-${end}`, signal);
  const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (response.status !== 206 || !range || Number(range[1]) !== start || Number(range[2]) > end) {
    await response.body?.cancel(); throw fail();
  }
  const total = integer(Number(range[3])), chunks = []; let length = 0;
  try {
    for await (const chunk of response.body) {
      length += chunk.length; valid(length <= end - start + 1); chunks.push(chunk);
    }
  } catch (error) { throw error; }
  valid(length === Number(range[2]) - start + 1);
  return { buffer: Buffer.concat(chunks, length), total };
}

async function readIndex(fetchRange, signal) {
  let offset = 0, total = Infinity;
  for (let i = 0; i < 24 && offset < total; i++) {
    const header = await readRange(fetchRange, offset, offset + 15, signal); total = header.total;
    const b = header.buffer; valid(b.length >= 8);
    let size = b.readUInt32BE(0);
    if (size === 1) { valid(b.length >= 16); size = integer(Number(b.readBigUInt64BE(8))); }
    if (size === 0) size = total - offset;
    valid(size >= 8 && offset + size <= total);
    if (b.toString('ascii', 4, 8) === 'moov') {
      valid(size <= MAX_METADATA);
      return parseSubtitleIndex((await readRange(fetchRange, offset, offset + size - 1, signal)).buffer);
    }
    offset += size;
  }
  return [];
}

export class EmbeddedSubtitleReader {
  constructor(fetchRange) { this.fetchRange = fetchRange; this.windows = new Map(); }
  async read(time = 0, signal) {
    valid(Number.isFinite(time) && time >= 0 && time <= 172800);
    const bucket = Math.floor(time / WINDOW_SECONDS);
    if (this.windows.has(bucket)) return this.windows.get(bucket);
    return withReadSlot(() => this.readWindow(bucket, signal), signal);
  }
  async readWindow(bucket, signal) {
    if (this.windows.has(bucket)) return this.windows.get(bucket);
    // Keep only the parsed text index, never the large video/audio sample tables.
    if (!this.index) this.index = readIndex(this.fetchRange, signal).catch(error => { this.index = null; throw error; });
    const tracks = await this.index;
    const from = bucket * WINDOW_SECONDS, to = from + WINDOW_SECONDS;
    const requests = [], output = tracks.map(track => ({ id: track.id, label: track.label, language: track.language, cues: [] }));
    tracks.forEach((track, i) => track.samples.filter(s => s.end > from && s.start < to && s.size > 2).forEach(sample => requests.push({ ...sample, track: i })));
    requests.sort((a, b) => a.offset - b.offset);
    const groups = [];
    for (const sample of requests) {
      const group = groups.at(-1), end = sample.offset + sample.size - 1;
      if (group && sample.offset - group.end <= 1024 && end - group.start < 64 * 1024) { group.end = Math.max(group.end, end); group.samples.push(sample); }
      else groups.push({ start: sample.offset, end, samples: [sample] });
    }
    valid(groups.length <= 128 && groups.reduce((n, g) => n + g.end - g.start + 1, 0) <= 1024 * 1024);
    let next = 0;
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, groups.length) }, async () => {
      while (next < groups.length) {
        const group = groups[next++], { buffer } = await readRange(this.fetchRange, group.start, group.end, signal);
        for (const sample of group.samples) {
          const p = sample.offset - group.start, length = buffer.readUInt16BE(p); valid(length <= sample.size - 2);
          const raw = buffer.subarray(p + 2, p + 2 + length);
          const text = raw[0] === 0xfe && raw[1] === 0xff ? new TextDecoder('utf-16be').decode(raw) : raw[0] === 0xff && raw[1] === 0xfe ? new TextDecoder('utf-16le').decode(raw) : raw.toString('utf8');
          if (text.trim() && sample.end > sample.start) output[sample.track].cues.push({ start: Math.max(0, sample.start), end: sample.end, text: text.replace(/\u0000/g, '') });
        }
      }
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    output.forEach(track => track.cues.sort((a, b) => a.start - b.start));
    const result = { from, to, tracks: output };
    this.windows.set(bucket, result);
    if (this.windows.size > 8) this.windows.delete(this.windows.keys().next().value);
    return result;
  }
}
