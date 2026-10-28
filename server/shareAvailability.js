import { shareFailureDisposition } from './shareFailurePolicy.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const AVAILABLE_TTL_MS = 60_000;
const UNAVAILABLE_TTL_MS = 30 * 60_000;
const UNCERTAIN_TTL_MS = 30_000;
const EMPTY_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 2_000;

export const shareFailureCode = message => {
  const text = String(message || '');
  if (/提取码|访问码|密码|passcode|password/i.test(text)) return 'QUARK_SHARE_PASSCODE_REQUIRED';
  if (/(?:取消|删除|撤销).*分享|分享.*(?:取消|撤销|失效|过期|删除|不存在)|不存在.*分享|share.*(?:cancelled|expired|deleted|not found)/i.test(text)) {
    return 'QUARK_SHARE_UNAVAILABLE';
  }
  return 'QUARK_SHARE_ACCESS_FAILED';
};

const normalize = item => {
  const match = String(item?.url || item?.shareUrl || '').match(/^https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]{1,80})(?:[?#][^\s]*)?$/);
  const password = String(item?.password || item?.passcode || '');
  if (!match || password.length > 32) {
    throw Object.assign(new Error('分享链接或提取码无效'), { code: 'INVALID_QUARK_SHARE', statusCode: 400 });
  }
  const url = `https://pan.quark.cn/s/${match[1]}`;
  const key = `${url}:${crypto.createHash('sha256').update(password).digest('hex')}`;
  return { url, password, key };
};

/** Bounded content checks shared across search channels and users. Never transfer files. */
export class ShareAvailability {
  constructor({ probe, dataDir, now = Date.now, concurrency = 4, maxPending = 32 } = {}) {
    this.probe = probe;
    this.now = now;
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this.cache = new Map();
    this.unavailable = new Map();
    this.jobs = new Set();
    this.queue = [];
    this.active = 0;
    this.file = dataDir ? path.resolve(dataDir, 'share_availability.json') : '';
    if (this.file) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [key, entry] of (saved.entries || []).slice(-MAX_ENTRIES)) {
          if (saved.version === 2 && entry.expiresAt > now() && ['available', 'restricted', 'deferred'].includes(entry.status)) this.cache.set(key, entry);
        }
        for (const [url, expiresAt] of (saved.unavailable || []).slice(-MAX_ENTRIES)) {
          if (expiresAt > now()) this.unavailable.set(normalize({ url }).url, expiresAt);
        }
      } catch { /* A missing or damaged cache must not prevent startup. */ }
    }
  }

  isUnavailable(url) {
    return (this.unavailable.get(String(url)) || 0) > this.now();
  }

  markUnavailable(url, ttlMs = UNAVAILABLE_TTL_MS) {
    this.unavailable.set(normalize({ url }).url, this.now() + ttlMs);
    this.#persist();
  }

  recordFailure(input, error) {
    let item; try { item = normalize(input); } catch { return; }
    const status = shareFailureDisposition(error);
    if (status === 'unavailable') {
      this.markUnavailable(item.url, error?.code === 'QUARK_SHARE_UNAVAILABLE' ? UNAVAILABLE_TTL_MS : EMPTY_TTL_MS);
    } else {
      this.cache.set(item.key, { status, expiresAt: this.now() + UNCERTAIN_TTL_MS }); this.#persist();
    }
  }

  recordContents(input, videoCount) {
    if (!(videoCount > 0)) { this.recordFailure(input, { code: 'QUARK_VIDEO_NOT_FOUND' }); return; }
    let item; try { item = normalize(input); } catch { return; }
    this.unavailable.delete(item.url);
    this.cache.set(item.key, { status: 'available', expiresAt: this.now() + AVAILABLE_TTL_MS }); this.#persist();
  }

  async inspect(items, { force = false, waitMs = 350 } = {}) {
    if (!Array.isArray(items) || items.length > 100) {
      throw Object.assign(new Error('一次最多检查100条分享链接'), { code: 'INVALID_SHARE_CHECK_BATCH', statusCode: 400 });
    }
    const resources = items.map(normalize);
    for (const item of resources) {
      if (force && !this.jobs.has(item.key)) {
        this.cache.delete(item.key);
        this.unavailable.delete(item.url);
      }
      const cached = this.cache.get(item.key);
      if (this.isUnavailable(item.url) || cached?.expiresAt > this.now() || this.jobs.has(item.key)) continue;
      if (this.jobs.size >= this.maxPending) continue;
      this.jobs.add(item.key);
      this.queue.push(item);
    }
    this.#drain();
    if (waitMs && resources.some(item => this.jobs.has(item.key))) {
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 500)));
    }
    const entries = resources.map(item => ({ url: item.url, password: item.password,
      status: this.isUnavailable(item.url) ? 'unavailable' : this.jobs.has(item.key) ? 'pending'
        : this.cache.get(item.key)?.expiresAt > this.now() ? this.cache.get(item.key).status : 'pending' }));
    return { entries, pending: entries.some(entry => entry.status === 'pending') };
  }

  #drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const item = this.queue.shift();
      this.active++;
      void this.#check(item).finally(() => { this.jobs.delete(item.key); this.active--; this.#drain(); });
    }
  }

  async #check(item) {
    const previous = this.cache.get(item.key);
    let status = 'available', failure;
    try { await this.probe({ shareUrl: item.url, passcode: item.password }); }
    catch (error) { failure = error; status = shareFailureDisposition(error); }
    // A later actual directory read/switch failure is stronger evidence than
    // this older in-flight probe, even when it eventually reports success.
    const current = this.cache.get(item.key);
    if (current && current !== previous || this.isUnavailable(item.url)) return;
    if (status === 'unavailable') this.recordFailure(item, failure);
    else {
      this.cache.delete(item.key);
      this.cache.set(item.key, { status, expiresAt: this.now() + (status === 'available' ? AVAILABLE_TTL_MS : UNCERTAIN_TTL_MS) });
      this.#persist();
    }
  }

  #persist() {
    for (const [key, entry] of this.cache) if (entry.expiresAt <= this.now()) this.cache.delete(key);
    for (const [url, expiry] of this.unavailable) if (expiry <= this.now()) this.unavailable.delete(url);
    for (const map of [this.cache, this.unavailable]) while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ version: 2, entries: [...this.cache].filter(([, entry]) => entry.status !== 'unknown'),
        unavailable: [...this.unavailable] }), { mode: 0o600 });
      fs.renameSync(temp, this.file);
    } catch { /* Checks remain usable when the cache volume is read-only. */ }
  }
}
