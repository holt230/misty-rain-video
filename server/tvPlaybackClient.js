import crypto from 'node:crypto';
import { QuarkApiError } from './quarkGateway.js';

const API_HOST = 'https://open-api-drive.quark.cn';
const CLIENT_ID = 'd3194e61504e493eb6222857bccfed94';
const SIGN_KEY = 'kw2dvtd7p4t3pjl2d9ed9yc8yej8kw2d';
const APP_VERSION = '1.8.2.2';
const CHANNEL = 'GENERAL';
const USER_AGENT = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2004J7AC Build/UKQ1.231108.001) AppleWebKit/533.1 (KHTML, like Gecko) Mobile Safari/533.1';
const AUTH_SESSION_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const deviceQuery = deviceId => ({
  app_ver: APP_VERSION,
  device_id: deviceId,
  device_brand: 'Xiaomi',
  platform: 'tv',
  device_name: 'M2004J7AC',
  device_model: 'M2004J7AC',
  build_device: 'M2004J7AC',
  build_product: 'M2004J7AC',
  device_gpu: 'Adreno (TM) 550',
  activity_rect: '{}',
  channel: CHANNEL
});

export class TvPlaybackClient {
  constructor(credentialStore) {
    this.credentialStore = credentialStore;
    this.authSessions = new Map();
  }

