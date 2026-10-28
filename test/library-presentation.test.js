import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { handleApiRequest } from '../server/api.js';
import { LibraryViewRepository, MediaRepository, PlaybackHistoryRepository } from '../server/storage.js';
import { LEGACY_DEFAULT_POSTER, PosterService } from '../server/posterService.js';
import { QuarkGateway } from '../server/quarkGateway.js';

const temporaryDirectory = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-presentation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const card = (fid, title = '原名称') => ({ id: `quark:${fid}`, quarkFid: fid, title, category: 'tv', poster: LEGACY_DEFAULT_POSTER });
const response = () => ({ statusCode: 0, headersSent: false, body: '', setHeader() {}, end(value) { this.body = String(value); this.headersSent = true; } });
const request = (url, method = 'GET', body = {}) => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { url, method, headers: { host: 'localhost' } });
const fixture = t => {
  const directory = temporaryDirectory(t);
  const users = new Map(['admin', 'viewer'].map(username => [username, {
    mediaRepository: new MediaRepository(path.join(directory, username)),
    libraryViewRepository: new LibraryViewRepository(path.join(directory, username)),
    playbackHistory: new PlaybackHistoryRepository(path.join(directory, username))
  }]));
  let username = 'admin';
  const context = {
    authService: { authenticate: () => ({ username, folder: username, role: username === 'admin' ? 'admin' : 'user' }), assertSameOrigin() {} },
    userContext: user => users.get(user.username),
    quarkGateway: { listLibrary: async user => user.username === 'admin' ? [card('first'), card('second', '另一部')] : [card('viewer')] },
    posterService: { enrich: async cards => cards.map(item => ({ ...item, poster: '/api/media-posters/current.jpg' })) }
  };
  return { users, directory, context, login: user => { username = user; } };
};
const call = async (context, url, method, body) => {
  const res = response(); await handleApiRequest(request(url, method, body), res, context);
  return { status: res.statusCode, ...JSON.parse(res.body) };
};

test('名称按目录和账号持久化，分类变更不能覆盖名称；历史读取及晚到的写入使用新名称', async t => {
  const { context, users, directory, login } = fixture(t);
  const admin = users.get('admin');
  admin.libraryViewRepository.setCategory('原名称', 'anime');
  const original = admin.playbackHistory.save({ media: card('first'), episodeFid: 'ep17', position: 63, duration: 900, completed: false });
  const rename = await call(context, '/api/media-cards/title', 'PATCH', { quarkFid: 'first', title: '  正确名称  ' });
  assert.equal(rename.status, 200); assert.equal(rename.data.title, '正确名称');
  assert.equal(rename.data.category, 'anime'); assert.equal(rename.data.quarkFid, 'first');
  const library = await call(context, '/api/media-cards', 'GET');
  assert.deepEqual(library.data.map(item => item.title), ['正确名称', '另一部']);
  await call(context, '/api/media-cards/category', 'PATCH', { title: '正确名称', category: 'tv' });
  assert.equal(new LibraryViewRepository(path.join(directory, 'admin')).titleFor('first'), '正确名称');
  const history = await call(context, '/api/playback-history', 'GET');
  assert.equal(history.data[0].media.title, '正确名称'); assert.equal(history.data[0].position, original.position);
  assert.equal(history.data[0].id, original.id); assert.equal(history.data[0].media.poster, '/api/media-posters/current.jpg');
  const updated = await call(context, '/api/playback-history', 'PUT', { ...original, position: 88 });
  assert.equal(updated.data.media.title, '正确名称'); assert.equal(updated.data.id, original.id);
  assert.equal(admin.playbackHistory.all().length, 1);
  login('viewer');
  assert.equal((await call(context, '/api/media-cards/title', 'PATCH', { quarkFid: 'first', title: '越权改名' })).status, 403);
  assert.equal(users.get('viewer').libraryViewRepository.titleFor('first'), '');
  assert.equal((await call(context, '/api/media-cards/title', 'PATCH', { quarkFid: 'viewer', title: '我的名称' })).status, 200);
  assert.equal(admin.libraryViewRepository.titleFor('first'), '正确名称');
});

test('名称输入、登录和请求来源被校验，失败不修改片库', async t => {
  const { context, users } = fixture(t);
  for (const title of ['', '  ', 'a'.repeat(121), 'a\nb', 123]) {
    assert.equal((await call(context, '/api/media-cards/title', 'PATCH', { quarkFid: 'first', title })).status, 400);
  }
  context.authService.assertSameOrigin = () => { throw Object.assign(new Error('origin'), { statusCode: 403 }); };
  assert.equal((await call(context, '/api/media-cards/title', 'PATCH', { quarkFid: 'first', title: 'test' })).status, 403);
  context.authService.authenticate = () => { throw Object.assign(new Error('login'), { statusCode: 401 }); };
  assert.equal((await call(context, '/api/media-cards/title', 'PATCH', { quarkFid: 'first', title: 'test' })).status, 401);
  assert.equal(users.get('admin').libraryViewRepository.titleFor('first'), '');
});

