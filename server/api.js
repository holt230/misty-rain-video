import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRequestBody, sendError, sendJson, sendSuccess } from './http.js';
import { AuthService } from './auth.js';
import { DanmakuService } from './danmaku/service.js';
import { LibraryConfigStore, LibraryViewRepository, MediaRepository, PlaybackCacheRepository, PlaybackHistoryRepository, PlayerPreferencesStore, QuarkCredentialStore, LibraryMaintenanceRepository } from './storage.js';
import { LibraryMaintenance } from './libraryMaintenance.js';
import { QUARK_LIBRARY_FOLDERS, QuarkGateway } from './quarkGateway.js';
import { isGenericPoster, PosterService } from './posterService.js';
import { ResourceSearchService } from './resourceSearch.js';
import { ShareAvailability } from './shareAvailability.js';
import { TvPlaybackClient } from './tvPlaybackClient.js';
import { DiscoveryService } from './discoveryService.js';
import { CatalogSearch } from './catalogSearch.js';
import { CatalogBrowse } from './catalogBrowse.js';
import { CatalogDetails } from './catalogDetails.js';
import { SiteSettings } from './siteSettings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const createApiContext = ({ dataDir = path.resolve(__dirname, '..', 'data') } = {}) => {
  const authService = new AuthService(dataDir);
  const credentialStore = new QuarkCredentialStore(dataDir);
  const libraryConfigStore = new LibraryConfigStore(dataDir);
  const tvPlaybackClient = new TvPlaybackClient(credentialStore);
  const userContexts = new Map();
  const userContext = user => {
    const key = user.folder;
    if (userContexts.has(key)) return userContexts.get(key);
    const userDataDir = path.resolve(dataDir, 'users', key);
    const isAdmin = user.role === 'admin';
    const value = {
      mediaRepository: new MediaRepository(userDataDir, {
        legacyFilePath: isAdmin ? path.resolve(dataDir, 'media_cards.json') : ''
      }),
      libraryViewRepository: new LibraryViewRepository(userDataDir, {
        legacyFilePath: isAdmin ? path.resolve(dataDir, 'library_view.json') : ''
      }),
      playbackCache: new PlaybackCacheRepository(userDataDir),
      playbackHistory: new PlaybackHistoryRepository(userDataDir),
      playerPreferences: new PlayerPreferencesStore(userDataDir),
      maintenanceRepository: new LibraryMaintenanceRepository(userDataDir)
    };
    userContexts.set(key, value);
    return value;
  };
  const quarkGateway = new QuarkGateway({ credentialStore, libraryConfigStore, tvPlaybackClient });
  const shareAvailability = new ShareAvailability({ dataDir, probe: input => quarkGateway.probeShare(input) });
  const context = {
    authService,
    siteSettings: new SiteSettings(dataDir),
    userContext,
    credentialStore,
    posterService: new PosterService(dataDir, {
      resolveThumbnail: (item, user) => quarkGateway.getLibraryThumbnail(item.quarkFid, user),
      fetchThumbnail: (url, signal) => quarkGateway.fetchMedia(url, undefined, 'thumbnail', '', { signal })
    }),
    resourceSearch: new ResourceSearchService({ dataDir, exclude: item => shareAvailability.isUnavailable(item.url) }),
    shareAvailability,
    danmaku: new DanmakuService(dataDir),
    tvPlaybackClient,
    quarkGateway
  };
  context.libraryMaintenance = new LibraryMaintenance(context);
  context.discovery = new DiscoveryService({ dataDir, posterService: context.posterService });
  context.catalogSearch = new CatalogSearch({ discovery: context.discovery });
  context.catalogBrowse = new CatalogBrowse({ catalogSearch: context.catalogSearch });
  context.catalogDetails = new CatalogDetails({ dataDir, discovery: context.discovery });
  return context;
};

const setSecurityHeaders = response => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
};

