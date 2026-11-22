import type { ResourceItem } from '../types/search';
import type { QuarkShareDetails } from './quarkStreamService';
import { automaticCatalogCandidates, matchedShareDetails, fileSelection, type PlaybackWork } from './catalogMatching';
import { resourceCompleteness } from './resourceCompleteness';
import { resourceEpisode } from './resourceMatching';
import { workFormat } from '../../server/searchTitles.js';

interface AutomaticPlaybackOptions {
  resources: () => ResourceItem[];
  searching: () => boolean;
  cancelled: () => boolean;
  inspect: (resource: ResourceItem, signal?: AbortSignal) => Promise<QuarkShareDetails>;
  save: (resource: ResourceItem, selectedFids?: string[]) => Promise<boolean>;
  officialLatest?: number;
  previewBatch?: (resource: ResourceItem) => Promise<boolean>;
  progress: (message: string) => void;
  now?: () => number;
  wait?: () => Promise<void>;
}
export async function prepareCatalogPlayback(item: PlaybackWork, options: AutomaticPlaybackOptions) {
  const format = workFormat(item.title, item.category);
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
    if (item.category === 'tv' && resource.batchEligible && options.previewBatch) {
      options.progress('已找到剧集，正在检查还缺多少集…');
      const prepared = await options.previewBatch(resource);
      return { status: prepared ? 'planned' as const : 'failed' as const, attempts: checked.size };
    }
    if (resource.archivePreparation && (!resource.verification || (resource.archivePreparation.batchEligible && resource.verification.complete === false))) {
      lastSourceError = '已找到资源，可在结果中保存到片库。';
      continue;
    }
    if (resource.verification) {
      if (resource.verification.complete === false && format !== 'anime') {
        lastSourceError = resource.verification.notice || '只找到部分剧集，可查看实际集数后手动保存。';
        continue;
      }
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
    details = matchedShareDetails(item, details, resource, item.category === 'anime');
    if (!details.videoCount) continue;
    const target = item.category === 'tv' ? options.officialLatest || 0 : resource.latestEpisode || resourceEpisode(resource.title);
    const coverage = resourceCompleteness(details, format, target, resource.title);
    if (!coverage.complete && !(format === 'anime' && coverage.available > 0)) {
      if (!bestPartial || coverage.available > bestPartial.available) bestPartial = coverage;
      options.progress(`当前来源实际可识别 ${coverage.available} 集，缺 ${coverage.missing.length} 集，继续核对其他来源…`);
      continue;
    }
    options.progress(format === 'movie' ? '已核对正片文件，正在加入片库…' : `已核对 ${coverage.available} 集视频，正在保存…`);
    const saved = await options.save({ ...resource, verification: { summary: '已核对视频文件', episodeCount: coverage.available,
      latestEpisode: coverage.actualLatest, shareTitle: details.title, requiredEpisodes: coverage.episodes,
      ...fileSelection(details, coverage.selectedFids) } }, coverage.selectedFids);
    return { status: saved ? 'saved' as const : 'failed' as const, attempts: checked.size };
  }
  return {
    status: 'manual' as const, attempts: checked.size,
    message: bestPartial ? ('reason' in bestPartial && bestPartial.reason ? bestPartial.reason + '未执行入库。' : `暂未找到完整片源：已核实的来源最多有 ${bestPartial.available} 集，目标 ${bestPartial.target} 集，缺 ${bestPartial.missing.length} 集。未执行入库，请稍后重试。`) : checked.size
      ? `已核对 ${checked.size} 个片源，暂未找到可用的完整版本。${lastSourceError ? '来源反馈：' + lastSourceError : '请稍后重试。'}`
      : '未找到可自动确认的完整片源，请稍后重试。'
  };
}
