import crypto from 'node:crypto';
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const imageType = bytes => bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
  : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
  : /^GIF8[79]a$/.test(bytes.toString('ascii',0,6)) ? 'image/gif'
  : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : '';

/** Opaque, owner-scoped thumbnail handles; never expose signed media URLs. */
export class ShareThumbnails {
  constructor(fetchImage, now = Date.now) {
    this.fetchImage = fetchImage; this.now = now; this.entries = new Map();
    this.queue = []; this.active = 0; this.bytes = 0;
  }
  remove(id) { const item = this.entries.get(id); this.bytes -= item?.asset?.bytes.length || 0; this.entries.delete(id); }
  cleanup() { for (const [id,item] of this.entries) if (item.expires <= this.now()) this.remove(id); }
  register(url, owner) {
    try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.username || parsed.password || url.length > 4096) return ''; } catch { return ''; }
    this.cleanup();
    while (this.entries.size >= 5000) this.remove(this.entries.keys().next().value);
    const id = crypto.randomBytes(18).toString('base64url');
    this.entries.set(id, { url, owner, expires: this.now() + 10 * 60_000 });
    return `/api/quark/share-thumbnails/${id}`;
  }
  async read(id, owner) {
    const item = this.entries.get(id);
    if (!item || item.expires <= this.now()) throw error('缩略图已过期',404);
    if (item.owner !== owner) throw error('无权读取此缩略图',403);
    if (item.asset) return item.asset;
    if (item.pending) return item.pending;
    if (item.retryAt > this.now()) throw item.failure;
    if (this.queue.length >= 32) throw error('缩略图加载繁忙',503);
    item.pending = new Promise((resolve,reject) => { this.queue.push({ item, resolve, reject }); this.drain(); })
      .then(asset => { item.failure = null; item.retryAt = 0; return asset; })
      .catch(failure => {
        // Switching list views remounts images. Do not repeatedly fetch the same
        // expired/failed CDN URL; a short cooldown still permits recovery.
        item.failure = failure; item.retryAt = this.now() + 30_000; throw failure;
      })
      .finally(() => { item.pending = null; });
    return item.pending;
  }
  drain() {
    while (this.active < 3 && this.queue.length) {
      const task = this.queue.shift(); this.active++;
      this.load(task.item).then(task.resolve,task.reject).finally(() => { this.active--; this.drain(); });
    }
  }
  async load(item) {
    const response = await this.fetchImage(item.url, AbortSignal.timeout(8000));
    if (!response.ok || !response.body) { await response.body?.cancel(); throw error('缩略图读取失败',502); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 2*1024*1024) throw error('缩略图过大',413); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks,size), contentType = imageType(bytes);
    if (!contentType) throw error('缩略图格式不支持',415);
    const asset = { bytes, contentType };
    for (const cached of this.entries.values()) {
      if (this.bytes + size <= 8*1024*1024) break;
      if (cached.asset) { this.bytes -= cached.asset.bytes.length; cached.asset = null; }
    }
    if ([...this.entries.values()].includes(item)) { item.asset = asset; this.bytes += size; }
    return asset;
  }
}
