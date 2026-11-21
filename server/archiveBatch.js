import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { archiveError, mergeArchiveMetadata, requireArchiveCapacity } from './archivePolicy.js';
import { matchingShareFiles } from './libraryPolicy.js';
import { hasConflictingOfficialEditions, sameWorkEdition, searchTitleKey } from './searchTitles.js';
import { fileSourceColor, leastCompatibleColor, sourceColor, sourceColorRank } from './sourceColor.js';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const titleKey = (input, user) => `${user.username}\n${input.category}\n${searchTitleKey(input.title)}`;
const sourceFingerprint = card => card ? digest([card.quarkFid, card.quarkShareUrl || '', card.quarkPasscode || '',
  card.quarkSelectionFids === undefined ? null : card.quarkSelectionFids]) : '';

function validateInput(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 || input.category !== 'tv'
    || !/^https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+$/.test(input.shareUrl || '')
    || (input.quarkFid != null && (typeof input.quarkFid !== 'string' || !/^[a-zA-Z0-9_-]{0,240}$/.test(input.quarkFid)))
    || (input.year && !/^(?:19|20)\d{2}$/.test(String(input.year)))) {
    throw archiveError('补集信息不正确，请重新搜索。', 'INVALID_ARCHIVE_REQUEST', 400);
  }
}

function chooseOfficialWork(progress, input) {
  const works = (progress?.works || []).filter(work => work.category === 'tv'
    && sameWorkEdition(work.title, input.title)
    && Number.isInteger(work.latestEpisode) && work.latestEpisode > 0 && work.latestEpisode <= 5000
    && (!input.year || !work.year || String(input.year) === String(work.year)));
  const years = new Set(works.map(work => String(work.year || '')).filter(Boolean));
  if (!works.length || years.size > 1) {
    throw archiveError('暂时无法确认这部剧更新到多少集，请稍后重试。', 'OFFICIAL_PROGRESS_UNAVAILABLE', 422);
  }
  if (hasConflictingOfficialEditions(works)) {
    throw archiveError('播出平台的集数不同，暂时无法确认找到的是哪个版本。', 'OFFICIAL_EDITION_AMBIGUOUS', 422);
  }
  return [...works].sort((a, b) => b.latestEpisode - a.latestEpisode || String(a.platform).localeCompare(String(b.platform)))[0];
}

const compareBatchFiles = (a, b) => sourceColorRank(a.colorFormat) - sourceColorRank(b.colorFormat)
  || Number(a.kind === 'archive') - Number(b.kind === 'archive') || a.bytes - b.bytes;

/** Cover the most missing episodes, then prefer a compatible release and save space. */
export function selectArchiveBatch(groups, missingEpisodes) {
  const missing = new Set(missingEpisodes), chosen = [];
  while (missing.size) {
    const candidates = groups.map(group => {
      const items = group.items.filter(item => missing.has(item.episode));
      const colorFormat = leastCompatibleColor(items.map(item => item.colorFormat ?? sourceColor(group.quality)));
      return { group, items, colorFormat, kind: items[0]?.kind, bytes: items.reduce((sum, item) => sum + item.bytes, 0) };
    }).filter(candidate => candidate.items.length)
      .sort((a, b) => b.items.length - a.items.length || compareBatchFiles(a, b) || a.group.key.localeCompare(b.group.key));
    if (!candidates.length) break;
    for (const item of candidates[0].items) {
      if (!missing.has(item.episode)) continue;
      missing.delete(item.episode); chosen.push(item);
    }
  }
  return { items: chosen.sort((a, b) => a.episode - b.episode), missing: [...missing].sort((a, b) => a - b) };
}

const publicBatch = job => ({
  id: job.id, title: job.input.title, category: job.input.category, targetFid: job.targetFid || '',
  status: job.status, message: job.message, officialLatest: job.officialLatest,
  total: job.items.length, completedEpisodes: [...job.completedEpisodes],
  currentEpisode: job.currentEpisode || 0, cleanupPendingCount: job.cleanupPendingCount || 0,
  updatedAt: job.updatedAt, ...(job.error ? { error: job.error } : {})
});

