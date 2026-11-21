import type { CategoryType } from '../types/media';
import type { ResourceItem, SearchCategory } from '../types/search';
import type { QuarkShareDetails } from './quarkStreamService';
import { matchedShareDetails, fileSelection } from './catalogMatching';
import { episodeRangeLabel, resourceCompleteness } from './resourceCompleteness';
import { matchResource, resourceEpisode } from './resourceMatching';
import { fileSourceColor, leastCompatibleColor, sourceColorRank } from '../../server/sourceColor.js';

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
    || (b.datetime || '').localeCompare(a.datetime || '') || a.url.localeCompare(b.url));
  let inspected = 0;
  for (let start = 0; start < rows.length && !options.signal.aborted && !needsAuth && Date.now() < deadline; start += 3) {
    // Keep the normal request budget after finding usable files. If the first links are dead, keep looking within the same deadline.
    if (start >= 18 && (accepted.length || start >= 36)) break;
    options.progress(`正在核对${label}的实际视频文件…`);
    await Promise.all(rows.slice(start, start + 3).map(async resource => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      options.signal.addEventListener('abort', cancel, { once: true });
      if (options.signal.aborted) controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([options.inspect(resource, controller.signal), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('核对剧集超时，请重试')); }, Math.max(1, Math.min(6000, deadline - Date.now())));
        })]);
        if (options.signal.aborted) return;
        const category: CategoryType | undefined = options.category === 'all'
          ? resource.category || matchResource(options.title, resource.title).inferred : options.category;
        if (!category) { reasons.push('无法确认作品类型。'); return; }
        const details = matchedShareDetails({ title: options.title, category, year: options.year || resource.year }, raw, resource, true);
        const folders = new Map(details.entries.filter(entry => entry.isDirectory).map(entry => [entry.fid, entry.name]));
        const color = (file: QuarkShareDetails['entries'][number]) => fileSourceColor(file, folders, resource.title);
        const compareFiles = (a: QuarkShareDetails['entries'][number], b: QuarkShareDetails['entries'][number]) =>
          sourceColorRank(color(a)) - sourceColorRank(color(b)) || b.size - a.size || a.fid.localeCompare(b.fid);
        const archives = details.entries.filter(entry => entry.isArchive && ['zip','rar','7z'].includes(entry.archiveFormat || '')
          && Number.isInteger(entry.episodeNumber) && entry.episodeNumber > 0 && entry.episodeNumber <= 5000 && !ancillary.test(entry.name));
        const requestedArchive = options.episode ? archives.filter(entry => entry.episodeNumber === options.episode) : archives;
        const archiveEpisode = options.episode || (archives.some(entry => entry.episodeNumber === options.officialLatest) ? options.officialLatest : Math.max(0,...archives.map(entry => entry.episodeNumber)));
        const chosenArchives = requestedArchive.filter(entry => entry.episodeNumber === archiveEpisode);
        if (chosenArchives.length && archiveEpisode) {
          const file = [...chosenArchives].sort(compareFiles)[0];
          const availableEpisodes = [...new Set(requestedArchive.map(entry => entry.episodeNumber))].sort((a,b)=>a-b);
          const expectedLatest = options.officialLatest || resource.latestEpisode || resourceEpisode(resource.title);
          const missingEpisodes = !options.episode && Number.isInteger(expectedLatest) && expectedLatest > 0 && expectedLatest <= 5000
            ? Array.from({ length: expectedLatest }, (_, i) => i + 1).filter(episode => !availableEpisodes.includes(episode)) : [];
          const missingNotice = missingEpisodes.length ? `${episodeRangeLabel(missingEpisodes)}暂未找到。` : '';
          // A batch can use other folders. Describe the share's formats conservatively until the plan selects files.
          const colorFormat = category === 'tv' && !options.episode ? leastCompatibleColor(requestedArchive.map(color)) : color(file);
          accepted.push({ ...resource, category, colorFormat, batchEligible: category === 'tv' && !options.episode, archivePreparation: { archiveFid: file.fid, fileCheck: file.identityTag, episode: archiveEpisode, fileName: file.name, bytes: file.size,
            availableEpisodes, missingEpisodes, summary: `已找到${episodeRangeLabel(availableEpisodes)}的资源`,
            batchEligible: category === 'tv' && !options.episode,
            requiredMembership: '夸克SVIP', notice: category === 'tv' && !options.episode
              ? `${missingNotice}可以检查并补齐缺少的剧集。`
              : `${missingNotice}保存时会确认视频是否可播放，并占用网盘空间。` } });
        }
        if (!details.videoCount) {
          if (options.episode && archives.length && !chosenArchives.length) reasons.push(`分享中没有第 ${options.episode} 集。`);
          else if (!chosenArchives.length) reasons.push(raw.entries.some(entry => entry.isVideo || entry.isArchive)
            ? '无法确认分享中的片名或版本。' : '分享中没有识别到正片视频文件。');
          return;
        }
        if (options.episode) {
          const files = details.entries.filter(entry => entry.isVideo && entry.episodeNumber === options.episode && !ancillary.test(entry.name)).sort(compareFiles);
          if (!files[0]?.fid) { reasons.push(`分享中没有第 ${options.episode} 集。`); return; }
          const issue = category === 'variety' ? resourceCompleteness({ ...details, entries: details.entries.filter(entry => entry.isDirectory || files.includes(entry)) }, category, 0, resource.title) : undefined;
          accepted.push({ ...resource, category, colorFormat: issue?.colorFormat || color(files[0]), verification: { summary: `已核对第 ${options.episode} ${issue ? '期' : '集'}的视频文件`, episodeCount: 1,
            latestEpisode: options.episode, requestedEpisode: options.episode, ...fileSelection(details, issue?.selectedFids || [files[0].fid]), requiredEpisodes: [options.episode], shareTitle: details.title,
            complete: !issue?.partialIssue, ...(issue?.partialIssue ? { notice: '这一期仅找到部分分段。' } : {}) } });
          return;
        }
        const target = category === 'tv' ? options.officialLatest || 0 : options.officialLatest || resource.latestEpisode || resourceEpisode(resource.title);
        const coverage = resourceCompleteness(details, category, target, resource.title);
        if (!coverage.available) {
          reasons.push('视频文件未标明可识别的集数，暂时无法确认剧集范围。'); return;
        }
        const unit = category === 'variety' ? '期' : '集';
        accepted.push({ ...resource, category, colorFormat: coverage.colorFormat, batchEligible: category === 'tv', verification: {
          summary: category === 'movie' ? '已核对可用正片文件' : `已核对${episodeRangeLabel(coverage.episodes, unit)}，共 ${coverage.available} ${unit}`,
          episodeCount: coverage.available, latestEpisode: coverage.actualLatest,
          ...fileSelection(details, coverage.selectedFids),
          requiredEpisodes: coverage.episodes,
          shareTitle: details.title, complete: coverage.complete,
          notice: coverage.complete ? '' : category === 'variety'
            ? coverage.missing.length ? `${episodeRangeLabel(coverage.missing, '期')}暂未找到。` : '仅保存已核对的期数。'
            : category === 'anime'
            ? `分段资源，仅包含以上已核对的 ${coverage.available} 集。`
            : coverage.missing.length
            ? `当前来源缺少 ${coverage.missing.length} 集，整剧保存前会检查其他来源。`
            : '暂未确认播出平台更新到了哪一集。'
        } });
      } catch (failure) {
        if (options.signal.aborted) return;
        const e = failure as { code?: string; status?: number; statusCode?: number; message?: string };
        if ([401, 403].includes(e.status || e.statusCode || 0) || /AUTH_REQUIRED/.test(e.code || '')) {
          needsAuth = true;
        } else if (/SHARE_EMPTY/.test(e.code || '')) reasons.push('分享目录没有可用视频。');
        else if (/SHARE_UNAVAILABLE|SHARE_NOT_FOUND|SHARE_EXPIRED/.test(e.code || '')) reasons.push('分享已失效或没有可用视频。');
        else errors.push(e.message || '视频文件暂时无法核对，请重试。');
      } finally { inspected++; clearTimeout(timer); options.signal.removeEventListener('abort', cancel); }
    }));
  }
  if (options.signal.aborted) return { resources: [], message: '' };
  if (needsAuth) return { resources: [], message: '', error: '需要有效的网盘认证才能核对视频文件，请先完成认证。', needsAuth: true };
  const verified = rows.filter(row => accepted.some(item => item.url === row.url)).map(row => {
    const video = accepted.find(item => item.url === row.url && item.verification);
    const archive = accepted.find(item => item.url === row.url && item.archivePreparation);
    return video && archive ? { ...video, archivePreparation: archive.archivePreparation } : video || archive!;
  })
    .sort((a, b) => Number(Boolean(b.verification)) - Number(Boolean(a.verification))
      || (b.verification?.latestEpisode || b.archivePreparation?.episode || 0) - (a.verification?.latestEpisode || a.archivePreparation?.episode || 0)
      || (b.verification?.episodeCount || b.archivePreparation?.availableEpisodes?.length || 0)
        - (a.verification?.episodeCount || a.archivePreparation?.availableEpisodes?.length || 0)
      || sourceColorRank(a.colorFormat) - sourceColorRank(b.colorFormat) || a.url.localeCompare(b.url));
  if (inspected < rows.length) errors.push('还有分享未核对完，请重新搜索。');
  if (verified.length) return { resources: verified, message: errors.length ? '以下是已核对的结果，部分分享尚未确认。' : '' };
  if (errors.length) return { resources: [], message: '', error: errors.sort()[0] };
  const explanation = reasons.find(reason => reason.startsWith('分享中没有第'))
    || reasons.find(reason => reason.includes('没有识别到正片')) || [...new Set(reasons)].sort()[0] || '';
  const unavailable = reasons.filter(reason => reason === '分享已失效或没有可用视频。').length;
  const noVideo = reasons.filter(reason => reason.includes('没有识别到正片') || reason === '分享目录没有可用视频。').length;
  const mismatch = reasons.filter(reason => reason.includes('片名或版本')).length;
  const missingEpisode = reasons.filter(reason => reason.startsWith('分享中没有第')).length;
  const details = [
    unavailable ? `${unavailable} 个已失效` : '',
    noVideo ? `${noVideo} 个未识别到正片视频` : '',
    mismatch ? `${mismatch} 个暂未确认作品或版本` : '',
    missingEpisode ? `${missingEpisode} 个未包含第 ${options.episode} 集` : ''
  ].filter(Boolean);
  const counted = unavailable + noVideo + mismatch + missingEpisode;
  const diagnostic = reasons.length > 1 && details.length
    ? `本次核对 ${reasons.length} 个分享：${details.join('，')}。${counted < reasons.length ? explanation : ''}`
    : explanation;
  if (mismatch > 0 && !missingEpisode) return { resources: [], message: `找到相关分享，暂时无法确认里面是${label}的正片。${mismatch === reasons.length ? '' : diagnostic}` };
  return { resources: [], message: `未找到${label}的可用视频。${diagnostic}` };
}
