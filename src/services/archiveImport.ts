import { ref } from 'vue';
import { authFetch } from './authService';
import { apiUrl } from './appUrl';
import type { MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import { LibrarySaveError } from './libraryFeedback';
interface Job { id:string;status:'running'|'failed'|'success';message:string;media?:MediaItem;summary?:string;error?:{code:string;message:string} }
export interface ArchiveBatchPreview {
  token: string; title: string; targetFid: string; officialLatest: number; officialPlatform: string;
  existingEpisodes: number[]; plannedEpisodes: number[]; missingEpisodes: number[];
  totalArchiveBytes: number; totalVideoBytes: number; recommendedFreeBytes: number; freeBytes?: number; unavailableSources: number; qualities: string[];
  canStart: boolean; reason: string;
}
export interface ArchiveBatchJob {
  id: string; title: string; category: 'tv'; targetFid: string; status: 'running' | 'success' | 'failed' | 'paused';
  message: string; officialLatest: number; total: number; completedEpisodes: number[]; currentEpisode: number;
  cleanupPendingCount: number; updatedAt: string; error?: { code: string; message: string };
}
const request = async <T>(url:string,init?:RequestInit,timeoutMs=15000):Promise<T> => {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await authFetch(apiUrl(url),{...init,signal:controller.signal});
    const body=await response.json();
    if(!response.ok||body.code!==0||!body.data)throw new LibrarySaveError(body.message||'暂时无法连接片库',String(body.code||'ARCHIVE_CONNECTION_FAILED'));
    return body.data;
  } finally { clearTimeout(timer); }
};
export const archiveImportMessage=ref('');
export async function importArchiveResource(media:MediaItem,resource:ResourceItem,category:MediaItem['category']):Promise<{media:MediaItem;summary:string}> {
  const archive=resource.archivePreparation;
  if(!archive)throw new LibrarySaveError('该结果不是可解压的资源','INVALID_ARCHIVE_REQUEST');
  let job=await request<Job>('/api/library/archive-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    title:media.title,category,shareUrl:resource.url,archiveFid:archive.archiveFid,episode:archive.episode,passcode:resource.password||'',
    quarkFid:media.quarkFid||'',year:media.year||resource.year||'',catalogId:media.catalogId||'',poster:media.poster||''
  })});
  const deadline=Date.now()+240000;
  while(job.status==='running'&&Date.now()<deadline){
    archiveImportMessage.value=job.message||'正在保存，请稍候…';
    await new Promise(resolve=>setTimeout(resolve,1200));
    job=await request<Job>('/api/library/archive-jobs/'+encodeURIComponent(job.id));
  }
  if(job.status!=='success'||!job.media)throw new LibrarySaveError(job.error?.message||job.message||'任务仍在云端进行，请稍后检查片库',job.error?.code||'ARCHIVE_TASK_PENDING');
  return {media:job.media,summary:job.summary||'已保存到片库'};
}

const batchInput = (media: MediaItem, resource: ResourceItem) => ({
  title: media.title, category: 'tv', shareUrl: resource.url, quarkFid: media.quarkFid || '',
  year: media.year || resource.year || '', catalogId: media.catalogId || '', poster: media.poster || ''
});
export const previewArchiveBatch = (media: MediaItem, resource: ResourceItem) => request<ArchiveBatchPreview>(
  '/api/library/archive-batches/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchInput(media, resource)) }, 40000
);
export const startArchiveBatch = (media: MediaItem, resource: ResourceItem, token: string) => request<ArchiveBatchJob>(
  '/api/library/archive-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...batchInput(media, resource), token }) }, 40000
);
export const listArchiveBatches = () => request<ArchiveBatchJob[]>('/api/library/archive-batches');
export const stopArchiveBatch = (id: string) => request<ArchiveBatchJob>(
  `/api/library/archive-batches/${encodeURIComponent(id)}/stop`, { method: 'POST' }
);
export const continueArchiveBatch = (id: string) => request<ArchiveBatchJob>(
  `/api/library/archive-batches/${encodeURIComponent(id)}/resume`, { method: 'POST' }, 40000
);
export const archiveBytes = (bytes: number) => {
  const unit = bytes >= 1000 ** 4 ? 'TB' : bytes >= 1000 ** 3 ? 'GB' : 'MB';
  const divisor = unit === 'TB' ? 1000 ** 4 : unit === 'GB' ? 1000 ** 3 : 1000 ** 2;
  return `${(bytes / divisor).toFixed(1).replace(/\.0$/, '')} ${unit}`;
};
