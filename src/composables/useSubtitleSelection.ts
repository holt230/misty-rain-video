import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type Hls from 'hls.js';
import {
  activeSubtitleTrack, centerSelectedSubtitleCues, managedSubtitleTracks,
  normalizeSubtitlePreference, preferredSubtitleChoice, selectSubtitleTrack,
  setSubtitleDefaults, subtitleChoiceKey, subtitleChoiceLabel, subtitleChoices,
  subtitleEvents, subtitlePreferenceKey, subtitleTrackOptions, type SubtitleChoice,
} from '../services/subtitleTracks';

interface SubtitleSelectionProps {
  video: HTMLVideoElement; hls?: Hls | null; username?: string;
  nativeFullscreen?: boolean; contextKey?: string;
}

/** Owns intent and TextTrack selection. Loaders own cues; renderers own visibility. */
export function useSubtitleSelection(props: SubtitleSelectionProps) {
  const preference = ref('auto'), choices = ref<SubtitleChoice[]>([]), activeKey = ref('');
  const error = ref('');
  let release = () => {}, reconcile = () => {};
  let storageKey = '';
  const summary = computed(() => preference.value === 'off' ? '关闭'
    : preference.value === 'auto' ? `自动${activeKey.value ? ` · ${subtitleChoiceLabel(activeKey.value)}` : ''}`
      : subtitleChoiceLabel(preference.value));
  const unavailable = computed(() => preference.value !== 'off' && preference.value !== 'auto'
    && !choices.value.some(choice => choice.key === preference.value));
  const remember = (value: string) => {
    preference.value = value;
    try { localStorage.setItem(storageKey, value); } catch { /* Session intent still applies. */ }
  };
  const choose = (key: string) => {
    if (!['auto', 'off'].includes(key) && !choices.value.some(choice => choice.key === key)) return;
    remember(key); error.value = ''; reconcile();
  };
  const retry = () => {
    const element = Array.from(props.video.querySelectorAll('track')).find(track => track.track.mode === 'showing' && track.readyState === 3);
    if (!element) return;
    const url = new URL(element.src, location.href); url.searchParams.set('_retry', String(Date.now()));
    error.value = ''; element.src = url.toString();
  };

  watch([() => props.video, () => props.hls, () => props.username, () => props.contextKey], ([video, hls]) => {
    release(); error.value = '';
    const nextKey = subtitlePreferenceKey(props.username);
    if (storageKey !== nextKey) {
      storageKey = nextKey;
      try { preference.value = normalizeSubtitlePreference(localStorage.getItem(storageKey)); } catch { preference.value = 'auto'; }
    }
    let applying = false, stopped = false, nativeActive = Boolean(props.nativeFullscreen), settling = false;
    let nativeTimer: ReturnType<typeof setTimeout> | undefined;
    let appliedTrack: TextTrack | undefined;
    const cues = new Set<TextTrack>(), elements = new Set<HTMLTrackElement>();
    const ready = (track: TextTrack) => ['subtitles','captions'].includes(track.kind)
      && managedSubtitleTracks.get(track)?.active !== false && managedSubtitleTracks.get(track)?.ready !== false;
    const updateChoices = () => { choices.value = subtitleChoices(subtitleTrackOptions(video, hls)); };
    const selectedTrack = () => Array.from(video.textTracks).find(track => ready(track) && track.mode === 'showing');
    const cancelNative = () => { clearTimeout(nativeTimer); nativeTimer = undefined; };
    reconcile = () => {
      if (stopped || applying) return;
      updateChoices();
      const choice = preferredSubtitleChoice(choices.value, preference.value);
      const id = choice?.options[0]?.id || 'off';
      const availableTracks = Array.from(video.textTracks).filter(ready);
      const showing = availableTracks.filter(track => track.mode === 'showing');
      applying = true;
      try {
        if (activeSubtitleTrack(video, hls) !== id || showing.length > 1
          || id === 'off' && availableTracks.some(track => track.mode !== 'disabled')) selectSubtitleTrack(video, hls, id);
        setSubtitleDefaults(video, id); centerSelectedSubtitleCues(video, true);
        activeKey.value = choice?.key || ''; appliedTrack = selectedTrack();
      } finally { applying = false; }
    };
    const onModeChange = () => {
      if (applying || stopped) return;
      if (!nativeActive) { reconcile(); return; }
      if (settling) return;
      cancelNative();
      // Native pickers do not identify user actions. Accept only a stable change
      // while the system player is open, never its hidden/disabled exit handoff.
      nativeTimer = setTimeout(() => {
        if (stopped || !nativeActive) return;
        const tracks = Array.from(video.textTracks).filter(ready);
        const showing = tracks.filter(track => track.mode === 'showing');
        if (showing.length === 1) {
          const track = showing[0]!;
          if (track === appliedTrack) return;
          const key = subtitleChoiceKey(track);
          if (key !== activeKey.value) remember(key);
          reconcile();
        } else if (!showing.length && appliedTrack && tracks.includes(appliedTrack)
          && tracks.every(track => track.mode === 'disabled')) {
          remember('off'); reconcile();
        }
      }, 150);
    };
    const nativeBegin = () => {
      cancelNative(); nativeActive = true; settling = true;
      nativeTimer = setTimeout(() => { settling = false; }, 150);
    };
    const nativeEnd = () => {
      cancelNative(); nativeActive = false; settling = false;
      // Intent survives presentation changes; the exit track state is not input.
      reconcile();
    };
    const fullscreenChanged = () => {
      if (document.fullscreenElement === video) nativeBegin();
      else if (nativeActive) nativeEnd();
    };
    const centerActive = () => centerSelectedSubtitleCues(video);
    const failed = () => { error.value = '字幕暂时加载失败'; };
    const loaded = () => { error.value = ''; refresh(); };
    const refresh = () => {
      cancelNative(); settling = false;
      const current = new Set(Array.from(video.textTracks));
      for (const track of cues) if (!current.has(track)) { track.removeEventListener('cuechange', centerActive); cues.delete(track); }
      for (const track of current) if (!cues.has(track)) { track.addEventListener('cuechange', centerActive); cues.add(track); }
      const currentElements = new Set(Array.from(video.querySelectorAll('track')));
      for (const track of elements) if (!currentElements.has(track)) { track.removeEventListener('load', loaded); track.removeEventListener('error', failed); elements.delete(track); }
      for (const track of currentElements) if (!elements.has(track)) { track.addEventListener('load', loaded); track.addEventListener('error', failed); elements.add(track); }
      reconcile();
    };
    video.textTracks.addEventListener('change', onModeChange);
    const trackEvents = ['addtrack', 'removetrack'];
    trackEvents.forEach(event => video.textTracks.addEventListener(event, refresh));
    const videoEvents = ['loadedmetadata', 'subtitletracksupdated'];
    videoEvents.forEach(event => video.addEventListener(event, refresh));
    video.addEventListener('webkitbeginfullscreen', nativeBegin);
    video.addEventListener('webkitendfullscreen', nativeEnd);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    const hlsEvents = hls ? subtitleEvents(hls) : [];
    hlsEvents.forEach(event => hls?.on(event, refresh));
    const stopNativeWatch = watch(() => props.nativeFullscreen, active => {
      if (active && !nativeActive) nativeBegin();
      else if (!active && nativeActive) nativeEnd();
    }, { flush: 'sync' });
    refresh();
    release = () => {
      stopped = true; cancelNative(); stopNativeWatch();
      video.textTracks.removeEventListener('change', onModeChange);
      trackEvents.forEach(event => video.textTracks.removeEventListener(event, refresh));
      videoEvents.forEach(event => video.removeEventListener(event, refresh));
      video.removeEventListener('webkitbeginfullscreen', nativeBegin); video.removeEventListener('webkitendfullscreen', nativeEnd);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      hlsEvents.forEach(event => hls?.off(event, refresh));
      cues.forEach(track => track.removeEventListener('cuechange', centerActive));
      elements.forEach(track => { track.removeEventListener('load', loaded); track.removeEventListener('error', failed); });
    };
  }, { immediate: true, flush: 'post' });
  onBeforeUnmount(() => release());
  return { preference, choices, activeKey, summary, unavailable, error, choose, retry };
}
