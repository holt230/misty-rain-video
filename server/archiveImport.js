import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isExactWorkTitle } from './searchTitles.js';
import { supportedArchive, archiveError } from './archivePolicy.js';

const publicJob = job => ({ id: job.id, title: job.input.title, episode: job.input.episode, status: job.status, phase: job.phase,
  message: job.message, updatedAt: job.updatedAt, ...(job.error ? { error: job.error } : {}),
  ...(job.result ? { media: job.result.item, summary: '已解压并核对第 ' + job.input.episode + ' 集', cleanupPending: job.cleanupPending } : {}) });
export class ArchiveImportService {
  constructor(dataDir, { gateway, resourceSearch, userContext }) {
    this.directory = path.join(dataDir, 'archive-jobs');
    this.gateway = gateway; this.resourceSearch = resourceSearch; this.userContext = userContext;
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
    const key = crypto.createHash('sha256').update(JSON.stringify([user.username,input.title,input.category,input.shareUrl,input.archiveFid,input.episode])).digest('hex');
    if (this.starting.has(key)) return this.starting.get(key);
    const pending = this.startOnce(input,user).finally(()=>this.starting.delete(key));
    this.starting.set(key,pending);return pending;
  }
  async startOnce(input, user) {
    const { title, category, shareUrl, archiveFid, episode } = input;
    if (typeof title !== 'string' || !title || title.length > 160 || !['tv','anime'].includes(category) || !/^https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+$/.test(shareUrl || '')
      || !/^[a-zA-Z0-9_-]{1,240}$/.test(archiveFid || '') || !Number.isInteger(episode) || episode < 1 || episode > 5000
      || String(input.archivePassword || '').length > 128 || String(input.passcode || '').length > 64) throw archiveError('解压入库参数不正确', 'INVALID_ARCHIVE_REQUEST', 400);
    const id = crypto.createHash('sha256').update(JSON.stringify([user.username,title,category,shareUrl,archiveFid,episode])).digest('hex').slice(0,32);
    let existing;
    try { existing = await this.load(id, user); } catch(error) { if (error.code !== 'ARCHIVE_JOB_NOT_FOUND') throw error; }
    if (existing?.status === 'success' || this.active.has(id)) return publicJob(existing);
    if (this.active.size + this.starting.size > 2) throw archiveError('当前解压任务较多，请稍后重试', 'ARCHIVE_BUSY', 429);
    const job = existing || { id, owner: user.username, input: { title,category,shareUrl,archiveFid,episode,year:input.year||'',catalogId:input.catalogId||'',poster:input.poster||'' }, state:{} };
    job.status = 'running'; job.phase = 'checking'; job.message = '正在核对资源与解压条件…'; delete job.error;
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
      const file = details.entries.find(entry=>entry.fid===job.input.archiveFid && entry.isArchive && entry.episodeNumber===job.input.episode && supportedArchive(entry.name));
      if (!file) throw archiveError('所选压缩包或集数已变化，请重新搜索。', 'QUARK_SOURCE_CHANGED',409);
      const prepared = await this.gateway.prepareArchiveImport({...job.input,passcode:passcode||candidates[0].password||'',archivePassword,operationId:job.id},user,{
        state:job.state,checkpoint:async state=>{job.state=state;await this.persist(job);},
        progress:(phase,message)=>{job.phase=phase;job.message=message;}
      });
      await update('verifying','解压已完成，正在核对实际视频与集数…');
      const result = await this.gateway.finalizeArchiveImport(prepared,job.input,candidates[0],user,{
        checkpoint:async state=>{job.state=state;await this.persist(job);},progress:(phase,message)=>{job.phase=phase;job.message=message;}
      });
      job.state=result.state; job.result={item:{...result.item,catalogId:job.input.catalogId||undefined,poster:job.input.poster||''}};
      this.userContext(user).mediaRepository.save(job.result.item);
      job.status='success';job.phase='done';job.message='解压并核对完成，已保存到片库。';await this.persist(job);
      try { await this.gateway.cleanupArchiveStage(job.state,user);job.cleanupPending=false; }
      catch { job.cleanupPending=true;job.message='视频已入库，临时压缩包清理未完成；可在网盘系统临时目录检查。'; }
      await this.persist(job);
    } catch(error) {
      job.status='failed';job.phase='failed';job.error={code:error.code||'QUARK_ARCHIVE_FAILED',message:error.message||'解压入库失败'};
      job.message=job.error.message;await this.persist(job);
    }
  }
  async get(id,user) {
    const job=await this.load(id,user);
    if(job.status==='running'&&!this.active.has(id)){job.status='failed';job.message='服务已重启，任务断点已保留，可继续检查。';await this.persist(job);}
    return publicJob(job);
  }
}
