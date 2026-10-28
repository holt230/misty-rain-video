import type { MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';

export interface SourceChoice { key:string; number:number; media:MediaItem; missing?:Record<string,number> }
export interface SourcePool { sources:SourceChoice[]; selectedKey:string; nextNumber:number; nextSearchAt:number; lastUsedAt:number }
const PREFIX='misty_rain_sources_v1:';
const HOUR=3600_000, RETENTION=7*24*HOUR, MAX_WORKS=40, MAX_SOURCES=8;
const shareUrl=(url?:string)=>(typeof url==='string'?url:'').match(/^https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]{1,80})(?:[?#]|$)/)?.[1] || '';
export const playbackSourceKey=(media:MediaItem)=>shareUrl(media.quarkShareUrl)?`share:${shareUrl(media.quarkShareUrl)}`:media.quarkFid?`folder:${media.quarkFid}`:'';
export const playbackWorkKey=(media:MediaItem)=>media.catalogId?`catalog:${media.catalogId}`:JSON.stringify([media.category,media.title.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase(),media.year||'']);
export const sourceEpisodeKey=(episode:{seasonNumber?:number;episodeNumber:number;fileName:string;ancillary?:boolean})=>episode.episodeNumber>0&&!episode.ancillary?`${episode.seasonNumber||1}:${episode.episodeNumber}`:episode.fileName;

// Pick durable metadata only. Signed stream URLs, sessions and initial-episode
// overrides must never become a persisted source or leak into a later playback.
function durableMedia(media:MediaItem):MediaItem {
  const text=(value:unknown,max=300)=>typeof value==='string'?value.slice(0,max):'';
  const share=shareUrl(media.quarkShareUrl);
  return {id:text(media.id),title:text(media.title),category:media.category,year:text(media.year,12),catalogId:text(media.catalogId,80)||undefined,danmakuKey:text(media.danmakuKey,256)||undefined,
    poster:text(media.poster,2048),tag:text(media.tag,100),quarkFid:text(media.quarkFid,150)||undefined,
    quarkShareUrl:share?`https://pan.quark.cn/s/${share}`:undefined,quarkPasscode:text(media.quarkPasscode,80),quarkQuality:text(media.quarkQuality,100)};
}

export class PlaybackSourceCache {
  private skipDisk=new Set<string>();
  private memory=new Map<string,Record<string,SourcePool>>();
  constructor(private storage:()=>Storage=()=>localStorage,private now:()=>number=Date.now){}
  private read(owner:string) {
    let rows=this.memory.get(owner)||{};
    try { if(this.skipDisk.has(owner))throw new Error('memory-only');const saved=JSON.parse(this.storage().getItem(PREFIX+encodeURIComponent(owner))||'null');if(saved?.version===1&&saved.entries&&typeof saved.entries==='object')rows=saved.entries; } catch { /* In-memory operation in private/full storage. */ }
    const clean:Record<string,SourcePool>={};
    for(const [key,row] of Object.entries(rows)){
      if(!row||!Array.isArray(row.sources)||!Number.isFinite(row.lastUsedAt)||this.now()-row.lastUsedAt>RETENTION||row.lastUsedAt>this.now()+60_000)continue;
      const seen=new Set<string>();
      const sources=row.sources.filter(source=>source?.media&&typeof source.media.id==='string'&&source.media.id.length>0&&typeof source.media.title==='string'&&['tv','movie','anime','variety'].includes(source.media.category)&&source.key===playbackSourceKey(source.media)&&source.key&&Number.isInteger(source.number)&&source.number>0&&source.number<10000&&!seen.has(source.key)&&Boolean(seen.add(source.key))).slice(0,MAX_SOURCES).map(source=>({...source,media:durableMedia(source.media),missing:Object.fromEntries(Object.entries(source.missing||{}).filter(([,until])=>Number.isFinite(until)&&until>this.now()).slice(0,20))}));
      clean[key]={sources,selectedKey:typeof row.selectedKey==='string'?row.selectedKey:'',nextNumber:Math.max(Number.isInteger(row.nextNumber)&&row.nextNumber>0&&row.nextNumber<10000?row.nextNumber:1,...sources.map(source=>source.number+1)),nextSearchAt:Number.isFinite(row.nextSearchAt)?Math.min(row.nextSearchAt,this.now()+24*HOUR):0,lastUsedAt:row.lastUsedAt};
    }
    return Object.fromEntries(Object.entries(clean).sort((a,b)=>b[1].lastUsedAt-a[1].lastUsedAt).slice(0,MAX_WORKS));
  }
  private write(owner:string,rows:Record<string,SourcePool>){
    if(!owner)return;
    const bounded=Object.fromEntries(Object.entries(rows).sort((a,b)=>b[1].lastUsedAt-a[1].lastUsedAt).slice(0,MAX_WORKS));
    this.memory.set(owner,bounded);
    try { this.storage().setItem(PREFIX+encodeURIComponent(owner),JSON.stringify({version:1,entries:bounded}));this.skipDisk.delete(owner); } catch { this.skipDisk.add(owner); }
  }
  private mutate(owner:string,media:MediaItem,change:(pool:SourcePool)=>void):SourcePool {
    const rows=this.read(owner),key=playbackWorkKey(media);
    const pool=rows[key]||{sources:[],selectedKey:'',nextNumber:1,nextSearchAt:0,lastUsedAt:this.now()};
    change(pool);pool.lastUsedAt=this.now();rows[key]=pool;this.write(owner,rows);return pool;
  }
  private add(pool:SourcePool,media:MediaItem){
    const key=playbackSourceKey(media);if(!key)return;
    const existing=pool.sources.find(source=>source.key===key);
    if(existing){existing.media=durableMedia(existing.media.quarkFid&&!media.quarkFid?{...existing.media,quarkPasscode:media.quarkPasscode||existing.media.quarkPasscode}:media);return;}
    if(pool.sources.length>=MAX_SOURCES)return;
    pool.sources.push({key,number:pool.nextNumber++,media:durableMedia(media)});
  }
  open(owner:string,media:MediaItem){return this.mutate(owner,media,pool=>{
    // An explicitly selected resource must always have a slot, even in a full pool.
    if(!pool.sources.some(source=>source.key===playbackSourceKey(media))&&pool.sources.length>=MAX_SOURCES)pool.sources.pop();
    this.add(pool,media);pool.selectedKey=playbackSourceKey(media);
  });}
  preferred(owner:string,media:MediaItem):MediaItem {
    const rows=this.read(owner);this.write(owner,rows);
    const pool=rows[playbackWorkKey(media)],choice=pool?.sources.find(source=>source.key===pool.selectedKey);
    return choice?{...choice.media,title:media.title,category:media.category,year:media.year||choice.media.year,poster:media.poster||choice.media.poster,catalogId:media.catalogId||choice.media.catalogId}:media;
  }
  merge(owner:string,media:MediaItem,items:ResourceItem[]){return this.mutate(owner,media,pool=>{
    this.add(pool,media);
    for(const item of items){const id=shareUrl(item.url);if(!id)continue;
      this.add(pool,{...durableMedia(media),id:media.catalogId?`discovery:${media.catalogId}`:`share:${id}`,quarkFid:undefined,quarkShareUrl:`https://pan.quark.cn/s/${id}`,quarkPasscode:item.password,quarkQuality:item.quality,tag:item.quality||''});
    }
  });}
  resetFailures(owner:string,media:MediaItem){return this.mutate(owner,media,pool=>{for(const source of pool.sources)source.missing={};pool.nextSearchAt=0;});}
  searched(owner:string,media:MediaItem,result:'available'|'empty'|'uncertain') {return this.mutate(owner,media,pool=>{pool.nextSearchAt=this.now()+(result==='available'?24*HOUR:result==='empty'?HOUR:5*60_000);});}
  remove(owner:string,media:MediaItem,key:string){return this.mutate(owner,media,pool=>{pool.sources=pool.sources.filter(source=>source.key!==key);if(pool.selectedKey===key)pool.selectedKey='';});}
  missing(owner:string,media:MediaItem,key:string,episode:string){return this.mutate(owner,media,pool=>{const source=pool.sources.find(row=>row.key===key);if(source)source.missing={...source.missing,[episode]:this.now()+HOUR};});}
  clear(owner:string){this.memory.delete(owner);this.skipDisk.add(owner);try{this.storage().removeItem(PREFIX+encodeURIComponent(owner));}catch{}}
}
export const playbackSourceCache=new PlaybackSourceCache();
