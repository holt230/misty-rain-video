import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { handleApiRequest } from '../server/api.js';
import { QuarkGateway } from '../server/quarkGateway.js';
import { TvPlaybackClient } from '../server/tvPlaybackClient.js';

const makeGateway = ({ format = 'mp4', download = true } = {}) => {
  const gateway = new QuarkGateway({
    credentialStore: { getCookie: () => 'private-cookie', getTvAuth: () => ({ refreshToken: 'private-token' }) },
    tvPlaybackClient: {
      getStreaming: async () => ({ video_list: [{ resolution: '4k', video_info: { url: `https://media.example.test/video.${format}`, format, width: 3840, height: 2160 } }] }),
      getDownload: async () => {
        if (!download) throw new Error('download denied');
        return { download_url: 'https://media.example.test/original.mkv', file_name: 'original.mkv' };
      }
    }
  });
  gateway.directPlaybackEnabled = true;
  gateway.sessions.set('session', {
    id: 'session', ownerUsername: 'admin', kind: 'drive', episodes: [{ fid: 'episode' }],
    sources: new Map(), assets: new Map(), assetIndex: new Map(), touchedAt: Date.now()
  });
  return gateway;
};

const responseSink = () => ({
  statusCode: 0, headersSent: false, headers: new Map(), body: '',
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
  end(body = '') { this.body = String(body); this.headersSent = true; }
});

const admin = { username: 'admin', role: 'admin', folder: 'admin' };
const api = async ({ gateway, url, method = 'GET', user = admin, tvPlaybackClient, body }) => {
  const response = responseSink();
  const request = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers: { host: 'localhost' } });
  await handleApiRequest(request, response, {
    authService: { authenticate: () => user, assertSameOrigin() {} },
    userContext: () => ({}), quarkGateway: gateway, tvPlaybackClient
  });
  return response;
};

test('TV MP4 优先直连，公开数据不包含上游地址或网盘凭证', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  assert.equal(result.sources[0].delivery, 'direct');
  assert.equal(result.sources[0].isHls, false);
  assert.ok(result.sources[0].url.startsWith('/api/player/sessions/session/streams/'));
  assert.doesNotMatch(JSON.stringify(result), /private-cookie|private-token|media\.example|upstreamUrl|requestCookie/);
});

test('播放准备按来源返回内嵌音轨，只标记 Dolby Vision Profile 5 的 H.264 转码', async () => {
  const gateway = makeGateway();
  const tracks = [
    { index: '1', codec_name: 'aac', channels: '6', lang: 'und' },
    { index: '2', codec_name: 'aac', channel_layout: 'stereo', lang: 'und' }
  ];
  let profile = 5;
  gateway.tvPlaybackClient.getStreaming = async () => ({ video_list: [
    { resolution: 'super', video_info: { url: 'https://media.example.test/multi.mp4', codec: 'h264', streams: { audio_stream_list: tracks } } },
    { resolution: 'high', video_info: { url: 'https://media.example.test/stereo.mp4', codec: 'avc1.640028', audio: { channels: 2, codec: 'aac' } } },
    { resolution: 'dolby_vision', video_info: { url: 'https://media.example.test/video.mkv', codec: 'hevc', dolby_vision: { profile } } }
  ] });
  const result = await gateway.prepareEpisode('session', 'episode');
  const source = resolution => result.sources.find(item => item.resolution === resolution);
  assert.deepEqual(source('super').audioTracks.map(track => [track.id, track.codec, track.channels]), [
    ['1', 'aac', '6'], ['2', 'aac', 'stereo']
  ]);
  assert.deepEqual(source('high').audioTracks.map(track => track.channels), ['2']);
  assert.equal(source('super').colorCompatibilityRisk, true);
  assert.equal(source('high').colorCompatibilityRisk, true);
  assert.equal(source('dolby_vision').colorCompatibilityRisk, undefined);
  assert.deepEqual(result.audioTracks, []);
  profile = 8;
  const hdr = await gateway.prepareEpisode('session', 'episode');
  assert.ok(hdr.sources.every(item => !item.colorCompatibilityRisk));
});

test('直连 GET 和 HEAD 只返回 302，不请求或转发媒体内容', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  gateway.fetchMedia = () => { throw new Error('must not proxy'); };
  for (const method of ['GET', 'HEAD']) {
    const response = await api({ gateway, url: result.sources[0].url, method });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.get('location'), 'https://media.example.test/video.mp4');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.body, '');
  }
});

