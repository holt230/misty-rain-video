<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { captionLayout, playerViewportSize } from '../../services/captionLayout';
const props = defineProps<{ video: HTMLVideoElement; fit: 'contain' | 'cover'; controlsInset: number; nativeFullscreen: boolean }>();
const lines = ref<string[]>([]);
const style = ref({});
const nativePresentation = ref(false);
let release = () => {};
let update = () => {};
watch(() => props.video, video => {
  release();
  const tracks = new Set<TextTrack>();
  let systemFullscreen = false;
  const sync = () => {
    const native = video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean; webkitPresentationMode?: string };
    nativePresentation.value = props.nativeFullscreen || systemFullscreen || Boolean(native.webkitDisplayingFullscreen)
      || document.fullscreenElement === video || document.pictureInPictureElement === video
      || native.webkitPresentationMode === 'fullscreen' || native.webkitPresentationMode === 'picture-in-picture';
    video.classList.toggle('player-captions-active', !nativePresentation.value);
    const track = Array.from(video.textTracks).find(track => track.mode === 'showing' && ['subtitles', 'captions'].includes(track.kind));
    lines.value = nativePresentation.value ? [] : Array.from(track?.activeCues || [])
      // Chromium can retain the ending cue in activeCues when paused exactly
      // at a boundary. Apply the cue's half-open interval without suppressing
      // legitimate overlapping or bilingual captions.
        .filter(cue => cue.startTime <= video.currentTime && video.currentTime < cue.endTime).map(cue => {
        const vtt = cue as VTTCue;
        return typeof vtt.getCueAsHTML === 'function' ? vtt.getCueAsHTML().textContent || '' : vtt.text || '';
      }).filter(Boolean);
  };
  const begin = () => { systemFullscreen = true; sync(); };
  const end = () => { systemFullscreen = false; sync(); };
  const measure = () => {
    const rect = playerViewportSize(video);
    style.value = captionLayout(rect.width, rect.height, video.videoWidth, video.videoHeight, props.fit, props.controlsInset);
  };
  const bind = () => {
    for (const track of tracks) if (!Array.from(video.textTracks).includes(track)) { track.removeEventListener('cuechange', sync); tracks.delete(track); }
    for (const track of Array.from(video.textTracks)) if (!tracks.has(track)) { track.addEventListener('cuechange', sync); tracks.add(track); }
    sync();
  };
  const trackEvents = ['change', 'addtrack', 'removetrack'];
  const videoEvents = ['loadedmetadata', 'seeked', 'timeupdate', 'enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged', 'subtitletracksupdated'];
  trackEvents.forEach(event => video.textTracks.addEventListener(event, bind));
  videoEvents.forEach(event => video.addEventListener(event, bind));
  video.addEventListener('webkitbeginfullscreen', begin); video.addEventListener('webkitendfullscreen', end);
  document.addEventListener('fullscreenchange', sync);
  video.addEventListener('resize', measure); window.addEventListener('resize', measure);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
  observer?.observe(video); bind(); measure(); update = () => { sync(); measure(); };
  release = () => {
    observer?.disconnect(); video.classList.remove('player-captions-active');
    trackEvents.forEach(event => video.textTracks.removeEventListener(event, bind));
    videoEvents.forEach(event => video.removeEventListener(event, bind));
    video.removeEventListener('webkitbeginfullscreen', begin); video.removeEventListener('webkitendfullscreen', end);
    document.removeEventListener('fullscreenchange', sync);
    video.removeEventListener('resize', measure); window.removeEventListener('resize', measure);
    tracks.forEach(track => track.removeEventListener('cuechange', sync));
  };
}, { immediate: true, flush: 'post' });
watch([() => props.fit, () => props.controlsInset, () => props.nativeFullscreen], () => update(), { flush: 'sync' });
onBeforeUnmount(() => release());
</script>
<template>
  <div v-if="!nativePresentation && lines.length" class="player-captions" :style="style" aria-hidden="true"><span v-for="(line, index) in lines" :key="index">{{ line }}</span></div>
</template>
<style>
/* Keep track modes/cue clocks untouched. Native PiP/fullscreen gets its own cue rendering. */
video.player-captions-active::cue { opacity: 0; }
</style>
<style scoped>
.player-captions { position: absolute; left: 50%; transform: translateX(-50%); z-index: 4; pointer-events: none; text-align: center; color: white; line-height: 1.35; font-weight: 600; text-shadow: 0 1px 3px #000, 1px 0 2px #000, -1px 0 2px #000; }
.player-captions span { display: block; white-space: pre-line; overflow-wrap: anywhere; }
</style>
