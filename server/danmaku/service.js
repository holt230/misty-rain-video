import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DanmakuProviders, segmentSeconds, validateSource, platforms } from './providers.js';
import { DanmakuCatalog, automaticWork } from './catalog.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file);
};
const invalid = message => Object.assign(new Error(message), { code: 'DANMAKU_INVALID_INPUT', statusCode: 400 });
export function validateInput(input) {
  if (!input || typeof input.mediaKey !== 'string' || !input.mediaKey || input.mediaKey.length > 256
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160
    || !['tv', 'movie', 'anime', 'variety'].includes(input.category)
    || !Number.isInteger(input.episodeNumber) || input.episodeNumber < 0 || input.episodeNumber > 10000) throw invalid('影片或集数信息无效');
  return { ...input, episodeTitle: String(input.episodeTitle || '').slice(0, 160) };
}

export class DanmakuService {
  constructor(dataDir, { providers = new DanmakuProviders(), catalog = new DanmakuCatalog(), now = Date.now } = {}) {
    this.directory = path.join(dataDir, 'danmaku'); this.providers = providers; this.catalog = catalog; this.now = now;
    this.pending = new Map(); this.cooldowns = new Map(); this.limits = new Map(); this.active = 0;
  }
  limit(user, kind) {
    const key = `${user}:${kind}`, now = this.now();
    const entry = this.limits.get(key);
    const next = entry && now < entry.until ? entry : { count: 0, until: now + 60_000 };
    if (++next.count > (kind === 'segment' ? 120 : 20)) throw Object.assign(new Error('操作较频繁，请稍后再试'), { code: 'DANMAKU_RATE_LIMIT', statusCode: 429 });
    this.limits.set(key, next);
    if (this.limits.size > 500) for (const [k, v] of this.limits) if (v.until < now) this.limits.delete(k);
  }
  mappingPath(user, key) { return path.join(this.directory, 'users', hash(user), `${hash(key)}.json`); }
  async source(input, workId, platform) {
    if (!Object.hasOwn(platforms, platform)) throw invalid('请选择支持的弹幕平台');
    const number = input.category === 'movie' ? 1 : input.episodeNumber;
    const work = await this.catalog.episode(workId, platform, number, input.episodeTitle);
    const source = await this.providers.resolveUrl(work.episode.url);
    if (source.platform !== platform) throw invalid('剧集来源不一致');
    return { ...source, workId, title: work.title, episodeTitle: work.episode.title, year: work.year, segmentSeconds: segmentSeconds[platform] };
  }
  async match(user, raw) {
    const input = validateInput(raw);
    const saved = read(this.mappingPath(user, input.mediaKey));
    const epKey = `${input.episodeNumber}:${input.episodeTitle}`;
    if (!input.query && saved?.episodes?.[epKey]) return { selected: saved.episodes[epKey], candidates: [], status: 'matched' };
    if (!input.query && saved?.workId) {
      try { return { selected: await this.source(input, saved.workId, saved.platform), candidates: [], status: 'matched' }; }
      catch { /* Keep the saved choice, but let the user correct a missing episode. */ }
    }
    const candidates = await this.catalog.search(input.query || input.title);
    const exact = input.query ? null : automaticWork(input, candidates);
    if (exact) {
      for (const platform of ['qq', 'qiyi', 'youku'].filter(p => exact.platforms.includes(p))) {
        try {
          const selected = await this.source(input, exact.id, platform);
          // Remember a successful exact match, including the original work identity.
          write(this.mappingPath(user, input.mediaKey), { workId: exact.id, platform, episodes: saved?.episodes || {} });
          return { selected, candidates, status: 'matched' };
        } catch { /* Another platform may list the same, exact episode. */ }
      }
    }
    return { selected: null, candidates, status: candidates.length ? 'choose' : 'missing' };
  }
  async select(user, raw) {
    const input = validateInput(raw);
    let selected;
    if (input.url) {
      if (typeof input.url !== 'string' || input.url.length > 1000) throw invalid('剧集链接无效');
      const source = await this.providers.resolveUrl(input.url.trim());
      selected = { ...source, workId: '', title: input.title, episodeTitle: `${input.episodeTitle || '当前剧集'}（手动关联）`, year: '', segmentSeconds: segmentSeconds[source.platform] };
    } else if (input.platform) selected = await this.source(input, input.workId, input.platform);
    else {
      // A viewer chooses the work; choose a platform that actually lists this episode.
      const work = await this.catalog.details(input.workId);
      let lastError;
      for (const platform of ['qq', 'qiyi', 'youku']) {
        if (work.category !== '3' && !work.episodes.some(item => item.platform === platform)) continue;
        try { selected = await this.source(input, input.workId, platform); break; }
        catch (error) { lastError = error; }
      }
      if (!selected) throw lastError || invalid('这部作品暂时没有本集弹幕，可稍后再试');
    }
    const file = this.mappingPath(user, input.mediaKey), saved = read(file) || {};
    if (input.url) {
      saved.episodes ||= {};
      saved.episodes[`${input.episodeNumber}:${input.episodeTitle}`] = selected;
      const keys = Object.keys(saved.episodes); if (keys.length > 500) delete saved.episodes[keys[0]];
    } else { saved.workId = input.workId; saved.platform = selected.platform; saved.episodes = {}; }
    write(file, saved);
    return selected;
  }
  async segment(source, index, force = false) {
    validateSource(source);
    if (!Number.isInteger(index) || index < 0 || index * segmentSeconds[source.platform] > 24 * 3600) throw invalid('弹幕时间段无效');
    const key = `${source.platform}:${source.id}:${index}`, file = path.join(this.directory, 'segments', `${hash(key)}.json`);
    const cached = read(file), now = this.now();
    if (cached && now - cached.fetchedAt < (force ? 5_000 : 600_000)) return { ...cached, stale: false };
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.cooldowns.get(key) > now) {
      if (cached) return { ...cached, stale: true };
      throw Object.assign(new Error('弹幕暂不可用，请稍后刷新'), { statusCode: 503 });
    }
    if (this.active >= 4) throw Object.assign(new Error('弹幕加载繁忙，请稍后再试'), { statusCode: 503 });
    this.active++;
    const task = (async () => {
      try {
        const comments = await this.providers.segment(source, index);
        const result = { comments, index, segmentSeconds: segmentSeconds[source.platform], fetchedAt: this.now() };
        write(file, result); this.prune(); return { ...result, stale: false };
      } catch {
        this.cooldowns.set(key, this.now() + 30_000);
        if (this.cooldowns.size > 256) this.cooldowns.delete(this.cooldowns.keys().next().value);
        if (cached) return { ...cached, stale: true };
        throw Object.assign(new Error('弹幕暂不可用，视频可继续播放，请稍后刷新或更换来源'), { code: 'DANMAKU_UNAVAILABLE', statusCode: 503 });
      } finally { this.active--; this.pending.delete(key); }
    })();
    this.pending.set(key, task); return task;
  }
  prune() {
    const directory = path.join(this.directory, 'segments');
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => ({ name, ...fs.statSync(path.join(directory, name)) })).sort((a, b) => b.mtimeMs - a.mtimeMs);
    let bytes = 0;
    files.forEach((file, index) => {
      bytes += file.size;
      if (index >= 256 || bytes > 64 * 1024 * 1024 || this.now() - file.mtimeMs > 86400_000) fs.unlinkSync(path.join(directory, file.name));
    });
  }
}
