import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRequestBody, sendError, sendJson, sendSuccess, pipeWebResponse } from './http.js';
import { AuthService } from './auth.js';
import { LibraryConfigStore, LibraryViewRepository, MediaRepository, PlaybackCacheRepository, PlaybackHistoryRepository, QuarkCredentialStore } from './storage.js';
import { QUARK_LIBRARY_FOLDERS, QuarkGateway } from './quarkGateway.js';
import { isGenericPoster, LEGACY_DEFAULT_POSTER, PosterService } from './posterService.js';
import { ResourceSearchService } from './resourceSearch.js';
import { TvPlaybackClient } from './tvPlaybackClient.js';

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
      playbackHistory: new PlaybackHistoryRepository(userDataDir)
    };
    userContexts.set(key, value);
    return value;
  };
  return {
    authService,
    userContext,
    credentialStore,
    posterService: new PosterService(dataDir),
    resourceSearch: new ResourceSearchService(),
    tvPlaybackClient,
    quarkGateway: new QuarkGateway({ credentialStore, libraryConfigStore, tvPlaybackClient })
  };
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
      poster: saved.poster || item.poster || '',
      desc: saved.desc || item.desc,
      quarkShareUrl: saved.quarkShareUrl || item.quarkShareUrl
    };
  });
  const enriched = await context.posterService.enrich(cards);
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
    poster: item.poster || LEGACY_DEFAULT_POSTER,
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
      quarkShareUrl: saved.quarkShareUrl || item.quarkShareUrl || '',
      quarkPasscode: saved.quarkPasscode || item.quarkPasscode || ''
    };
  });
};

const persistablePoster = value => isGenericPoster(value) || /\/api\/media-posters\//.test(value) ? '' : value;

const publicPlaybackStatus = status => ({
  isConfigured: Boolean(status?.isConfigured),
  libraryConfigured: Boolean(status?.libraryConfigured),
  cookiePlaybackConfigured: Boolean(status?.cookiePlaybackConfigured),
  advancedPlaybackConfigured: Boolean(status?.advancedPlaybackConfigured),
  isAuthenticated: Boolean(status?.isAuthenticated),
  ...(status?.nickname ? { nickname: status.nickname } : {})
});

const forwardedPrefix = request => {
  const value = String(request.headers['x-forwarded-prefix'] || '').split(',')[0].trim();
  if (!value || value === '/' || !/^\/[a-zA-Z0-9._~/-]+$/.test(value) || value.includes('..')) return '';
  return value.replace(/\/+$/, '');
};

