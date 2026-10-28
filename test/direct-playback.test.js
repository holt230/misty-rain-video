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

test('非原生 HLS 设备只提供原文件直连，不回退分片中转',async()=>{
 const gateway=makeGateway({format:'m3u8'});const result=await gateway.prepareEpisode('session','episode');
 assert.equal(result.sources.length,1);assert.equal(result.sources[0].resolution,'original');assert.equal(result.sources[0].delivery,'direct');assert.equal(result.sources[0].mimeType,'video/x-matroska');
 assert.equal(await gateway.getDirectStreamUrl('session',result.sources[0].id),'https://media.example.test/original.mkv');
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
  assert.equal(sources[0].proxyUrl,undefined);
  gateway.fetchMedia = () => { throw new Error('direct HLS must not fetch media'); };
  for (const method of ['GET', 'HEAD']) {
    const response = await api({ gateway, method, url: sources[0].url });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.get('location'), 'https://media.example.test/video.m3u8');
    assert.equal(response.body, '');
  }
});

test('旧客户端和非布尔能力值只得到渐进式直连', async () => {
  for (const body of [undefined, { nativeHls: 'true' }, { nativeHls: false }]) {
    const gateway = makeGateway({ format: 'm3u8' });
    const response = await api({ gateway, method: 'POST', url: '/api/player/sessions/session/episodes/episode/prepare', body });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(JSON.parse(response.body).data.sources[0].delivery, 'direct');
    assert.equal(JSON.parse(response.body).data.sources[0].isHls, false);
  }
});

test('旧中转参数和分片地址都被阻止，不会获取任何上游视频字节',async()=>{
 const gateway=makeGateway({format:'m3u8'});const result=await gateway.prepareEpisode('session','episode',admin,undefined,{nativeHls:true});let fetches=0;
 gateway.fetchMedia=async()=>{fetches++;throw new Error('must not proxy')};
 for(const method of ['GET','HEAD']){
  const blocked=await api({gateway,method,url:result.sources[0].url+'?delivery=proxy'});assert.equal(blocked.statusCode,409);assert.equal(JSON.parse(blocked.body).code,'VIDEO_RELAY_DISABLED');
  const asset=await api({gateway,method,url:'/api/player/sessions/session/assets/old'});assert.equal(asset.statusCode,410);assert.equal(JSON.parse(asset.body).code,'VIDEO_RELAY_DISABLED');
 }
 assert.equal(fetches,0);const denied=await api({gateway,url:result.sources[0].url,user:{username:'other',folder:'other',role:'user'}});assert.equal(denied.statusCode,403);
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

test('直连源刷新失败时返回错误，不读取Cookie播放源也不转发视频',async()=>{
 const gateway=makeGateway();const result=await gateway.prepareEpisode('session','episode');const {source}=gateway.getStreamSource('session',result.sources[0].id);source.resolvedAt=Date.now()-11*60*1000;
 gateway.tvPlaybackClient.getStreaming=async()=>{throw Object.assign(new Error('TV unavailable'),{code:'TV_PLAYBACK_NETWORK',statusCode:502})};let fetches=0;gateway.fetchMedia=async()=>{fetches++;throw new Error('no relay')};
 for(let i=0;i<2;i++){const response=await api({gateway,url:result.sources[0].url});assert.equal(response.statusCode,502);assert.equal(JSON.parse(response.body).code,'TV_PLAYBACK_NETWORK');}
 assert.equal(fetches,0);
});

test('仅有HLS且无原文件权限的非原生设备明确失败，不以中转补位',async()=>{
 const gateway=makeGateway({format:'m3u8',download:false});await assert.rejects(gateway.prepareEpisode('session','episode'),{code:'DIRECT_SOURCE_UNAVAILABLE'});
});

test('TV MKV 保留真实媒体类型供原生播放，不冒充 MP4', async () => {
  const gateway = makeGateway({ format: 'mkv' });
  const result = await gateway.prepareEpisode('session', 'episode');
  assert.equal(result.sources[0].delivery, 'direct');
  assert.equal(result.sources[0].mimeType, 'video/x-matroska');
});

test('TV认证失效时不回退Cookie源',async()=>{
 const gateway=makeGateway();gateway.tvPlaybackClient.getStreaming=async()=>{throw Object.assign(new Error('TV expired'),{code:'QUARK_AUTH_REQUIRED',statusCode:401})};
 await assert.rejects(gateway.prepareEpisode('session','episode'),{code:'QUARK_AUTH_REQUIRED'});
});

test('旧代理配置不能重新启用中转',async()=>{
 const gateway=makeGateway();gateway.directPlaybackEnabled=false;const result=await gateway.prepareEpisode('session','episode');assert.ok(result.sources.every(source=>source.delivery==='direct'));
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


test('embedded subtitle reads require the session owner and valid time, without exposing stream URLs', async () => {
  const gateway = makeGateway();
  try {
    const playback = await gateway.prepareEpisode('session', 'episode');
    assert.match(playback.embeddedSubtitleUrl, /embedded-subtitles/);
    const forbidden = await api({ gateway, url: playback.embeddedSubtitleUrl + '?time=0', user: { username: 'other', folder: 'other', role: 'user' } });
    assert.equal(forbidden.statusCode, 403);
    const invalid = await api({ gateway, url: playback.embeddedSubtitleUrl + '?time=-1' }); assert.equal(invalid.statusCode, 422);
    assert.doesNotMatch(invalid.body, /private-cookie|private-token|media.example/);
  } finally { clearInterval(gateway.cleanupTimer); }
});

test('concurrent prepare requests for the same user/session/file share one upstream preparation',async()=>{
 const gateway=makeGateway();let count=0,release;const gate=new Promise(resolve=>release=resolve);
 const original=gateway.tvPlaybackClient.getStreaming;
 gateway.tvPlaybackClient.getStreaming=async(...args)=>{count++;await gate;return original(...args)};
 try {
  const first=gateway.prepareEpisode('session','episode'),second=gateway.prepareEpisode('session','episode');
  await assert.rejects(gateway.prepareEpisode('session','episode',{username:'other',role:'user',folder:'other'}),{statusCode:403});
  release();const [a,b]=await Promise.all([first,second]);assert.equal(count,1);assert.equal(a,b);assert.equal(gateway.sessions.get('session').pendingPreparations.size,0);
 }finally{clearInterval(gateway.cleanupTimer)}
});