const readLibrary = async (context, user, userData) => {
  const library = await context.quarkGateway.listLibrary(user);
  const metadata = userData.mediaRepository.all();
  const cards = library.map(item => {
    const saved = metadata.find(meta => meta.quarkFid === item.quarkFid)
      || metadata.find(meta => meta.title === item.title && meta.category === item.category)
      || {};
    return {
      ...saved,
      ...item,
      title: userData.libraryViewRepository.titleFor?.(item.quarkFid) || item.title,
      poster: saved.poster || item.poster || '',
      desc: saved.desc || item.desc,
      quarkShareUrl: saved.quarkShareUrl || item.quarkShareUrl
    };
  });
  const enriched = await context.posterService.enrich(cards, user);
  const grouped = new Map();
  const normalizeTitle = value => String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·•:：—_.,，。!！?？《》“”'"【】\[\]()（）-]+/g, '');
  for (const item of enriched) {
    const key = normalizeTitle(item.title) || item.id;
    const group = grouped.get(key) || [];
    group.push(item);
    grouped.set(key, group);
  }

  return [...grouped.values()].map(group => {
    const categoryOverride = userData.libraryViewRepository.categoryFor(group[0].title);
    const exactAnime = group.find(item => item.category === 'anime'
      && item.posterSource === 'bangumi'
      && normalizeTitle(item.posterMatchedTitle) === normalizeTitle(item.title));
    const selected = group.find(item => item.category === categoryOverride)
      || exactAnime
      || group[0];
    return {
      ...selected,
      category: categoryOverride || selected.category,
      duplicateCount: group.length
    };
  }).map(item => ({
    ...item,
    poster: isGenericPoster(item.poster) ? '' : item.poster,
    desc: String(item.desc || '').replace(/夸克\s*(?:网盘)?/gi, '云端网盘').replace(/\bSVIP\b/gi, '高清播放')
  }));
};

const readLibrarySources = async (context, user, userData) => {
  const library = await context.quarkGateway.listLibrary(user);
  const metadata = userData.mediaRepository.all();
  return library.map(item => {
    const saved = metadata.find(meta => meta.quarkFid === item.quarkFid)
      || metadata.find(meta => meta.title === item.title && meta.category === item.category)
      || {};
    return {
      ...item,
      title: userData.libraryViewRepository.titleFor?.(item.quarkFid) || item.title,
      quarkShareUrl: saved.quarkShareUrl || item.quarkShareUrl || '',
      quarkPasscode: saved.quarkPasscode || item.quarkPasscode || '',
      quarkSelectionFids: saved.quarkSelectionFids
    };
  });
};

const importLibraryShare = async (context, card, user) => {
  try { return await context.quarkGateway.importShare(card, user); }
  catch (error) {
    if (error?.code === 'QUARK_SHARE_UNAVAILABLE' && card.quarkShareUrl) context.shareAvailability?.markUnavailable(card.quarkShareUrl);
    else if (card.quarkShareUrl) context.shareAvailability?.recordFailure?.({ shareUrl: card.quarkShareUrl, passcode: card.quarkPasscode }, error);
    throw error;
  }
};

const persistablePoster = value => isGenericPoster(value) || /\/api\/(?:media-posters|discovery\/posters)\//.test(value) ? '' : value;

const historyMedia = (media, userData, metadata) => {
  if (media.catalogId && !media.quarkFid) {
    const saved = (metadata || userData.mediaRepository?.all?.() || []).find(item => item.catalogId === media.catalogId && item.quarkFid);
    if (saved) media = { ...media, ...saved, poster: media.poster || saved.poster };
  }
  const fid = media.quarkFid || (String(media.id || '').startsWith('quark:') ? media.id.slice(6) : '');
  const title = userData.libraryViewRepository?.titleFor?.(fid) || media.title;
  return { ...media, title, poster: isGenericPoster(media.poster) || title !== media.title ? '' : media.poster };
};

const readHistory = async (context, user, userData) => {
  const entries = userData.playbackHistory.all();
  const metadata = userData.mediaRepository?.all?.() || [];
  // History is a snapshot of progress; title and cover use current library metadata.
  const media = await context.posterService.enrich(entries.map(entry => historyMedia(entry.media, userData, metadata)), user);
  return entries.map((entry, index) => ({ ...entry, media: media[index] }));
};

const publicPlaybackStatus = status => ({
  isConfigured: Boolean(status?.isConfigured),
  libraryConfigured: Boolean(status?.libraryConfigured),
  cookiePlaybackConfigured: Boolean(status?.cookiePlaybackConfigured),
  advancedPlaybackConfigured: Boolean(status?.advancedPlaybackConfigured),
  isAuthenticated: Boolean(status?.isAuthenticated),
  ...(status?.nickname ? { nickname: status.nickname } : {})
});

