const invalid = message => Object.assign(new Error(message), { code:'DANMAKU_UNAVAILABLE',statusCode:502 });
const hosts = new Set(['www.bilibili.com','bilibili.com','m.bilibili.com']);
export const isBilibiliMainEpisode = row => Number(row.section_type || 0) === 0 && Number(row.pv || 0) === 0
  && !/预告|花絮|先导|特典|PV|trailer/i.test(`${row.badge || ''} ${row.show_title || ''}`);
export function parseBilibiliUrl(value) {
  try {
    const url=new URL(String(value));
    if(!['https:','http:'].includes(url.protocol)||url.port||url.username||url.password)return null;
    if(url.hostname==='b23.tv'&&/^\/[A-Za-z0-9]{3,24}\/?$/.test(url.pathname))return {platform:'bilibili',kind:'short',id:url.pathname.replaceAll('/',''),url:`https://b23.tv/${url.pathname.replaceAll('/','')}`};
    if(!hosts.has(url.hostname))return null;
    const video=url.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av[1-9]\d{0,18})\/?$/);
    if(video){
      const page=Number(url.searchParams.get('p')||1);
      if(url.searchParams.getAll('p').length>1||!Number.isInteger(page)||page<1||page>10000)return null;
      return {platform:'bilibili',kind:'video',id:video[1],page,url:`https://www.bilibili.com/video/${video[1]}/${page>1?`?p=${page}`:''}`};
    }
    const episode=url.pathname.match(/^\/bangumi\/play\/(ep|ss)([1-9]\d{0,18})\/?$/);
    return episode?{platform:'bilibili',kind:episode[1],id:episode[2],url:`https://www.bilibili.com/bangumi/play/${episode[1]}${episode[2]}`}:null;
  }catch{return null;}
}

export async function resolveBilibili(source,request,episodeNumber=1,depth=0){
  if(source.kind==='short'){
    if(depth)throw invalid('短链接未能解析，请使用完整的 B 站剧集链接');
    const response=await request(source.url,{allowRedirect:true});
    const next=parseBilibiliUrl(response.location);
    if(!next||next.kind==='short')throw invalid('短链接未能解析，请使用完整的 B 站剧集链接');
    return resolveBilibili(next,request,episodeNumber,depth+1);
  }
  let row;
  if(source.kind==='video'){
    const query=source.id.startsWith('BV')?{bvid:source.id}:{aid:source.id.slice(2)};
    const data=(await request(`https://api.bilibili.com/x/player/pagelist?${new URLSearchParams(query)}`)).json();
    if(data.code!==0||!Array.isArray(data.data))throw invalid('B 站视频信息暂时不可用');
    row=data.data.find(part=>Number(part.page)===source.page);
  }else{
    const query=source.kind==='ep'?{ep_id:source.id}:{season_id:source.id};
    const data=(await request(`https://api.bilibili.com/pgc/view/web/season?${new URLSearchParams(query)}`)).json();
    if(data.code!==0||!data.result)throw invalid('B 站剧集信息暂时不可用');
    const episodes=Array.isArray(data.result.episodes)?data.result.episodes:[];
    if(source.kind==='ep'){
      const extras=(Array.isArray(data.result.section)?data.result.section:[]).flatMap(section=>Array.isArray(section.episodes)?section.episodes:[]);
      row=[...episodes,...extras].find(episode=>String(episode.id)===source.id);
    }else{
      // Never infer an ordinal from array position: PVs/specials and sparse
      // episode lists must not silently select the wrong recording.
      const regular=episodes.filter(isBilibiliMainEpisode);
      const matches=regular.filter(episode=>/^\d+$/.test(String(episode.title))&&Number(episode.title)===episodeNumber);
      row=matches.length===1?matches[0]:regular.length===1&&episodeNumber===1?regular[0]:undefined;
    }
  }
  if(!row)throw invalid('没有找到对应分 P 或集数，请粘贴具体剧集链接');
  if(typeof row.cid==='number'&&!Number.isSafeInteger(row.cid))throw invalid('B 站弹幕编号无效');
  const cid=String(row.cid||'');
  if(!/^[1-9]\d{0,18}$/.test(cid))throw invalid('B 站弹幕编号无效');
  return {platform:'bilibili',id:cid,url:source.url};
}

// Only the ordinary text fields of DmSegMobileReply/DanmakuElem are decoded.
// User IDs, timestamps and executable/BAS payloads are never retained or run.
export function parseBilibiliSegment(input,start,end){
  const bytes=Buffer.from(input);
  if(bytes.length>4*1024*1024)throw invalid('B 站弹幕数据过大');
  const uint=(cursor,limit)=>{
    let value=0;
    for(let i=0;i<10;i++){
      if(cursor.offset>=limit)throw invalid('B 站弹幕数据不完整');
      const byte=bytes[cursor.offset++];
      if(i===9&&byte>1)throw invalid('B 站弹幕数字格式无效');
      value+=(byte&127)*2**(i*7);
      if(!(byte&128))return value;
    }
    throw invalid('B 站弹幕数字格式无效');
  };
  const fields=(from,to,visit)=>{
    const cursor={offset:from};let count=0;
    while(cursor.offset<to){
      if(++count>50000)throw invalid('B 站弹幕数据过多');
      const tag=uint(cursor,to),field=Math.floor(tag/8),wire=tag%8;
      if(!Number.isSafeInteger(tag)||!field)throw invalid('B 站弹幕格式无效');
      if(wire===0){visit(field,wire,uint(cursor,to));continue;}
      if(wire===2){
        const length=uint(cursor,to),offset=cursor.offset;
        if(!Number.isSafeInteger(length)||length<0||length>to-offset)throw invalid('B 站弹幕数据不完整');
        cursor.offset+=length;visit(field,wire,[offset,cursor.offset]);continue;
      }
      if(wire!==1&&wire!==5)throw invalid('B 站弹幕格式暂不支持');
      cursor.offset+=wire===1?8:4;
      if(cursor.offset>to)throw invalid('B 站弹幕数据不完整');
    }
  };
  const comments=[],seen=new Set();
  fields(0,bytes.length,(field,wire,value)=>{
    if(field!==1||wire!==2)return;
    let time=-1,mode=0,color=0xffffff,text='';
    fields(value[0],value[1],(name,type,data)=>{
      if(type===0){if(name===2)time=data/1000;else if(name===3)mode=data;else if(name===5)color=data;}
      if(type===2&&name===7)text=bytes.toString('utf8',data[0],Math.min(data[1],data[0]+2048)).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);
    });
    if(![1,2,3,4,5].includes(mode)||!text||!Number.isFinite(time)||time<start||time>=end)return;
    const key=`${time}:${text}`;if(seen.has(key)||comments.length>=8000)return;seen.add(key);
    comments.push({time,text,color:Number.isInteger(color)&&color>=0&&color<=0xffffff?`#${color.toString(16).padStart(6,'0')}`:'#ffffff',mode:mode===4?'bottom':mode===5?'top':'rtl'});
  });
  return comments.sort((a,b)=>a.time-b.time);
}
