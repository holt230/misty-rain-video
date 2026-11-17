import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

export type NativeFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
};

/** Request a supported fullscreen API once. A rejection never changes page layout. */
export function usePlayerFullscreen(
  target: () => HTMLElement | null,
  video: () => NativeFullscreenVideo | null,
  isOpen: () => boolean,
  mobile = false
) {
  const fullscreen = ref(false);
  const notice = ref('');
  const pending = ref(false);
  let orientationLocked = false;
  const nativeVideoFullscreen = computed(() => !document.fullscreenEnabled && Boolean(video()?.webkitEnterFullscreen));
  const orientation = () => window.screen.orientation as (ScreenOrientation & { lock?: (mode: string) => Promise<void> }) | undefined;
  const unlock = () => {
    if (orientationLocked) orientation()?.unlock();
    orientationLocked = false;
  };
  const sync = () => {
    const wasFullscreen = fullscreen.value;
    fullscreen.value = Boolean((target() && document.fullscreenElement === target()) || video()?.webkitDisplayingFullscreen);
    if (!fullscreen.value) { unlock(); if (wasFullscreen) notice.value = ''; }
  };
  async function exitFullscreen() {
    try {
      if (target() && document.fullscreenElement === target()) await document.exitFullscreen();
      else if (video()?.webkitDisplayingFullscreen) video()?.webkitExitFullscreen?.();
      sync();
    } catch { notice.value = '退出全屏失败，请使用系统的退出全屏按钮'; }
  }
  async function toggleFullscreen() {
    if (pending.value) return;
    notice.value = '';
    if (fullscreen.value) { await exitFullscreen(); return; }
    const element = target();
    const media = video();
    pending.value = true;
    try {
      if (document.fullscreenEnabled && element?.requestFullscreen) {
        await element.requestFullscreen();
        sync();
        if (!isOpen()) { await exitFullscreen(); return; }
        const screen = orientation();
        if (mobile && window.innerHeight > window.innerWidth && screen?.lock) {
          try { await screen.lock('landscape'); orientationLocked = true; }
          catch { notice.value = '已进入全屏，浏览器未允许自动横屏，请旋转手机横向观看'; }
          if (!isOpen() || !fullscreen.value) unlock();
        }
      } else if (media?.webkitEnterFullscreen && media.webkitSupportsFullscreen !== false) {
        media.webkitEnterFullscreen();
        sync();
      } else {
        notice.value = '当前浏览器不支持系统全屏' + (mobile ? '，请旋转手机横向观看' : '');
      }
    } catch {
      notice.value = '浏览器未允许进入全屏，请检查浏览器的全屏权限后重试';
    } finally { pending.value = false; }
  }
  watch(video, (current, previous) => {
    previous?.removeEventListener('webkitbeginfullscreen', sync);
    previous?.removeEventListener('webkitendfullscreen', sync);
    current?.addEventListener('webkitbeginfullscreen', sync);
    current?.addEventListener('webkitendfullscreen', sync);
    sync();
  }, { immediate: true });
  watch(isOpen, open => { if (!open) { notice.value = ''; void exitFullscreen(); } });
  onMounted(() => document.addEventListener('fullscreenchange', sync));
  onBeforeUnmount(() => {
    void exitFullscreen();
    unlock();
    document.removeEventListener('fullscreenchange', sync);
    video()?.removeEventListener('webkitbeginfullscreen', sync);
    video()?.removeEventListener('webkitendfullscreen', sync);
  });
  return { fullscreen, nativeVideoFullscreen, notice, toggleFullscreen, exitFullscreen };
}
