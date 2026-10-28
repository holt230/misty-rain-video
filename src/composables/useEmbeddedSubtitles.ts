import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { authFetch } from '../services/authService';
import { withAppBase } from '../services/appUrl';
import { managedSubtitleTracks, centerSubtitleCue } from '../services/subtitleTracks';

interface SubtitleCue { start: number; end: number; text: string }
interface SubtitleWindow {
  from: number; to: number;
  tracks: Array<{ id: string; label: string; language: string; cues: SubtitleCue[] }>;
}
interface ManagedTrack { element: HTMLTrackElement; track: TextTrack; cues: Map<string, TextTrackCue>; blob: string }
const cueKey = (cue: { startTime: number; endTime: number }) => `${Math.round(cue.startTime * 1000)}:${Math.round(cue.endTime * 1000)}`;
const cueText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n\s*\n/g, '\n');
const clock = (value: number) => {
  const ms = Math.round(value * 1000), seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2,'0')}:${String(Math.floor(seconds / 60) % 60).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
};

/** A persistent HTML track works with Safari's native caption picker. The
 * loader owns cues only; selection/default/mode belong to SubtitleControls. */
export function useEmbeddedSubtitles(videoRef: Ref<HTMLVideoElement | null>, endpoint: () => string | undefined) {
  const loading = ref(false), error = ref('');
  let release = () => {}, retry = () => {};
  watch([videoRef, endpoint], ([video, url]) => {
    release(); loading.value = false; error.value = '';
    if (!video || !url) return;
    const controller = new AbortController(), tracks = new Map<string, ManagedTrack>();
    const loaded = new Set<number>();
    let busy = false, stopped = false, found: boolean | undefined;
    let failedBucket = -1, failures = 0, retryAt = 0, retryTimer: ReturnType<typeof setTimeout> | undefined;
    const announce = () => video.dispatchEvent(new Event('subtitletracksupdated'));
    const createTrack = async (item: SubtitleWindow['tracks'][number]) => {
      const element = document.createElement('track');
      element.kind = 'subtitles'; element.label = item.label; element.srclang = item.language || 'und';
      element.dataset.subtitleOrigin = 'embedded';
      const content = 'WEBVTT\n\n' + item.cues.map(cue => `${clock(cue.start)} --> ${clock(cue.end)} align:center\n${cueText(cue.text)}\n`).join('\n');
      const blob = URL.createObjectURL(new Blob([content], { type: 'text/vtt' }));
      element.src = blob;
      const entry: ManagedTrack = { element, track: element.track, cues: new Map(), blob };
      managedSubtitleTracks.set(entry.track, { active: true, ready: false, origin: 'embedded' });
      tracks.set(item.id, entry);
      try {
        await new Promise<void>((resolve, reject) => {
          const done = () => { cleanup(); resolve(); };
          const failed = () => { cleanup(); reject(new Error('字幕轨道加载失败')); };
          const cleanup = () => { clearTimeout(timer); element.removeEventListener('load', done); element.removeEventListener('error', failed); controller.signal.removeEventListener('abort', failed); };
          const timer = setTimeout(failed, 10_000);
          element.addEventListener('load', done); element.addEventListener('error', failed); controller.signal.addEventListener('abort', failed, { once: true });
          video.appendChild(element);
          entry.track.mode = 'hidden'; // Initial load only. Never toggle while adding later windows.
        });
        if (stopped) throw new Error('stopped');
        for (const cue of Array.from(entry.track.cues || [])) { centerSubtitleCue(cue as VTTCue); entry.cues.set(cueKey(cue), cue); }
        managedSubtitleTracks.set(entry.track, { active: true, ready: true, origin: 'embedded' });
        return entry;
      } catch (failure) {
        managedSubtitleTracks.set(entry.track, { active: false, origin: 'embedded' });
        entry.element.remove(); URL.revokeObjectURL(blob); tracks.delete(item.id); throw failure;
      }
    };
    const read = async (force = false) => {
      if (stopped || busy || found === false) return;
      const current = Math.max(0, video.currentTime || 0), bucket = Math.floor(current / 90);
      const wanted = loaded.has(bucket) && current % 90 >= 75 ? bucket + 1 : bucket;
      if (loaded.has(wanted)) return;
      if (wanted !== failedBucket || force) { failures = 0; retryAt = 0; error.value = ''; }
      if (!force && (Date.now() < retryAt || failures > 3)) return;
      clearTimeout(retryTimer);
      busy = true; loading.value = true;
      try {
        const response = await authFetch(`${withAppBase(url)}?time=${wanted * 90}`, { signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error('字幕读取失败'), { permanent: response.status === 422 });
        const json = await response.json();
        if (stopped) return;
        if (json.code !== 0 || !Array.isArray(json.data?.tracks)) throw new Error('字幕读取失败');
        const data = json.data as SubtitleWindow;
        found = data.tracks.length > 0;
        for (const item of data.tracks) {
          const entry = tracks.get(item.id) || await createTrack(item);
          if (stopped) return;
          for (const [key, cue] of entry.cues) {
            if (cue.endTime < current - 180 || cue.startTime > current + 270) { entry.track.removeCue(cue); entry.cues.delete(key); }
          }
          for (const itemCue of item.cues) {
            const cue = new VTTCue(itemCue.start, itemCue.end, cueText(itemCue.text));
            if (entry.cues.has(cueKey(cue))) continue;
            centerSubtitleCue(cue); entry.track.addCue(cue); entry.cues.set(cueKey(cue), cue);
          }
        }
        loaded.add(wanted);
        for (const key of loaded) if (key < bucket - 1 || key > bucket + 2) loaded.delete(key);
        failures = 0; retryAt = 0; error.value = ''; announce();
      } catch (failure) {
        if (!stopped) {
          failedBucket = wanted;
          failures = failure && typeof failure === 'object' && 'permanent' in failure && failure.permanent === true ? 4 : failures + 1;
          const delay = [1000, 3000, 8000][failures - 1];
          error.value = delay ? '字幕连接中断，正在重试…' : '字幕暂时读取失败';
          if (delay) { retryAt = Date.now() + delay; retryTimer = setTimeout(() => { void read(); }, delay); }
        }
      } finally {
        if (!stopped) {
          busy = false; loading.value = false;
          if (Math.floor(video.currentTime / 90) !== bucket) void read();
        }
      }
    };
    const update = () => { void read(); };
    retry = () => { void read(true); };
    ['loadedmetadata', 'seeked', 'timeupdate', 'webkitbeginfullscreen', 'webkitendfullscreen'].forEach(event => video.addEventListener(event, update));
    void read();
    release = () => {
      stopped = true; controller.abort(); clearTimeout(retryTimer);
      ['loadedmetadata', 'seeked', 'timeupdate', 'webkitbeginfullscreen', 'webkitendfullscreen'].forEach(event => video.removeEventListener(event, update));
      for (const entry of tracks.values()) {
        managedSubtitleTracks.set(entry.track, { active: false, origin: 'embedded' });
        entry.track.mode = 'disabled'; entry.element.remove(); URL.revokeObjectURL(entry.blob);
      }
    };
  }, { immediate: true, flush: 'post' });
  onBeforeUnmount(() => release());
  return { loading, error, retry: () => retry() };
}
