import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useDialog } from './useDialog';
import { centerSelectedSubtitleCues } from '../services/subtitleTracks';

export type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

/** Web presentation retains the existing video/overlay DOM; native presentation stays explicit. */
export function useVideoFullscreen(videoRef: Ref<HTMLVideoElement | null>, containerRef?: Ref<HTMLElement | null>, mobile = true, preferWeb = false, screenLocked?: Ref<boolean>) {
  const fullscreen = ref(false);
  const nativeFullscreen = ref(false);
  const webFullscreen = ref(false);
  const webRotation = ref(0);
  const webPortrait = ref(false);
  const webStyle = ref<Record<string,string>>({});
  const canNativeFullscreen = computed(() => {
    const video = videoRef.value as FullscreenVideo | null;
    return Boolean(video?.webkitEnterFullscreen || video?.requestFullscreen);
  });
  const error = ref('');
  let disposed = false;
  let restoreControls = () => {};
  let release = () => {};
  const readOrientation = () => {
    const angle = window.screen.orientation?.angle ?? window.orientation;
    return typeof angle === 'number' && Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0;
  };
  let frameSize: { width:number; height:number; angle:number } | undefined;
  const measureWebViewport = () => {
    const viewport=window.visualViewport;
    const width=viewport?.width || window.innerWidth, height=viewport?.height || window.innerHeight;
    if (!screenLocked?.value || !frameSize) frameSize={width,height,angle:readOrientation()};
    // iOS rotates the viewport independently of our touch lock. Cancel that
    // rotation relative to the angle captured at lock time, including 180° flips.
    webRotation.value=screenLocked?.value ? (frameSize.angle-readOrientation()+360)%360 : 0;
    const sideways=webRotation.value%180!==0;
    const boundsWidth=sideways?frameSize.height:frameSize.width;
    const boundsHeight=sideways?frameSize.width:frameSize.height;
    webPortrait.value=frameSize.height>frameSize.width;
    webStyle.value={
      '--web-width':`${frameSize.width}px`,
      '--web-height':`${frameSize.height}px`,
      '--web-center-x':`${(viewport?.offsetLeft||0)+width/2}px`,
      '--web-center-y':`${(viewport?.offsetTop||0)+height/2}px`,
      '--web-scale':`${Math.min(1,width/boundsWidth,height/boundsHeight)}`,
      '--web-rotation':`${webRotation.value}deg`,
      '--player-safe-left':`var(--safe-area-${['left','top','right','bottom'][webRotation.value/90] || 'left'},0px)`
    };
  };
  watch(webFullscreen,(open,_previous,onCleanup)=>{
    if(!open){frameSize=undefined;webRotation.value=0;webPortrait.value=false;webStyle.value={};return;}
    measureWebViewport();let frame=0;
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(webFullscreen.value&&!disposed)measureWebViewport();});};
    window.addEventListener('resize',schedule);window.addEventListener('orientationchange',schedule);
    const orientation=window.screen.orientation;
    orientation?.addEventListener('change',schedule);
    const viewport=window.visualViewport;
    viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
    onCleanup(()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('orientationchange',schedule);orientation?.removeEventListener('change',schedule);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);});
  },{flush:'sync'});
  watch(()=>screenLocked?.value,()=>{frameSize=undefined;if(webFullscreen.value)measureWebViewport();},{flush:'sync'});
  let previousWidth=window.innerWidth;
  let landscape=window.innerWidth>window.innerHeight;
  let rotationFrame=0;
  const onViewportChange=()=>{
    cancelAnimationFrame(rotationFrame);
    rotationFrame=requestAnimationFrame(()=>{
      const nextLandscape=window.innerWidth>window.innerHeight;
      const rotated=previousWidth!==window.innerWidth && nextLandscape!==landscape;
      previousWidth=window.innerWidth;landscape=nextLandscape;
      // A keyboard resize alone must not trigger fullscreen; OS rotation lock
      // naturally leaves the viewport unchanged.
      if(rotated && landscape && (mobile||preferWeb) && !screenLocked?.value && !fullscreen.value && containerRef?.value && (videoRef.value?.readyState||0)>=1){
        webFullscreen.value=true;fullscreen.value=true;
      }
    });
  };
  window.addEventListener('resize',onViewportChange);
  window.addEventListener('orientationchange',onViewportChange);

  watch(videoRef, video => {
    release();
    fullscreen.value = webFullscreen.value;
    nativeFullscreen.value = false;
    if (!video) return;
    const sync = () => {
      nativeFullscreen.value = document.fullscreenElement === video
        || Boolean((video as FullscreenVideo).webkitDisplayingFullscreen);
      fullscreen.value = webFullscreen.value || nativeFullscreen.value || Boolean(containerRef?.value && document.fullscreenElement === containerRef.value);
      if (!fullscreen.value) restoreControls();
    };
    const begin = () => { centerSelectedSubtitleCues(video,true);fullscreen.value = true; nativeFullscreen.value = true; };
    const end = () => { fullscreen.value = webFullscreen.value; nativeFullscreen.value = false; restoreControls(); };
    document.addEventListener('fullscreenchange', sync);
    video.addEventListener('webkitbeginfullscreen', begin);
    video.addEventListener('webkitendfullscreen', end);
    release = () => {
      document.removeEventListener('fullscreenchange', sync);
      video.removeEventListener('webkitbeginfullscreen', begin);
      video.removeEventListener('webkitendfullscreen', end);
      restoreControls();
    };
    sync();
  }, { flush: 'sync', immediate: true });

  async function exit() {
    webFullscreen.value = false;
    const video = videoRef.value as FullscreenVideo | null;
    if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen?.();
    else if (document.fullscreenElement && (document.fullscreenElement === video || document.fullscreenElement === containerRef?.value)) await document.exitFullscreen();
    fullscreen.value = nativeFullscreen.value;
  }

  async function enterNative() {
    error.value = '';
    const video = videoRef.value as FullscreenVideo | null;
    if (!video || disposed || nativeFullscreen.value) return;
    if (video.readyState < 1) { error.value = '视频尚未加载，请稍后再进入全屏'; return; }
    const previous = video.controls;
    const hadWebCaptions = video.classList.contains('player-captions-active');
    restoreControls();
    restoreControls = () => { video.controls = previous; restoreControls = () => {}; };
    video.controls = true;
    // Native presentation owns cue rendering. Remove the CSS suppression before
    // requesting it, without changing TextTrack modes or awaiting user activation.
    centerSelectedSubtitleCues(video,true);
    video.classList.remove('player-captions-active');
    try {
      if (typeof video.webkitEnterFullscreen === 'function') video.webkitEnterFullscreen();
      else if (typeof video.requestFullscreen === 'function') await video.requestFullscreen({ navigationUI: 'hide' });
      else { error.value = '当前浏览器不支持系统全屏'; restoreControls(); }
    } catch { restoreControls(); error.value = '无法进入视频全屏，请稍后重试'; }
    if (error.value && hadWebCaptions) video.classList.add('player-captions-active');
  }

  async function toggle() {
    error.value = '';
    const video = videoRef.value as FullscreenVideo | null;
    if (!video) return;
    try {
      if (fullscreen.value || document.fullscreenElement === video || video.webkitDisplayingFullscreen) {
        await exit();
        return;
      }
      if (video.readyState < 1) {
        error.value = '视频尚未加载，请稍后再进入全屏';
        return;
      }
      const container = containerRef?.value;
      if (preferWeb && container) {
        webFullscreen.value = true; fullscreen.value = true;
        return;
      }
      if (container?.requestFullscreen) {
        await container.requestFullscreen({ navigationUI: 'hide' });
        return;
      }
      await enterNative();
    } catch {
      restoreControls();
      error.value = '无法进入视频全屏，请稍后重试';
    }
  }

  // Reuse the same lock/focus stack as settings and episode panels; no media node
  // is moved or remounted, and closing a nested panel cannot unlock the page.
  if ((mobile||preferWeb) && containerRef) useDialog(containerRef, () => webFullscreen.value, () => { void exit(); });

  onBeforeUnmount(() => { disposed = true; cancelAnimationFrame(rotationFrame);window.removeEventListener('resize',onViewportChange);window.removeEventListener('orientationchange',onViewportChange);release(); void exit().catch(() => {}); });
  return { fullscreen, nativeFullscreen, webFullscreen, webRotation, webPortrait, webStyle, canNativeFullscreen, error, toggle, exit, enterNative };
}
