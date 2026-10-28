import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inflateSync } from 'node:zlib';
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const sizes = [180,192,512];
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };

/** Accept only bounded, complete canvas PNGs; uploaded markup/SVG is never served. */
export function validateSiteIcon(value, size) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,') || value.length > 1_500_000) throw error('图标格式无效，请重新选择图片');
  const encoded = value.slice(22);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw error('图标数据无效');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > 1100_000 || !bytes.subarray(0,8).equals(signature)) throw error('图标数据无效');
  let offset = 8, header = false, ended = false, channels = 0; const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), end = offset + length + 12;
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw error('图标文件已损坏');
    if (!header && type !== 'IHDR') throw error('图标文件已损坏');
    if (type === 'IHDR') {
      if (header || length !== 13 || bytes.readUInt32BE(offset + 8) !== size || bytes.readUInt32BE(offset + 12) !== size
        || bytes[offset + 16] !== 8 || ![0,2,4,6].includes(bytes[offset + 17]) || bytes[offset + 18] || bytes[offset + 19] || bytes[offset + 20]) throw error('图标尺寸或格式无效');
      channels = { 0:1, 2:3, 4:2, 6:4 }[bytes[offset + 17]]; header = true;
    } else if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    else if (type === 'IEND') { if (length || !compressed.length || end !== bytes.length) throw error('图标文件已损坏'); ended = true; }
    else if (type === 'acTL' || /^[A-Z]/.test(type) && type !== 'PLTE') throw error('不支持此图标格式');
    offset = end;
  }
  if (!header || !ended || offset !== bytes.length) throw error('图标文件不完整');
  try {
    const stride = size * channels + 1, decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: stride * size });
    if (decoded.length !== stride * size) throw new Error();
    for (let row = 0; row < size; row++) if (decoded[row * stride] > 4) throw new Error();
  } catch { throw error('图标文件无法读取'); }
  return encoded;
}

const field = (value, name, max, required = false) => {
  if (typeof value !== 'string') throw error(`${name}格式无效`);
  const result = value.trim();
  if ((required && !result) || [...result].length > max || /[\u0000-\u001f\u007f]/.test(result)) throw error(`${name}${required ? `需为 1–${max}` : `最多 ${max}`} 个字符，不能包含换行`);
  return result;
};
export class SiteSettings {
  constructor(dataDir) {
    this.file = path.resolve(dataDir, 'site-settings.json');
    this.defaults = { name: String(process.env.APP_DISPLAY_NAME || '烟雨影视').trim().slice(0,32) || '烟雨影视' };
    this.value = { ...this.defaults, icons: null };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version === 1) this.value = this.validate(saved.settings);
    } catch { /* Use built-in branding if absent or corrupt; never block login. */ }
  }
  validate(input) {
    const result = { name: field(input.name, '站点名称', 32, true), icons: null };
    if (input.icons) result.icons = Object.fromEntries(sizes.map(size => [size, validateSiteIcon(input.icons[size], size)]));
    return result;
  }
  get revision() { return crypto.createHash('sha256').update(JSON.stringify(this.value)).digest('hex').slice(0,24); }
  public() {
    const { name, icons } = this.value, revision = this.revision;
    const icon = size => `/api/site/icon/${size}.png?v=${revision}`;
    return { name, revision, customIcon: Boolean(icons),
      iconUrl: icons ? icon(512) : '/brand-mark.png', faviconUrl: icons ? icon(180) : '/apple-touch-icon.png',
      touchIconUrl: icons ? icon(180) : '/apple-touch-icon.png', defaults: { ...this.defaults, iconUrl: '/brand-mark.png' } };
  }
  update(input) {
    if (input?.revision !== this.revision) throw error('站点信息已被更新，请重新加载后再保存', 409);
    const icons = input.icons === undefined ? this.value.icons && Object.fromEntries(sizes.map(size => [size, `data:image/png;base64,${this.value.icons[size]}`])) : input.icons;
    const next = this.validate({ ...input, icons });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      // Store one atomic document so a failed icon upload can never leave metadata half saved.
      // Empty legacy keys keep an older deployed reader usable during rollback.
      const saved = { ...next, subtitle: '', description: '', icons: next.icons && Object.fromEntries(sizes.map(size => [size, `data:image/png;base64,${next.icons[size]}`])) };
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, settings: saved }), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch { try { fs.unlinkSync(temporary); } catch {} throw error('保存失败，请稍后重试', 503); }
    this.value = next; return this.public();
  }
  icon(size, distDir) {
    if (!sizes.includes(size)) return null;
    if (this.value.icons) return Buffer.from(this.value.icons[size], 'base64');
    const file = path.resolve(distDir, size === 180 ? 'apple-touch-icon.png' : `app-icon-${size}.png`);
    try { return fs.readFileSync(file); } catch { return null; }
  }
  manifest(template) {
    const result = { ...template, name: this.value.name, short_name: [...this.value.name].slice(0,12).join('') };
    delete result.description;
    if (this.value.icons) result.icons = [192,512].map(size => ({ src: `api/site/icon/${size}.png?v=${this.revision}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' }));
    return result;
  }
  html(template, basePath = '') {
    const data = this.public(), url = value => escapeHtml(basePath + value);
    return template.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(data.name)}</title>`)
      .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*("\s*\/>)/, (_, a, b) => a + escapeHtml(data.name) + b)
      .replace(/(<link rel="icon"[^>]*href=")[^"]*(")/, (_, a, b) => a + url(data.faviconUrl) + b)
      .replace(/(<link rel="apple-touch-icon"[^>]*href=")[^"]*(")/, (_, a, b) => a + url(data.touchIconUrl) + b)
      .replace(/(<img class="app-boot__mark" src=")[^"]*(")/, (_, a, b) => a + url(data.iconUrl) + b)
      .replace(/(<p class="app-boot__title">)[^<]*(<\/p>)/, (_, a, b) => a + escapeHtml(data.name) + b)
      .replace('</head>', `<script type="application/json" id="site-settings">${safeJson(data)}</script></head>`);
  }
}