const rewriteHlsManifest = (manifest, baseUrl, session, gateway, publicPrefix = '', requestProfile = 'web', requestCookie = '') => {
  const register = value => {
    const upstreamUrl = new URL(value, baseUrl).toString();
    const assetId = gateway.registerAsset(session, upstreamUrl, requestProfile, requestCookie);
    return `${publicPrefix}/api/player/sessions/${encodeURIComponent(session.id)}/assets/${encodeURIComponent(assetId)}`;
  };

  return manifest.split(/\r?\n/).map(line => {
    if (!line) return line;
    if (!line.startsWith('#')) return register(line.trim());
    return line.replace(/URI=("|')([^"']+)(\1)/g, (_match, quote, uri) => `URI=${quote}${register(uri)}${quote}`);
  }).join('\n');
};

const isManifestResponse = (upstream, upstreamUrl, forceHls = false) => {
  const contentType = upstream.headers.get('content-type') || '';
  return forceHls || /mpegurl|m3u8/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(upstreamUrl);
};

const proxyUpstream = async ({ request, response, gateway, session, upstreamUrl, forceHls = false, requestProfile = 'web', requestCookie = '' }) => {
  const upstream = await gateway.fetchMedia(upstreamUrl, request.headers.range, requestProfile, requestCookie);
  if (isManifestResponse(upstream, upstreamUrl, forceHls) && upstream.ok) {
    const manifest = await upstream.text();
    const rewritten = rewriteHlsManifest(manifest, upstreamUrl, session, gateway, forwardedPrefix(request), requestProfile, requestCookie);
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(rewritten);
    return;
  }
  await pipeWebResponse(upstream, response);
};

const fetchStreamWithRefresh = async ({ gateway, sessionId, sourceId, source, range, user }) => {
  let currentSource = source;
  let refreshed = false;
  while (true) {
    try {
      const upstream = await gateway.fetchMedia(
        currentSource.upstreamUrl,
        range,
        currentSource.requestProfile,
        currentSource.requestCookie
      );
      // Media nodes also use 412 when a signed playback URL has expired or its
      // signature preconditions no longer match. Refresh the source once just
      // like the other expiry responses before returning an upstream error.
      const shouldRefresh = [401, 403, 410, 412].includes(upstream.status);
      if (!shouldRefresh || refreshed) return { source: currentSource, upstream };
      await upstream.body?.cancel().catch(() => {});
    } catch (error) {
      if (error?.code !== 'STREAM_NETWORK_ERROR' || refreshed) throw error;
    }
    currentSource = await gateway.refreshStreamSource(sessionId, sourceId, user);
    refreshed = true;
  }
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

    if (pathname === '/api/resource-search' && request.method === 'GET') {
      const keyword = url.searchParams.get('kw');
      sendSuccess(response, await context.resourceSearch.search(keyword));
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
          const imported = await context.quarkGateway.importShare(item, user);
          userData.mediaRepository.save({ ...item, ...imported.item, poster: persistablePoster(item.poster) });
          sendSuccess(response, await readLibrary(context, user, userData), imported.transferredCount ? '已转存到云端片库' : '片库中已存在该内容');
        } else {
          userData.mediaRepository.save(item);
          sendSuccess(response, await readLibrary(context, user, userData), '元数据已保存');
        }
        return true;
      }
      if (request.method === 'DELETE') {
        const title = url.searchParams.get('title');
        const id = url.searchParams.get('id');
        if (!title && !id) {
          const error = new Error('缺少片名或卡片标识');
          error.statusCode = 400;
          throw error;
        }
        if (title) {
          const result = await context.quarkGateway.trashLibraryTitle(title, user);
          userData.mediaRepository.removeTitle(title);
          sendSuccess(response, result, result.deletedCount > 1 ? '同名目录已全部移入回收站' : '已移入回收站');
        } else {
          userData.mediaRepository.remove(id);
          sendSuccess(response, { deletedCount: 1 }, '已从片单移除');
        }
        return true;
      }
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
      const result = await context.quarkGateway.applyLibraryUpdates(cards, user);
      sendSuccess(response, result, result.transferredCount
        ? `已补充 ${result.transferredCount} 个正片文件`
        : '当前片库已是最新');
      return true;
    }

    if (pathname === '/api/playback-history') {
      if (request.method === 'GET') {
        sendSuccess(response, userData.playbackHistory.all());
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
          quarkQuality: String(media.quarkQuality || '').slice(0, 120)
        };
        const duration = Math.max(0, Math.min(Number(body.duration) || 0, 60 * 60 * 48));
        const position = Math.max(0, Math.min(Number(body.position) || 0, duration || 60 * 60 * 48));
        const entry = userData.playbackHistory.save({
          media: safeMedia,
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
      sendSuccess(response, userData.playbackHistory.remove(id), '播放记录已删除');
      return true;
    }

    if (pathname === '/api/library/import' && request.method === 'POST') {
      const item = await readRequestBody(request);
      const imported = await context.quarkGateway.importShare(item, user);
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
      }, imported.transferredCount ? '已转存并加入云端片库' : '片库中已存在该内容');
      return true;
    }

    if (pathname === '/api/quark/config') {
      if (request.method === 'GET') {
        const status = await context.quarkGateway.getPlaybackStatus(true);
        const publicStatus = publicPlaybackStatus(status);
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
        sendSuccess(response, publicPlaybackStatus(status), '片库与播放 Cookie 已验证并安全保存');
        return true;
      }
    }

    if ((pathname === '/api/player/sessions' || pathname === '/api/quark/resolve') && request.method === 'POST') {
      const body = await readRequestBody(request);
      const session = await context.quarkGateway.createPlaybackSession(body, user);
      sendSuccess(response, session);
      return true;
    }

    const prepareMatch = pathname.match(/^\/api\/player\/sessions\/([^/]+)\/episodes\/([^/]+)\/prepare$/);
    if (prepareMatch && request.method === 'POST') {
      const sessionId = decodeURIComponent(prepareMatch[1]);
      const episodeFid = decodeURIComponent(prepareMatch[2]);
      const playback = await context.quarkGateway.prepareEpisode(sessionId, episodeFid, user, userData.playbackCache);
      sendSuccess(response, playback);
      return true;
    }

    const streamMatch = pathname.match(/^\/api\/player\/sessions\/([^/]+)\/streams\/([^/]+)$/);
    if (streamMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const sessionId = decodeURIComponent(streamMatch[1]);
      const sourceId = decodeURIComponent(streamMatch[2]);
      const { session, source } = context.quarkGateway.getStreamSource(sessionId, sourceId, user);
      const refreshed = await fetchStreamWithRefresh({
        gateway: context.quarkGateway,
        sessionId,
        sourceId,
        source,
        range: request.headers.range,
        user
      });
      const upstream = refreshed.upstream;
      const activeSource = refreshed.source;

      if (isManifestResponse(upstream, activeSource.upstreamUrl, activeSource.isHls) && upstream.ok) {
        const manifest = await upstream.text();
        response.statusCode = upstream.status;
        response.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(rewriteHlsManifest(
          manifest,
          activeSource.upstreamUrl,
          session,
          context.quarkGateway,
          forwardedPrefix(request),
          activeSource.requestProfile,
          activeSource.requestCookie
        ));
      } else {
        await pipeWebResponse(upstream, response);
      }
      return true;
    }

    const assetMatch = pathname.match(/^\/api\/player\/sessions\/([^/]+)\/assets\/([^/]+)$/);
    if (assetMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const sessionId = decodeURIComponent(assetMatch[1]);
      const assetId = decodeURIComponent(assetMatch[2]);
      const { session, asset } = context.quarkGateway.getAsset(sessionId, assetId, user);
      await proxyUpstream({
        request,
        response,
        gateway: context.quarkGateway,
        session,
        upstreamUrl: asset.upstreamUrl,
        requestProfile: asset.requestProfile,
        requestCookie: asset.requestCookie
      });
      return true;
    }

    sendJson(response, 404, { code: 'API_NOT_FOUND', message: '接口不存在' });
    return true;
  } catch (error) {
    if (error?.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
    sendError(response, error);
    return true;
  }
};
