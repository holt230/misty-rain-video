import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DanmakuProviders, segmentSeconds, validateSource, platforms } from './providers.js';
import { DanmakuCatalog, automaticWork, missingEpisode, validateWorkId } from './catalog.js';
import { parseBilibiliUrl } from './bilibili.js';
import { seasonNumber } from '../libraryPolicy.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file);
};
const invalid = message => Object.assign(new Error(message), { code: 'DANMAKU_INVALID_INPUT', statusCode: 400 });
const seasonScope = input => String(input.seasonNumber || seasonNumber(input.episodeTitle) || 1);
export function validateInput(input) {
  if (!input || typeof input.mediaKey !== 'string' || !input.mediaKey || input.mediaKey.length > 256
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160
    || !['tv', 'movie', 'anime', 'variety'].includes(input.category)
    || !Number.isInteger(input.episodeNumber) || input.episodeNumber < 0 || input.episodeNumber > 10000) throw invalid('影片或集数信息无效');
  if(input.seasonNumber !== undefined && (!Number.isInteger(input.seasonNumber) || input.seasonNumber<0 || input.seasonNumber>99))throw invalid('季数信息无效');
  if(input.associationKey !== undefined && (typeof input.associationKey !== 'string' || !input.associationKey || input.associationKey.length>256))throw invalid('关联标识无效');
  if(input.episodePart !== undefined && (typeof input.episodePart !== 'string' || input.episodePart.length>40))throw invalid('分集信息无效');
  if(input.scope !== undefined && !['season','episode'].includes(input.scope))throw invalid('请选择关联范围');
  if(input.categoryConfirmed !== undefined && typeof input.categoryConfirmed!=='boolean')throw invalid('分类信息无效');
  // Legacy direct-share records used the resource browser's default category.
  // That is a UI fallback, unlike a library folder or catalogue classification.
  const categoryConfirmed=input.categoryConfirmed ?? !/^share:[A-Za-z0-9]{1,80}$/.test(input.mediaKey);
  return { ...input, categoryConfirmed, episodeTitle: String(input.episodeTitle || '').slice(0, 160) };
}