function friendlyBatchError(error) {
  const code = String(error?.code || '');
  if (code === 'QUARK_AUTH_REQUIRED') return '网盘登录已失效，请重新登录后继续。';
  if (code === 'QUARK_ARCHIVE_MEMBERSHIP_REQUIRED') return '当前网盘账号暂不支持保存这类资源，请检查会员权限。';
  if (code === 'QUARK_ARCHIVE_SPACE_REQUIRED' || code === 'QUARK_ARCHIVE_CAPACITY_UNKNOWN') return '网盘空间不足或暂时无法确认，请检查后继续。';
  if (code === 'ARCHIVE_TARGET_CHANGED' || code === 'ARCHIVE_TARGET_AMBIGUOUS') return '片库内容有变化，请重新打开影片后继续。';
  if (code === 'QUARK_SOURCE_CHANGED' || code === 'QUARK_SHARE_UNAVAILABLE' || code === 'ARCHIVE_WORK_MISMATCH') return '剧集资源已变化或失效，请重新搜索。';
  if (code === 'ARCHIVE_BUSY') return '当前任务较多，请稍后继续。';
  return '这一集暂时无法保存，请稍后重试。';
}

export class ArchiveBatchService {
  constructor(dataDir, { gateway, resourceSearch, officialProgress, catalog, archiveImport, userContext }) {
    this.directory = path.join(dataDir, 'archive-batches');
    this.gateway = gateway; this.resourceSearch = resourceSearch; this.officialProgress = officialProgress;
    this.catalog = catalog; this.archiveImport = archiveImport; this.userContext = userContext;
    this.ready = fs.mkdir(this.directory, { recursive: true });
    this.jobs = new Map(); this.active = new Map(); this.activeTitles = new Map(); this.starting = new Map();
  }

  async persist(job) {
    await this.ready;
    job.updatedAt = new Date().toISOString();
    const file = path.join(this.directory, `${job.id}.json`);
    const temporary = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
    await fs.rename(temporary, file);
    this.jobs.set(job.id, job);
  }

