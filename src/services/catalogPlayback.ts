import type { ResourceItem } from '../types/search';
import type { QuarkShareDetails } from './quarkStreamService';
import { automaticCatalogCandidates, validatesCatalogShare, type PlaybackWork } from './catalogMatching';
import { resourceCompleteness } from './resourceCompleteness';
import { resourceEpisode } from './resourceMatching';

interface AutomaticPlaybackOptions {
  resources: () => ResourceItem[];
  searching: () => boolean;
  cancelled: () => boolean;
  inspect: (resource: ResourceItem, signal?: AbortSignal) => Promise<QuarkShareDetails>;
  save: (resource: ResourceItem, selectedFids?: string[]) => Promise<boolean>;
  progress: (message: string) => void;
  now?: () => number;
  wait?: () => Promise<void>;
}
export async function prepareCatalogPlayback(item: PlaybackWork, options: AutomaticPlaybackOptions) {
  const now = options.now || Date.now;
  const wait = options.wait || (() => new Promise<void>(resolve => setTimeout(resolve, 250)));
  const deadline = now() + 30_000;
  const checked = new Set<string>();
  let bestPartial: ReturnType<typeof resourceCompleteness> | undefined;
  let lastSourceError = '';
  while (now() < deadline && checked.size < 12) {
    if (options.cancelled()) return { status: 'cancelled' as const, attempts: checked.size };
    const resource = automaticCatalogCandidates(item, options.resources()).find(candidate => !checked.has(candidate.url));
    if (!resource) {
      if (!options.searching()) break;
      options.progress('正在等待其他来源，找到匹配片源后会继续核对…');
      await wait();
      continue;
    }
    checked.add(resource.url);
    if (resource.verification) {
      if (options.cancelled()) return { status: 'cancelled' as const, attempts: checked.size };
      options.progress('剧集已核对，正在保存到片库…');
      const saved = await options.save(resource, resource.verification.selectedFids);
      return { status: saved ? 'saved' as const : 'failed' as const, attempts: checked.size };
    }
    options.progress('正在核对第 ' + checked.size + ' 个片源的片名、年份与正片内容…');
    let details: QuarkShareDetails;
    const controller = new AbortController();
    let inspectionTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      details = await Promise.race([options.inspect(resource, controller.signal), new Promise<never>((_, reject) => {
        inspectionTimer = setTimeout(() => { controller.abort(); reject(new Error('核对片源目录超时')); }, Math.max(1, Math.min(8000, deadline - now())));
      })]);
    }
    catch (error) {
      if (options.cancelled()) return { status: 'cancelled' as const, attempts: checked.size };
      const failure = error as { code?: string; status?: number; statusCode?: number };
      const status = failure.status || failure.statusCode;
      if ([401, 403, 429].includes(status || 0) || /AUTH_REQUIRED|RISK_CONTROL/.test(failure.code || '')) {
        return { status: 'manual' as const, attempts: checked.size, message: '片源访问或认证受限，请检查播放认证后重试。' };
      }
      lastSourceError = error instanceof Error ? error.message : '片源访问失败';
      continue;
    }
    finally { clearTimeout(inspectionTimer); }
    if (options.cancelled()) return { status: 'cancelled' as const, attempts: checked.size };
    if (!validatesCatalogShare(item, details, resource)) continue;
    let selectedFids: string[] | undefined;
    {
      const coverage = resourceCompleteness(details, item.category, resource.latestEpisode || resourceEpisode(resource.title));
      if (!coverage.complete) {
        if (!bestPartial || coverage.available > bestPartial.available) bestPartial = coverage;
        options.progress(`当前来源实际可识别 ${coverage.available} 集，缺 ${coverage.missing.length} 集，继续核对其他来源…`);
        continue;
      }
      // A fully verified series retains the whole-source scope so future
      // updates can add episode 220+, instead of freezing the selected FIDs.
      selectedFids = item.category === 'movie' && coverage.selectedFids.length ? coverage.selectedFids : undefined;
      options.progress(item.category === 'movie' ? '已核对正片文件，正在加入片库…' : `已核对第 1～${coverage.actualLatest} 集连续完整，正在加入片库…`);
    }
    const saved = await options.save(resource, selectedFids);
    return { status: saved ? 'saved' as const : 'failed' as const, attempts: checked.size };
  }
  return {
    status: 'manual' as const, attempts: checked.size,
    message: bestPartial ? ('reason' in bestPartial && bestPartial.reason ? bestPartial.reason + '未执行入库。' : `暂未找到完整片源：已核实的来源最多有 ${bestPartial.available} 集，目标 ${bestPartial.target} 集，缺 ${bestPartial.missing.length} 集。未执行入库，请稍后重试。`) : checked.size
      ? `已核对 ${checked.size} 个片源，暂未找到可用的完整版本。${lastSourceError ? '来源反馈：' + lastSourceError : '请稍后重试。'}`
      : '未找到可自动确认的完整片源，请稍后重试。'
  };
}