  async getStatus() {
    const auth = this.credentialStore.getTvAuth();
    if (!auth.refreshToken) return { isConfigured: false, isAuthenticated: false };
    try {
      const accessToken = await this.#ensureAccessToken();
      const user = await this.#request('/user', {
        accessToken,
        deviceId: auth.deviceId,
        query: { method: 'user_info' }
      });
      const data = user?.data || {};
      return {
        isConfigured: true,
        isAuthenticated: true,
        nickname: data.nickname || data.nick_name || data.username || ''
      };
    } catch (error) {
      if (error?.code === 'TV_AUTH_REQUIRED') {
        return { isConfigured: true, isAuthenticated: false };
      }
      throw error;
    }
  }

  async createQrSession() {
    this.#cleanupSessions();
    const stored = this.credentialStore.getTvAuth();
    const deviceId = stored.deviceId || crypto.randomBytes(16).toString('hex');
    const body = await this.#request('/oauth/authorize', {
      deviceId,
      query: {
        auth_type: 'code',
        client_id: CLIENT_ID,
        scope: 'netdisk',
        qrcode: '1',
        qr_width: '460',
        qr_height: '460'
      },
      allowAuthError: true
    });
    const queryToken = body?.query_token || body?.data?.query_token || '';
    const qrData = body?.qr_data || body?.data?.qr_data || '';
    if (!queryToken || !qrData) {
      throw new QuarkApiError('暂时无法生成认证二维码，请稍后重试', {
        code: 'TV_QR_UNAVAILABLE',
        statusCode: 502
      });
    }
    const sessionId = crypto.randomBytes(18).toString('base64url');
    this.authSessions.set(sessionId, { deviceId, queryToken, createdAt: Date.now() });
    return {
      sessionId,
      qrCode: `data:image/png;base64,${qrData}`,
      expiresAt: new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString()
    };
  }

  async pollQrSession(sessionId) {
    const session = this.authSessions.get(String(sessionId || ''));
    if (!session || Date.now() - session.createdAt > AUTH_SESSION_TTL_MS) {
      if (session) this.authSessions.delete(sessionId);
      return { state: 'expired' };
    }
    let body;
    try {
      body = await this.#request('/oauth/code', {
        deviceId: session.deviceId,
        query: { client_id: CLIENT_ID, scope: 'netdisk', query_token: session.queryToken },
        allowAuthError: true
      });
    } catch (error) {
      if (error?.upstreamErrno === 11003) return { state: 'pending' };
      throw error;
    }
    const code = body?.code || body?.data?.code || '';
    if (!code) return { state: 'pending' };
    const token = await this.#exchangeToken({ code }, session.deviceId);
    this.authSessions.delete(sessionId);
    return { state: 'confirmed', status: await this.getStatus(), tokenExpiresAt: token.expiresAt };
  }

  async getStreaming(fid) {
    const auth = this.credentialStore.getTvAuth();
    if (!auth.refreshToken) throw this.#authError();
    const accessToken = await this.#ensureAccessToken();
    const body = await this.#request('/file', {
      deviceId: auth.deviceId,
      accessToken,
      query: {
        method: 'streaming',
        group_by: 'source',
        fid,
        resolution: 'low,normal,high,super,2k,4k',
        support: 'dolby_vision'
      }
    });
    const data = body?.data || {};
    const videoList = Array.isArray(data.video_info) ? data.video_info.map(item => ({
      resolution: item.resolution,
      accessable: item.accessable,
      trans_status: item.trans_status,
      video_info: item
    })) : [];
    return { ...data, video_list: videoList, audio_list: data.audio_info || [] };
  }

  async #ensureAccessToken() {
    const auth = this.credentialStore.getTvAuth();
    if (!auth.refreshToken) throw this.#authError();
    if (auth.accessToken && auth.expiresAt > Date.now() + 60_000) return auth.accessToken;
    const token = await this.#exchangeToken({ refresh_token: auth.refreshToken }, auth.deviceId);
    return token.accessToken;
  }

  async #exchangeToken(grant, deviceId) {
    const configured = String(process.env.TV_TOKEN_EXCHANGE_URL || 'https://api.extscreen.com/quarkdrive/token').trim();
    let url;
    try {
      url = new URL(configured);
    } catch {
      throw new QuarkApiError('播放认证交换地址配置无效', { code: 'TV_TOKEN_EXCHANGE_INVALID', statusCode: 500 });
    }
    if (url.protocol !== 'https:') {
      throw new QuarkApiError('播放认证交换必须使用 HTTPS', { code: 'TV_TOKEN_EXCHANGE_INSECURE', statusCode: 500 });
    }
    const timestamp = String(Date.now());
    const reqId = crypto.createHash('md5').update(deviceId + timestamp).digest('hex');
    const body = { req_id: reqId, ...deviceQuery(deviceId), ...grant };
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new QuarkApiError(`认证服务暂时不可用：${error.message}`, {
        code: 'TV_TOKEN_EXCHANGE_NETWORK',
        statusCode: 502
      });
    }
    const result = await response.json().catch(() => ({}));
    const data = result?.data || {};
    if (!response.ok || Number(result?.code) !== 200 || !data.access_token || !data.refresh_token) {
      throw new QuarkApiError(result?.message || '扫码认证暂未完成', {
        code: 'TV_TOKEN_EXCHANGE_FAILED',
        statusCode: response.status >= 400 && response.status < 500 ? 422 : 502
      });
    }
    const expiresAt = Date.now() + Math.max(300, Number(data.expires_in) || 3600) * 1000;
    this.credentialStore.saveTvAuth({
      deviceId,
      refreshToken: data.refresh_token,
      accessToken: data.access_token,
      expiresAt
    });
    return { accessToken: data.access_token, expiresAt };
  }

  async #request(pathname, { method = 'GET', query = {}, deviceId, accessToken = '', allowAuthError = false } = {}) {
    const timestamp = String(Date.now());
    const reqId = crypto.createHash('md5').update(deviceId + timestamp).digest('hex');
    const token = crypto.createHash('sha256').update(`${method}&${pathname}&${timestamp}&${SIGN_KEY}`).digest('hex');
    const url = new URL(`${API_HOST}${pathname}`);
    for (const [key, value] of Object.entries({
      req_id: reqId,
      access_token: accessToken,
      ...deviceQuery(deviceId),
      ...query
    })) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': USER_AGENT,
          'x-pan-tm': timestamp,
          'x-pan-token': token,
          'x-pan-client-id': CLIENT_ID
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new QuarkApiError(`连接高清播放服务失败：${error.message}`, {
        code: 'TV_PLAYBACK_NETWORK',
        statusCode: 502
      });
    }
    const body = await response.json().catch(() => ({}));
    const errno = Number(body?.errno) || 0;
    if (response.ok && Number(body?.status) < 400 && errno === 0) return body;
    if (allowAuthError && errno === 11003) {
      const error = new QuarkApiError(body?.error_info || '等待扫码确认', {
        code: 'TV_QR_PENDING',
        statusCode: 409
      });
      error.upstreamErrno = errno;
      throw error;
    }
    if ([10001, 11001].includes(errno) || /access[_ ]?token|token\s*无效/i.test(body?.error_info || '')) {
      this.credentialStore.clearTvAuth();
      throw this.#authError();
    }
    throw new QuarkApiError(body?.error_info || `高清播放服务请求失败（HTTP ${response.status}）`, {
      code: 'TV_PLAYBACK_ERROR',
      statusCode: response.status >= 400 && response.status < 500 ? 422 : 502,
      details: { upstreamStatus: response.status, upstreamErrno: errno }
    });
  }

  #authError() {
    return new QuarkApiError('高清播放认证已失效，请重新扫码认证', {
      code: 'QUARK_AUTH_REQUIRED',
      statusCode: 401
    });
  }

  #cleanupSessions() {
    const threshold = Date.now() - AUTH_SESSION_TTL_MS;
    for (const [id, session] of this.authSessions.entries()) {
      if (session.createdAt < threshold) this.authSessions.delete(id);
    }
  }
}
