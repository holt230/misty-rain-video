import { onBeforeUnmount, watch, type Ref } from 'vue';

interface MediaOptions {
  enabled: () => boolean;
  title: () => string;
  album?: () => string;
  episode: () => string;
  nextAvailable: () => boolean;
  next: () => void;
  play: () => void;
}

/** Own system controls and the visible-playback wake lock for this player lifetime. */
export function useAndroidMediaSession(videoRef: Ref<HTMLVideoElement | null>, options: MediaOptions) {
  let release = () => {};
  const stop = watch([videoRef, options.enabled, options.title, options.episode, options.nextAvailable, () => options.album?.() || ''], ([video, enabled]) => {
    release();
    if (!video || !enabled) return;
    const media = navigator.mediaSession;
    let disposed = false;
    let pending = false;
    let wake: WakeLockSentinel | null = null;
    const shouldWake = () => !disposed && document.visibilityState === 'visible' && !video.paused && !video.ended;
    const releaseWake = () => { const current = wake; wake = null; void current?.release().catch(() => {}); };
    const syncWake = async () => {
      if (!shouldWake()) { releaseWake(); return; }
      if (!navigator.wakeLock || wake || pending) return;
      pending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!shouldWake()) { await lock.release(); return; }
        wake = lock;
        lock.addEventListener('release', () => { if (wake === lock) wake = null; }, { once: true });
      } catch { /* Battery/browser policy can deny a wake lock; playback continues. */ }
      finally { pending = false; }
    };
    const syncPosition = () => {
      if (!media?.setPositionState) return;
      try {
        if (Number.isFinite(video.duration) && video.duration > 0 && video.playbackRate > 0) {
          media.setPositionState({ duration: video.duration, playbackRate: video.playbackRate, position: Math.max(0, Math.min(video.currentTime || 0, video.duration)) });
        } else media.setPositionState();
      } catch { /* Some browsers expose a partial Media Session implementation. */ }
    };
    const sync = () => {
      if (media) media.playbackState = video.paused || video.ended ? 'paused' : 'playing';
      syncPosition();
      void syncWake();
    };
    const seek = (position: number) => {
      if (Number.isFinite(position) && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.max(0, Math.min(position, video.duration)); syncPosition();
      }
    };
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>> = {
      play: options.play, pause: () => video.pause(),
      seekto: detail => { if (detail.seekTime !== undefined) seek(detail.seekTime); },
      seekbackward: detail => seek(video.currentTime - (detail.seekOffset || 10)),
      seekforward: detail => seek(video.currentTime + (detail.seekOffset || 10)),
      nexttrack: options.nextAvailable() ? options.next : null,
    };
    if (media) {
      if (typeof MediaMetadata !== 'undefined') media.metadata = new MediaMetadata({ title: options.title(), artist: options.episode(), album: options.album?.() || '' });
      for (const [action, handler] of Object.entries(handlers)) {
        try { media.setActionHandler(action as MediaSessionAction, handler); } catch { /* Unsupported action. */ }
      }
    }
    const events = ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'ratechange'];
    events.forEach(event => video.addEventListener(event, sync));
    video.addEventListener('timeupdate', syncPosition);
    video.addEventListener('seeked', syncPosition);
    document.addEventListener('visibilitychange', syncWake);
    sync();
    release = () => {
      disposed = true; releaseWake();
      events.forEach(event => video.removeEventListener(event, sync));
      video.removeEventListener('timeupdate', syncPosition);
      video.removeEventListener('seeked', syncPosition);
      document.removeEventListener('visibilitychange', syncWake);
      if (media) {
        for (const action of Object.keys(handlers)) { try { media.setActionHandler(action as MediaSessionAction, null); } catch { /* Unsupported action. */ } }
        media.metadata = null; media.playbackState = 'none';
        try { media.setPositionState?.(); } catch { /* Unsupported action. */ }
      }
    };
  }, { immediate: true, flush: 'post' });
  onBeforeUnmount(() => { stop(); release(); });
}
