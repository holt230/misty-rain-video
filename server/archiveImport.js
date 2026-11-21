import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { matchingShareFiles } from './libraryPolicy.js';
import { isExactWorkTitle } from './searchTitles.js';
import { supportedArchive, archiveError, mergeArchiveMetadata } from './archivePolicy.js';

const publicJob = job => ({ id: job.id, title: job.input.title, episode: job.input.episode, status: job.status, phase: job.phase,
  message: job.message, updatedAt: job.updatedAt, ...(job.error ? { error: job.error } : {}),
  ...(job.result ? { media: job.result.item, summary: '第 ' + job.input.episode + ' 集已保存到片库', cleanupPending: job.cleanupPending } : {}) });
const userMessage = error => {
  const code = String(error?.code || '');
  if (code === 'QUARK_AUTH_REQUIRED') return '网盘登录已失效，请重新登录。';
  if (code === 'QUARK_ARCHIVE_MEMBERSHIP_REQUIRED') return '当前网盘账号暂不支持保存这类资源，请检查会员权限。';
  if (code === 'QUARK_ARCHIVE_SPACE_REQUIRED' || code === 'QUARK_ARCHIVE_CAPACITY_UNKNOWN') return '网盘空间不足或暂时无法确认，请检查后重试。';
  if (code === 'QUARK_SOURCE_CHANGED' || code === 'QUARK_SHARE_UNAVAILABLE' || code === 'ARCHIVE_WORK_MISMATCH') return '剧集资源已变化或失效，请重新搜索。';
  if (code === 'ARCHIVE_TASK_PENDING') return '这集还在保存，请稍后查看片库。';
  return '这一集暂时无法保存，请稍后重试。';
};
export class ArchiveImportService {
  constructor(dataDir, { gateway, resourceSearch, userContext, catalog }) {
    this.directory = path.join(dataDir, 'archive-jobs');
    this.gateway = gateway; this.resourceSearch = resourceSearch; this.catalog = catalog; this.userContext = userContext;
    this.jobs = new Map(); this.active = new Map(); this.starting = new Map(); this.ready = fs.mkdir(this.directory, { recursive: true });
  }
  async persist(job) {
    await this.ready;
    job.updatedAt = new Date().toISOString();
    const file = path.join(this.directory, job.id + '.json'), temp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fs.writeFile(temp, JSON.stringify(job), { mode: 0o600 }); await fs.rename(temp, file);
    this.jobs.set(job.id, job);
    while (this.jobs.size > 200) this.jobs.delete(this.jobs.keys().next().value);
  }
  async load(id, user) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw archiveError('解压任务标识无效', 'INVALID_ARCHIVE_JOB', 400);
    let job = this.jobs.get(id);
    if (!job) try { job = JSON.parse(await fs.readFile(path.join(this.directory, id + '.json'), 'utf8')); } catch {}
    if (!job || job.owner !== user.username) throw archiveError('未找到该账号的解压任务', 'ARCHIVE_JOB_NOT_FOUND', 404);
    return job;
  }
  async start(input, user) {
    if (!input || typeof input !== 'object') throw archiveError('解压入库参数不正确', 'INVALID_ARCHIVE_REQUEST', 400);
    const identity = [user.username,input.title,input.category,input.shareUrl,input.archiveFid,input.episode];
    if (input.quarkFid) identity.push(input.quarkFid);
    if (input.fileCheck) identity.push(input.fileCheck);
    const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    if (this.starting.has(key)) return this.starting.get(key);
    const pending = this.startOnce(input,user).finally(()=>this.starting.delete(key));
    this.starting.set(key,pending);return pending;
  }
  async startOnce(input, user) {
    const { title, category, shareUrl, archiveFid, episode } = input;
    if (typeof title !== 'string' || !title || title.length > 160 || !['tv','anime'].includes(category) || !/^https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+$/.test(shareUrl || '')
      || !/^[a-zA-Z0-9_-]{1,240}$/.test(archiveFid || '') || !Number.isInteger(episode) || episode < 1 || episode > 5000
      || (input.quarkFid != null && (typeof input.quarkFid !== 'string' || !/^[a-zA-Z0-9_-]{0,240}$/.test(input.quarkFid)))
      || (input.fileCheck != null && !/^[A-Za-z0-9_-]{43}$/.test(input.fileCheck))
      || String(input.archivePassword || '').length > 128 || String(input.passcode || '').length > 64) throw archiveError('解压入库参数不正确', 'INVALID_ARCHIVE_REQUEST', 400);
    const identity = [user.username,title,category,shareUrl,archiveFid,episode];
    if (input.quarkFid) identity.push(input.quarkFid);
    if (input.fileCheck) identity.push(input.fileCheck);
    const id = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0,32);
    let existing;
    try { existing = await this.load(id, user); } catch(error) { if (error.code !== 'ARCHIVE_JOB_NOT_FOUND') throw error; }
    if (existing?.status === 'success' || this.active.has(id)) return publicJob(existing);
    if (this.active.size + this.starting.size > 2) throw archiveError('当前解压任务较多，请稍后重试', 'ARCHIVE_BUSY', 429);
    const job = existing || { id, owner: user.username, input: { title,category,shareUrl,archiveFid,episode,fileCheck:input.fileCheck,quarkFid:input.quarkFid||'',year:input.year||'',catalogId:input.catalogId||'',poster:input.poster||'' }, state:{} };
    job.status = 'running'; job.phase = 'checking'; job.message = '正在准备保存…'; delete job.error;
    await this.persist(job);
    const task = this.run(job, user, input.passcode || '', input.archivePassword || '').finally(()=>this.active.delete(id));
    this.active.set(id, task);
    return publicJob(job);
  }
  async run(job, user, passcode, archivePassword) {
    const update = async (phase,message) => { job.phase=phase;job.message=message;await this.persist(job); };
    try {
      const publication = await this.resourceSearch.search(job.input.title, { category:job.input.category });
      const candidates = publication.merged_by_type.quark.filter(row=>row.url===job.input.shareUrl
        && isExactWorkTitle(job.input.title,row.work_title||'') && row.category===job.input.category
        && (!job.input.year || !row.year || job.input.year===row.year));
      if (!candidates.length) throw archiveError('本轮来源中未确认到该片名与分享，请重新搜索。', 'ARCHIVE_WORK_MISMATCH');
      const details = await this.gateway.getShareDetails({shareUrl:job.input.shareUrl,passcode:passcode||candidates[0].password||''});
      const workTitleAliases = await this.catalog?.matchingAliases?.({ ...job.input, year: job.input.year || candidates[0].year });
      const source = { ...candidates[0], workTitleAliases };
      const eligible = matchingShareFiles(job.input, details, source, { allowUnspecifiedSeason: true });
      const file = eligible.find(entry=>entry.fid===job.input.archiveFid && entry.isArchive && entry.episodeNumber===job.input.episode && supportedArchive(entry.name));
      if (!file || (job.input.fileCheck && file.identityTag !== job.input.fileCheck)) throw archiveError('所选压缩包或集数已变化，请重新搜索。', 'QUARK_SOURCE_CHANGED',409);
      const prepared = await this.gateway.prepareArchiveImport({...job.input,fileCheck:file.identityTag,passcode:passcode||candidates[0].password||'',archivePassword,operationId:job.id},user,{
        state:job.state,checkpoint:async state=>{job.state=state;await this.persist(job);},
        progress:(phase,message)=>{job.phase=phase;job.message=message;}
      });
      await update('verifying','正在检查保存的剧集…');
      const result = await this.gateway.finalizeArchiveImport(prepared,job.input,source,user,{
        checkpoint:async state=>{job.state=state;await this.persist(job);},progress:(phase,message)=>{job.phase=phase;job.message=message;}
      });
      const repository = this.userContext(user).mediaRepository;
      const original = repository.all?.().find(item => item.quarkFid === result.item.quarkFid);
      const item = mergeArchiveMetadata(result.item, job.input, original);
      // Adding one archive to an existing direct-video library must not disable
      // its original update source or replace its metadata.
      repository.save(item);
      const { quarkPasscode: _passcode, ...receipt } = item;
      job.state=result.state; job.result={item:receipt};
      job.status='success';job.phase='done';job.message='已保存到片库。';await this.persist(job);
      try { await this.gateway.cleanupArchiveStage(job.state,user);job.cleanupPending=false; }
      catch { job.cleanupPending=true;job.message='已保存到片库，部分临时文件未清理，可能占用网盘空间。'; }
      await this.persist(job);
    } catch(error) {
      job.status='failed';job.phase='failed';job.error={code:error.code||'QUARK_ARCHIVE_FAILED',message:userMessage(error)};
      job.message=job.error.message;await this.persist(job);
    }
  }
  async get(id,user) {
    const job=await this.load(id,user);
    if(job.status==='running'&&!this.active.has(id)){job.status='failed';job.message='服务已重启，任务断点已保留，可继续检查。';await this.persist(job);}
    return publicJob(job);
  }
}
