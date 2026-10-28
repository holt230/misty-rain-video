import fs from 'node:fs';
import path from 'node:path';
import { parseBilibiliUrl, isBilibiliMainEpisode } from './bilibili.js';

const fail = message => Object.assign(new Error(message), { code:'DANMAKU_CATALOG_UNAVAILABLE', statusCode:502 });
const clean = value => String(value || '').replace(/<[^>]*>/g, '').trim().slice(0,160);
const key = value => clean(value).normalize('NFKC').toLowerCase().replace(/(?:19|20)\d{2}|[\s·:：_《》【】\[\]()（）-]/g, '');
const categoryByType = { 1:'4', 2:'1', 3:'2', 4:'4', 5:'2', 7:'3' };
const names = { 1:'电影', 2:'电视剧', 3:'综艺', 4:'动漫' };
const identifier = value => (typeof value !== 'number' || Number.isSafeInteger(value)) && /^[1-9]\d{0,18}$/.test(String(value));

export function parseBilibiliSeason(data) {
  const category = categoryByType[data?.type];
  if (!category || !identifier(data.season_id) || !clean(data.title) || !Array.isArray(data.episodes)) throw fail('B 站作品目录暂不可用');
  const byNumber = new Map();
  for (const row of data.episodes.slice(0,3000)) {
    // Main lists also contain trailers with the SAME numeric title as the real
    // episode. Membership in episodes[] or a number alone is insufficient.
    if (!isBilibiliMainEpisode(row)) continue;
    const number = /^\d{1,5}$/.test(String(row.title)) ? Number(row.title) : category === '1' && data.episodes.length === 1 ? 1 : 0;
    const episodeId = String(row.id || row.ep_id || '');
    if (number < 1 || number > 10000 || !identifier(episodeId) || !identifier(row.cid)) continue;
    const previous = byNumber.get(number);
    if (byNumber.has(number) && (!previous || previous.episodeId !== episodeId || previous.cid !== String(row.cid))) { byNumber.set(number,null); continue; }
    byNumber.set(number, { platform:'bilibili',number,episodeId,cid:String(row.cid),title:category === '1' ? '正片' : `第 ${number} 集`,url:`https://www.bilibili.com/bangumi/play/ep${episodeId}` });
  }
  return { id:`bili:${category}:${data.season_id}`,seasonId:String(data.season_id),title:clean(data.title),category,categoryLabel:names[category],
    year:String(data.publish?.pub_time || '').match(/^(?:19|20)\d{2}/)?.[0] || '',platforms:['bilibili'],
    episodes:[...byNumber.values()].filter(Boolean).sort((a,b)=>a.number-b.number) };
}

export class BilibiliCatalog {
  constructor(request, directory) {
    this.request=request; this.cache=new Map(); this.pending=new Map(); this.known=new Map(); this.searchCooldown=0;
    this.file=directory ? path.join(directory,'bilibili-works.json') : null;
    if (this.file) {
      try { for (const work of JSON.parse(fs.readFileSync(this.file,'utf8')).slice(-200)) if (/^bili:[1-4]:[1-9]\d{0,18}$/.test(work.id) && typeof work.title==='string') this.known.set(work.id,work); } catch { /* Empty index on first use. */ }
    }
  }
  async cached(cacheKey, load) {
    const found=this.cache.get(cacheKey); if(found && Date.now()-found.at<600000) return found.value;
    if(this.pending.has(cacheKey)) return this.pending.get(cacheKey);
    const task=load().then(value=>{this.cache.delete(cacheKey);this.cache.set(cacheKey,{at:Date.now(),value});if(this.cache.size>64)this.cache.delete(this.cache.keys().next().value);return value;}).finally(()=>this.pending.delete(cacheKey));
    this.pending.set(cacheKey,task); return task;
  }
  remember(work) {
    const summary={id:work.id,title:work.title,year:work.year,category:work.category,categoryLabel:work.categoryLabel,platforms:['bilibili']};
    if(JSON.stringify(this.known.get(work.id))===JSON.stringify(summary)) return;
    this.known.delete(work.id);this.known.set(work.id,summary);if(this.known.size>200)this.known.delete(this.known.keys().next().value);
    if(this.file){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=`${this.file}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify([...this.known.values()]),{mode:0o600});fs.renameSync(temp,this.file);}
  }
  async season(id, episode=false) {
    if(!identifier(id))throw fail('B 站作品编号无效');
    if(episode)for(const cached of this.cache.values())if(Date.now()-cached.at<600000 && cached.value?.episodes?.some(row=>row.episodeId===String(id)))return cached.value;
    const work=await this.cached(`${episode?'ep':'ss'}:${id}`,async()=>{
      const result=(await this.request(`https://api.bilibili.com/pgc/view/web/season?${episode?'ep_id':'season_id'}=${id}`)).json();
      if(result.code!==0)throw fail('B 站作品目录暂不可用');return parseBilibiliSeason(result.result);
    });
    this.cache.set(`ss:${work.seasonId}`,{at:Date.now(),value:work});this.remember(work);return work;
  }
  async link(url, number) {
    const parsed=parseBilibiliUrl(url);
    if(!parsed || !['ep','ss'].includes(parsed.kind))return null;
    const work=await this.season(parsed.id,parsed.kind==='ep');
    const episode=work.episodes.find(item=>parsed.kind==='ep' ? item.episodeId===parsed.id : item.number===number);
    return episode ? {work,episode} : null;
  }
  async search(query) {
    const keyword=key(query);
    const known=()=>[...this.known.values()].filter(work=>keyword && key(work.title).includes(keyword));
    const saved=known();
    if(saved.length || Date.now()<this.searchCooldown)return saved;
    try {
      const found=await this.cached(`search:${query}`,async()=>{
        const result=(await this.request(`https://api.bilibili.com/x/web-interface/search/type?${new URLSearchParams({search_type:'media_bangumi',keyword:query})}`)).json();
        if(result.code!==0 || !Array.isArray(result.data?.result))throw fail('B 站检索暂不可用');
        return result.data.result.slice(0,20).filter(row=>identifier(row.season_id) && clean(row.title)).map(row=>({id:`bili:4:${row.season_id}`,title:clean(row.title),category:'4',categoryLabel:'动漫',platforms:['bilibili'],year:typeof row.pubtime==='number' && row.pubtime>0 ? String(new Date(row.pubtime*1000).getUTCFullYear()) : ''}));
      });
      found.forEach(work=>this.remember(work));return found;
    } catch { this.searchCooldown=Date.now()+600000;return known(); }
  }
}