export class DanmakuService {
  constructor(dataDir, { providers = new DanmakuProviders(), catalog, now = Date.now } = {}) {
    this.directory = path.join(dataDir, 'danmaku'); this.providers = providers; this.catalog = catalog || new DanmakuCatalog(undefined,this.directory); this.now = now;
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
    const number = validateWorkId(workId).category === '1' ? 1 : input.episodeNumber;
    const work = await this.catalog.episode(workId, platform, number, input.episodeTitle);
    const source = work.episode.platform === 'bilibili' && work.episode.cid
      ? validateSource({platform:'bilibili',id:work.episode.cid,url:work.episode.url}) : await this.providers.resolveUrl(work.episode.url,number);
    if (source.platform !== platform) throw invalid('剧集来源不一致');
    return { ...source, workId, title: work.title, episodeTitle: work.episode.title, episodeNumber: number, year: work.year, segmentSeconds: segmentSeconds[platform] };
  }
  async sourceForWork(input, workId, preferred) {
    const identity=validateWorkId(workId);
    const order = identity.provider==='bilibili' ? ['bilibili'] : [...new Set([preferred, ...Object.keys(platforms)])].filter(platform => Object.hasOwn(platforms, platform));
    let unavailable;
    for (const platform of order) {
      try { return await this.source(input, workId, platform); }
      catch (error) {
        // A network/format error does not prove that the episode is absent.
        if (error.code !== 'DANMAKU_EPISODE_NOT_FOUND') unavailable ||= error;
      }
    }
    if (unavailable) throw Object.assign(new Error('作品已找到，弹幕来源暂时连接失败，请重试', { cause: unavailable }), {
      code: 'DANMAKU_SOURCE_UNAVAILABLE', statusCode: 502
    });
    throw missingEpisode();
  }
  episodeKey(input) {
    return `s${seasonScope(input)}:${input.category === 'variety' || !input.episodeNumber ? `t${input.episodeTitle}` : `e${input.episodeNumber}`}${input.episodePart ? `:p${input.episodePart}`:''}`;
  }
  async loadMapping(user, input) {
    const file = this.mappingPath(user, input.associationKey || input.mediaKey);
    let saved = read(file) || (input.associationKey ? read(this.mappingPath(user,input.mediaKey)) : null);
    if (!saved) return {file,saved:{version:2,series:{},episodes:{},resolved:{}}};
    // One migration boundary for already published records. Unknown old global
    // work choices have no local-season proof: migrate to season 1, never every season.
    if (saved.version !== 2) {
      if(!read(file))write(file,saved);
      saved = await this.upgradeBilibili(file, saved, input);
      saved.series ||= {}; saved.episodes ||= {}; saved.resolved ||= {};
      if (saved.workId) {
        const scope='1';
        saved.series[scope] ||= {workId:saved.workId,platform:saved.platform,offset:0};
      }
      for (const binding of Object.values(saved.series)) {
        binding.platform ||= binding.workId?.startsWith('bili:') ? 'bilibili' : undefined;
      }
      delete saved.workId; delete saved.platform; saved.version=2;
      write(file,saved);
    }
    return {file,saved};
  }
  bindingView(binding) {
    return {workId:binding.workId,title:binding.title || '',year:binding.year || '',platform:binding.platform,offset:binding.offset || 0};
  }
  rememberResolved(file,saved,key,selected) {
    saved.resolved ||= {}; delete saved.resolved[key]; saved.resolved[key]=selected;
    // Only derived resolutions are bounded. User confirmations are not cache.
    const keys=Object.keys(saved.resolved); if(keys.length>500)delete saved.resolved[keys[0]];
    write(file,saved);
  }
  async match(user, raw) {
    const input=validateInput(raw);
    if(input.query)return {selected:null,candidates:await this.catalog.search(input.query),status:'choose'};
    const {file,saved}=await this.loadMapping(user,input), scope=seasonScope(input), key=this.episodeKey(input);
    const legacyKey=`${input.episodeNumber}:${input.episodeTitle}`;
    const legacySeason=String(seasonNumber(input.episodeTitle) || 1);
    const override=saved.episodes?.[key] || (legacySeason===scope ? saved.episodes?.[legacyKey] : null);
    if(override)return {selected:override,candidates:[],status:'matched',binding:saved.series?.[scope] && this.bindingView(saved.series[scope])};
    const binding=saved.series?.[scope];
    if(binding){
      if(input.episodePart)return {selected:null,candidates:[],status:'choose',binding:this.bindingView(binding),message:'分段视频请确认对应集数'};
      try {
        const target={...input,episodeNumber:input.episodeNumber+(binding.offset || 0)};
        const selected=saved.resolved?.[key] || {...(binding.platform
          ? await this.source(target,binding.workId,binding.platform)
          : await this.sourceForWork(target,binding.workId)),seriesLinked:true};
        if(!saved.resolved?.[key]){
          Object.assign(binding,{title:selected.title,year:selected.year,platform:selected.platform});
          this.rememberResolved(file,saved,key,selected);
        }
        return {selected,candidates:[],status:'matched',binding:this.bindingView(binding)};
      } catch(error) {
        const missing=error.code==='DANMAKU_EPISODE_NOT_FOUND';
        return {selected:null,candidates:[],status:missing?'missing':'unavailable',binding:this.bindingView(binding),
          message:missing?'本集暂无弹幕，已保留本季关联':'弹幕暂时无法加载，已保留本季关联'};
      }
    }
    const candidates=await this.catalog.search(input.title);
    const exact=automaticWork(input,candidates);
    if(!exact)return {selected:null,candidates,status:candidates.length?'choose':'missing'};
    const selected={...await this.sourceForWork(input,exact.id),seriesLinked:true};
    saved.series ||= {};saved.series[scope]={workId:exact.id,platform:selected.platform,offset:0,title:selected.title,year:selected.year,confirmed:false};
    this.rememberResolved(file,saved,key,selected);
    return {selected,candidates:[],status:'matched',binding:this.bindingView(saved.series[scope])};
  }
  async select(user, raw) {
    const input=validateInput(raw), corrected=input.targetEpisode !== undefined;
    if(corrected && (!Number.isInteger(input.targetEpisode) || input.targetEpisode<0 || input.targetEpisode>10000
      || typeof input.targetEpisodeTitle!=='string' || input.targetEpisodeTitle.length>160 || input.url))throw invalid('请选择有效集数');
    const target=corrected?{...input,episodeNumber:input.targetEpisode,episodeTitle:input.targetEpisodeTitle}:input;
    let selected,linked;
    if(input.url){
      if(typeof input.url!=='string' || input.url.length>1000)throw invalid('剧集链接无效');
      const parsed=parseBilibiliUrl(input.url.trim());
      if(parsed && ['ep','ss'].includes(parsed.kind))linked=await this.catalog.importBilibili(input.url.trim(),input.category==='movie'?1:input.episodeNumber);
      if(linked)selected=this.linkedSource(linked);
      else {
        const source=await this.providers.resolveUrl(input.url.trim(),input.category==='movie'?1:input.episodeNumber);
        selected={...source,workId:'',title:input.title,episodeTitle:input.episodeTitle || '当前剧集',year:'',segmentSeconds:segmentSeconds[source.platform]};
      }
    } else selected=input.platform ? await this.source(target,input.workId,input.platform) : await this.sourceForWork(target,input.workId);
    selected={...selected,episodeNumber:selected.episodeNumber ?? (target.category==='movie'?1:target.episodeNumber),corrected};
    // Validate and resolve the new choice completely before changing a binding.
    const {file,saved}=await this.loadMapping(user,input),scope=seasonScope(input),key=this.episodeKey(input);
    const applySeason=Boolean(selected.workId && !input.episodePart && (input.scope || (corrected?'episode':'season'))==='season');
    selected.seriesLinked=applySeason;
    saved.episodes ||= {};saved.series ||= {};saved.resolved ||= {};
    if(applySeason){
      saved.series[scope]={workId:selected.workId,platform:selected.platform,offset:input.category==='variety'||input.category==='movie'?0:selected.episodeNumber-input.episodeNumber,
        title:selected.title,year:selected.year,confirmed:true};
      for(const entry of Object.keys(saved.resolved))if(entry.startsWith(`s${scope}:`))delete saved.resolved[entry];
      // A new season confirmation supersedes that season's previous corrections.
      for(const entry of Object.keys(saved.episodes)){
        const legacyTitle=entry.slice(entry.indexOf(':')+1);
        if(/^s\d+:/.test(entry)?entry.startsWith(`s${scope}:`):String(seasonNumber(legacyTitle)||1)===scope)delete saved.episodes[entry];
      }
      saved.resolved[key]=selected;
    }else saved.episodes[key]=selected;
    write(file,saved);
    return selected;
  }
  linkedSource({work,episode}) {
    return {platform:'bilibili',id:episode.cid,url:episode.url,workId:work.id,title:work.title,year:work.year,
      episodeTitle:episode.title,episodeNumber:episode.number,segmentSeconds:360,seriesLinked:true};
  }
  async upgradeBilibili(file, saved, input) {
    const scope=seasonScope(input);
    if(saved.series?.[scope])return saved;
    const anchors=Object.entries(saved.episodes || {}).map(([key,value])=>({key,value,number:Number(key.split(':')[0]),episodeTitle:key.slice(key.indexOf(':')+1)}))
      .filter(row=>row.value.platform==='bilibili' && !row.value.workId && parseBilibiliUrl(row.value.url)?.kind==='ep' && seasonScope(row)===scope && row.number>0).slice(-2);
    if(!anchors.length)return saved;
    const signature=JSON.stringify(saved), resolved=[];
    try {
      for(const anchor of anchors){const linked=await this.catalog.importBilibili(anchor.value.url,anchor.number);if(!linked || linked.episode.cid!==String(anchor.value.id))return saved;resolved.push({...anchor,linked,offset:linked.episode.number-anchor.number});}
    } catch { return saved; }
    const last=resolved.at(-1);
    if(resolved.some(row=>row.linked.work.id!==last.linked.work.id || row.offset!==last.offset) || last.offset!==0 && resolved.length<2)return saved;
    const current=read(file);if(JSON.stringify(current)!==signature)return current || saved;
    saved.series ||= {};saved.series[scope]={workId:last.linked.work.id,offset:last.offset};
    for(const [key,value] of Object.entries(saved.episodes)){
      const number=Number(key.split(':')[0]),episodeTitle=key.slice(key.indexOf(':')+1),link=parseBilibiliUrl(value.url);
      const episode=last.linked.work.episodes.find(row=>link?.kind==='ep' && row.episodeId===link.id);
      if(value.platform==='bilibili' && !value.workId && seasonScope({episodeTitle})===scope && episode?.number===number+last.offset && episode.cid===String(value.id))saved.episodes[key]=this.linkedSource({work:last.linked.work,episode});
    }
    write(file,saved);return saved;
  }
  async options(raw) {
    const input = validateInput(raw); validateWorkId(input.workId);
    return this.catalog.options(input.workId, input.episodeTitle);
  }
  async segment(source, index, force = false) {
    validateSource(source);
    if (!Number.isInteger(index) || index < 0 || index * segmentSeconds[source.platform] > 24 * 3600) throw invalid('弹幕时间段无效');
    const key = `${source.platform}:${source.id}:${index}`, file = path.join(this.directory, 'segments', `${hash(key)}.json`);
    const cached = read(file), now = this.now();
    if (!force && cached && now - cached.fetchedAt < 600_000) return { ...cached, stale: false };
    if (this.pending.has(key)) return this.pending.get(key);
    if (!force && this.cooldowns.get(key) > now) {
      if (cached) return { ...cached, stale: true };
      throw Object.assign(new Error('弹幕暂不可用，请稍后刷新'), { statusCode: 503 });
    }
    if (this.active >= 4) throw Object.assign(new Error('弹幕加载繁忙，请稍后再试'), { statusCode: 503 });
    this.active++;
    const task = (async () => {
      try {
        const comments = await this.providers.segment(source, index);
        this.cooldowns.delete(key);
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
