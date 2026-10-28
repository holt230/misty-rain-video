import { SilentSearchEngine } from './silentSearchEngine';
import type { ResourceItem } from '../types/search';

/** A prefetch only reads metadata. It never transfers files or opens playback sessions. */
export async function findPlaybackCandidates(keyword: string, currentUrl: string, signal: AbortSignal, publish: (items: ResourceItem[]) => void, force=false, unavailable:(urls:string[])=>void=()=>{}) {
  const engine = new SilentSearchEngine();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timeout = setTimeout(cancel, 20_000);
  const pause = () => new Promise<void>((resolve, reject) => {
    if (controller.signal.aborted) { reject(new DOMException('Cancelled','AbortError')); return; }
    const aborted = () => { clearTimeout(timer); reject(new DOMException('Cancelled','AbortError')); };
    const timer = setTimeout(() => { controller.signal.removeEventListener('abort', aborted); resolve(); }, 1200);
    controller.signal.addEventListener('abort', aborted, { once: true });
  });
  const valid = new Map<string, ResourceItem>();
  let uncertain=false,forceValidation=force;
  try {
    let result = await engine.prefetch(keyword, controller.signal, force);
    for (let attempt = 0; attempt < 12 && !controller.signal.aborted; attempt++) {
      const candidates = result?.quarkItems.filter(item => item.url.split(/[?#]/)[0] !== currentUrl.split(/[?#]/)[0]).slice(0, 12) || [];
      if (candidates.length) {
        const checked = await engine.validateResources(candidates, forceValidation, controller.signal);
        forceValidation=false;
        if (controller.signal.aborted) break;
        for (const item of candidates) {
          const status = checked.entries.find(entry => entry.url === item.url)?.status;
          if (status === 'available') valid.set(item.url, { ...item, linkStatus: status });
          if (status === 'unavailable') { valid.delete(item.url); unavailable([item.url]); }
          if (!status || ['unknown','restricted','pending','deferred'].includes(status)) uncertain=true;
        }
        publish([...valid.values()].slice(0,5));
        if (valid.size >= 3 || !checked.pending && !result?.refreshing) break;
      } else if (!result?.refreshing) break;
      await pause();
      result = await engine.readCached(keyword, controller.signal) || result;
    }
  } catch (error) {
    if (!controller.signal.aborted && !valid.size) throw error;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  return {items:[...valid.values()].slice(0,5),complete:!uncertain&&!controller.signal.aborted};
}
