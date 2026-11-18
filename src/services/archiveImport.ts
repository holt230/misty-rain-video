import { ref } from 'vue';
import { authFetch } from './authService';
import { apiUrl } from './appUrl';
import type { MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import { LibrarySaveError } from './libraryFeedback';
interface Job { id:string;status:'running'|'failed'|'success';message:string;media?:MediaItem;summary?:string;error?:{code:string;message:string} }
const request = async (url:string,init?:RequestInit):Promise<Job> => {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await authFetch(apiUrl(url),{...init,signal:controller.signal});
    const body=await response.json();
    if(!response.ok||body.code!==0||!body.data)throw new LibrarySaveError(body.message||'解压任务暂时无法连接',String(body.code||'ARCHIVE_CONNECTION_FAILED'));
    return body.data;
  } finally { clearTimeout(timer); }
};
export const archiveImportMessage=ref('');
export async function importArchiveResource(media:MediaItem,resource:ResourceItem,category:MediaItem['category']):Promise<{media:MediaItem;summary:string}> {
  const archive=resource.archivePreparation;
  if(!archive)throw new LibrarySaveError('该结果不是可解压的资源','INVALID_ARCHIVE_REQUEST');
  let job=await request('/api/library/archive-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    title:media.title,category,shareUrl:resource.url,archiveFid:archive.archiveFid,episode:archive.episode,passcode:resource.password||'',
    year:media.year||resource.year||'',catalogId:media.catalogId||'',poster:media.poster||''
  })});
  const deadline=Date.now()+240000;
  while(job.status==='running'&&Date.now()<deadline){
    archiveImportMessage.value=job.message||'正在云端解压核对…';
    await new Promise(resolve=>setTimeout(resolve,1200));
    job=await request('/api/library/archive-jobs/'+encodeURIComponent(job.id));
  }
  if(job.status!=='success'||!job.media)throw new LibrarySaveError(job.error?.message||job.message||'任务仍在云端进行，请稍后检查片库',job.error?.code||'ARCHIVE_TASK_PENDING');
  return {media:job.media,summary:job.summary||'已解压并核对实际视频'};
}
