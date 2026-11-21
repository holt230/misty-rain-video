import { isExactWorkTitle } from './searchTitles.js';
import { matchingShareFiles } from './libraryPolicy.js';
const supported = new Set(['zip', 'rar', '7z']);
export const archiveFormat = name => String(name || '').match(/\.(zip|rar|7z|iso)$/i)?.[1].toLowerCase() || '';
export const supportedArchive = name => supported.has(archiveFormat(name));
export const archiveError = (message, code = 'QUARK_ARCHIVE_FAILED', statusCode = 422) => Object.assign(new Error(message), { code, statusCode });
export function mergeArchiveMetadata(item, input, original) {
  const next = { ...item, catalogId: original?.catalogId || input.catalogId || undefined, poster: original?.poster || input.poster || '' };
  if (original) {
    for (const key of ['quarkShareUrl', 'quarkPasscode', 'quarkSelectionFids', 'quarkQuality', 'tag', 'desc', 'status']) {
      if (Object.hasOwn(original, key)) next[key] = original[key]; else delete next[key];
    }
    if (!original.quarkArchiveImported) { delete next.quarkArchiveImported; delete next.quarkArchiveEpisode; }
  }
  return next;
}
export function requireArchiveCapacity(capability, bytes) {
  if (!capability.isAuthenticated) throw archiveError('网盘登录已失效，请重新登录。', 'QUARK_AUTH_REQUIRED', 401);
  if (!capability.isSvip) throw archiveError('当前网盘账号暂不支持保存这类资源，请检查会员权限。', 'QUARK_ARCHIVE_MEMBERSHIP_REQUIRED');
  if (!Number.isFinite(capability.freeBytes) || !Number.isFinite(bytes) || bytes <= 0) throw archiveError('暂时无法确认网盘空间，请稍后重试。', 'QUARK_ARCHIVE_CAPACITY_UNKNOWN');
  if (capability.freeBytes < bytes * 3) throw archiveError('网盘空间不足，请清理后重试。', 'QUARK_ARCHIVE_SPACE_REQUIRED');
}

export function selectArchiveEpisode(episodes, request, publication, archiveName = '') {
  if (!publication || !isExactWorkTitle(request.title, publication.work_title || '')
    || publication.category !== request.category || (request.year && publication.year && request.year !== publication.year)) {
    throw archiveError('资源发布信息与所选作品版本不符，未入库。', 'ARCHIVE_WORK_MISMATCH');
  }
  const number = Number(request.episode);
  if (!Number.isInteger(number) || number < 1 || number > 5000) throw archiveError('请指定要解压的集数', 'INVALID_ARCHIVE_EPISODE', 400);
  const wrapper = supportedArchive(archiveName) ? archiveName.slice(0, archiveName.lastIndexOf('.')).normalize('NFKC') : '';
  const entries = episodes.filter(item => item.episodeNumber === number).map(item => {
    const pathNames = String(item.sourcePath || '').split('/').filter(Boolean);
    // Quark can name the outer folder after the archive already verified before extraction.
    if (wrapper && pathNames[0]?.normalize('NFKC') === wrapper) pathNames.shift();
    return { ...item, name: item.fileName, isVideo: true, pathNames: pathNames.filter(part => part !== String(number)) };
  });
  const exact = matchingShareFiles(request, { title: publication.work_title, entries }, publication, { allowUnspecifiedSeason: true });
  if (exact.length !== 1) throw archiveError(exact.length ? '解压出了多个同集正片，暂不能自动选择版本。' : '解压后未确认所选作品和集数的正片，未入库。', 'ARCHIVE_EPISODE_UNCONFIRMED');
  return episodes.find(item => item.fid === exact[0].fid);
}