test('其他用户无法通过直连端点获取上游地址', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  const response = await api({ gateway, url: result.sources[0].url, user: { username: 'other', folder: 'other', role: 'user' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers.has('location'), false);
});

test('非 HTTPS 或本机上游地址不能作为直连目标', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  const { source } = gateway.getStreamSource('session', result.sources[0].id);
  for (const url of ['http://media.example.test/video.mp4', 'https://127.0.0.1/video.mp4']) {
    source.upstreamUrl = url;
    const response = await api({ gateway, url: result.sources[0].url });
    assert.equal(response.statusCode, 502);
    assert.equal(response.headers.has('location'), false);
  }
});

test('较旧的直连地址重新解析后再签发', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  const { source } = gateway.getStreamSource('session', result.sources[0].id);
  source.resolvedAt = Date.now() - 11 * 60 * 1000;
  gateway.tvPlaybackClient.getStreaming = async () => ({ video_list: [{ resolution: '4k', video_info: { url: 'https://media.example.test/fresh.mp4', format: 'mp4' } }] });
  assert.equal(await gateway.getDirectStreamUrl('session', source.id), 'https://media.example.test/fresh.mp4');
});

test('未声明原生 HLS 的设备保留中转，并单独提供原文件选项', async () => {
  const gateway = makeGateway({ format: 'm3u8' });
  const result = await gateway.prepareEpisode('session', 'episode');
  assert.equal(result.sources[0].isHls, true);
  assert.equal(result.sources[0].delivery, 'proxy');
  const original = result.sources.find(source => source.resolution === 'original');
  assert.equal(original.delivery, 'direct');
  assert.equal(original.mimeType, 'video/x-matroska');
  assert.equal(await gateway.getDirectStreamUrl('session', result.sources[0].id), null);
});

test('原生 HLS 能力经 API 传递，清单入口只返回 302，服务器不下载分片', async () => {
  const gateway = makeGateway({ format: 'm3u8' });
  gateway.tvPlaybackClient.getDownload = () => { throw new Error('native HLS should not request original'); };
  const prepared = await api({ gateway, method: 'POST', url: '/api/player/sessions/session/episodes/episode/prepare', body: { nativeHls: true } });
  assert.equal(prepared.statusCode, 200, prepared.body);
  const sources = JSON.parse(prepared.body).data.sources;
  assert.equal(sources.length, 1);
  assert.equal(sources[0].isHls, true);
  assert.equal(sources[0].delivery, 'direct');
  assert.equal(sources[0].proxyUrl, `${sources[0].url}?delivery=proxy`);
  gateway.fetchMedia = () => { throw new Error('direct HLS must not fetch media'); };
  for (const method of ['GET', 'HEAD']) {
    const response = await api({ gateway, method, url: sources[0].url });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.get('location'), 'https://media.example.test/video.m3u8');
    assert.equal(response.body, '');
  }
});

test('旧客户端和非布尔能力值不能意外启用 HLS 直连', async () => {
  for (const body of [undefined, { nativeHls: 'true' }, { nativeHls: false }]) {
    const gateway = makeGateway({ format: 'm3u8' });
    const response = await api({ gateway, method: 'POST', url: '/api/player/sessions/session/episodes/episode/prepare', body });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(JSON.parse(response.body).data.sources[0].delivery, 'proxy');
  }
});

