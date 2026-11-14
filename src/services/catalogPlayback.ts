import type { CatalogItem } from '../types/catalog';
import type { ResourceItem } from '../types/search';
import type { QuarkShareDetails } from './quarkStreamService';
import { automaticCatalogCandidates, validatesCatalogShare } from './catalogMatching';

interface AutomaticPlaybackOptions {
  resources: () => ResourceItem[];
  searching: () => boolean;
  cancelled: () => boolean;
  inspect: (resource: ResourceItem) => Promise<QuarkShareDetails>;
  save: (resource: ResourceItem) => Promise<boolean>;
  progress: (message: string) => void;
  now?: () => number;
  wait?: () => Promise<void>;
}
export async function prepareCatalogPlayback(item: CatalogItem, options: AutomaticPlaybackOptions) {
  const now = options.now || Date.now;
  const wait = options.wait || (() => new Promise<void>(resolve => setTimeout(resolve, 250)));
  const deadline = now() + 30_000;
  const checked = new Set<string>();
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
    options.progress('正在核对第 ' + checked.size + ' 个片源的片名、年份与正片内容…');
    let details: QuarkShareDetails;
    try { details = await options.inspect(resource); }
    catch (error) {
      if (options.cancelled()) return { status: 'cancelled' as const, attempts: checked.size };
      const failure = error as { code?: string; status?: number; statusCode?: number };
      const status = failure.status || failure.statusCode;
      if ([401, 403, 429].includes(status || 0) || /AUTH_REQUIRED|RISK_CONTROL/.test(failure.code || '')) {
        return { status: 'manual' as const, attempts: checked.size, message: '片源访问或认证受限，请检查播放认证后重试。' };
      }
      continue;
    }
    if (options.cancelled()) return { status: 'cancelled' as const, attempts: checked.size };
    if (!validatesCatalogShare(item, details)) continue;
    options.progress('已核对片源，正在加入片库…');
    const saved = await options.save(resource);
    return { status: saved ? 'saved' as const : 'failed' as const, attempts: checked.size };
  }
  return {
    status: 'manual' as const, attempts: checked.size,
    message: checked.size
      ? '已核对 ' + checked.size + ' 个片源，暂未找到内容可确认的版本；请查看资源详情后选择。'
      : '已自动搜索片名，但年份或版本信息不足；请选择合适的片源。'
  };
}