test('常规英文片名不读取对象原型，旧分类和按目录保存的名称可以同时恢复', t => {
  const views = new LibraryViewRepository(temporaryDirectory(t));
  assert.equal(views.categoryFor('constructor'), ''); assert.equal(views.titleFor('__proto__'), '');
  views.setTitle('movie', 'constructor'); views.setCategory('constructor', 'movie');
  assert.equal(views.categoryFor('constructor'), 'movie'); assert.equal(views.titleFor('movie'), 'constructor');
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const noMetadata = t => t.mock.method(globalThis, 'fetch', async url => Response.json(String(url).includes('douban') ? [] : { list: [] }));

test('海报未匹配时读取网盘截图，缓存图片但不返回或保存带签名的网盘地址，按用户隔离', async t => {
  noMetadata(t);
  const directory = temporaryDirectory(t);
  let lookups = 0, downloads = 0;
  const options = {
    resolveThumbnail: async () => { lookups++; return { imageUrl: 'https://thumb.quark.cn/frame.jpg?token=private' }; },
    fetchThumbnail: async (_url, signal) => { assert.ok(signal instanceof AbortSignal); downloads++; return new Response(png, { headers: { 'Content-Type': 'image/png' } }); }
  };
  const posters = new PosterService(directory, options);
  const [first] = await posters.enrich([card('movie')], { username: 'admin' });
  assert.equal(first.posterSource, 'video'); assert.match(first.poster, /^\/api\/media-posters\/.*\.png$/);
  assert.ok(posters.getAsset(path.basename(first.poster)));
  assert.deepEqual(await posters.enrich([card('movie')], { username: 'admin' }), [first]);
  assert.equal(lookups, 1); assert.equal(downloads, 1);
  const [other] = await posters.enrich([card('movie')], { username: 'viewer' });
  assert.notEqual(first.poster, other.poster); assert.equal(lookups, 2);
  assert.doesNotMatch(fs.readFileSync(posters.cachePath, 'utf8'), /private|thumb\.quark/);
  const restarted = new PosterService(directory, options);
  assert.equal((await restarted.enrich([card('movie')], { username: 'admin' }))[0].poster, first.poster);
  assert.equal(lookups, 2);
});

test('已有或正确匹配的海报优先，图片失败可恢复且不把错误页面当封面', async t => {
  const directory = temporaryDirectory(t);
  let videoLookups = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('subject_suggest')) return Response.json([{ id: '1', title: '测试片', img: 'https://image.example/poster.png' }]);
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  });
  const posters = new PosterService(directory, { resolveThumbnail: () => { videoLookups++; } });
  const result = await posters.enrich([{ ...card('matched', '测试片') }, { ...card('own'), poster: 'https://image.example/own.png' }]);
  assert.equal(result[0].posterSource, 'douban'); assert.equal(result[1].poster, 'https://image.example/own.png');
  assert.equal(videoLookups, 0);
  noMetadata(t);
  const bad = new PosterService(temporaryDirectory(t), { resolveThumbnail: async () => ({ imageUrl: 'https://image.example/not-image' }), fetchThumbnail: async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }) });
  assert.equal(await bad.resolve(card('bad'), { username: 'admin' }), null);
  assert.equal(fs.readdirSync(bad.posterDirectory).length, 0);
  bad.fetchThumbnail = async () => new Response(png, { headers: { 'Content-Type': 'image/png' } });
  assert.equal(await bad.resolve(card('bad'), { username: 'admin' }), null, 'temporary failures are briefly cached');
  for (const entry of Object.values(bad.cache.entries)) if (entry.retryMs === 60_000) entry.updatedAt = new Date(Date.now() - 61_000).toISOString();
  assert.equal((await bad.resolve(card('bad'), { username: 'admin' })).posterSource, 'video');
});

test('视频缩略图只扫描当前账号片库，跳过预告和花絮，嵌套目录无视频时有扫描上限', async t => {
  const user = { username: 'viewer', role: 'user', folder: 'viewer' };
  const gateway = new QuarkGateway({ credentialStore: { getCookie: () => 'fixture' } });
  t.after(() => clearInterval(gateway.cleanupTimer));
  gateway.libraryAccessCache.set('viewer', { checkedAt: Date.now(), fids: new Set(['mine', 'empty']) });
  let scans = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    scans++; const fid = new URL(input).searchParams.get('pdir_fid');
    const list = fid === 'mine' ? [{ fid: 'trailer', file_type: 1, file_name: '预告片.mp4', thumbnail: 'https://image.example/wrong.jpg' }, { fid: 'sub', file_type: 0, dir: true, file_name: '第一季' }]
      : fid === 'sub' ? [{ fid: 'ep', file_type: 1, file_name: '第1集.mp4', big_thumbnail: 'https://image.example/first.jpg', thumbnail: 'https://image.example/small.jpg' }]
        : [{ fid: `next-${scans}`, file_type: 0, dir: true, file_name: '目录' }];
    return Response.json({ code: 0, data: { list } });
  });
  assert.equal((await gateway.getLibraryThumbnail('mine', user)).imageUrl, 'https://image.example/first.jpg');
  scans = 0; assert.equal(await gateway.getLibraryThumbnail('empty', user), null); assert.equal(scans, 20);
  gateway.listLibrary = async () => [];
  await assert.rejects(gateway.getLibraryThumbnail('other', user), error => error.statusCode === 403);
});
