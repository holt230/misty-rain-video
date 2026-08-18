import dns from 'node:dns';
import { createOpaqueId } from './http.js';

dns.setDefaultResultOrder('ipv4first');

const API_HOST = 'https://drive-pc.quark.cn/1/clouddrive';
// 分享令牌、目录和转存必须使用同一个 PC 会话域。混用 drive.quark.cn
// 签发的 stoken 与 drive-pc.quark.cn 的保存接口，会在部分账号上返回 41020。
const SHARE_HOST = API_HOST;
const MEDIA_HOST = 'https://drive.quark.cn/1/clouddrive';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const ACCOUNT_CACHE_MS = 60 * 1000;
const API_REQUEST_TIMEOUT_MS = 15_000;
const MEDIA_REQUEST_TIMEOUT_MS = 8_000;
const MEDIA_REQUEST_ATTEMPTS = 2;
const DIRECTORY_EPISODE_CACHE_MS = 10 * 60 * 1000;
const LIBRARY_UPDATE_CACHE_MS = 5 * 60 * 1000;
const DIRECTORY_SCAN_CONCURRENCY = 6;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const QUARK_DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch';

export const QUARK_LIBRARY_FOLDERS = {
  tv: '电视剧',
  movie: '电影',
  variety: '综艺',
  anime: '动漫'
};

const SYSTEM_USER = { username: 'admin', folder: 'admin', role: 'admin' };
const normalizeUser = user => ({
  username: String(user?.username || SYSTEM_USER.username),
  folder: String(user?.folder || SYSTEM_USER.folder),
  role: user?.role === 'admin' ? 'admin' : 'user'
});

const videoExtensionPattern = /\.(mp4|mkv|mov|m4v|ts|avi|webm|flv|wmv|mpeg|mpg)$/i;
const nonVideoExtensionPattern = /\.(?:srt|ass|ssa|vtt|sub|idx|nfo|txt|md|pdf|jpe?g|png|gif|webp|bmp|svg|zip|rar|7z|torrent)$/i;
const ancillaryVideoPattern = /(?:^|[\s._\-【\[(（])(片头|片尾|预告|花絮|幕后|宣传片|主题曲|op|ed|mv)(?:\d{0,2}|[\s._\-】\])）]|$)/i;

export class QuarkApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'QuarkApiError';
    this.code = options.code || 'QUARK_API_ERROR';
    this.statusCode = options.statusCode || 502;
    this.details = options.details;
  }
}

const createAuthError = (message = '播放认证已失效，请重新认证', details) => new QuarkApiError(message, {
  code: 'QUARK_AUTH_REQUIRED',
  statusCode: 401,
  details
});

const isAuthResponse = result => {
  const code = Number(result?.code);
  const status = Number(result?.__upstreamStatus);
  return status === 401 || status === 403 || code === 401 || code === 32003 || code === 31001 || code === 41020;
};

const isCredentialAuthFailure = error => {
  if (error?.code !== 'QUARK_AUTH_REQUIRED') return false;
  const upstreamStatus = Number(error?.details?.upstreamStatus);
  const upstreamCode = Number(error?.details?.upstreamCode);
  return upstreamStatus === 401
    || upstreamStatus === 403
    || [401, 31001, 32003].includes(upstreamCode);
};

const libraryUpdateFailureStatus = (card, error) => {
  const code = String(error?.code || '');
  const rawMessage = String(error instanceof Error ? error.message : '暂时无法检查更新');
  let message = rawMessage;
  if (code === 'QUARK_SHARE_UNAVAILABLE' || /取消了分享|分享链接已失效|需要提取码/i.test(rawMessage)) {
    message = '原片源已失效，请通过“更多操作”更换资源；已保存的剧集不受影响';
  } else if (code === 'QUARK_AUTH_REQUIRED') {
    message = '片源访问暂时受限，请稍后重试';
  } else if (code === 'MEDIA_FOLDER_FORBIDDEN') {
    message = '片库目录已变更，请刷新片库后重试';
  } else if (/转存|任务/.test(rawMessage)) {
    message = '补充内容暂未完成，请稍后重试';
  }
  return {
    quarkFid: card.quarkFid,
    title: card.title,
    localEpisodeCount: 0,
    sourceEpisodeCount: 0,
    latestEpisodeNumber: 0,
    latestEpisodeTitle: '',
    newEpisodeCount: 0,
    updateCheckedAt: new Date().toISOString(),
    updateCheckAvailable: false,
    message
  };
};

const createDriveOperationUrl = (path, params = {}) => {
  const url = new URL(`${API_HOST}/${String(path || '').replace(/^\/+/, '')}`);
  url.searchParams.set('pr', 'ucpro');
  url.searchParams.set('fr', 'pc');
  url.searchParams.set('uc_param_str', '');
  url.searchParams.set('app', 'clouddrive');
  url.searchParams.set('__dt', String(Math.floor(60_000 + Math.random() * 240_000)));
  url.searchParams.set('__t', String(Date.now() / 1000));
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, String(value));
  }
  return url;
};

const parseShareUrl = shareUrl => {
  const value = String(shareUrl || '').trim();
  const pwdId = value.match(/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/i)?.[1] || '';
  if (!pwdId) {
    throw new QuarkApiError('这张卡片没有有效的网盘分享链接，请先换源', {
      code: 'INVALID_QUARK_SHARE',
      statusCode: 400
    });
  }
  return { pwdId, shareUrl: `https://pan.quark.cn/s/${pwdId}` };
};

const isVideoFile = item => {
  if (!item || item.file_type === 0 || item.dir) return false;
  if (nonVideoExtensionPattern.test(item.file_name || '')) return false;
  const formatType = String(item.format_type || '').toLowerCase();
  const category = String(item.category || item.obj_category || '').toLowerCase();
  return formatType.startsWith('video') || category === 'video' || videoExtensionPattern.test(item.file_name || '');
};

const extractEpisodeNumber = fileName => {
  const name = String(fileName || '').replace(/\.[a-z\d]{2,5}$/i, '');
  const explicit = [
    /s\d{1,2}e(\d{1,4})/i,
    /(?:ep?|episode)[\s._-]*(\d{1,4})/i,
    /第\s*(\d{1,4})\s*[集话期]/
  ];
  for (const pattern of explicit) {
    const match = name.match(pattern);
    if (match) return Number(match[1]);
  }

  if (/^(?:19|20)\d{2}[\s._-]/.test(name)) return null;

  const bracketed = name.match(/[\[【(（]\s*(\d{1,4})\s*[\]】)）]/);
  if (bracketed) return Number(bracketed[1]);

  const ignored = new Set([2160, 1440, 1080, 720, 576, 480, 360, 266, 265, 264]);
  const leading = name.match(/^\s*(\d{1,4})(?=\D|$)/);
  if (leading) {
    const value = Number(leading[1]);
    if (value > 0 && value < 1900 && !ignored.has(value)) return value;
  }

  const fallbackName = name.replace(/[\[【(（]?(?:19|20)\d{2}[._/-]\d{1,2}[._/-]\d{1,2}[\]】)）]?/g, ' ');
  const candidates = [...fallbackName.matchAll(/\d{1,4}/g)].filter(match => {
    const value = Number(match[0]);
    if (!value || ignored.has(value) || (value >= 1900 && value <= 2100)) return false;
    const before = fallbackName.slice(Math.max(0, match.index - 3), match.index).toLowerCase();
    const after = fallbackName.slice(match.index + match[0].length, match.index + match[0].length + 5).toLowerCase();
    return !/(?:[hx]|ddp)$/.test(before) && !/^(?:p|k|bit|ch|audio|aac|\.\d)/.test(after);
  });
  return candidates.length === 1 ? Number(candidates[0][0]) : null;
};

const formatBytes = value => {
  const size = Number(value) || 0;
  if (!size) return '';
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
};

const formatDuration = value => {
  const seconds = Math.max(0, Number(value) || 0);
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
};

const qualityMeta = (resolution, width, height) => {
  const key = String(resolution || '').toLowerCase();
  const numericHeight = Number(height) || 0;
  const labelMap = {
    normal: '标清',
    low: '流畅',
    high: '高清',
    super: '超高清',
    '2k': '2K',
    '4k': '4K',
    source: '原画',
    original: '原画'
  };
  const inferredLabel = numericHeight >= 2160 ? '4K'
    : numericHeight >= 1440 ? '2K'
      : numericHeight >= 1080 ? '超高清'
        : numericHeight >= 720 ? '高清'
          : numericHeight ? `${numericHeight}P` : '原画';
  const rank = numericHeight || ({ normal: 360, low: 480, high: 720, super: 1080, '2k': 1440, '4k': 2160, source: 4320, original: 4320 }[key] || 0);
  return { key: key || `${numericHeight || 'source'}p`, label: labelMap[key] || inferredLabel, rank };
};