test('用户明确切换兼容播放后才改写 HLS 清单并中转，仍校验会话所属用户', async () => {
  const gateway = makeGateway({ format: 'm3u8' });
  const result = await gateway.prepareEpisode('session', 'episode', admin, undefined, { nativeHls: true });
  gateway.fetchMedia = async () => new Response('#EXTM3U\n#EXTINF:4,\nsegment.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  const response = await api({ gateway, url: result.sources[0].proxyUrl });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.has('location'), false);
  assert.match(response.body, /\/api\/player\/sessions\/session\/assets\//);
  const denied = await api({ gateway, url: result.sources[0].proxyUrl, user: { username: 'other', folder: 'other', role: 'user' } });
  assert.equal(denied.statusCode, 403);
});

test('HLS 地址刷新后保留客户端的原生直连能力', async () => {
  const gateway = makeGateway({ format: 'm3u8' });
  const result = await gateway.prepareEpisode('session', 'episode', admin, undefined, { nativeHls: true });
  const { source } = gateway.getStreamSource('session', result.sources[0].id);
  source.resolvedAt = Date.now() - 11 * 60 * 1000;
  gateway.tvPlaybackClient.getStreaming = async () => ({ video_list: [{ resolution: '4k', video_info: { url: 'https://media.example.test/fresh.m3u8', format: 'm3u8' } }] });
  assert.equal(await gateway.getDirectStreamUrl('session', source.id), 'https://media.example.test/fresh.m3u8');
  assert.equal(source.delivery, 'direct');
  assert.equal(source.nativeHls, true);
});

test('直连源刷新失败回退网页源时不静默中转，重复请求也不能绕过', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  const { source } = gateway.getStreamSource('session', result.sources[0].id);
  source.resolvedAt = Date.now() - 11 * 60 * 1000;
  gateway.tvPlaybackClient.getStreaming = async () => { throw new Error('TV unavailable'); };
  const originalFetch = globalThis.fetch;
  let mediaFetches = 0;
  globalThis.fetch = async () => Response.json({ code: 0, data: { video_list: [{ resolution: '4k', video_info: { url: 'https://media.example.test/web.m3u8', format: 'm3u8' } }] } });
  gateway.fetchMedia = async () => {
    mediaFetches += 1;
    return new Response('#EXTM3U\nsegment.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  };
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await api({ gateway, url: result.sources[0].url });
      assert.equal(response.statusCode, 409);
      assert.equal(JSON.parse(response.body).code, 'DIRECT_SOURCE_UNAVAILABLE');
    }
    assert.equal(mediaFetches, 0);
    const compatible = await api({ gateway, url: `${result.sources[0].url}?delivery=proxy` });
    assert.equal(compatible.statusCode, 200);
    assert.equal(mediaFetches, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('没有原文件下载权限时仍保留 HLS 播放源', async () => {
  const gateway = makeGateway({ format: 'm3u8', download: false });
  const result = await gateway.prepareEpisode('session', 'episode');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].delivery, 'proxy');
});

test('TV MKV 保留真实媒体类型供原生播放，不冒充 MP4', async () => {
  const gateway = makeGateway({ format: 'mkv' });
  const result = await gateway.prepareEpisode('session', 'episode');
  assert.equal(result.sources[0].delivery, 'direct');
  assert.equal(result.sources[0].mimeType, 'video/x-matroska');
});

test('TV 失效时回退网页源且继续代理，绝不把 Cookie 地址当成直链', async () => {
  const gateway = makeGateway();
  gateway.tvPlaybackClient.getStreaming = async () => { throw new Error('TV expired'); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 0, data: { video_list: [{ resolution: 'super', video_info: { url: 'https://media.example.test/web.mp4', format: 'mp4' } }] } });
  try {
    const result = await gateway.prepareEpisode('session', 'episode');
    assert.equal(result.sources[0].delivery, 'proxy');
  } finally { globalThis.fetch = originalFetch; }
});

test('强制代理模式不会优先使用 TV 或返回直连来源', async () => {
  const gateway = makeGateway();
  gateway.directPlaybackEnabled = false;
  gateway.tvPlaybackClient.getStreaming = async () => { throw new Error('must use web first'); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 0, data: { video_list: [{ resolution: 'super', video_info: { url: 'https://media.example.test/web.mp4', format: 'mp4' } }] } });
  try {
    const result = await gateway.prepareEpisode('session', 'episode');
    assert.equal(result.sources[0].delivery, 'proxy');
  } finally { globalThis.fetch = originalFetch; }
});

test('只有管理员可以创建与确认 TV 认证会话', async () => {
  for (const url of ['/api/player/tv-auth/sessions', '/api/player/tv-auth/sessions/qr']) {
    const response = await api({ url, method: 'POST', user: { username: 'user', role: 'user' }, tvPlaybackClient: {} });
    assert.equal(response.statusCode, 403);
  }
  const calls = [];
  const tvPlaybackClient = {
    createQrSession: async owner => { calls.push(['create', owner]); return { sessionId: 'qr' }; },
    pollQrSession: async (id, owner) => { calls.push(['poll', id, owner]); return { state: 'pending' }; }
  };
  await api({ url: '/api/player/tv-auth/sessions', method: 'POST', tvPlaybackClient });
  await api({ url: '/api/player/tv-auth/sessions/qr', method: 'POST', tvPlaybackClient });
  assert.deepEqual(calls, [['create', 'admin'], ['poll', 'qr', 'admin']]);
});

test('TV 二维码会话绑定管理员，过期会话不能兑换令牌', async () => {
  const client = new TvPlaybackClient({});
  client.authSessions.set('qr', { ownerUsername: 'admin', createdAt: Date.now() });
  await assert.rejects(client.pollQrSession('qr', 'other'), error => error.code === 'TV_QR_FORBIDDEN');
  client.authSessions.get('qr').createdAt -= 6 * 60 * 1000;
  assert.deepEqual(await client.pollQrSession('qr', 'admin'), { state: 'expired' });
});
