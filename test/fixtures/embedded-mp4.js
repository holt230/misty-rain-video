const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
const words = values => Buffer.concat(values.map(u32));
export const box = (type, ...parts) => { const payload = Buffer.concat(parts); return Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]); };
const full = (type, ...parts) => box(type, Buffer.alloc(4), ...parts);
export function textTrack(samples, { offset = 0, codec = 'tx3g', language = 'zho', shift = 0, co64 = false } = {}) {
  const encoded = samples.map(s => { const b = Buffer.from(s.text); const length = Buffer.alloc(2); length.writeUInt16BE(b.length); return Buffer.concat([length, b]); });
  const code = [...language].reduce((n, c) => (n << 5) | (c.charCodeAt(0) - 96), 0);
  const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(1000, 12); mdhd.writeUInt32BE(samples.reduce((n, s) => n + s.duration, 0), 16); mdhd.writeUInt16BE(code, 20);
  const handler = Buffer.alloc(24); handler.write('sbtl', 8);
  const desc = Buffer.alloc(38); desc.writeUInt16BE(1, 6); desc.writeInt8(1, 12); // source defaults to right-aligned captions
  const offsets = []; let cursor = offset;
  for (const part of encoded) { if (co64) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(cursor)); offsets.push(b); } else offsets.push(u32(cursor)); cursor += part.length; }
  const stbl = box('stbl', full('stsd', u32(1), box(codec, desc)), full('stts', u32(samples.length), ...samples.map(s => words([1, s.duration]))),
    full('stsc', words([1, 1, 1, 1])), full('stsz', words([0, samples.length]), ...encoded.map(s => u32(s.length))), full(co64 ? 'co64' : 'stco', u32(offsets.length), ...offsets));
  const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(3, 12); tkhd.writeUInt32BE(65536, 40); tkhd.writeUInt32BE(65536, 56); tkhd.writeUInt32BE(0x40000000, 72);
  const edits = shift ? box('edts', full('elst', words([2, shift, 0xffffffff, 0x10000, samples.reduce((n,s)=>n+s.duration,0), 0, 0x10000]))) : Buffer.alloc(0);
  const trak = box('trak', box('tkhd', tkhd), edits, box('mdia', box('mdhd', mdhd), box('hdlr', handler), box('minf', stbl)));
  return { trak, payload: Buffer.concat(encoded) };
}
export function mp4Fixture({ samples = [{ duration: 1000, text: '' }, { duration: 3000, text: '你好，世界' }, { duration: 95000, text: '下一段' }], tailMoov = false, ...options } = {}) {
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom'));
  const mvhd = Buffer.alloc(24); mvhd.writeUInt32BE(1000, 12);
  const provisional = box('moov', box('mvhd', mvhd), textTrack(samples, options).trak);
  const offset = ftyp.length + (tailMoov ? 0 : provisional.length) + 8;
  const track = textTrack(samples, { ...options, offset });
  const moov = box('moov', box('mvhd', mvhd), track.trak), mdat = box('mdat', track.payload);
  return Buffer.concat(tailMoov ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}
