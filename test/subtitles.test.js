import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSubtitle, subtitleToVtt, subtitleMatches, includeSubtitleCompanions } from '../server/subtitles.js';
import { QuarkGateway } from '../server/quarkGateway.js';

test('SRT/VTT时间轴统一为WebVTT，文本与换行保留', () => {
  const srt = '1\r\n00:00:01,200 --> 00:00:03,400\r\n<b>你好</b> & 世界\r\n第二行\r\n';
  const vtt = subtitleToVtt(srt, 'demo.srt');
  assert.equal(vtt, 'WEBVTT\n\n00:00:01.200 --> 00:00:03.400 align:center\n你好 &amp; 世界\n第二行\n');
  assert.match(subtitleToVtt('WEBVTT\n\n00:01.200 --> 00:03.400\n字幕', 'demo.vtt'), /00:00:01.200/);
  assert.throws(() => subtitleToVtt('bad content'), error => error.code === 'SUBTITLE_FORMAT_UNSUPPORTED');
});

test('ASS/SSA按声明字段读取时间轴，去掉样式控制但保留逗号和换行', () => {
  const ass = '[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.20,0:00:03.40,Default,,0,0,0,,{\\b1}Hello,世界\\N第二行';
  assert.match(subtitleToVtt(ass, 'demo.ass'), /Hello,世界\n第二行/);
  assert.doesNotMatch(subtitleToVtt(ass), /\\b1/);
});

test('VTT/SRT entities decode once, literal comparisons survive, and encoded markup stays inert', () => {
  const input = 'WEBVTT\n\n00:01.000 --> 00:03.000\n<b>Tom &amp; Jerry</b> &lt;3 &#20320;&#x597d; &nbsp; &quot;ok&quot;\n1 < 2 and 3 > 2\n&lt;img src=x onerror=alert(1)&gt;';
  const vtt = subtitleToVtt(input, 'entities.vtt');
  assert.match(vtt, /Tom &amp; Jerry &lt;3 你好 \u00a0 "ok"/);
  assert.match(vtt, /1 &lt; 2 and 3 &gt; 2/);
  assert.match(vtt, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(vtt, /&amp;amp;|&amp;lt;|<img|<b>/);
  assert.equal(subtitleToVtt(vtt, 'roundtrip.vtt'), vtt, 'normalizing VTT twice preserves its visible text');
  assert.doesNotThrow(() => subtitleToVtt('00:01.000 --> 00:02.000\n&#999999999; &#xD800;', 'invalid-entities.srt'));
  assert.match(subtitleToVtt('00:01.000 --> 00:02.000\nTop<br><br>Bottom', 'linebreaks.srt'), /\nTop\nBottom\n$/,
    'HTML line breaks cannot accidentally terminate a WebVTT cue');
});

test('ASS formatting and escapes are parsed only for ASS, including indented records', () => {
  const ass = '[Events]\n  Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n  Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\b1}A &amp; B\\N第二行';
  assert.match(subtitleToVtt(ass, 'indented.ass'), /A &amp;amp; B\n第二行/);
  assert.match(subtitleToVtt('00:01.000 --> 00:02.000\nC:\\New\\notes', 'literal.vtt'), /C:\\New\\notes/);
  assert.throws(() => subtitleToVtt('00:01.000 --> 00:02.000\n<b></b>', 'empty.srt'), { code: 'SUBTITLE_FORMAT_UNSUPPORTED' });
});

test('UTF-16和GBK字幕不变成乱码', () => {
  assert.equal(decodeSubtitle(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好', 'utf16le')])), '你好');
  assert.equal(decodeSubtitle(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])), '你好');
});

test('选集保存附带字幕，保留字幕目录并排除不同季和不同集', () => {
  const video = { fid: 'video', file_name: 'S01E01.4K.mp4', parentFid: 'folder', ancestorFids: ['folder'] };
  const entries = [video,
    { fid: 'folder', file_name: '第一季', file_type: 0, parentFid: '0', ancestorFids: [] },
    { fid: 'subs', file_name: 'Subtitles', file_type: 0, parentFid: 'folder', ancestorFids: ['folder'] },
    { fid: 'zh', file_name: 'S01E01.chs.srt', parentFid: 'subs', ancestorFids: ['folder', 'subs'] },
    { fid: 'bitmap', file_name: 'S01E01.idx', parentFid: 'folder', ancestorFids: ['folder'] },
    { fid: 'other', file_name: 'S01E02.chs.srt', parentFid: 'folder', ancestorFids: ['folder'] }
  ];
  assert.deepEqual(includeSubtitleCompanions(entries, [video]).map(item => item.fid), ['video', 'zh', 'bitmap']);
  assert.equal(subtitleMatches('S01E01.mp4', 'S02E01.srt'), false);
  assert.equal(subtitleMatches('S01E01.mp4', 'S01E010.srt'), false);
  assert.equal(subtitleMatches('第01季 第01集.mp4', '第01季 第01集.S01E01.chs.srt'), true);
  assert.equal(subtitleMatches('第02季 第01集.mp4', 'S01E01.chs.srt'), false);
});

test('同目录字幕绑定播放会话并转换为VTT，其他用户不能读取', async t => {
  const gateway = new QuarkGateway({
    credentialStore: { getCookie: () => 'private-cookie', getTvAuth: () => ({ refreshToken: 'private-token' }) },
    tvPlaybackClient: {
      getStreaming: async () => ({ video_list: [{ resolution: '4k', video_info: { url: 'https://media.example.test/video.mp4' } }] }),
      getDownload: async fid => { assert.equal(fid, 'caption'); return { download_url: 'https://media.example.test/caption.srt' }; }
    }
  });
  t.after(() => clearInterval(gateway.cleanupTimer));
  gateway.sessions.set('session', { id: 'session', ownerUsername: 'admin', kind: 'drive',
    episodes: [{ fid: 'episode', fileName: 'S01E01.mp4', parentFid: 'folder' }], sources: new Map(), assets: new Map(), touchedAt: Date.now() });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { list: [
    { fid: 'episode', file_name: 'S01E01.mp4', file_type: 1 },
    { fid: 'caption', file_name: 'S01E01.chs.srt', file_type: 1 },
    { fid: 'wrong-caption', file_name: 'S01E02.srt', file_type: 1 }
  ] } }));
  const playback = await gateway.prepareEpisode('session', 'episode');
  assert.equal(playback.subtitles.length, 1);
  assert.equal(playback.subtitles[0].language, 'zh-Hans');
  assert.doesNotMatch(JSON.stringify(playback), /private-cookie|private-token|media.example/);
  gateway.fetchMedia = async () => new Response('1\n00:00:01,000 --> 00:00:02,000\n字幕测试');
  const content = await gateway.getSubtitleContent('session', playback.subtitles[0].id);
  assert.match(content, /^WEBVTT/);
  await assert.rejects(gateway.getSubtitleContent('session', playback.subtitles[0].id, { username: 'other', role: 'user', folder: 'other' }), error => error.statusCode === 403);
  gateway.fetchMedia = async () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(gateway.getSubtitleContent('session', playback.subtitles[0].id), error => error.code === 'SUBTITLE_TOO_LARGE');
});
