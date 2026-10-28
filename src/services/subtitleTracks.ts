import type Hls from 'hls.js';
export interface SubtitleTrackOption { id: string; label: string; language: string; origin: string; }
const caption = (track: TextTrack) => track.kind === 'subtitles' || track.kind === 'captions';
export const managedSubtitleTracks = new WeakMap<TextTrack, { active: boolean; origin: string; ready?: boolean }>();
export const subtitleLanguageKey = (language: string) => {
  const primary = language.trim().toLowerCase().split(/[-_]/)[0];
  return ({ chi: 'zh', zho: 'zh', eng: 'en', jpn: 'ja' } as Record<string, string>)[primary] || primary;
};
export const centerSubtitleCue = (cue: VTTCue) => {
  if (cue.align !== 'center') cue.align = 'center';
  // Let the native renderer place the centered cue box. An explicit 50%
  // position/anchor can be interpreted differently by AVKit and WebVTT.
  if (cue.position !== 'auto') cue.position = 'auto';
  if (cue.size !== 100) cue.size = 100;
  if (!cue.snapToLines) cue.snapToLines = true;
  if (cue.line !== 'auto') cue.line = 'auto';
  if ('positionAlign' in cue && cue.positionAlign !== 'auto') cue.positionAlign = 'auto';
  if ('lineAlign' in cue && cue.lineAlign !== 'start') cue.lineAlign = 'start';
  if ('vertical' in cue && cue.vertical !== '') cue.vertical = '';
  if ('region' in cue && cue.region) cue.region = null;
};
export const centerSelectedSubtitleCues = (video: HTMLVideoElement, all = false) => {
  for (const track of Array.from(video.textTracks)) {
    if (!caption(track) || track.mode !== 'showing') continue;
    for (const cue of Array.from((all ? track.cues : track.activeCues) || [])) {
      if ('text' in cue && 'position' in cue) centerSubtitleCue(cue as VTTCue);
    }
  }
};
export const subtitleTrackOptions = (video: HTMLVideoElement, hls?: Hls | null): SubtitleTrackOption[] => {
  const options: SubtitleTrackOption[] = (hls?.subtitleTracks || []).map((track, index) => ({
    id: `hls:${index}`, label: `${track.name || track.lang || `字幕 ${index + 1}`} · 流媒体`, language: track.lang || '', origin: 'hls'
  }));
  Array.from(video.textTracks).forEach((track, index) => {
    if (!caption(track)) return;
    const managed = managedSubtitleTracks.get(track);
    if (managed?.active === false || managed?.ready === false) return;
    const element = Array.from(video.querySelectorAll('track')).find(item => item.track === track);
    if (!element?.dataset.subtitleOrigin && hls?.subtitleTracks.some(item => item.name === track.label && (item.lang || '') === track.language)) return;
    options.push({ id: `native:${index}`, label: track.label || track.language || `字幕 ${index + 1}`, language: track.language || '', origin: managed?.origin || element?.dataset.subtitleOrigin || 'native' });
  });
  return options;
};
export const activeSubtitleTrack = (video: HTMLVideoElement, hls?: Hls | null): string => {
  if (hls?.subtitleDisplay && hls.subtitleTrack >= 0) return `hls:${hls.subtitleTrack}`;
  const options = subtitleTrackOptions(video, hls);
  const showing = Array.from(video.textTracks).map((track,index) => ({ track, id: `native:${index}` })).filter(item => caption(item.track) && item.track.mode === 'showing');
  const selectable = showing.find(item => options.some(option => option.id === item.id));
  if (selectable) return selectable.id;
  return showing[0]?.id || 'off';
};
export const setSubtitleDefaults = (video: HTMLVideoElement, id: string) => {
  Array.from(video.querySelectorAll('track')).forEach(element => {
    const selected = id.startsWith('native:') && element.track === video.textTracks[Number(id.slice(7))];
    if (element.default !== selected) element.default = selected;
  });
};
export const selectSubtitleTrack = (video: HTMLVideoElement, hls: Hls | null | undefined, id: string) => {
  if (id !== 'off' && !subtitleTrackOptions(video, hls).some(track => track.id === id)) return false;
  if (hls) { hls.subtitleDisplay = false; hls.subtitleTrack = -1; }
  Array.from(video.textTracks).filter(caption).forEach(track => { if (managedSubtitleTracks.get(track)?.ready !== false && track.mode !== 'disabled') track.mode = 'disabled'; });
  setSubtitleDefaults(video, id);
  if (id.startsWith('hls:') && hls) { hls.subtitleTrack = Number(id.slice(4)); hls.subtitleDisplay = true; }
  else if (id.startsWith('native:')) video.textTracks[Number(id.slice(7))].mode = 'showing';
  return true;
};

