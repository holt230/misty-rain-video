import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';

const { code } = await transform(fs.readFileSync('src/services/subtitleTracks.ts', 'utf8'), { loader: 'ts', format: 'esm' });
const { centerSubtitleCue, centerSelectedSubtitleCues, subtitleTrackOptions, selectSubtitleTrack, activeSubtitleTrack, subtitleChoiceKey, subtitleChoices, preferredSubtitleChoice, normalizeSubtitlePreference, subtitleLanguageKey, managedSubtitleTracks } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const videoFixture = () => ({ textTracks: [
  { kind: 'subtitles', label: '中文', language: 'zh', mode: 'showing' },
  { kind: 'captions', label: 'English', language: 'en', mode: 'disabled' },
  { kind: 'metadata', label: 'timing', language: '', mode: 'hidden' }
], querySelectorAll: () => [] });

test('内嵌字幕可选/关闭，元数据轨道保持不变', () => {
  const video = videoFixture();
  assert.equal(subtitleTrackOptions(video).length, 2);
  selectSubtitleTrack(video, null, 'native:1');
  assert.equal(video.textTracks[0].mode, 'disabled');
  assert.equal(video.textTracks[1].mode, 'showing');
  assert.equal(video.textTracks[2].mode, 'hidden');
  assert.equal(activeSubtitleTrack(video), 'native:1');
  selectSubtitleTrack(video, null, 'off');
  assert.equal(activeSubtitleTrack(video), 'off');
  assert.equal(selectSubtitleTrack(video, null, 'native:2'), false);
});

test('HLS字幕使用流媒体选择接口，并与文件字幕互斥', () => {
  const video = videoFixture();
  const hls = { subtitleTracks: [{ name: '中文字幕', lang: 'zh' }], subtitleTrack: -1, subtitleDisplay: false };
  selectSubtitleTrack(video, hls, 'hls:0');
  assert.equal(hls.subtitleTrack, 0);
  assert.equal(hls.subtitleDisplay, true);
  assert.equal(activeSubtitleTrack(video, hls), 'hls:0');
  selectSubtitleTrack(video, hls, 'native:1');
  assert.equal(hls.subtitleDisplay, false);
  assert.equal(hls.subtitleTrack, -1);
  assert.equal(video.textTracks[1].mode, 'showing');
  assert.equal(subtitleChoiceKey({ label: '中文', language: 'zh' }), subtitleChoiceKey({ label: '中文 · 外挂', language: 'zh' }));
});

test('Safari selection marks exactly one HTML default track and leaves a loading track alone', () => {
 const video=videoFixture();const elements=video.textTracks.slice(0,2).map(track=>({track,dataset:{subtitleOrigin:'sidecar'},default:false}));video.querySelectorAll=()=>elements;
 selectSubtitleTrack(video,null,'native:1');assert.equal(elements[1].default,true);assert.equal(elements[0].default,false);
 const loading={kind:'subtitles',label:'加载中',language:'zh',mode:'hidden'};video.textTracks.push(loading);managedSubtitleTracks.set(loading,{active:true,ready:false,origin:'embedded'});
 selectSubtitleTrack(video,null,'off');assert.equal(elements[1].default,false);assert.equal(loading.mode,'hidden');assert.ok(!subtitleTrackOptions(video).some(o=>o.label==='加载中'));
});

test('subtitle language preferences survive regional and container language codes', () => {
  for (const language of ['en', 'eng', 'en-US', 'EN_gb']) assert.equal(subtitleLanguageKey(language), 'en');
  for (const language of ['zh', 'zho', 'chi', 'zh-Hans', 'zh_Hant']) assert.equal(subtitleLanguageKey(language), 'zh');
  for (const language of ['ja', 'jpn', 'ja-JP']) assert.equal(subtitleLanguageKey(language), 'ja');
  assert.equal(subtitleLanguageKey('zhuang'), 'zhuang', 'unknown languages are not matched by a Chinese prefix');
});


test('native dialogue resets explicit right-side boxes to centered automatic layout without changing timing, text or track choice',()=>{
 const cue={startTime:1,endTime:4,text:'测试字幕',align:'end',position:90,size:30,snapToLines:false,line:100,positionAlign:'line-right',lineAlign:'end',vertical:'rl',region:{id:'side'}};
 centerSubtitleCue(cue);assert.deepEqual([cue.align,cue.position,cue.size,cue.snapToLines,cue.line,cue.positionAlign,cue.lineAlign,cue.vertical,cue.region],['center','auto',100,true,'auto','auto','start','',null]);assert.equal(cue.text,'测试字幕');assert.equal(cue.startTime,1);assert.equal(cue.endTime,4);
 const active={...cue,position:72},inactive={...cue,position:80},metadata={...cue,position:90};
 const video={textTracks:[{kind:'subtitles',mode:'showing',cues:[active,inactive],activeCues:[active]},{kind:'metadata',mode:'showing',cues:[metadata],activeCues:[metadata]}]};
 centerSelectedSubtitleCues(video);assert.equal(active.position,'auto');assert.equal(inactive.position,80);assert.equal(metadata.position,90);centerSelectedSubtitleCues(video,true);assert.equal(inactive.position,'auto');assert.equal(video.textTracks[0].mode,'showing');
});


test('language choices merge sources, prefer normalized tracks and retain script/bilingual choices', () => {
 const options=[{id:'native:0',origin:'native',language:'zh',label:'中文'}, {id:'native:1',origin:'sidecar',language:'en-US',label:'English · 外挂'}, {id:'native:2',origin:'embedded',language:'chi',label:'中文'}, {id:'native:3',origin:'sidecar',language:'en',label:'English'}, {id:'native:4',origin:'sidecar',language:'zh-Hant',label:'繁体中文'}, {id:'native:5',origin:'sidecar',language:'zh-Hans',label:'简体中文'}, {id:'native:6',origin:'sidecar',language:'zh',label:'中英双语'}];
 const choices=subtitleChoices(options);assert.equal(choices.length,5);assert.equal(choices.find(c=>c.key==='language:zh').options[0].id,'native:2');assert.equal(choices.find(c=>c.key==='language:en').options.length,2);
 assert.equal(preferredSubtitleChoice(choices,'auto').key,'language:zh');assert.equal(preferredSubtitleChoice(choices,'language:zh-Hant').key,'language:zh-Hant');assert.equal(preferredSubtitleChoice(choices,'off'),undefined);
 assert.equal(normalizeSubtitlePreference('embedded:language:en-US'),'language:en');assert.equal(normalizeSubtitlePreference('hls:language:zh-Hant'),'language:zh-Hant');assert.equal(normalizeSubtitlePreference('off'),'off');assert.equal(normalizeSubtitlePreference(null),'auto');
});