const arrayFrom = value => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
};

const firstNonEmpty = (...values) => values.find(value => typeof value === 'string' && value.trim()) || '';

const playbackVideoItems = data => [
  ...arrayFrom(data?.video_list),
  ...arrayFrom(data?.videos),
  ...arrayFrom(data?.transcoding_list)
];

const hasRawPlaybackSource = data => playbackVideoItems(data).some(item => {
  const info = item?.video_info || item?.video || {};
  return Boolean(firstNonEmpty(item?.m3u8_url, item?.play_url, item?.video_url, item?.url, info?.url));
});

const mergeCookieHeaders = (...headers) => {
  const cookies = new Map();
  for (const header of headers) {
    for (const part of String(header || '').split(/;\s*/)) {
      const separator = part.indexOf('=');
      if (separator <= 0) continue;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (name) cookies.set(name, value);
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
};

const responseCookieHeader = headers => {
  const values = typeof headers?.getSetCookie === 'function'
    ? headers.getSetCookie()
    : String(headers?.get?.('set-cookie') || '').split(/,(?=\s*[!#$%&'*+\-.^_`|~\w]+=)/);
  return values.map(value => String(value).split(';', 1)[0].trim()).filter(Boolean).join('; ');
};

const getSavedFids = data => data?.save_as?.save_as_top_fids
  || data?.save_as_top_fids
  || data?.save_as?.top_fids
  || [];

const sanitizeFolderName = value => String(value || '')
  .replace(/[\\/:*?"<>|]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120);

const normalizeLibraryTitle = value => sanitizeFolderName(value)
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s·•:：—_.,，。!！?？《》“”'"【】\[\]()（）-]+/g, '');

const genericMediaTitlePattern = /^(?:烟雨视频|我的网盘库|待识别片名|未命名影片|网盘影视资源)$/i;

const resolveMediaTitle = (requestedTitle, shareTitle) => {
  const requested = sanitizeFolderName(requestedTitle);
  const shared = sanitizeFolderName(shareTitle);
  if (!requested || genericMediaTitlePattern.test(requested)) return shared || '未命名影片';
  return requested;
};

const normalizeFileTimestamp = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const numeric = typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())
      ? Number(value)
      : Number.NaN;
    const timestamp = Number.isFinite(numeric)
      ? (numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
      : Date.parse(String(value));
    if (Number.isFinite(timestamp) && timestamp > 0) return new Date(timestamp).toISOString();
  }
  return '';
};

const serializeEpisode = item => {
  const episodeNumber = extractEpisodeNumber(item.file_name) ?? 0;
  const part = String(item.file_name || '').match(/\d{1,4}\s*([上中下])(?=\D|$)/)?.[1] || '';
  return {
    fid: item.fid,
    shareFidToken: item.share_fid_token,
    parentFid: item.pdir_fid || '0',
    fileName: item.file_name || (episodeNumber ? `第 ${episodeNumber} 集` : '正片'),
    episodeNumber,
    episodeTitle: episodeNumber ? `第 ${episodeNumber} 集${part ? `（${part}）` : ''}` : '正片',
    episodePart: part,
    updatedAt: normalizeFileTimestamp(
      item.updated_at,
      item.update_time,
      item.modified_at,
      item.created_at
    ),
    size: Number(item.size) || 0,
    sizeFormatted: formatBytes(item.size),
    duration: Number(item.duration) || 0,
    durationFormatted: formatDuration(item.duration),
    formatType: item.format_type || 'video',
    width: Number(item.video_width) || 0,
    height: Number(item.video_height) || 0,
    fps: Number(item.fps) || 0,
    maxResolution: item.video_max_resolution || '',
    previewUrl: item.preview_url || ''
  };
};

const preferEpisode = (left, right) => {
  const leftScore = [left.duration, left.height, left.width, left.size];
  const rightScore = [right.duration, right.height, right.width, right.size];
  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) return rightScore[index] > leftScore[index] ? right : left;
  }
  return collator.compare(right.fileName, left.fileName) > 0 ? right : left;
};

export const normalizePlaybackEpisodes = items => {
  const playable = items
    .filter(isVideoFile)
    .filter(item => !ancillaryVideoPattern.test(String(item.file_name || '')))
    .map(serializeEpisode);
  const numbered = playable.filter(episode => episode.episodeNumber > 0);
  const candidates = numbered.length >= 2 ? numbered : playable;
  const unique = new Map();
  for (const episode of candidates) {
    const key = episode.episodeNumber > 0
      ? `${episode.episodeNumber}:${episode.episodePart || ''}`
      : `file:${String(episode.fileName).normalize('NFKC').toLowerCase()}`;
    unique.set(key, unique.has(key) ? preferEpisode(unique.get(key), episode) : episode);
  }
  return [...unique.values()].sort((left, right) => {
    if (left.episodeNumber !== right.episodeNumber) return right.episodeNumber - left.episodeNumber;
    return collator.compare(right.fileName, left.fileName);
  });
};

const episodeIdentity = episode => episode.episodeNumber > 0
  ? `episode:${episode.episodeNumber}:${episode.episodePart || ''}`
  : `file:${String(episode.fileName || '').normalize('NFKC').toLowerCase()}:${Number(episode.size) || 0}`;

const publicUpdateStatus = status => ({
  quarkFid: status.quarkFid,
  title: status.title,
  localEpisodeCount: status.localEpisodeCount,
  sourceEpisodeCount: status.sourceEpisodeCount,
  latestEpisodeNumber: status.latestEpisodeNumber,
  latestEpisodeTitle: status.latestEpisodeTitle,
  newEpisodeCount: status.newEpisodeCount,
  updateCheckedAt: status.updateCheckedAt,
  updateCheckAvailable: status.updateCheckAvailable,
  ...(status.message ? { message: status.message } : {})
});

export class QuarkGateway {
  constructor({ credentialStore, playbackCache, libraryConfigStore, tvPlaybackClient }) {
    this.credentialStore = credentialStore;
    this.playbackCache = playbackCache;
    this.libraryConfigStore = libraryConfigStore;
    this.tvPlaybackClient = tvPlaybackClient;
    this.sessions = new Map();
    this.accountCache = null;
    this.libraryRootCache = null;
    this.namedRootCache = new Map();
    this.userRootCache = new Map();
    this.libraryAccessCache = new Map();
    this.driveEpisodeCache = new Map();
    this.libraryUpdateCache = new Map();
    this.cleanupTimer = setInterval(() => this.#cleanupSessions(), 10 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  async getAccountStatus(force = false) {
    const cookie = this.credentialStore.getCookie();
    if (!cookie) return { isConfigured: false, isAuthenticated: false, isSvip: false };
    if (!force && this.accountCache && Date.now() - this.accountCache.checkedAt < ACCOUNT_CACHE_MS) {
      return this.accountCache.value;
    }

    try {
      const value = await this.validateCookie(cookie);
      this.accountCache = { checkedAt: Date.now(), value };
      return value;
    } catch (error) {
      if (error.code === 'QUARK_AUTH_REQUIRED') {
        return { isConfigured: true, isAuthenticated: false, isSvip: false };
      }
      throw error;
    }
  }

  async getPlaybackStatus(force = false) {
    const storedTvAuth = this.credentialStore.getTvAuth?.();
    const [libraryStatus, playbackStatus] = await Promise.all([
      this.getAccountStatus(force).catch(() => ({
        isConfigured: this.credentialStore.isConfigured(),
        isAuthenticated: false
      })),
      this.tvPlaybackClient?.getStatus?.().catch(() => ({
        isConfigured: Boolean(storedTvAuth?.refreshToken),
        isAuthenticated: false
      })) || Promise.resolve({ isConfigured: false, isAuthenticated: false })
    ]);
    const cookiePlaybackConfigured = Boolean(libraryStatus.isAuthenticated);
    const advancedPlaybackConfigured = Boolean(playbackStatus.isAuthenticated);
    return {
      isConfigured: Boolean(libraryStatus.isConfigured || playbackStatus.isConfigured),
      libraryConfigured: cookiePlaybackConfigured,
      cookiePlaybackConfigured,
      advancedPlaybackConfigured,
      isAuthenticated: cookiePlaybackConfigured || advancedPlaybackConfigured,
      nickname: playbackStatus.nickname || libraryStatus.nickname || ''
    };
  }

  async validateCookie(cookie) {
    const cleanCookie = String(cookie || '').trim();
    if (!cleanCookie) throw createAuthError('请输入有效的播放服务凭证');

    const [account, member] = await Promise.all([
      this.#requestJson('https://pan.quark.cn/account/info', { cookie: cleanCookie }),
      this.#requestJson(`${API_HOST}/member?pr=ucpro&fr=pc`, { cookie: cleanCookie })
    ]);
    const accountValid = account?.code === 'OK' && account?.data;
    const memberValid = member?.code === 0 && member?.data;
    if (!accountValid || !memberValid) throw createAuthError();

    const memberData = member.data || {};
    const memberType = String(memberData.member_type || memberData.member_info?.member_type || '');
    const superVipExpiry = Number(memberData.super_vip_exp_at) || 0;
    const isSvip = /super|svip/i.test(memberType) || superVipExpiry * 1000 > Date.now();
    return {
      isConfigured: true,
      isAuthenticated: true,
      isSvip,
      memberType,
      nickname: account.data?.nickname || ''
    };
  }

  async saveCookie(cookie) {
    const status = await this.validateCookie(cookie);
    // 用户复制的完整 Cookie 中包含网盘写操作会话。保存时主动删除并重签
    // __puus 会把一个可用会话替换成服务端 IP 下的风险会话，造成目录可读、
    // 转存却被 41020 拒绝。原样保存，只有上游明确拒绝时才尝试刷新。
    this.credentialStore.saveCookie(String(cookie || '').trim());
    // 分享 stoken 与签发它的 Cookie 会话绑定。重新保存 Cookie 后继续复用
    // 之前“检查更新”的缓存，会让转存端点将新 Cookie 也判定为失效。
    this.libraryUpdateCache.clear();
    this.sessions.clear();
    this.accountCache = { checkedAt: Date.now(), value: status };
    return status;
  }

  async listLibrary(user = SYSTEM_USER) {
    const principal = normalizeUser(user);
    const cookie = this.#requireCookie();
    const roots = [];
    const userRoot = await this.#getUserRoot(cookie, principal, false);
    if (userRoot) roots.push(userRoot);
    if (principal.role === 'admin') {
      const configuredRoot = await this.#getLibraryRoot(cookie, false);
      if (configuredRoot) roots.push(configuredRoot);
      const config = this.libraryConfigStore?.get?.() || {};
      if (config.legacyRootFolderName && config.legacyRootFolderName !== config.rootFolderName) {
        const legacyRoot = await this.#findOwnedRoot(cookie, config.legacyRootFolderName);
        if (legacyRoot) roots.push(legacyRoot);
      }
    }

    const items = [];
    const seenRoots = new Set();
    for (const root of roots) {
      if (!root?.fid || seenRoots.has(root.fid)) continue;
      seenRoots.add(root.fid);
      const rootChildren = await this.#listDriveFolder(root.fid, cookie);
      for (const [category, folderName] of Object.entries(QUARK_LIBRARY_FOLDERS)) {
        const categoryFolder = rootChildren.find(item => (item.file_type === 0 || item.dir) && item.file_name === folderName);
        if (!categoryFolder) continue;
        const mediaFolders = await this.#listDriveFolder(categoryFolder.fid, cookie);
        for (const folder of mediaFolders) {
          if (folder.file_type !== 0 && !folder.dir) continue;
          items.push({
            id: `quark:${folder.fid}`,
            quarkFid: folder.fid,
            title: folder.file_name,
            category,
            tag: '云端片库',
            status: '已入库',
            desc: `已转存至云端网盘 · ${folderName}`,
            poster: '',
            quarkQuality: folder.video_max_resolution || ''
          });
        }
      }
    }
    const unique = [...new Map(items.map(item => [item.quarkFid, item])).values()]
      .sort((left, right) => collator.compare(left.title, right.title));
    this.libraryAccessCache.set(principal.username, {
      checkedAt: Date.now(),
      fids: new Set(unique.map(item => item.quarkFid))
    });
    return unique;
  }

  async trashLibraryTitle(title, user = SYSTEM_USER) {
    const cookie = this.#requireCookie();
    const normalizedTitle = normalizeLibraryTitle(title);
    if (!normalizedTitle) {
      throw new QuarkApiError('片名无效，无法删除', { code: 'INVALID_MEDIA_TITLE', statusCode: 400 });
    }

    const matches = (await this.listLibrary(user)).filter(item => normalizeLibraryTitle(item.title) === normalizedTitle);
    if (!matches.length) {
      throw new QuarkApiError('云端片库中未找到该影片，可能已被删除', {
        code: 'MEDIA_FOLDER_NOT_FOUND',
        statusCode: 404
      });
    }

    const fids = [...new Set(matches.map(item => item.quarkFid).filter(Boolean))];
    for (let offset = 0; offset < fids.length; offset += 50) {
      const batch = fids.slice(offset, offset + 50);
      const result = await this.#requestJson(`${API_HOST}/file/delete?pr=ucpro&fr=pc`, {
        method: 'POST',
        cookie,
        body: { action_type: 2, filelist: batch, exclude_fids: [] }
      });
      if (result?.code !== 0) {
        throw new QuarkApiError(result?.message || '移入回收站失败，请稍后重试', {
          code: 'MEDIA_TRASH_FAILED',
          statusCode: 502
        });
      }
    }
    for (const fid of fids) this.driveEpisodeCache.delete(fid);
    return { deletedCount: fids.length };
  }

  async importShare({ shareUrl, quarkShareUrl, title, category, passcode = '', quarkPasscode = '' }, user = SYSTEM_USER) {
    const principal = normalizeUser(user);
    const cookie = this.#requireCookie();
    const resourceShareUrl = shareUrl || quarkShareUrl;
    const resourcePasscode = passcode || quarkPasscode;
    const folderName = QUARK_LIBRARY_FOLDERS[category];
    if (!folderName) {
      throw new QuarkApiError('影视类型无效', { code: 'INVALID_MEDIA_CATEGORY', statusCode: 400 });
    }
    const libraryConfig = this.libraryConfigStore?.get?.();
    if (libraryConfig?.rootShareUrl
      && parseShareUrl(libraryConfig.rootShareUrl).pwdId === parseShareUrl(resourceShareUrl).pwdId) {
      throw new QuarkApiError('该链接是片库根目录，不能作为影视资源转存', {
        code: 'LIBRARY_ROOT_CANNOT_IMPORT',
        statusCode: 400
      });
    }

    const share = await this.#resolveShareCredentials({
      shareUrl: resourceShareUrl,
      passcode: resourcePasscode,
      cookie
    });
    const mediaTitle = resolveMediaTitle(title, share.title);
    const userRoot = await this.#getUserRoot(cookie, principal, true);
    const categoryFolder = await this.#ensureDriveFolder(userRoot.fid, folderName, cookie);
    const mediaFolder = await this.#ensureDriveFolder(categoryFolder.fid, mediaTitle, cookie);
    const shareItems = await this.#listShareFolder({
      pwdId: share.pwdId,
      stoken: share.stoken,
      parentFid: '0',
      cookie
    });
    if (!shareItems.length) {
      throw new QuarkApiError('分享目录为空，无法转存', { code: 'QUARK_SHARE_EMPTY', statusCode: 422 });
    }

    const existing = await this.#listDriveFolder(mediaFolder.fid, cookie);
    const missing = shareItems.filter(item => !existing.some(saved => saved.file_name === item.file_name
      && (item.file_type === 0 || Number(saved.size) === Number(item.size))));
    let savedFids = [];
    if (missing.length) {
      for (let offset = 0; offset < missing.length; offset += 50) {
        const batch = await this.#saveSharedItems({
          pwdId: share.pwdId,
          stoken: share.stoken,
          parentFid: '0',
          items: missing.slice(offset, offset + 50),
          targetFolderFid: mediaFolder.fid,
          cookie,
          passcode: resourcePasscode
        });
        savedFids.push(...batch);
      }
    }
    this.driveEpisodeCache.delete(mediaFolder.fid);

    return {
      item: {
        id: `quark:${mediaFolder.fid}`,
        quarkFid: mediaFolder.fid,
        title: mediaTitle,
        category,
        tag: '云端片库',
        status: '已入库',
        desc: `已转存至云端网盘 · ${folderName}`,
        poster: '',
        quarkShareUrl: `https://pan.quark.cn/s/${share.pwdId}`,
        quarkQuality: ''
      },
      transferredCount: missing.length,
      reusedCount: shareItems.length - missing.length,
      savedFids
    };
  }

  async checkLibraryUpdates(cards, user = SYSTEM_USER, { force = false } = {}) {
    const principal = normalizeUser(user);
    const cookie = this.#requireCookie();
    const candidates = cards.filter(card => card?.quarkFid);
    const results = new Array(candidates.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await this.#inspectLibraryUpdate(candidates[index], principal, cookie, force);
        } catch (error) {
          // 仅在整个账号确实退出时中止检查。单个失效分享、风控或目录变化
          // 应只影响对应卡片，避免一次失败让整页更新功能不可用。
          if (isCredentialAuthFailure(error)) throw error;
          results[index] = libraryUpdateFailureStatus(candidates[index], error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, worker));
    return results.map(publicUpdateStatus);
  }

  async applyLibraryUpdates(cards, user = SYSTEM_USER) {
    const principal = normalizeUser(user);
    const cookie = this.#requireCookie();
    let transferredCount = 0;
    const failures = [];
    for (const card of cards) {
      if (!card?.quarkFid) continue;
      try {
        await this.#assertLibraryAccess(card.quarkFid, principal);
        // 点击更新时重新签发分享 stoken，不使用页面自动检查留下的旧会话。
        const status = await this.#inspectLibraryUpdate(card, principal, cookie, true);
        if (!status.updateCheckAvailable) {
          failures.push({ title: card.title, message: status.message || '当前片源暂时无法更新' });
          continue;
        }
        if (!status.missingEpisodes.length) continue;
        for (let offset = 0; offset < status.missingEpisodes.length; offset += 50) {
          const batch = status.missingEpisodes.slice(offset, offset + 50);
          await this.#saveSharedItems({
            pwdId: status.pwdId,
            stoken: status.stoken,
            items: batch,
            targetFolderFid: card.quarkFid,
            cookie,
            passcode: status.passcode
          });
          transferredCount += batch.length;
        }
        this.driveEpisodeCache.delete(card.quarkFid);
        this.libraryUpdateCache.delete(this.#libraryUpdateCacheKey(card, principal));
      } catch (error) {
        if (isCredentialAuthFailure(error)) throw error;
        const failure = libraryUpdateFailureStatus(card, error);
        failures.push({ title: failure.title, message: failure.message });
      }
    }
    const items = await this.checkLibraryUpdates(cards, principal, { force: true });
    return {
      transferredCount,
      failedCount: failures.length,
      failures,
      items,
      checkedAt: new Date().toISOString()
    };
  }

  async createPlaybackSession({ quarkFid, shareUrl, title, passcode = '' }, user = SYSTEM_USER) {
    const principal = normalizeUser(user);
    if (quarkFid) {
      await this.#assertLibraryAccess(quarkFid, principal);
      return this.#createDrivePlaybackSession({ quarkFid, title }, principal);
    }
    return this.#createSharePlaybackSession({ shareUrl, title, passcode }, principal);
  }

  async #createSharePlaybackSession({ shareUrl, title, passcode = '' }, user) {
    const cookie = this.#requireCookie();
    const share = await this.#resolveShareCredentials({ shareUrl, passcode, cookie });
    const episodes = await this.#walkShareDirectory({ pwdId: share.pwdId, stoken: share.stoken, cookie });
    if (!episodes.length) {
      throw new QuarkApiError('这个分享目录中没有找到可播放的视频文件', {
        code: 'QUARK_VIDEO_NOT_FOUND',
        statusCode: 404
      });
    }

    const sessionId = createOpaqueId();
    const session = {
      id: sessionId,
      ownerUsername: user.username,
      kind: 'share',
      pwdId: share.pwdId,
      stoken: share.stoken,
      passcode: String(passcode || ''),
      title: share.title || title || '云端视频',
      episodes,
      sources: new Map(),
      assets: new Map(),
      assetIndex: new Map(),
      createdAt: Date.now(),
      touchedAt: Date.now()
    };
    this.sessions.set(sessionId, session);

    return {
      sessionId,
      title: session.title,
      episodes: episodes.map(({ shareFidToken, parentFid, previewUrl, ...episode }) => episode)
    };
  }

  async #createDrivePlaybackSession({ quarkFid, title }, user) {
    const cookie = this.#requireCookie();
    const cached = this.driveEpisodeCache.get(quarkFid);
    const episodes = cached && Date.now() - cached.checkedAt < DIRECTORY_EPISODE_CACHE_MS
      ? cached.episodes
      : await this.#walkDriveDirectory(quarkFid, cookie);
    if (!episodes.length) {
      throw new QuarkApiError('这个片名目录中没有找到可播放的视频文件', {
        code: 'QUARK_VIDEO_NOT_FOUND',
        statusCode: 404
      });
    }
    if (!cached || cached.episodes !== episodes) {
      this.driveEpisodeCache.set(quarkFid, { checkedAt: Date.now(), episodes });
    }

    const sessionId = createOpaqueId();
    const session = {
      id: sessionId,
      ownerUsername: user.username,
      kind: 'drive',
      driveFid: quarkFid,
      title: title || '云端视频',
      episodes,
      sources: new Map(),
      assets: new Map(),
      assetIndex: new Map(),
      createdAt: Date.now(),
      touchedAt: Date.now()
    };
    this.sessions.set(sessionId, session);
    return {
      sessionId,
      title: session.title,
      episodes: episodes.map(({ shareFidToken, parentFid, previewUrl, ...episode }) => episode)
    };
  }

  async prepareEpisode(sessionId, episodeFid, user = SYSTEM_USER, playbackCache = this.playbackCache) {
    const principal = normalizeUser(user);
    const session = this.#getSession(sessionId, principal);
    const episode = session.episodes.find(item => item.fid === episodeFid);
    if (!episode) {
      throw new QuarkApiError('未找到指定剧集', { code: 'EPISODE_NOT_FOUND', statusCode: 404 });
    }

    const cookie = this.#requireCookie();
    const cacheKey = session.kind === 'share' ? `${session.pwdId}:${episode.fid}` : '';
    let savedFid = session.kind === 'drive' ? episode.fid : (playbackCache?.get(cacheKey)?.savedFid || '');
    let playData = null;

    if (savedFid) {
      try {
        playData = await this.#loadPlayData(savedFid);
      } catch (error) {
        if (error.code === 'QUARK_FILE_NOT_FOUND') {
          if (cacheKey) playbackCache?.remove(cacheKey);
          if (session.kind === 'drive') throw error;
          savedFid = '';
        } else {
          throw error;
        }
      }
    }

    let transferred = false;
    if (!savedFid && session.kind === 'share') {
      const folder = await this.#ensurePlaybackFolder(cookie, principal);
      const existingFile = await this.#findSavedEpisode(folder.fid, episode, cookie);
      if (existingFile) {
        savedFid = existingFile.fid;
      } else {
        savedFid = await this.#saveSharedEpisode(session, episode, folder.fid, cookie);
        transferred = true;
      }
      playbackCache?.set(cacheKey, {
        savedFid,
        fileName: episode.fileName,
        size: episode.size,
        folderFid: folder.fid
      });
      playData = await this.#loadPlayData(savedFid);
    }

    const normalized = await this.#normalizePlayData(playData, savedFid, cookie);
    if (!normalized.sources.length) {
      throw new QuarkApiError('播放服务没有返回当前文件可用的播放地址', {
        code: 'QUARK_PLAY_SOURCE_EMPTY',
        statusCode: 502
      });
    }

    for (const [sourceId, source] of [...session.sources.entries()]) {
      if (source.episodeFid === episode.fid) session.sources.delete(sourceId);
    }

    const sources = normalized.sources.map(source => {
      const sourceId = createOpaqueId();
      session.sources.set(sourceId, {
        ...source,
        id: sourceId,
        episodeFid: episode.fid,
        savedFid,
        touchedAt: Date.now()
      });
      return {
        id: sourceId,
        label: source.label,
        resolution: source.resolution,
        width: source.width,
        height: source.height,
        fps: source.fps,
        codec: source.codec,
        bitrate: source.bitrate,
        mimeType: source.mimeType,
        isHls: source.isHls,
        url: `/api/player/sessions/${encodeURIComponent(sessionId)}/streams/${encodeURIComponent(sourceId)}`
      };
    });

    const subtitles = normalized.subtitles.map(({ requestCookie, requestProfile, ...subtitle }) => {
      const assetId = this.registerAsset(session, subtitle.url, requestProfile, requestCookie);
      return {
        ...subtitle,
        url: `/api/player/sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(assetId)}`
      };
    });

    return {
      episode: (({ shareFidToken, parentFid, previewUrl, ...publicEpisode }) => publicEpisode)(episode),
      sources,
      audioTracks: normalized.audioTracks,
      subtitles,
      transferred,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString()
    };
  }

  getStreamSource(sessionId, sourceId, user = SYSTEM_USER) {
    const session = this.#getSession(sessionId, normalizeUser(user));
    const source = session.sources.get(sourceId);
    if (!source) {
      throw new QuarkApiError('播放地址已过期，请重新加载当前剧集', {
        code: 'PLAY_SOURCE_EXPIRED',
        statusCode: 410
      });
    }
    source.touchedAt = Date.now();
    return { session, source };
  }

  async refreshStreamSource(sessionId, sourceId, user = SYSTEM_USER) {
    const { source } = this.getStreamSource(sessionId, sourceId, user);
    const cookie = this.#requireCookie();
    const playData = await this.#loadPlayData(source.savedFid);
    const normalized = await this.#normalizePlayData(playData, source.savedFid, cookie);
    const replacement = normalized.sources.find(item => item.resolution === source.resolution)
      || normalized.sources.find(item => item.label === source.label)
      || normalized.sources[0];
    if (!replacement) return source;
    Object.assign(source, replacement, { id: sourceId, touchedAt: Date.now() });
    return source;
  }

  registerAsset(session, upstreamUrl, requestProfile = 'web', requestCookie = '') {
    const existingId = session.assetIndex.get(upstreamUrl);
    if (existingId && session.assets.has(existingId)) {
      Object.assign(session.assets.get(existingId), { requestProfile, requestCookie, touchedAt: Date.now() });
      return existingId;
    }
    const assetId = createOpaqueId();
    session.assets.set(assetId, { upstreamUrl, requestProfile, requestCookie, touchedAt: Date.now() });
    session.assetIndex.set(upstreamUrl, assetId);
    return assetId;
  }

  getAsset(sessionId, assetId, user = SYSTEM_USER) {
    const session = this.#getSession(sessionId, normalizeUser(user));
    const asset = session.assets.get(assetId);
    if (!asset) {
      throw new QuarkApiError('播放分片地址已过期，请重新加载', {
        code: 'PLAY_ASSET_EXPIRED',
        statusCode: 410
      });
    }
    asset.touchedAt = Date.now();
    return { session, asset };
  }

  async fetchMedia(upstreamUrl, rangeHeader, requestProfile = 'web', requestCookie = '') {
    let currentUrl = this.#assertRemoteUrl(upstreamUrl);
    for (let redirect = 0; redirect < 4; redirect += 1) {
      const parsed = new URL(currentUrl);
      const headers = {
        'Accept': '*/*',
        'User-Agent': requestProfile === 'tv'
          ? 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2004J7AC Build/UKQ1.231108.001) AppleWebKit/533.1 (KHTML, like Gecko) Mobile Safari/533.1'
          : QUARK_DESKTOP_USER_AGENT,
        ...(requestProfile === 'web' ? { Referer: 'https://pan.quark.cn/' } : {})
      };
      if (rangeHeader) headers.Range = rangeHeader;
      if (requestProfile === 'web' && /(^|\.)quark\.cn$/i.test(parsed.hostname)) {
        headers.Cookie = requestCookie || this.#requireCookie();
      }

      let response;
      let lastError;
      for (let attempt = 0; attempt < MEDIA_REQUEST_ATTEMPTS && !response; attempt += 1) {
        try {
          response = await fetch(currentUrl, {
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(MEDIA_REQUEST_TIMEOUT_MS)
          });
        } catch (error) {
          lastError = error;
          if (attempt + 1 < MEDIA_REQUEST_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
          }
        }
      }
      if (!response) {
        throw new QuarkApiError(`连接媒体节点失败（${parsed.hostname}）：${lastError?.cause?.code || lastError?.message || 'network error'}`, {
          code: 'STREAM_NETWORK_ERROR',
          statusCode: 502
        });
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return response;
        currentUrl = this.#assertRemoteUrl(new URL(location, currentUrl).toString());
        continue;
      }
      return response;
    }
    throw new QuarkApiError('播放地址重定向次数过多', { code: 'STREAM_REDIRECT_ERROR', statusCode: 502 });
  }

  #getSession(sessionId, user) {
    const session = this.sessions.get(sessionId);
    if (!session || Date.now() - session.touchedAt > SESSION_TTL_MS) {
      if (session) this.sessions.delete(sessionId);
      throw new QuarkApiError('播放会话已过期，请重新打开影片', {
        code: 'PLAY_SESSION_EXPIRED',
        statusCode: 410
      });
    }
    if (session.ownerUsername !== user.username) {
      throw new QuarkApiError('无权访问其他用户的播放会话', {
        code: 'PLAY_SESSION_FORBIDDEN',
        statusCode: 403
      });
    }
    session.touchedAt = Date.now();
    return session;
  }

  #requireCookie() {
    const cookie = this.credentialStore.getCookie();
    if (!cookie) throw createAuthError();
    return cookie;
  }

  async #resolveShareCredentials({ shareUrl, passcode = '', cookie }) {
    const { pwdId } = parseShareUrl(shareUrl);
    const tokenData = await this.#requestJson(`${SHARE_HOST}/share/sharepage/token?pr=ucpro&fr=pc`, {
      method: 'POST',
      cookie,
      userAgent: QUARK_DESKTOP_USER_AGENT,
      body: { pwd_id: pwdId, passcode: String(passcode || '') }
    });
    if (tokenData?.code !== 0 || !tokenData?.data?.stoken) {
      throw new QuarkApiError(tokenData?.message || '网盘分享链接已失效或需要提取码', {
        code: 'QUARK_SHARE_UNAVAILABLE',
        statusCode: 422
      });
    }
    return {
      pwdId,
      stoken: tokenData.data.stoken,
      title: tokenData.data.title || ''
    };
  }

  async #listShareFolder({ pwdId, stoken, parentFid, cookie }) {
    const all = [];
    for (let page = 1; page <= 100; page += 1) {
      const url = new URL(`${SHARE_HOST}/share/sharepage/detail`);
      url.searchParams.set('pwd_id', pwdId);
      url.searchParams.set('stoken', stoken);
      url.searchParams.set('pdir_fid', parentFid);
      url.searchParams.set('page', String(page));
      url.searchParams.set('size', '100');
      const result = await this.#requestJson(url, { cookie, userAgent: QUARK_DESKTOP_USER_AGENT });
      if (result?.code !== 0) {
        throw new QuarkApiError(result?.message || '读取网盘分享目录失败', {
          code: 'QUARK_SHARE_LIST_FAILED',
          statusCode: 502
        });
      }
      const list = arrayFrom(result?.data?.list);
      all.push(...list);
      if (list.length < 100) break;
    }
    return all;
  }

  async #walkDriveDirectory(rootFid, cookie) {
    const queue = [rootFid];
    const visited = new Set();
    const files = [];
    while (queue.length && visited.size < 300 && files.length < 5000) {
      const batch = [];
      while (queue.length && batch.length < DIRECTORY_SCAN_CONCURRENCY && visited.size < 300) {
        const parentFid = queue.shift();
        if (visited.has(parentFid)) continue;
        visited.add(parentFid);
        batch.push(parentFid);
      }
      const lists = await Promise.all(batch.map(parentFid => this.#listDriveFolder(parentFid, cookie)));
      for (const list of lists) {
        for (const item of list) {
          if (item.file_type === 0 || item.dir) queue.push(item.fid);
          else if (isVideoFile(item)) files.push(item);
        }
      }
    }
    return normalizePlaybackEpisodes(files);
  }

  #libraryUpdateCacheKey(card, user) {
    return `${user.username}:${card.quarkFid}:${String(card.quarkShareUrl || '')}`;
  }

  async #inspectLibraryUpdate(card, user, cookie, force) {
    const cacheKey = this.#libraryUpdateCacheKey(card, user);
    const cached = this.libraryUpdateCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.checkedAt < LIBRARY_UPDATE_CACHE_MS) return cached.status;

    await this.#assertLibraryAccess(card.quarkFid, user);
    const cachedLocal = this.driveEpisodeCache.get(card.quarkFid);
    const localEpisodes = !force && cachedLocal && Date.now() - cachedLocal.checkedAt < DIRECTORY_EPISODE_CACHE_MS
      ? cachedLocal.episodes
      : await this.#walkDriveDirectory(card.quarkFid, cookie);
    if (!cachedLocal || cachedLocal.episodes !== localEpisodes) {
      this.driveEpisodeCache.set(card.quarkFid, { checkedAt: Date.now(), episodes: localEpisodes });
    }

    const shareUrl = String(card.quarkShareUrl || '');
    if (!/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/i.test(shareUrl)) {
      const latest = localEpisodes[0];
      const status = {
        quarkFid: card.quarkFid,
        title: card.title,
        localEpisodeCount: localEpisodes.length,
        sourceEpisodeCount: localEpisodes.length,
        latestEpisodeNumber: latest?.episodeNumber || 0,
        latestEpisodeTitle: latest?.episodeTitle || '',
        newEpisodeCount: 0,
        updateCheckedAt: new Date().toISOString(),
        updateCheckAvailable: false,
        missingEpisodes: [],
        message: '当前卡片没有可持续检查的原片源'
      };
      this.libraryUpdateCache.set(cacheKey, { checkedAt: Date.now(), status });
      return status;
    }

    const share = await this.#resolveShareCredentials({
      shareUrl,
      passcode: card.quarkPasscode || '',
      cookie
    });
    const sourceEpisodes = await this.#walkShareDirectory({ pwdId: share.pwdId, stoken: share.stoken, cookie });
    const localKeys = new Set(localEpisodes.map(episodeIdentity));
    const missingEpisodes = sourceEpisodes.filter(episode => !localKeys.has(episodeIdentity(episode)));
    const latest = sourceEpisodes[0] || localEpisodes[0];
    const status = {
      quarkFid: card.quarkFid,
      title: card.title,
      localEpisodeCount: localEpisodes.length,
      sourceEpisodeCount: sourceEpisodes.length,
      latestEpisodeNumber: latest?.episodeNumber || 0,
      latestEpisodeTitle: latest?.episodeTitle || '',
      newEpisodeCount: missingEpisodes.length,
      updateCheckedAt: new Date().toISOString(),
      updateCheckAvailable: true,
      missingEpisodes,
      pwdId: share.pwdId,
      stoken: share.stoken,
      passcode: card.quarkPasscode || ''
    };
    this.libraryUpdateCache.set(cacheKey, { checkedAt: Date.now(), status });
    return status;
  }

  async #walkShareDirectory({ pwdId, stoken, cookie }) {
    const queue = ['0'];
    const visited = new Set();
    const files = [];

    while (queue.length && visited.size < 300 && files.length < 5000) {
      const parentFid = queue.shift();
      if (visited.has(parentFid)) continue;
      visited.add(parentFid);

      for (let page = 1; page <= 100; page += 1) {
        const url = new URL(`${SHARE_HOST}/share/sharepage/detail`);
        url.searchParams.set('pwd_id', pwdId);
        url.searchParams.set('stoken', stoken);
        url.searchParams.set('pdir_fid', parentFid);
        url.searchParams.set('page', String(page));
        url.searchParams.set('size', '100');
        const result = await this.#requestJson(url, { cookie, userAgent: QUARK_DESKTOP_USER_AGENT });
        if (result?.code !== 0) {
          throw new QuarkApiError(result?.message || '读取网盘分享目录失败', {
            code: 'QUARK_SHARE_LIST_FAILED',
            statusCode: 502
          });
        }
        const list = arrayFrom(result?.data?.list);
        for (const item of list) {
          if (item.file_type === 0 || item.dir) queue.push(item.fid);
          else if (isVideoFile(item)) files.push(item);
        }
        if (list.length < 100) break;
      }
    }
    return normalizePlaybackEpisodes(files);
  }

  async #ensurePlaybackFolder(cookie, user) {
    const userRoot = await this.#getUserRoot(cookie, user, true);
    return this.#ensureDriveFolder(userRoot.fid, '_临时播放', cookie);
  }

  async #assertLibraryAccess(quarkFid, user) {
    let access = this.libraryAccessCache.get(user.username);
    if (!access || Date.now() - access.checkedAt > 60 * 1000 || !access.fids.has(quarkFid)) {
      await this.listLibrary(user);
      access = this.libraryAccessCache.get(user.username);
    }
    if (!access?.fids?.has(quarkFid)) {
      throw new QuarkApiError('无权访问其他用户的影片目录', {
        code: 'MEDIA_FOLDER_FORBIDDEN',
        statusCode: 403
      });
    }
  }

  async #getUserRoot(cookie, user, createIfMissing) {
    const libraryRoot = await this.#getLibraryRoot(cookie, createIfMissing);
    if (!libraryRoot) return null;
    const cacheKey = `${libraryRoot.fid}:${user.folder}`;
    const cached = this.userRootCache.get(cacheKey);
    if (cached && Date.now() - cached.checkedAt < 10 * 60 * 1000) return cached.folder;
    const children = await this.#listDriveFolder(libraryRoot.fid, cookie);
    let folder = children.find(item => (item.file_type === 0 || item.dir) && item.file_name === user.folder);
    if (!folder && createIfMissing) folder = await this.#ensureDriveFolder(libraryRoot.fid, user.folder, cookie);
    if (folder) this.userRootCache.set(cacheKey, { checkedAt: Date.now(), folder });
    return folder || null;
  }

  async #findOwnedRoot(cookie, folderName) {
    const cached = this.namedRootCache.get(folderName);
    if (cached && Date.now() - cached.checkedAt < 10 * 60 * 1000) return cached.folder;
    const rootItems = await this.#listDriveFolder('0', cookie);
    const folder = rootItems.find(item => (item.file_type === 0 || item.dir) && item.file_name === folderName) || null;
    this.namedRootCache.set(folderName, { checkedAt: Date.now(), folder });
    return folder;
  }

  async #getLibraryRoot(cookie, createIfMissing) {
    if (this.libraryRootCache && Date.now() - this.libraryRootCache.checkedAt < 10 * 60 * 1000) {
      return this.libraryRootCache.folder;
    }
    const config = this.libraryConfigStore?.get?.() || { rootFolderName: '烟雨视频', rootShareUrl: '' };

    if (config.rootShareUrl) {
      try {
        const share = await this.#resolveShareCredentials({ shareUrl: config.rootShareUrl, cookie });
        const sharedItems = await this.#listShareFolder({
          pwdId: share.pwdId,
          stoken: share.stoken,
          parentFid: '0',
          cookie
        });
        const sharedRoot = sharedItems.find(item => (item.file_type === 0 || item.dir)
          && item.file_name === config.rootFolderName)
          || (!config.preferOwnedRoot && sharedItems.length === 1 && (sharedItems[0].file_type === 0 || sharedItems[0].dir)
            ? sharedItems[0]
            : null);
        if (sharedRoot) {
          await this.#listDriveFolder(sharedRoot.fid, cookie);
          this.libraryRootCache = { checkedAt: Date.now(), folder: sharedRoot };
          return sharedRoot;
        }
      } catch {
        // Fall through to locating the owned folder by name.
      }
    }

    const rootItems = await this.#listDriveFolder('0', cookie);
    let folder = rootItems.find(item => (item.file_type === 0 || item.dir) && item.file_name === config.rootFolderName);
    if (!folder && createIfMissing) folder = await this.#ensureDriveFolder('0', config.rootFolderName, cookie);
    if (folder) this.libraryRootCache = { checkedAt: Date.now(), folder };
    return folder || null;
  }

  async #ensureDriveFolder(parentFid, folderName, cookie) {
    const items = await this.#listDriveFolder(parentFid, cookie);
    const existing = items.find(item => (item.file_type === 0 || item.dir) && item.file_name === folderName);
    if (existing) return existing;
    const result = await this.#requestJson(`${API_HOST}/file?pr=ucpro&fr=pc`, {
      method: 'POST',
      cookie,
      body: { pdir_fid: parentFid, file_name: folderName, dir_path: '', dir_init_lock: false }
    });
    if (result?.code !== 0 || !result?.data?.fid) {
      throw new QuarkApiError(result?.message || '无法创建播放专用目录', {
        code: 'QUARK_CREATE_FOLDER_FAILED',
        statusCode: 502
      });
    }
    return result.data;
  }

  async #listDriveFolder(parentFid, cookie) {
    const all = [];
    for (let page = 1; page <= 50; page += 1) {
      const url = new URL(`${API_HOST}/file/sort`);
      url.searchParams.set('pr', 'ucpro');
      url.searchParams.set('fr', 'pc');
      url.searchParams.set('pdir_fid', parentFid);
      url.searchParams.set('_page', String(page));
      url.searchParams.set('_size', '100');
      url.searchParams.set('_fetch_total', '1');
      url.searchParams.set('_fetch_sub_dirs', '0');
      url.searchParams.set('_sort', 'file_type:asc,updated_at:desc');
      const result = await this.#requestJson(url, { cookie });
      if (result?.code !== 0) {
        throw new QuarkApiError(result?.message || '读取个人网盘目录失败', {
          code: 'QUARK_DRIVE_LIST_FAILED',
          statusCode: 502
        });
      }
      const list = arrayFrom(result?.data?.list);
      all.push(...list);
      if (list.length < 100) break;
    }
    return all;
  }

  async #findSavedEpisode(folderFid, episode, cookie) {
    const files = await this.#listDriveFolder(folderFid, cookie);
    return files.find(item => item.file_type !== 0
      && item.file_name === episode.fileName
      && (!episode.size || Number(item.size) === episode.size));
  }

  async #saveSharedEpisode(session, episode, targetFolderFid, cookie) {
    const savedFids = await this.#saveSharedItems({
      pwdId: session.pwdId,
      stoken: session.stoken,
      parentFid: episode.parentFid || '0',
      items: [{ fid: episode.fid, share_fid_token: episode.shareFidToken }],
      targetFolderFid,
      cookie,
      passcode: session.passcode || ''
    });
    if (!savedFids[0]) {
      throw new QuarkApiError('转存任务没有返回文件标识', {
        code: 'QUARK_TRANSFER_RESULT_EMPTY',
        statusCode: 502
      });
    }
    return savedFids[0];
  }

  async #saveSharedItems({ pwdId, stoken, parentFid, items, targetFolderFid, cookie, passcode = '' }) {
    // 首次转存原样使用用户保存的 Cookie。上游拒绝时只重新签发 stoken，
    // 不主动替换 __puus；服务端 IP 重签 __puus 反而可能把可写 Cookie
    // 变成只能读取目录的风险会话。
    let activeCookie = cookie;
    let activeStoken = stoken;
    let saveResponse;
    const fidList = items.map(item => item?.fid).filter(Boolean);
    const fidTokenList = items.map(item => item?.shareFidToken || item?.share_fid_token || '');
    if (!fidList.length || fidList.length !== fidTokenList.length || fidTokenList.some(token => !token)) {
      throw new QuarkApiError('片源缺少可转存的文件凭证，请重新检查或更换资源', {
        code: 'QUARK_TRANSFER_TOKEN_MISSING',
        statusCode: 422
      });
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await this.#requestJson(createDriveOperationUrl('share/sharepage/save'), {
          method: 'POST',
          cookie: activeCookie,
          userAgent: QUARK_DESKTOP_USER_AGENT,
          captureResponseCookies: true,
          body: {
            fid_list: fidList,
            fid_token_list: fidTokenList,
            to_pdir_fid: targetFolderFid,
            pwd_id: pwdId,
            stoken: activeStoken,
            // Web 端保存任意层级 fid 时固定使用分享根目录。传入视频实际
            // 父目录会被部分分享风控判为无效上下文并返回 41020。
            pdir_fid: '0',
            scene: 'link'
          }
        });
        activeCookie = mergeCookieHeaders(activeCookie, result.__responseCookies);
        this.credentialStore.saveCookie(activeCookie);
        saveResponse = { result, cookie: activeCookie };
        break;
      } catch (error) {
        const upstreamCode = Number(error?.details?.upstreamCode);
        if (attempt > 0 || error?.code !== 'QUARK_AUTH_REQUIRED'
          || ![31001, 32003, 41020].includes(upstreamCode)) throw error;
        const refreshedShare = await this.#resolveShareCredentials({
          shareUrl: `https://pan.quark.cn/s/${pwdId}`,
          passcode,
          cookie: activeCookie
        });
        activeStoken = refreshedShare.stoken;
      }
    }
    if (!saveResponse) {
      throw createAuthError('片库转存会话建立失败，请稍后重试');
    }
    const result = saveResponse.result;
    activeCookie = saveResponse.cookie;
    if (result?.code !== 0) {
      throw new QuarkApiError(result?.message || '转存当前剧集失败', {
        code: 'QUARK_TRANSFER_FAILED',
        statusCode: 502
      });
    }

    let savedFids = getSavedFids(result.data);
    const taskId = result?.data?.task_id;
    for (let retry = 0; taskId && !savedFids.length && retry < 18; retry += 1) {
      await new Promise(resolve => setTimeout(resolve, 600));
      const url = createDriveOperationUrl('task', { task_id: taskId, retry_index: retry });
      const taskResponse = await this.#requestJsonWithCookieRotation(url, {
        cookie: activeCookie,
        authStage: '转存任务确认',
        userAgent: QUARK_DESKTOP_USER_AGENT
      });
      const task = taskResponse.result;
      activeCookie = taskResponse.cookie;
      savedFids = getSavedFids(task?.data);
    }
    if (!savedFids.length) {
      throw new QuarkApiError('转存任务超时，请稍后重试', {
        code: 'QUARK_TRANSFER_TIMEOUT',
        statusCode: 504
      });
    }
    return savedFids;
  }

  async #requestJsonWithCookieRotation(url, options = {}) {
    let activeCookie = options.cookie || this.#requireCookie();
    let lastAuthResult = null;
    const authStage = String(options.authStage || '网盘操作');
    const requestOptions = { ...options };
    delete requestOptions.authStage;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let result;
      try {
        result = await this.#requestJson(url, {
          ...requestOptions,
          cookie: activeCookie,
          captureResponseCookies: true,
          acceptAuthRefreshResponse: true
        });
      } catch (error) {
        if (error?.code !== 'QUARK_AUTH_REQUIRED') throw error;
        const upstreamCode = error?.details?.upstreamCode;
        console.warn('[quark-gateway] upstream auth rejected', {
          stage: authStage,
          status: error?.details?.upstreamStatus,
          code: upstreamCode
        });
        throw createAuthError(
          `${authStage}认证被上游拒绝${upstreamCode ? `（${upstreamCode}）` : ''}，请重新保存 Cookie 后重试`,
          { ...error.details, stage: authStage }
        );
      }

      const responseCookies = result?.__responseCookies || '';
      if (responseCookies) {
        const mergedCookie = mergeCookieHeaders(activeCookie, responseCookies);
        if (mergedCookie !== activeCookie) {
          activeCookie = mergedCookie;
          this.credentialStore.saveCookie(activeCookie);
        }
      }
      if (!isAuthResponse(result)) return { result, cookie: activeCookie };
      lastAuthResult = result;
      if (!responseCookies) break;
    }

    const upstreamCode = lastAuthResult?.code;
    console.warn('[quark-gateway] rotated cookie was rejected', {
      stage: authStage,
      status: lastAuthResult?.__upstreamStatus,
      code: upstreamCode
    });
    throw createAuthError(
      `${authStage}认证刷新失败${upstreamCode ? `（${upstreamCode}）` : ''}，请重新保存 Cookie 后重试`,
      { upstreamStatus: lastAuthResult?.__upstreamStatus, upstreamCode, stage: authStage }
    );
  }

  async #loadPlayData(savedFid) {
    const cookie = this.#requireCookie();
    let webData = { __playbackProfile: 'web' };

    // fmp4_av 要求上游返回同一时间轴的音视频复用流。旧 fmp4
    // 模式在部分 60 FPS/HDR 文件上会产生音频 PTS 偏移，表现为声音
    // 与画面内字幕逐渐不同步。保留旧参数仅作老文件兼容兜底。
    const supportProfiles = [
      'fmp4_av,m3u8,dolby_vision',
      'fmp4,m3u8'
    ];
    for (const supports of supportProfiles) {
      const requestBody = {
        fid: savedFid,
        resolutions: 'normal,low,high,super,2k,4k',
        supports
      };
      for (const endpoint of [
        `${MEDIA_HOST}/file/v2/play?pr=ucpro&fr=pc`,
        `${API_HOST}/file/v2/play?pr=ucpro&fr=pc`
      ]) {
        try {
          const result = await this.#requestJson(endpoint, {
            method: 'POST',
            cookie,
            body: requestBody,
            acceptErrorCodes: true,
            captureResponseCookies: true,
            userAgent: QUARK_DESKTOP_USER_AGENT
          });
          if (Number(result?.code) === 0 && result?.data) {
            webData = {
              ...result.data,
              __playbackProfile: 'web',
              __mediaCookie: mergeCookieHeaders(cookie, result.__responseCookies)
            };
            if (hasRawPlaybackSource(webData)) return webData;
          }
        } catch (error) {
          if (error?.code === 'QUARK_AUTH_REQUIRED') throw error;
          // Try the alternate host/profile, then the optional advanced profile.
        }
      }
    }

    const tvAuth = this.credentialStore.getTvAuth?.();
    if (tvAuth?.refreshToken && this.tvPlaybackClient) {
      try {
        const data = await this.tvPlaybackClient.getStreaming(savedFid);
        const advancedData = { ...data, __playbackProfile: 'tv' };
        if (hasRawPlaybackSource(advancedData)) return advancedData;
      } catch {
        // Advanced playback is optional; the Cookie/download path remains usable.
      }
    }

    return webData;
  }

  async #normalizePlayData(data, savedFid, cookie) {
    const rawSources = playbackVideoItems(data);
    const seen = new Set();
    const sources = [];

    for (const item of rawSources) {
      if (item?.accessable === false) continue;
      const info = item?.video_info || item?.video || {};
      const upstreamUrl = firstNonEmpty(item?.m3u8_url, item?.play_url, item?.video_url, item?.url, info?.url);
      if (!upstreamUrl || seen.has(upstreamUrl)) continue;
      seen.add(upstreamUrl);
      const width = Number(info.width || item.width) || 0;
      const height = Number(info.height || item.height) || 0;
      const resolution = item.resolution || item.resolution_name || info.resolution || '';
      const quality = qualityMeta(resolution, width, height);
      const formatHints = [
        item.support,
        item.format_type,
        item.mime_type,
        item.supports_format,
        info.hls_type,
        info.format,
        info.file_format
      ].flat().filter(Boolean).join(',');
      const isHls = /\.m3u8(?:$|\?)/i.test(upstreamUrl)
        || /m3u8|mpegurl|hls/i.test(formatHints);
      sources.push({
        upstreamUrl,
        requestProfile: data?.__playbackProfile || 'web',
        requestCookie: data?.__mediaCookie || '',
        resolution: quality.key,
        label: quality.label,
        rank: quality.rank,
        width,
        height,
        fps: Number(info.fps || item.fps) || 0,
        codec: firstNonEmpty(info.video_codec, info.codec, item.video_codec, item.codec),
        bitrate: Number(info.bit_rate || info.bitrate || item.bit_rate || item.bitrate) || 0,
        mimeType: isHls ? 'application/vnd.apple.mpegurl' : (item.mime_type || 'video/mp4'),
        isHls
      });
    }

    if (!sources.length && data?.__playbackProfile !== 'tv') {
      const download = await this.#requestJson(`${API_HOST}/file/download?pr=ucpro&fr=pc`, {
        method: 'POST',
        cookie,
        body: { fids: [savedFid], speedup_session: '' },
        acceptErrorCodes: true,
        captureResponseCookies: true,
        userAgent: QUARK_DESKTOP_USER_AGENT
      });
      const downloadData = download?.data;
      const downloadItem = Array.isArray(downloadData)
        ? (downloadData[0] || {})
        : (downloadData?.list?.[0] || downloadData || {});
      const upstreamUrl = firstNonEmpty(downloadItem.download_url, downloadItem.url);
      if (upstreamUrl) {
        sources.push({
          upstreamUrl,
          requestProfile: 'web',
          requestCookie: mergeCookieHeaders(cookie, download.__responseCookies),
          resolution: 'original',
          label: '原画',
          rank: 4320,
          width: 0,
          height: 0,
          fps: 0,
          codec: '',
          bitrate: 0,
          mimeType: 'video/mp4',
          isHls: false
        });
      }
    }

    sources.sort((left, right) => right.rank - left.rank);
    const rawAudio = [
      ...arrayFrom(data?.audio_list),
      ...arrayFrom(data?.audio_tracks),
      ...rawSources.flatMap(item => arrayFrom(item?.audio_list || item?.audio_tracks))
    ];
    const audioTracks = rawAudio.map((item, index) => ({
      id: String(item.id ?? item.audio_track_id ?? index),
      label: item.name || item.label || item.language || `音轨 ${index + 1}`,
      language: item.language || item.lang || '',
      codec: item.codec || item.audio_codec || '',
      channels: item.channels || item.channel_layout || ''
    }));
    const subtitles = arrayFrom(data?.subtitle_list || data?.subtitles).map((item, index) => ({
      id: String(item.id ?? index),
      label: item.name || item.label || item.language || `字幕 ${index + 1}`,
      language: item.language || item.lang || '',
      url: firstNonEmpty(item.url, item.subtitle_url),
      requestProfile: data?.__playbackProfile || 'web',
      requestCookie: data?.__mediaCookie || ''
    })).filter(item => item.url);

    return { sources, audioTracks, subtitles };
  }

  async #requestJson(url, options = {}) {
    const cookie = options.cookie || this.#requireCookie();
    let response;
    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': options.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://pan.quark.cn/',
          'Cookie': cookie
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new QuarkApiError(`连接播放服务失败：${error.message}`, {
        code: 'QUARK_NETWORK_ERROR',
        statusCode: 502
      });
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new QuarkApiError(`播放服务返回了无法解析的响应（HTTP ${response.status}）`, {
        code: 'QUARK_INVALID_RESPONSE',
        statusCode: 502
      });
    }
    if (options.captureResponseCookies && result && typeof result === 'object') {
      Object.defineProperty(result, '__responseCookies', {
        value: responseCookieHeader(response.headers),
        enumerable: false
      });
      Object.defineProperty(result, '__upstreamStatus', {
        value: response.status,
        enumerable: false
      });
    }
    const code = result?.code;
    if (response.status === 401 || response.status === 403 || code === 401 || code === 32003 || code === 31001 || code === 41020) {
      if (options.acceptAuthRefreshResponse && result.__responseCookies) return result;
      // 41020 是单次写操作的风控/会话拒绝，并不代表账号 Cookie 已退出。
      // 将它写成全局未认证会导致更新失败后播放器也被错误地送回“我的”。
      if (Number(code) !== 41020) {
        this.accountCache = {
          checkedAt: Date.now(),
          value: { isConfigured: true, isAuthenticated: false, isSvip: false }
        };
      }
      throw createAuthError(result?.message || result?.message_desc || '播放认证已失效，请重新认证', {
        upstreamStatus: response.status,
        upstreamCode: code
      });
    }
    if (!options.acceptErrorCodes && !response.ok) {
      throw new QuarkApiError(result?.message || `播放服务请求失败（HTTP ${response.status}）`, {
        code: 'QUARK_HTTP_ERROR',
        statusCode: response.status >= 400 && response.status < 500 ? 422 : 502,
        details: { upstreamStatus: response.status, upstreamCode: code }
      });
    }
    return result;
  }

  #assertRemoteUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new QuarkApiError('无效的上游播放地址', { code: 'INVALID_STREAM_URL', statusCode: 502 });
    }
    if (url.protocol !== 'https:') {
      throw new QuarkApiError('拒绝非 HTTPS 播放地址', { code: 'UNSAFE_STREAM_URL', statusCode: 502 });
    }
    const host = url.hostname.toLowerCase();
    const isPrivateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    if (host === 'localhost' || host.endsWith('.local') || host === '::1' || isPrivateIpv4) {
      throw new QuarkApiError('拒绝访问本地网络播放地址', { code: 'UNSAFE_STREAM_URL', statusCode: 502 });
    }
    return url.toString();
  }

  #cleanupSessions() {
    const threshold = Date.now() - SESSION_TTL_MS;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.touchedAt < threshold) this.sessions.delete(sessionId);
    }
  }
}
