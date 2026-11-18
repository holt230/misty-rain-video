import { isExactWorkTitle } from './searchTitles.js';
import { isAncillaryVideoPath, seasonNumber } from './libraryPolicy.js';
const supported = new Set(['zip', 'rar', '7z']);
export const archiveFormat = name => String(name || '').match(/\.(zip|rar|7z|iso)$/i)?.[1].toLowerCase() || '';
export const supportedArchive = name => supported.has(archiveFormat(name));
export const archiveError = (message, code = 'QUARK_ARCHIVE_FAILED', statusCode = 422) => Object.assign(new Error(message), { code, statusCode });
export function requireArchiveCapacity(capability, bytes) {
  if (!capability.isAuthenticated) throw archiveError('网盘认证已失效，请重新认证', 'QUARK_AUTH_REQUIRED', 401);
  if (!capability.isSvip) throw archiveError('当前账号不支持云端解压，本次未转存或入库；应用不会自动开通会员。', 'QUARK_ARCHIVE_MEMBERSHIP_REQUIRED');
  if (!Number.isFinite(capability.freeBytes) || !Number.isFinite(bytes) || bytes <= 0) throw archiveError('暂未确认剩余容量，未开始转存。', 'QUARK_ARCHIVE_CAPACITY_UNKNOWN');
  if (capability.freeBytes < bytes * 3) throw archiveError('剩余容量不足以同时保留压缩包和解压视频，未开始转存。', 'QUARK_ARCHIVE_SPACE_REQUIRED');
}

export function selectArchiveEpisode(episodes, request, publication) {
  if (!publication || !isExactWorkTitle(request.title, publication.work_title || '')
    || publication.category !== request.category || (request.year && publication.year && request.year !== publication.year)) {
    throw archiveError('资源发布信息与所选作品版本不符，未入库。', 'ARCHIVE_WORK_MISMATCH');
  }
  const number = Number(request.episode);
  if (!Number.isInteger(number) || number < 1 || number > 5000) throw archiveError('请指定要解压的集数', 'INVALID_ARCHIVE_EPISODE', 400);
  const exact = episodes.filter(item => item.episodeNumber === number && !isAncillaryVideoPath(item.sourcePath || item.fileName));
  if (exact.length !== 1) throw archiveError(exact.length ? '解压出了多个同集视频，暂不能自动选择版本。' : '解压后没有找到所选集数的正片视频，未入库。', 'ARCHIVE_EPISODE_UNCONFIRMED');
  const selected = exact[0];
  const expectedSeason = seasonNumber(request.title), actualSeason = selected.seasonNumber || seasonNumber(selected.fileName) || seasonNumber(selected.sourcePath);
  if (expectedSeason && actualSeason && expectedSeason !== actualSeason) throw archiveError('解压后季度不符，未入库。', 'ARCHIVE_WORK_MISMATCH');
  const stem = String(selected.fileName).replace(/\.[a-z0-9]{2,5}$/i, '').normalize('NFKC').trim();
  const numeric = /^\d{1,4}(?:\s+(?:4k|1080p|2160p))?$/i.test(stem);
  const prefix = stem.split(/s\d{1,2}e\d{1,4}|(?:ep?|episode)[\s._-]*\d{1,4}|第\s*\d{1,4}\s*[集话期]|\d{1,4}$/i)[0].replace(/[\s._-]+$/, '');
  const named = isExactWorkTitle(request.title, prefix) || String(selected.sourcePath || '').split('/').some(part => isExactWorkTitle(request.title, part));
  // Numeric names are accepted only inside the one selected archive and with
  // a fresh exact publication match. Named conflicting works remain rejected.
  if (!named && !numeric) throw archiveError('解压后文件名无法确认属于所选作品，未入库。', 'ARCHIVE_WORK_MISMATCH');
  return selected;
}
