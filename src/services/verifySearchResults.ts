import type { CategoryType } from '../types/media';
import type { ResourceItem, SearchCategory } from '../types/search';
import type { QuarkShareDetails } from './quarkStreamService';
import { validatesCatalogShare } from './catalogMatching';
import { episodeRangeLabel, resourceCompleteness } from './resourceCompleteness';
import { matchResource, resourceEpisode } from './resourceMatching';

interface Options {
  title: string;
  category: SearchCategory;
  year?: string;
  episode?: number;
  officialLatest?: number;
  signal: AbortSignal;
  inspect: (resource: ResourceItem, signal: AbortSignal) => Promise<QuarkShareDetails>;
  progress: (message: string) => void;
}
export interface VerifiedSearchResults { resources: ResourceItem[]; message: string; error?: string; needsAuth?: boolean }
const ancillary = /预告|花絮|片头|片尾|主题曲|幕后|宣传片|(?:^|[\s._-])(?:op|ed|mv)(?:[\s._-]|$)/i;

export async function verifySearchResults(resources: ResourceItem[], options: Options): Promise<VerifiedSearchResults> {
  const accepted: ResourceItem[] = [];
  const reasons: string[] = [], errors: string[] = [];
  let needsAuth = false;
  const label = `《${options.title}》${options.episode ? `第 ${options.episode} 集` : ''}`;
  const deadline = Date.now() + 10_000;
  const target = options.episode || options.officialLatest;
  const priority = (resource: ResourceItem) => {
    const latest = resource.latestEpisode || resourceEpisode(resource.title);
    return target ? latest === target ? 2 : latest > target ? 1 : 0 : 0;
  };
  const rows = [...resources].sort((a, b) => priority(b) - priority(a) || (b.latestEpisode || resourceEpisode(b.title)) - (a.latestEpisode || resourceEpisode(a.title))
    || (b.datetime || '').localeCompare(a.datetime || '') || a.url.localeCompare(b.url)).slice(0, 18);
  for (let start = 0; start < rows.length && !options.signal.aborted && !needsAuth && Date.now() < deadline; start += 3) {
    options.progress(`正在核对${label}的实际视频文件…`);
    await Promise.all(rows.slice(start, start + 3).map(async resource => {
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
        const category: CategoryType | undefined = options.category === 'all'
          ? resource.category || matchResource(options.title, resource.title).inferred : options.category;
        if (!category) { reasons.push('无法确认作品类型。'); return; }
        if (!details.entries.some(entry => entry.isVideo && !ancillary.test(entry.name))) {
          reasons.push('分享中没有识别到正片视频文件。'); return;
        }
        if (!validatesCatalogShare({ title: options.title, category, year: options.year || resource.year }, details, resource, { allowUnspecifiedSeason: true })) {
          reasons.push('无法确认分享中的片名或版本。'); return;
        }
        if (options.episode) {
          const files = details.entries.filter(entry => entry.isVideo && entry.episodeNumber === options.episode && !ancillary.test(entry.name)).sort((a, b) => b.size - a.size);
          if (!files[0]?.fid) { reasons.push(`分享中没有第 ${options.episode} 集。`); return; }
          accepted.push({ ...resource, category, verification: { summary: `已核对第 ${options.episode} 集的视频文件`, episodeCount: 1,
            latestEpisode: options.episode, requestedEpisode: options.episode, selectedFids: [files[0].fid], requiredEpisodes: [options.episode], shareTitle: details.title, complete: true } });
          return;
        }
        const coverage = resourceCompleteness(details, category, options.officialLatest || resource.latestEpisode || resourceEpisode(resource.title));
        if (!coverage.available) {
          reasons.push('视频文件未标明可识别的集数，暂时无法确认剧集范围。'); return;
        }
        accepted.push({ ...resource, category, verification: {
          summary: category === 'movie' ? '已核对可用正片文件' : `已核对${episodeRangeLabel(coverage.episodes)}，共 ${coverage.available} 集`,
          episodeCount: coverage.available, latestEpisode: coverage.actualLatest,
          selectedFids: category === 'movie' || !coverage.complete ? coverage.selectedFids : undefined,
          requiredEpisodes: coverage.episodes,
          shareTitle: details.title, complete: coverage.complete,
          notice: coverage.complete ? '' : category === 'anime'
            ? `分段资源，仅包含以上已核对的 ${coverage.available} 集。`
            : coverage.missing.length
            ? `当前来源缺少 ${coverage.missing.length} 集，仅保存已找到的 ${coverage.available} 集。`
            : '最新更新集数尚未确认，仅保存已核对的剧集。'
        } });
      } catch (failure) {
        if (options.signal.aborted) return;
        const e = failure as { code?: string; status?: number; statusCode?: number; message?: string };
        if ([401, 403].includes(e.status || e.statusCode || 0) || /AUTH_REQUIRED/.test(e.code || '')) {
          needsAuth = true;
        } else if (/SHARE_UNAVAILABLE|SHARE_EMPTY|SHARE_NOT_FOUND|SHARE_EXPIRED/.test(e.code || '')) reasons.push('分享已失效或没有可用视频。');
        else errors.push(e.message || '视频文件暂时无法核对，请重试。');
      } finally { clearTimeout(timer); options.signal.removeEventListener('abort', cancel); }
    }));
  }
  if (options.signal.aborted) return { resources: [], message: '' };
  if (needsAuth) return { resources: [], message: '', error: '需要有效的网盘认证才能核对视频文件，请先完成认证。', needsAuth: true };
  const verified = rows.filter(row => accepted.some(item => item.url === row.url)).map(row => accepted.find(item => item.url === row.url)!)
    .sort((a, b) => b.verification!.latestEpisode - a.verification!.latestEpisode || b.verification!.episodeCount - a.verification!.episodeCount || a.url.localeCompare(b.url));
  if (verified.length) return { resources: verified, message: errors.length ? '部分分享暂时无法核对，以下仅展示已核对的视频。' : '' };
  if (errors.length) return { resources: [], message: '', error: errors.sort()[0] };
  const explanation = reasons.find(reason => reason.startsWith('分享中没有第'))
    || reasons.find(reason => reason.includes('没有识别到正片')) || [...new Set(reasons)].sort()[0] || '';
  return { resources: [], message: `未找到${label}的可用视频。${explanation}` };
}
