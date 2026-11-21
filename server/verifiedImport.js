import { createHash } from 'node:crypto';

const changed = message => Object.assign(new Error(message), { code: 'QUARK_SOURCE_CHANGED', statusCode: 409 });
const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

export function assertVerifiedImport({ expectedTitle, shareTitle, requiredEpisodes }, episodeNumbers) {
  if (expectedTitle !== undefined && normalize(expectedTitle) !== normalize(shareTitle)) throw changed('片源内容已变化，请重新搜索核对后保存');
  if (requiredEpisodes === undefined) return;
  if (!Array.isArray(requiredEpisodes) || requiredEpisodes.length > 5000 || requiredEpisodes.some(n => !Number.isInteger(n) || n < 1 || n > 5000)) {
    throw Object.assign(new Error('待保存剧集范围不正确'), { code: 'INVALID_EPISODE_REQUIREMENT', statusCode: 400 });
  }
  const available = new Set(episodeNumbers);
  const missing = [...new Set(requiredEpisodes)].filter(number => !available.has(number));
  if (missing.length) throw changed(`片源已变化，第 ${missing.slice(0, 5).join('、')} 集已不可用，请重新搜索。未保存到片库。`);
}

// Exclude rotating share tokens: only file identity and its position in the inspected tree matter.
export function shareFileTag(item) {
  return createHash('sha256').update(JSON.stringify([item.fid, item.file_name, item.ancestorFids,
    item.source_path, Number(item.size) || 0, Number(item.duration) || 0, item.file_type, item.format_type, item.md5 || ''])).digest('base64url');
}

export function sidecarEvidenceTags(entries, isVideo, isSubtitle) {
  const groups = new Map(), tags = new Map();
  for (const entry of entries) {
    const video = isVideo(entry);
    if (!video && !isSubtitle(entry)) continue;
    const parent = entry.parentFid || '0';
    if (!groups.has(parent)) groups.set(parent, { videos: [], subtitles: [] });
    groups.get(parent)[video ? 'videos' : 'subtitles'].push(entry);
  }
  for (const { videos, subtitles } of groups.values()) {
    if (videos.length !== 1 || !subtitles.length) continue;
    const evidence = [shareFileTag(videos[0]), ...subtitles.map(shareFileTag).sort()];
    tags.set(videos[0].fid, 's.' + createHash('sha256').update(JSON.stringify(evidence)).digest('base64url'));
  }
  return tags;
}

export function assertFileSelection(entries, fids, tags, sidecarTags) {
  if (tags === undefined) return; // Older clients and explicit manual selections.
  if (!Array.isArray(fids) || !Array.isArray(tags) || !tags.length || tags.length !== fids.length) throw changed('片源选择已变化，请重新核对。');
  const byId = new Map(entries.map(item => [item.fid, item]));
  for (const [index, fid] of fids.entries()) {
    const item = byId.get(fid);
    if (!item || (tags[index] !== shareFileTag(item) && !(sidecarTags?.has(fid) && tags[index] === sidecarTags.get(fid)))) throw changed('所选文件或所在目录已变化，请重新核对。');
  }
}