const createProxyRequestController = (request, response) => {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const handleResponseClose = () => {
    if (!response.writableEnded) abort();
  };
  request.once?.('aborted', abort);
  response.once?.('close', handleResponseClose);
  return {
    signal: controller.signal,
    cleanup() {
      request.off?.('aborted', abort);
      response.off?.('close', handleResponseClose);
    }
  };
};

export const handleApiRequest = async (request, response, context) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return false;

  setSecurityHeaders(response);
  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return true;
  }

  try {
    if (pathname === '/api/health' && request.method === 'GET') {
      sendSuccess(response, { status: 'ok' });
      return true;
    }

    if (pathname === '/api/site-settings' && request.method === 'GET') {
      sendSuccess(response, context.siteSettings.public());
      return true;
    }

    if (pathname === '/api/auth/session' && request.method === 'GET') {
      const user = context.authService.authenticate(request, false);
      sendSuccess(response, {
        authenticated: Boolean(user),
        user: context.authService.publicUser(user)
      });
      return true;
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      context.authService.assertSameOrigin(request);
      const body = await readRequestBody(request, 16 * 1024);
      const { user, token } = context.authService.login(request, body.username, body.password);
      context.authService.setSessionCookie(request, response, token);
      sendSuccess(response, {
        authenticated: true,
        user: context.authService.publicUser(user)
      }, '登录成功');
      return true;
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      context.authService.assertSameOrigin(request);
      context.authService.clearSessionCookie(request, response);
      sendSuccess(response, { authenticated: false }, '已退出登录');
      return true;
    }

    const user = context.authService.authenticate(request);
    const userData = context.userContext(user);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method || '')) {
      context.authService.assertSameOrigin(request);
    }

    if (pathname === '/api/site-settings' && request.method === 'PUT') {
      if (user.role !== 'admin') throw Object.assign(new Error('仅管理员可以修改站点信息'), { statusCode: 403 });
      const input = await readRequestBody(request, 2500_000);
      sendSuccess(response, context.siteSettings.update(input));
      return true;
    }

    if (pathname.startsWith('/api/danmaku/')) {
      const service = context.danmaku;
      if (pathname === '/api/danmaku/segment' && request.method === 'GET') {
        service.limit(user.folder, 'segment');
        sendSuccess(response, await service.segment(
          { platform: url.searchParams.get('platform'), id: url.searchParams.get('id') },
          Number(url.searchParams.get('index')), url.searchParams.get('refresh') === '1'
        ));
        return true;
      }
      if (request.method === 'POST' && ['/api/danmaku/match', '/api/danmaku/select', '/api/danmaku/options'].includes(pathname)) {
        service.limit(user.folder, 'match');
        const input = await readRequestBody(request, 8 * 1024);
        const result = pathname.endsWith('/match') ? await service.match(user.folder, input)
          : pathname.endsWith('/options') ? await service.options(input) : await service.select(user.folder, input);
        sendSuccess(response, result);
        return true;
      }
    }

    if (pathname === '/api/resource-search' && request.method === 'GET') {
      const keyword = url.searchParams.get('kw');
      if (url.searchParams.get('cached') === '1') {
        sendSuccess(response, context.resourceSearch.peek(keyword));
        return true;
      }
      const force = url.searchParams.get('refresh') === '1';
      sendSuccess(response, await context.resourceSearch.search(keyword, { force, allowStale: true, priority: url.searchParams.get('background') === '1' ? 'prefetch' : 'interactive' }));
      return true;
    }

    if (pathname === '/api/resource-search/validate' && request.method === 'POST') {
      const input = await readRequestBody(request, 64 * 1024);
      sendSuccess(response, await context.shareAvailability.inspect(input.items, { force: input.force === true }));
      return true;
    }

    const subjectContentMatch = pathname.match(/^\/api\/catalog\/subjects\/([^/]+)\/(photos|comments)$/);
    if (subjectContentMatch && request.method === 'GET') {
      response.setHeader('Cache-Control', 'private, no-store');
      sendSuccess(response, await context.catalogDetails.content.get(subjectContentMatch[1], subjectContentMatch[2], url.searchParams.get('start') || '0'));
      return true;
    }
    const subjectMatch = pathname.match(/^\/api\/catalog\/subjects\/([^/]+)$/);
    if (subjectMatch && request.method === 'GET') {
      response.setHeader('Cache-Control', 'private, no-store');
      sendSuccess(response, await context.catalogDetails.get(subjectMatch[1]));
      return true;
    }
    const detailImageMatch = pathname.match(/^\/api\/catalog\/detail-images\/([a-zA-Z0-9_-]+)$/);
    if (detailImageMatch && ['GET', 'HEAD'].includes(request.method)) {
      const asset = await context.catalogDetails.assets.read(detailImageMatch[1], 'catalog');
      response.setHeader('Content-Type', asset.contentType);
      response.setHeader('Content-Length', asset.bytes.length);
      response.setHeader('Cache-Control', 'private, max-age=300');
      response.end(request.method === 'HEAD' ? undefined : asset.bytes);
      return true;
    }
    if (pathname === '/api/catalog/browse' && request.method === 'GET') {
      sendSuccess(response, await context.catalogBrowse.get(Object.fromEntries(url.searchParams)));
      return true;
    }
    if (pathname === '/api/catalog/search' && request.method === 'GET') {
      sendSuccess(response, await context.catalogSearch.search(url.searchParams.get('q')));
      return true;
    }
    if (pathname === '/api/discovery' && request.method === 'GET') {
      sendSuccess(response, await context.discovery.get(url.searchParams.get('category') || 'all'));
      return true;
    }
    const discoveryPosterMatch = pathname.match(/^\/api\/discovery\/posters\/([^/]+)$/);
    if (discoveryPosterMatch && ['GET', 'HEAD'].includes(request.method)) {
      const id = decodeURIComponent(discoveryPosterMatch[1]);
      const poster = await context.discovery.poster(id, context.catalogDetails?.cachedPosterSource?.(id));
      const asset = context.posterService.getAsset(path.basename(poster.poster));
      if (!asset) throw Object.assign(new Error('封面暂时不可用'), { statusCode: 503 });
      response.statusCode = 200;
      response.setHeader('Content-Type', asset.contentType);
      response.setHeader('Content-Length', asset.size);
      const etag = `"${path.basename(poster.poster)}"`;
      response.setHeader('Cache-Control', 'private, no-cache');
      response.setHeader('ETag', etag);
      if (request.headers['if-none-match'] === etag) { response.statusCode = 304; response.removeHeader('Content-Length'); response.end(); return true; }
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(asset.filePath).pipe(response);
      return true;
    }

    const posterMatch = pathname.match(/^\/api\/media-posters\/([^/]+)$/);
    if (posterMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const asset = context.posterService.getAsset(decodeURIComponent(posterMatch[1]));
      if (!asset) {
        sendJson(response, 404, { code: 'POSTER_NOT_FOUND', message: '封面不存在' });
        return true;
      }
      response.statusCode = 200;
      response.setHeader('Content-Type', asset.contentType);
      response.setHeader('Content-Length', asset.size);
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(asset.filePath).pipe(response);
      return true;
    }

    if (pathname === '/api/quark/share-details' && request.method === 'POST') {
      const input = await readRequestBody(request);
      try {
        const result = await context.quarkGateway.getShareDetails(input, user);
        context.shareAvailability?.recordContents?.(input, result.videoCount);
        sendSuccess(response, result);
      }
      catch (error) {
        if (error?.code === 'QUARK_SHARE_UNAVAILABLE') context.shareAvailability?.markUnavailable(input.shareUrl);
        else context.shareAvailability?.recordFailure?.(input, error);
        throw error;
      }
      return true;
    }

    const shareThumbnail = pathname.match(/^\/api\/quark\/share-thumbnails\/([a-zA-Z0-9_-]+)$/);
    if (shareThumbnail && ['GET','HEAD'].includes(request.method)) {
      const asset = await context.quarkGateway.shareThumbnails.read(shareThumbnail[1], user.username);
      response.statusCode = 200;
      response.setHeader('Content-Type',asset.contentType);
      response.setHeader('Content-Length',asset.bytes.length);
      response.setHeader('Cache-Control','private, no-store');
      response.end(request.method === 'HEAD' ? undefined : asset.bytes);
      return true;
    }

    const episodeThumbnail = pathname.match(/^\/api\/player\/sessions\/([^/]+)\/episodes\/([^/]+)\/thumbnail$/);
    if (episodeThumbnail && ['GET','HEAD'].includes(request.method)) {
      const asset = await context.quarkGateway.getEpisodeThumbnail(decodeURIComponent(episodeThumbnail[1]),decodeURIComponent(episodeThumbnail[2]),user);
      response.statusCode = 200;
      response.setHeader('Content-Type',asset.contentType);
      response.setHeader('Content-Length',asset.bytes.length);
      response.setHeader('Cache-Control','private, no-store');
      response.end(request.method === 'HEAD' ? undefined : asset.bytes);
      return true;
    }

    if (pathname === '/api/media-cards') {
      if (request.method === 'GET') {
        sendSuccess(response, await readLibrary(context, user, userData));
        return true;
      }
      if (request.method === 'POST') {
        const item = await readRequestBody(request);
        if (!item?.id || !item?.title || !item?.category) {
          const error = new Error('片单数据缺少 id、title 或 category');
          error.statusCode = 400;
          throw error;
        }
        if (/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/i.test(item.quarkShareUrl || '')) {
          const imported = await importLibraryShare(context, item, user);
          if (typeof item.catalogId === 'string') await context.discovery.poster(item.catalogId).catch(() => {});
          if (imported.replacedFid) {
            userData.mediaRepository.removeFid(imported.replacedFid);
            userData.playbackHistory.removeByMediaFid(imported.replacedFid);
          }
          userData.mediaRepository.save({
            ...item, ...imported.item, poster: persistablePoster(item.poster),
            // Explicitly clear a previous selection when the user switches back to saving everything.
            quarkSelectionFids: item.quarkSelectionFids
          });
          const message = imported.replacedFid
            ? imported.cleanupPending
              ? '换源完成；旧目录已保留为隐藏备份，可在网盘确认后清理'
              : '新片源已验证并完成替换'
            : imported.transferredCount
              ? '已转存到云端片库'
              : '片库中已存在该内容';
          sendSuccess(response, await readLibrary(context, user, userData), message);
        } else {
          userData.mediaRepository.save(item);
          sendSuccess(response, await readLibrary(context, user, userData), '元数据已保存');
        }
        return true;
      }
      if (request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const explicitFid = String(url.searchParams.get('quarkFid') || '').trim();
        const fidFromId = String(id || '').startsWith('quark:') ? String(id).slice('quark:'.length).trim() : '';
        const quarkFid = explicitFid || fidFromId;
        if (!quarkFid && !id) {
          const error = new Error('缺少影片目录或卡片标识');
          error.statusCode = 400;
          throw error;
        }
        if (quarkFid) {
          const catalogId = userData.mediaRepository.all?.().find(item => item.quarkFid === quarkFid)?.catalogId;
          const result = await context.quarkGateway.trashLibraryItem(quarkFid, user);
          userData.mediaRepository.removeFid(quarkFid);
          userData.playbackHistory.removeByMediaFid(quarkFid);
          if (catalogId) userData.playbackHistory.removeUnlinkedCatalog(catalogId);
          sendSuccess(response, result, '当前影片目录已移入回收站');
        } else {
          userData.mediaRepository.remove(id);
          userData.playbackHistory.removeByMediaId(id);
          sendSuccess(response, { deletedCount: 1 }, '已从片单移除');
        }
        return true;
      }
    }

    if (pathname === '/api/media-cards/title' && request.method === 'PATCH') {
      const body = await readRequestBody(request, 4096);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const fid = typeof body.quarkFid === 'string' ? body.quarkFid.trim() : '';
      if (!fid || fid.length > 240 || !title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) {
        throw Object.assign(new Error('名称不能为空，最多 120 个字符'), { statusCode: 400, code: 'INVALID_MEDIA_TITLE' });
      }
      const library = await context.quarkGateway.listLibrary(user);
      const item = library.find(card => card.quarkFid === fid);
      if (!item) throw Object.assign(new Error('影片不在当前账号的片库中'), { statusCode: 403, code: 'MEDIA_FOLDER_FORBIDDEN' });
      const previousTitle = userData.libraryViewRepository.titleFor(fid) || item.title;
      const category = userData.libraryViewRepository.categoryFor(previousTitle);
      const saved = userData.mediaRepository.all().find(card => card.quarkFid === fid) || {};
      const [renamed] = await context.posterService.enrich([{
        ...saved, ...item, title, category: category || item.category, poster: persistablePoster(saved.poster || item.poster || '')
      }], user);
      userData.libraryViewRepository.setTitle(fid, title);
      if (category) userData.libraryViewRepository.setCategory(title, category);
      sendSuccess(response, renamed, '名称已修改');
      return true;
    }

    if (pathname === '/api/media-cards/category' && request.method === 'PATCH') {
      const body = await readRequestBody(request);
      if (!body?.title || !Object.hasOwn(QUARK_LIBRARY_FOLDERS, body.category)) {
        const error = new Error('片名或目标分类无效');
        error.statusCode = 400;
        throw error;
      }
      userData.libraryViewRepository.setCategory(body.title, body.category);
      sendSuccess(response, { title: body.title, category: body.category }, '分类已更新，同名内容已自动折叠');
      return true;
    }

    if (pathname === '/api/library-updates' && request.method === 'GET') {
      const cards = await readLibrarySources(context, user, userData);
      const items = await context.quarkGateway.checkLibraryUpdates(cards, user, {
        force: url.searchParams.get('force') === '1'
      });
      sendSuccess(response, { items, checkedAt: new Date().toISOString() });
      return true;
    }

    if (pathname === '/api/library-maintenance' && request.method === 'GET') {
      sendSuccess(response, context.libraryMaintenance.status(user));
      return true;
    }

    if (pathname === '/api/library-updates/apply' && request.method === 'POST') {
      const body = await readRequestBody(request, 32 * 1024);
      const requestedFids = Array.isArray(body?.quarkFids)
        ? [...new Set(body.quarkFids.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 100)
        : [];
      if (!requestedFids.length) {
        const error = new Error('请选择需要更新的影片');
        error.statusCode = 400;
        throw error;
      }
      const library = await readLibrarySources(context, user, userData);
      const cards = library.filter(item => requestedFids.includes(item.quarkFid));
      if (cards.length !== requestedFids.length) {
        const error = new Error('部分影片已不在当前用户片库中');
        error.statusCode = 403;
        throw error;
      }
      const result = await context.quarkGateway.applyLibraryUpdates(cards, user, {
        isCurrent: card => {
          const saved = userData.mediaRepository.all().find(item => item.quarkFid === card.quarkFid);
          return !saved || userData.mediaRepository.matchesSource(card);
        }
      });
      sendSuccess(response, result, result.transferredCount
        ? `已补充 ${result.transferredCount} 个正片文件`
        : result.failedCount ? '部分影片未能完成更新，请稍后重试' : '当前来源暂无待补剧集');
      return true;
    }

    if (pathname === '/api/player/preferences') {
      if (request.method === 'GET') { sendSuccess(response, userData.playerPreferences.get()); return true; }
      if (request.method === 'PUT') {
        sendSuccess(response, userData.playerPreferences.save(await readRequestBody(request, 4096)), '播放偏好已保存');
        return true;
      }
    }

    if (pathname === '/api/playback-history') {
      if (request.method === 'GET') {
        sendSuccess(response, await readHistory(context, user, userData));
        return true;
      }
      if (request.method === 'PUT') {
        const body = await readRequestBody(request, 64 * 1024);
        const media = body?.media;
        if (!media?.id || !media?.title || !media?.category || !body?.episodeFid) {
          const error = new Error('播放记录缺少影片或剧集信息');
          error.statusCode = 400;
          throw error;
        }
        const safeMedia = {
          id: String(media.id).slice(0, 240),
          title: String(media.title).slice(0, 240),
          category: String(media.category).slice(0, 24),
          tag: String(media.tag || '').slice(0, 80),
          poster: String(media.poster || '').slice(0, 2048),
          status: String(media.status || '').slice(0, 80),
          desc: String(media.desc || '').slice(0, 500),
          quarkShareUrl: String(media.quarkShareUrl || '').slice(0, 2048),
          quarkPasscode: String(media.quarkPasscode || '').slice(0, 32),
          quarkFid: String(media.quarkFid || '').slice(0, 240),
          quarkQuality: String(media.quarkQuality || '').slice(0, 120),
          catalogId: String(media.catalogId || '').slice(0, 80),
          year: String(media.year || '').slice(0,12),
          danmakuKey: String(media.danmakuKey || '').slice(0,256)
        };
        if (body.playbackSessionId !== undefined) {
          if (typeof body.playbackSessionId !== 'string' || !body.playbackSessionId || body.playbackSessionId.length > 240) {
            throw Object.assign(new Error('播放会话标识无效'), { code: 'INVALID_HISTORY_SESSION', statusCode: 400 });
          }
          context.quarkGateway.validateHistorySession(body.playbackSessionId, safeMedia.quarkFid, user);
        }
        const duration = Math.max(0, Math.min(Number(body.duration) || 0, 60 * 60 * 48));
        const position = Math.max(0, Math.min(Number(body.position) || 0, duration || 60 * 60 * 48));
        const entry = userData.playbackHistory.save({
          media: historyMedia(safeMedia, userData),
          episodeFid: String(body.episodeFid).slice(0, 240),
          episodeNumber: Math.max(0, Number(body.episodeNumber) || 0),
          episodeTitle: String(body.episodeTitle || '').slice(0, 240),
          position,
          duration,
          completed: Boolean(body.completed)
        });
        sendSuccess(response, entry, '播放进度已保存');
        return true;
      }
    }

    const historyMatch = pathname.match(/^\/api\/playback-history\/([^/]+)$/);
    if (historyMatch && request.method === 'DELETE') {
      const id = decodeURIComponent(historyMatch[1]);
      userData.playbackHistory.remove(id);
      sendSuccess(response, userData.playbackHistory.all(), '播放记录已删除');
      return true;
    }

    if (pathname === '/api/library/import' && request.method === 'POST') {
      const item = await readRequestBody(request);
      const imported = await importLibraryShare(context, item, user);
      if (imported.replacedFid) {
        userData.mediaRepository.removeFid(imported.replacedFid);
        userData.playbackHistory.removeByMediaFid(imported.replacedFid);
      }
      userData.mediaRepository.save({
        ...item,
        ...imported.item,
        poster: persistablePoster(item.poster)
      });
      sendSuccess(response, {
        imported: imported.item,
        transferredCount: imported.transferredCount,
        reusedCount: imported.reusedCount,
        library: await readLibrary(context, user, userData)
      }, imported.replacedFid
        ? imported.cleanupPending
          ? '换源完成；旧目录已保留为隐藏备份，可在网盘确认后清理'
          : '新片源已验证并完成替换'
        : imported.transferredCount
          ? '已转存并加入云端片库'
          : '片库中已存在该内容');
      return true;
    }

    if (pathname === '/api/quark/config') {
      if (request.method === 'GET') {
        const status = await context.quarkGateway.getPlaybackStatus(true);
        const publicStatus = publicPlaybackStatus(status);
        if (user.role === 'admin') publicStatus.tvTokenExchangeOrigin = context.tvPlaybackClient.getExchangeOrigin();
        if (user.role !== 'admin') delete publicStatus.nickname;
        sendSuccess(response, publicStatus);
        return true;
      }
      if (request.method === 'POST') {
        if (user.role !== 'admin') {
          const error = new Error('只有管理员可以配置播放服务凭证');
          error.statusCode = 403;
          error.code = 'ADMIN_REQUIRED';
          throw error;
        }
        const body = await readRequestBody(request);
        await context.quarkGateway.saveCookie(body.cookie || '');
        const status = await context.quarkGateway.getPlaybackStatus();
        sendSuccess(response, publicPlaybackStatus(status), '片库 Cookie 已验证并安全保存');
        return true;
      }
    }

    const tvQrMatch = pathname.match(/^\/api\/player\/tv-auth\/sessions(?:\/([^/]+))?$/);
    if (tvQrMatch && request.method === 'POST') {
      if (user.role !== 'admin') {
        const error = new Error('只有管理员可以配置播放认证');
        error.statusCode = 403;
        throw error;
      }
      const result = tvQrMatch[1]
        ? await context.tvPlaybackClient.pollQrSession(decodeURIComponent(tvQrMatch[1]), user.username)
        : await context.tvPlaybackClient.createQrSession(user.username);
      sendSuccess(response, result);
      return true;
    }

    if ((pathname === '/api/player/sessions' || pathname === '/api/quark/resolve') && request.method === 'POST') {
      const body = await readRequestBody(request);
      try {
        const session = await context.quarkGateway.createPlaybackSession(body, user, userData.playbackCache);
        if (session.cachedOnly && body.shareUrl) context.shareAvailability?.markUnavailable(body.shareUrl);
        else if (body.shareUrl && !body.quarkFid) context.shareAvailability?.recordContents?.(body, session.episodes.length);
        sendSuccess(response, session);
      }
      catch (error) {
        if (error?.code === 'QUARK_SHARE_UNAVAILABLE' && body.shareUrl) context.shareAvailability?.markUnavailable(body.shareUrl);
        else if (body.shareUrl) context.shareAvailability?.recordFailure?.(body, error);
        throw error;
      }
      return true;
    }

    const prepareMatch = pathname.match(/^\/api\/player\/sessions\/([^/]+)\/episodes\/([^/]+)\/prepare$/);
    if (prepareMatch && request.method === 'POST') {
      const sessionId = decodeURIComponent(prepareMatch[1]);
      const episodeFid = decodeURIComponent(prepareMatch[2]);
      const capabilities = await readRequestBody(request, 4 * 1024);
      const playback = await context.quarkGateway.prepareEpisode(sessionId, episodeFid, user, userData.playbackCache, {
        nativeHls: capabilities?.nativeHls === true
      });
      sendSuccess(response, playback);
      return true;
    }

    const streamMatch = pathname.match(/^\/api\/player\/sessions\/([^/]+)\/streams\/([^/]+)$/);
    if (streamMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const sessionId = decodeURIComponent(streamMatch[1]);
      const sourceId = decodeURIComponent(streamMatch[2]);
      context.quarkGateway.getStreamSource(sessionId, sourceId, user);
      if (url.searchParams.get('delivery') === 'proxy') throw Object.assign(new Error('服务器中转已禁用，请刷新播放器使用直连'), { code:'VIDEO_RELAY_DISABLED', statusCode:409 });
      const location = await context.quarkGateway.getDirectStreamUrl(sessionId, sourceId, user);
      if (!location) throw Object.assign(new Error('当前画质不能直连，请更换画质或片源'), { code:'DIRECT_SOURCE_UNAVAILABLE', statusCode:409 });
      response.statusCode = 302;
      response.setHeader('Location', location);
      response.setHeader('Referrer-Policy','no-referrer');
      response.setHeader('Cache-Control','no-store');
      response.end();
      return true;
    }

    const embeddedMatch = pathname.match(/^\/api\/player\/sessions\/([^/]+)\/embedded-subtitles\/([^/]+)$/);
    if (embeddedMatch && request.method === 'GET') {
      const controller = createProxyRequestController(request, response);
      try {
        const result = await context.quarkGateway.getEmbeddedSubtitles(decodeURIComponent(embeddedMatch[1]), decodeURIComponent(embeddedMatch[2]), Number(url.searchParams.get('time') || 0), user, { signal: controller.signal });
        response.setHeader('Cache-Control', 'no-store');
        sendSuccess(response, result);
      } finally { controller.cleanup(); }
      return true;
    }

    const subtitleMatch = pathname.match(/^\/api\/player\/sessions\/([^/]+)\/subtitles\/([^/]+)$/);
    if (subtitleMatch && request.method === 'GET') {
      const controller = createProxyRequestController(request, response);
      try {
        const content = await context.quarkGateway.getSubtitleContent(decodeURIComponent(subtitleMatch[1]), decodeURIComponent(subtitleMatch[2]), user, { signal: controller.signal });
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        response.setHeader('Cache-Control', 'private, no-store');
        response.end(content);
      } finally { controller.cleanup(); }
      return true;
    }

    if (/^\/api\/player\/sessions\/[^/]+\/assets\//.test(pathname)) {
      throw Object.assign(new Error('服务器视频中转已禁用，请重新打开影片'), { code:'VIDEO_RELAY_DISABLED', statusCode:410 });
    }

    sendJson(response, 404, { code: 'API_NOT_FOUND', message: '接口不存在' });
    return true;
  } catch (error) {
    if (error?.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
    sendError(response, error);
    return true;
  }
};