export const subtitlePreferenceKey = (username = 'guest') => `misty_rain_subtitles:${encodeURIComponent(username || 'guest')}`;
export const subtitleEvents = (hls: Hls) => {
  const events = (hls.constructor as typeof Hls).Events;
  return [events.SUBTITLE_TRACKS_UPDATED, events.SUBTITLE_TRACK_SWITCH, events.SUBTITLE_TRACKS_CLEARED];
};

export interface SubtitleChoice { key: string; label: string; options: SubtitleTrackOption[]; }
const languageNames: Record<string, string> = { zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语', ar: '阿拉伯语' };
/** User intent follows a language/variant, never an origin or a track index. */
export const subtitleChoiceKey = (option: Pick<SubtitleTrackOption, 'language' | 'label'>) => {
  let language = subtitleLanguageKey(option.language);
  const label = option.label.trim();
  if (!language || language === 'und') {
    if (/中文|汉语|简体|繁体|chinese/i.test(label)) language = 'zh';
    else if (/英语|英文|english/i.test(label)) language = 'en';
    else if (/日语|日文|japanese/i.test(label)) language = 'ja';
    else if (/韩语|韩文|korean/i.test(label)) language = 'ko';
  }
  if (/中英|英中|双语|bilingual/i.test(label)) return 'language:zh-bilingual';
  if (language === 'zh') {
    if (/hant|[-_]tw|[-_]hk/i.test(option.language) || /繁体|繁體|traditional/i.test(label)) return 'language:zh-Hant';
    if (/hans|[-_]cn|[-_]sg/i.test(option.language) || /简体|簡體|simplified/i.test(label)) return 'language:zh-Hans';
  }
  return language && language !== 'und' ? `language:${language}` : `label:${label || '字幕'}`;
};
export const subtitleChoiceLabel = (key: string) => {
  if (key.startsWith('label:')) return key.slice(6);
  const language = key.slice(9);
  return ({ 'zh-Hans': '简体中文', 'zh-Hant': '繁体中文', 'zh-bilingual': '中英双语' } as Record<string,string>)[language] || languageNames[language] || language;
};
export const normalizeSubtitlePreference = (stored: string | null): string => {
  if (!stored || stored === 'auto' || stored === 'off') return stored || 'auto';
  // Read the previously shipped origin:language/label format without pinning
  // future episodes to that origin. Migration never writes on fullscreen exit.
  const value = stored.replace(/^[^:]+:(?=language:|label:)/, '');
  if (value.startsWith('language:')) {
    const language = value.slice(9);
    return language === 'zh-bilingual' ? value : subtitleChoiceKey({ language, label: '' });
  }
  return value.startsWith('label:') ? value : 'auto';
};
export const subtitleChoices = (options: SubtitleTrackOption[]): SubtitleChoice[] => {
  const groups = new Map<string, SubtitleChoice>();
  const priority = (option: SubtitleTrackOption) => option.origin === 'embedded' ? 0 : option.origin === 'native' ? 3 : option.origin === 'hls' ? 2 : 1;
  for (const option of options) {
    const key = subtitleChoiceKey(option);
    const group = groups.get(key) || { key, label: subtitleChoiceLabel(key), options: [] };
    group.options.push(option); groups.set(key, group);
  }
  return Array.from(groups.values()).map(group => ({ ...group, options: group.options.sort((a,b) => priority(a)-priority(b)) }));
};
export const preferredSubtitleChoice = (choices: SubtitleChoice[], preference: string) => {
  if (preference === 'off') return undefined;
  const exact = choices.find(choice => choice.key === preference);
  if (exact) return exact;
  // An older generic Chinese preference can follow a newly identified script.
  const sameLanguage = preference.startsWith('language:') && !preference.includes('bilingual')
    ? choices.find(choice => choice.key.startsWith('language:') && subtitleLanguageKey(choice.key.slice(9)) === subtitleLanguageKey(preference.slice(9))) : undefined;
  return sameLanguage || choices.find(choice => /^language:zh(?:-|$)/.test(choice.key)) || choices[0];
};