  async load(id, user) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw archiveError('补集任务标识无效', 'INVALID_ARCHIVE_JOB', 400);
    let job = this.jobs.get(id);
    if (!job) {
      try { job = JSON.parse(await fs.readFile(path.join(this.directory, `${id}.json`), 'utf8')); } catch { /* Not found. */ }
    }
    if (!job || job.owner !== user.username) throw archiveError('未找到该账号的补集任务', 'ARCHIVE_JOB_NOT_FOUND', 404);
    this.jobs.set(job.id, job);
    if (job.status === 'running' && !this.active.has(job.id) && ![...this.activeTitles.values()].includes(job.id)) {
      job.status = 'paused'; job.message = '补集已暂停，已保存的剧集仍在片库。';
      await this.persist(job);
    }
    return job;
  }

  async plan(input, user, previousJob) {
    validateInput(input);
    const [library, capability, search, official] = await Promise.all([
      this.gateway.describeArchiveLibrary(input, user), this.gateway.getArchiveCapabilities(),
      this.resourceSearch.search(input.title, { category: 'tv' }),
      previousJob ? { year: previousJob.input.year, latestEpisode: previousJob.officialLatest } : this.confirmOfficialWork(input)
    ]);
    const saved = library.quarkFid && this.userContext?.(user).mediaRepository.all().find(item => item.quarkFid === library.quarkFid);
    if (previousJob?.sourceFingerprint && sourceFingerprint(saved) !== previousJob.sourceFingerprint) {
      throw archiveError('片库内容有变化，请重新打开影片后继续。', 'ARCHIVE_TARGET_CHANGED', 409);
    }
    if (saved?.year && official.year && String(saved.year) !== String(official.year)) {
      throw archiveError('片库中的作品年份与官方版本不一致，请先确认影片。', 'ARCHIVE_WORK_MISMATCH', 409);
    }
    const editionYear = String(official.year || input.year || '');
    const rows = (search?.merged_by_type?.quark || []).filter(row => row.category === 'tv'
      && sameWorkEdition(row.work_title, input.title)
      && (!editionYear || String(row.year || '') === editionYear));
    if (!previousJob && !rows.some(row => row.url === input.shareUrl)) {
      throw archiveError(search.partial ? '部分剧集暂时无法查找，请稍后重试。' : '暂时没有找到可用剧集，请稍后重试。', 'ARCHIVE_WORK_MISMATCH', 422);
    }
    const orderedRows = [...new Map(rows.map(row => [row.url, row])).values()]
      .sort((a, b) => Number(b.url === input.shareUrl) - Number(a.url === input.shareUrl) || a.url.localeCompare(b.url)).slice(0, 8);
    const aliases = editionYear ? this.catalog?.matchingAliases?.({ title: input.title, category: 'tv', year: editionYear }) : undefined;
    const details = new Array(orderedRows.length); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, orderedRows.length) }, async () => {
      while (cursor < orderedRows.length) {
        const index = cursor++, controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try { details[index] = await this.gateway.getShareDetails({ shareUrl: orderedRows[index].url, passcode: orderedRows[index].password || '' }, { signal: controller.signal }); }
        catch { details[index] = null; }
        finally { clearTimeout(timer); }
      }
    }));

    const workTitleAliases = await aliases;
    const groups = new Map();
    for (const [index, detail] of details.entries()) {
      if (!detail) continue;
      const row = orderedRows[index], folders = new Map(detail.entries.filter(entry => entry.isDirectory).map(entry => [entry.fid, entry.name]));
      const color = entry => fileSourceColor(entry, folders, row.note || detail.title);
      const files = matchingShareFiles({ title: input.title, category: 'tv', year: editionYear }, detail, { ...row, workTitleAliases });
      for (const entry of files) {
        if (!Number.isInteger(entry.episodeNumber) || entry.episodeNumber < 1 || entry.episodeNumber > official.latestEpisode
          || !Number.isFinite(entry.size) || entry.size <= 0) continue;
        const kind = entry.isArchive ? 'archive' : 'video';
        const key = `${row.url}\n${entry.parentFid || '0'}\n${kind}`;
        if (!groups.has(key)) groups.set(key, { key, quality: folders.get(entry.parentFid) || '', episodes: new Map() });
        const group = groups.get(key), previous = group.episodes.get(entry.episodeNumber);
        const candidate = { kind, shareUrl: row.url, shareTitle: detail.title, fileCheck: entry.identityTag,
          ...(entry.isArchive ? { archiveFid: entry.fid } : { fileFid: entry.fid }), episode: entry.episodeNumber,
          bytes: entry.size, quality: group.quality, colorFormat: color(entry) };
        if (!previous || (compareBatchFiles(candidate, previous) || entry.fid.localeCompare(previous.fileFid || previous.archiveFid)) < 0) {
          group.episodes.set(entry.episodeNumber, candidate);
        }
      }
    }
    const existingEpisodes = [...new Set(library.episodes.map(item => item.episodeNumber).filter(number => number > 0 && number <= official.latestEpisode))].sort((a, b) => a - b);
    const existing = new Set(existingEpisodes);
    const required = Array.from({ length: official.latestEpisode }, (_, index) => index + 1).filter(number => !existing.has(number));
    const selected = selectArchiveBatch([...groups.values()].map(group => ({ ...group, items: [...group.episodes.values()] })), required);
    const totalArchiveBytes = selected.items.filter(item => item.kind === 'archive').reduce((sum, item) => sum + item.bytes, 0);
    const totalVideoBytes = selected.items.filter(item => item.kind === 'video').reduce((sum, item) => sum + item.bytes, 0);
    // Quark may keep the temporary archives in its recycle bin. Estimate one
    // archive copy and one similarly sized video per episode, plus headroom.
    const largestArchiveBytes = Math.max(0, ...selected.items.filter(item => item.kind === 'archive').map(item => item.bytes));
    const recommendedFreeBytes = totalVideoBytes + totalArchiveBytes * 2 + largestArchiveBytes;
    const unavailableSources = details.filter(detail => !detail).length;
    let reason = '';
    if (!required.length) reason = `片库已保存第 1～${official.latestEpisode} 集。`;
    else if (selected.missing.length) reason = unavailableSources || search.partial
      ? '部分资源暂时无法访问，请稍后重试。'
      : '暂时没有找到全部剧集，请稍后重试。';
    else {
      try {
        if (!capability.isAuthenticated) throw archiveError('网盘登录已失效，请重新登录。', 'QUARK_AUTH_REQUIRED', 401);
        if (!Number.isFinite(capability.freeBytes)) throw archiveError('暂时无法确认网盘空间，请稍后重试。', 'QUARK_ARCHIVE_CAPACITY_UNKNOWN');
        if (largestArchiveBytes) requireArchiveCapacity(capability, largestArchiveBytes);
        if (capability.freeBytes < recommendedFreeBytes) {
          reason = '网盘可用空间不足，请清理后重试。';
        }
      }
      catch (error) { reason = error.message; }
    }
    const identity = { owner: user.username, title: input.title, category: 'tv', year: String(official.year || input.year || ''),
      targetFid: library.quarkFid, sourceFingerprint: sourceFingerprint(saved), latest: official.latestEpisode, existingEpisodes, items: selected.items };
    const token = digest(identity);
    return { identity, public: { token, title: input.title, targetFid: library.quarkFid,
      officialLatest: official.latestEpisode, officialPlatform: official.platform || '', existingEpisodes,
      plannedEpisodes: selected.items.map(item => item.episode), missingEpisodes: selected.missing,
      totalArchiveBytes, totalVideoBytes, recommendedFreeBytes, freeBytes: capability.freeBytes, unavailableSources,
      qualities: [...new Set(selected.items.map(item => item.quality).filter(Boolean))],
      canStart: Boolean(required.length && !selected.missing.length && !reason), reason } };
  }

  async confirmOfficialWork(input) {
    const known = await this.catalog?.knownPlatforms?.(input.title, 'tv').catch(() => []) || [];
    const progress = await this.officialProgress.lookup(input.title, { category: 'tv', known });
    return chooseOfficialWork(progress, input);
  }

  async preview(input, user) { return (await this.plan(input, user)).public; }

  async start(input, user) {
    validateInput(input);
    if (!/^[a-f0-9]{64}$/.test(input.token || '')) throw archiveError('请先检查缺少的剧集。', 'ARCHIVE_PLAN_REQUIRED', 400);
    const key = titleKey(input, user);
    if (this.starting.has(key)) return this.starting.get(key);
    const pending = this.startOnce(input, user, key).finally(() => this.starting.delete(key));
    this.starting.set(key, pending); return pending;
  }

  async startOnce(input, user, key) {
    const activeId = this.activeTitles.get(key);
    if (activeId) return publicBatch(await this.load(activeId, user));
    const plan = await this.plan(input, user);
    if (plan.public.token !== input.token) throw archiveError('剧集或片库内容有变化，请重新检查。', 'ARCHIVE_PLAN_CHANGED', 409);
    if (!plan.public.canStart) throw archiveError(plan.public.reason || '当前无法补齐全部剧集。', 'ARCHIVE_BATCH_INCOMPLETE', 422);
    return this.launch(plan, input, user, key);
  }

  async resume(id, user) {
    const job = await this.load(id, user);
    const key = titleKey(job.input, user);
    const starting = this.starting.get(key);
    if (starting) {
      const result = await starting;
      if (result.id === id) return result;
      throw archiveError('同名剧集正在补集，请等当前任务结束后再继续。', 'ARCHIVE_BUSY', 409);
    }
    const pending = this.resumeOnce(job, user, key).finally(() => this.starting.delete(key));
    this.starting.set(key, pending);
    return pending;
  }

  async resumeOnce(job, user, key) {
    const activeId = this.activeTitles.get(key);
    if (activeId) {
      const activeJob = await this.load(activeId, user);
      if (activeJob.status === 'running') {
        if (activeId === job.id) return publicBatch(activeJob);
        throw archiveError('同名剧集正在补集，请等当前任务结束后再继续。', 'ARCHIVE_BUSY', 409);
      }
      await this.active.get(activeId);
    }
    if (job.status === 'success') return publicBatch(job);
    const input = { ...job.input, quarkFid: job.targetFid, shareUrl: job.items.find(item => !job.completedEpisodes.includes(item.episode))?.shareUrl || job.items[0]?.shareUrl };
    const plan = await this.plan(input, user, job);
    const existing = new Set(plan.identity.existingEpisodes);
    const retained = job.items.filter(item => existing.has(item.episode));
    if (existing.size === job.officialLatest) {
      await this.persist({ ...job, items: retained, completedEpisodes: retained.map(item => item.episode),
        currentEpisode: 0, status: 'success', error: undefined,
        message: `片库已保存第 1～${job.officialLatest} 集，可以在片库观看。` });
      return publicBatch(this.jobs.get(job.id));
    }
    if (!plan.public.canStart) throw archiveError(plan.public.reason, 'ARCHIVE_BATCH_INCOMPLETE', 422);
    return this.launch(plan, input, user, key, job, retained);
  }

  async launch(plan, input, user, key, previousJob, retained = []) {
    if (this.active.size >= 2) throw archiveError('当前补集任务较多，请稍后重试。', 'ARCHIVE_BUSY', 429);
    const id = previousJob?.id || plan.public.token.slice(0, 32);
    const job = { id, owner: user.username, input: { title: input.title, category: 'tv', year: plan.identity.year,
      catalogId: String(input.catalogId || '').slice(0, 240), poster: String(input.poster || '').slice(0, 2048) },
      targetFid: plan.identity.targetFid, sourceFingerprint: plan.identity.sourceFingerprint, officialLatest: plan.identity.latest,
      items: [...retained, ...plan.identity.items], completedEpisodes: retained.map(item => item.episode),
      currentEpisode: 0, cleanupPendingCount: previousJob?.cleanupPendingCount || 0, status: 'running',
      message: previousJob ? '正在继续补齐剩余剧集。' : '补集已开始，可以继续浏览。', stopRequested: false };
    this.activeTitles.set(key, id);
    try { await this.persist(job); } catch (error) { this.activeTitles.delete(key); throw error; }
    const task = this.run(job, user).catch(error => {
      job.status = 'failed'; job.message = '补集状态暂时无法保存，请检查片库后重试。';
      console.error('[archive-batch] could not persist task status', error?.code || 'UNKNOWN');
    }).finally(() => { this.active.delete(id); this.activeTitles.delete(key); });
    this.active.set(id, task);
    return publicBatch(job);
  }

  async run(job, user) {
    try {
      for (const item of job.items.slice(job.completedEpisodes.length)) {
        if (job.stopRequested) { job.status = 'paused'; job.message = '已停止补集，已保存的剧集仍在片库。'; break; }
        if (job.sourceFingerprint) {
          const current = this.userContext?.(user).mediaRepository.all().find(card => card.quarkFid === job.targetFid);
          if (sourceFingerprint(current) !== job.sourceFingerprint) throw archiveError('片库内容有变化，请重新打开影片。', 'ARCHIVE_TARGET_CHANGED', 409);
        }
        job.currentEpisode = item.episode;
        job.message = `正在保存第 ${item.episode} 集（${job.completedEpisodes.length + 1}/${job.items.length}）…`;
        await this.persist(job);
        const target = await this.gateway.describeArchiveLibrary({ title: job.input.title, category: 'tv', quarkFid: job.targetFid }, user);
        if (job.targetFid && target.quarkFid !== job.targetFid) throw archiveError('原片库目录已变化，补集已停止。', 'ARCHIVE_TARGET_CHANGED', 409);
        if (!job.targetFid && target.quarkFid) job.targetFid = target.quarkFid;
        if (target.episodes.some(episode => episode.episodeNumber === item.episode)) {
          job.completedEpisodes.push(item.episode); await this.persist(job); continue;
        }
        let media, cleanupPending = false;
        if (item.kind === 'video') {
          const fresh = await this.resourceSearch.search(job.input.title, { category: 'tv' });
          const source = (fresh?.merged_by_type?.quark || []).find(row => row.url === item.shareUrl && row.category === 'tv'
            && sameWorkEdition(row.work_title, job.input.title)
            && (!job.input.year || String(row.year || '') === job.input.year));
          if (!source) throw archiveError('本轮未确认该集的来源与作品版本，补集已停止。', 'ARCHIVE_WORK_MISMATCH', 409);
          const saved = await this.gateway.importShare({ title: job.input.title, category: 'tv', shareUrl: item.shareUrl,
            passcode: source.password || '', appendToFid: job.targetFid, quarkSelectionFids: [item.fileFid], quarkRequiredEpisodes: [item.episode],
            quarkFileChecks: item.fileCheck ? [item.fileCheck] : undefined, quarkVerifiedShareTitle: item.shareTitle }, user);
          media = saved.item;
          const repository = this.userContext(user).mediaRepository;
          const original = repository.all().find(card => card.quarkFid === media.quarkFid);
          repository.save(mergeArchiveMetadata(media, job.input, original));
        } else {
          const child = await this.archiveImport.start({ ...job.input, shareUrl: item.shareUrl, archiveFid: item.archiveFid,
            episode: item.episode, fileCheck: item.fileCheck, quarkFid: job.targetFid }, user);
          const active = this.archiveImport.active.get(child.id);
          if (active) await active;
          const result = await this.archiveImport.get(child.id, user);
          if (result.status !== 'success' || !result.media?.quarkFid) throw archiveError(result.error?.message || result.message || '该集解压未完成。', result.error?.code || 'ARCHIVE_BATCH_EPISODE_FAILED');
          media = result.media; cleanupPending = Boolean(result.cleanupPending);
        }
        if (!media?.quarkFid || (job.targetFid && media.quarkFid !== job.targetFid)) throw archiveError('补集结果不属于原片库目录，任务已停止。', 'ARCHIVE_TARGET_CHANGED', 409);
        job.targetFid = media.quarkFid;
        if (!job.sourceFingerprint) {
          const stored = this.userContext?.(user).mediaRepository.all().find(card => card.quarkFid === job.targetFid);
          job.sourceFingerprint = sourceFingerprint(stored);
        }
        const confirmed = await this.gateway.describeArchiveLibrary({ title: job.input.title, category: 'tv', quarkFid: job.targetFid }, user);
        if (!confirmed.episodes.some(episode => episode.episodeNumber === item.episode)) throw archiveError('解压任务完成，但片库中尚未确认该集。', 'ARCHIVE_EPISODE_UNCONFIRMED', 409);
        if (cleanupPending) job.cleanupPendingCount++;
        job.completedEpisodes.push(item.episode); await this.persist(job);
      }
      if (job.status === 'running') {
        const target = await this.gateway.describeArchiveLibrary({ title: job.input.title, category: 'tv', quarkFid: job.targetFid }, user);
        const actual = new Set(target.episodes.map(episode => episode.episodeNumber));
        const missing = Array.from({ length: job.officialLatest }, (_, index) => index + 1).filter(number => !actual.has(number));
        if (missing.length) throw archiveError(`片库仍缺 ${missing.length} 集，请重新核对后继续补集。`, 'ARCHIVE_BATCH_INCOMPLETE', 409);
        job.status = 'success'; job.message = `已补齐第 1～${job.officialLatest} 集，可以在片库观看。`;
      }
      job.currentEpisode = 0; await this.persist(job);
    } catch (error) {
      job.status = 'failed'; job.error = { code: error.code || 'ARCHIVE_BATCH_FAILED', message: friendlyBatchError(error) };
      job.message = `第 ${job.currentEpisode} 集未保存：${job.error.message} 已保存的剧集仍在片库。`;
      job.currentEpisode = 0; await this.persist(job);
    }
  }

  async get(id, user) { return publicBatch(await this.load(id, user)); }

  async list(user) {
    await this.ready;
    const names = (await fs.readdir(this.directory)).filter(name => /^[a-f0-9]{32}\.json$/.test(name));
    const jobs = [];
    for (const name of names) {
      try { jobs.push(await this.get(name.slice(0, 32), user)); } catch (error) { if (error.code !== 'ARCHIVE_JOB_NOT_FOUND') throw error; }
    }
    // Keep recoverable records when the drive is temporarily unavailable.
    const folderIds = jobs.some(job => job.targetFid) ? await this.gateway.libraryFolderIds(user).catch(() => null) : null;
    const latest = new Map();
    for (const job of jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (folderIds && job.targetFid && !folderIds.has(job.targetFid)) continue;
      const key = `${job.category}:${searchTitleKey(job.title)}`;
      if (!latest.has(key)) latest.set(key, job);
    }
    return [...latest.values()].slice(0, 10);
  }

  async stop(id, user) {
    const job = await this.load(id, user);
    if (job.status === 'running') { job.stopRequested = true; job.message = '将在当前一集处理结束后停止。'; await this.persist(job); }
    return publicBatch(job);
  }
}
