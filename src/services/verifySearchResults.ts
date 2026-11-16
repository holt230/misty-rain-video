import type { CategoryType } from '../types/media';
import type { ResourceItem, SearchCategory } from '../types/search';
import type { QuarkShareDetails } from './quarkStreamService';
import { validatesCatalogShare } from './catalogMatching';
import { resourceCompleteness } from './resourceCompleteness';
import { resourceEpisode } from './resourceMatching';

interface Options {
  title: string;
  category: SearchCategory;
  year?: string;
  episode?: number;
  signal: AbortSignal;
  inspect: (resource: ResourceItem, signal: AbortSignal) => Promise<QuarkShareDetails>;
  progress: (message: string) => void;
}
export interface VerifiedSearchResults { resources: ResourceItem[]; message: string; error?: string; needsAuth?: boolean }
const ancillary = /预告|花絮|片头|片尾|主题曲|幕后|宣传片|(?:^|[\s._-])(?:op|ed|mv)(?:[\s._-]|$)/i;

export async function verifySearchResults(resources: ResourceItem[], options: Options): Promise<VerifiedSearchResults> {
  const accepted: ResourceItem[] = [];
  let reason = '', error = '', needsAuth = false;
  const label = `《${options.title}》${options.episode ? `第 ${options.episode} 集` : ''}`;
  const deadline = Date.now() + 12_000;
  const rows = resources.slice(0, 6);
  for (let start = 0; start < rows.length && !options.signal.aborted && !needsAuth && Date.now() < deadline; start += 2) {
    options.progress(`正在核对${label}的实际视频文件…`);
    await Promise.all(rows.slice(start, start + 2).map(async resource => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      options.signal.addEventListener('abort', cancel, { once: true });
      if (options.signal.aborted) controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const details = await Promise.race([options.inspect(resource, controller.signal), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('核对剧集超时，请重试')); }, Math.max(1, Math.min(6000, deadline - Date.now())));
        })]);
        if (options.signal.aborted) return;
        const category: CategoryType | undefined = options.category === 'all' ? resource.category : options.category;
        if (!category) { reason = '无法确认作品类型。'; return; }
        if (!validatesCatalogShare({ title: options.title, category, year: options.year || resource.year }, details, resource)) {
          reason = '分享中的内容与片名或版本不符。'; return;
        }
        if (options.episode) {
          const files = details.entries.filter(entry => entry.isVideo && entry.episodeNumber === options.episode && !ancillary.test(entry.name)).sort((a, b) => b.size - a.size);
          if (!files[0]?.fid) { reason = `分享中没有第 ${options.episode} 集。`; return; }
          accepted.push({ ...resource, category, verification: { summary: `已核对第 ${options.episode} 集的视频文件`, episodeCount: 1,
            latestEpisode: options.episode, requestedEpisode: options.episode, selectedFids: [files[0].fid], requiredEpisodes: [options.episode], shareTitle: details.title } });
          return;
        }
        const coverage = resourceCompleteness(details, category, resource.latestEpisode || resourceEpisode(resource.title));
        if (!coverage.complete) {
          reason = coverage.missing.length ? `实际可识别 ${coverage.available} 集，缺少 ${coverage.missing.length} 集。` : '无法确认是否包含当前全部剧集。'; return;
        }
        accepted.push({ ...resource, category, verification: {
          summary: category === 'movie' ? '已核对可用正片文件' : `已核对第 1～${coverage.actualLatest} 集，共 ${coverage.available} 集`,
          episodeCount: coverage.available, latestEpisode: coverage.actualLatest,
          selectedFids: category === 'movie' ? coverage.selectedFids : undefined,
          requiredEpisodes: category === 'movie' ? [] : Array.from({ length: coverage.actualLatest }, (_, i) => i + 1),
          shareTitle: details.title
        } });
      } catch (failure) {
        if (options.signal.aborted) return;
        const e = failure as { code?: string; status?: number; statusCode?: number; message?: string };
        if ([401, 403].includes(e.status || e.statusCode || 0) || /AUTH_REQUIRED/.test(e.code || '')) {
          needsAuth = true; error = '需要有效的网盘认证才能核对视频文件，请先完成认证。';
        } else if (/SHARE_UNAVAILABLE|SHARE_EMPTY|SHARE_NOT_FOUND|SHARE_EXPIRED/.test(e.code || '')) reason = '分享已失效或没有可用视频。';
        else error = e.message || '视频文件暂时无法核对，请重试。';
      } finally { clearTimeout(timer); options.signal.removeEventListener('abort', cancel); }
    }));
  }
  if (options.signal.aborted) return { resources: [], message: '' };
  const verified = rows.filter(row => accepted.some(item => item.url === row.url)).map(row => accepted.find(item => item.url === row.url)!);
  if (verified.length && !needsAuth) return { resources: verified, message: '' };
  if (error) return { resources: [], message: '', error, needsAuth };
  return { resources: [], message: `未找到${label}的${options.episode ? '可用视频' : '完整可用资源'}。${reason}` };
}
