import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { playerViewport } from '../services/playerViewport';

/** Keep video and DOM overlays together, including on portrait-locked phones. */
export function useMobileLandscape(mobile: boolean, isOpen: () => boolean) {
  const explicit = ref(false);
  const dismissed = ref(false);
  const width = ref(window.innerWidth);
  const height = ref(window.innerHeight);
  const insets = ref({ top: 0, right: 0, bottom: 0, left: 0 });
  const settling = new Set<ReturnType<typeof setTimeout>>();
  const landscape = computed(() => mobile && width.value > height.value && height.value <= 500);
  const immersive = computed(() => isOpen() && (explicit.value || (landscape.value && !dismissed.value)));
  const rotated = computed(() => mobile && explicit.value && height.value > width.value);
  const immersiveStyle = computed(() => immersive.value ? {
    '--player-width': `${width.value}px`, '--player-height': `${height.value}px`,
    '--player-inset-top': `${insets.value.top}px`, '--player-inset-right': `${insets.value.right}px`,
    '--player-inset-bottom': `${insets.value.bottom}px`, '--player-inset-left': `${insets.value.left}px`
  } : {});
  function sync() {
    const root = document.documentElement;
    const css = window.getComputedStyle(root);
    const safe = (edge: string) => parseFloat(css.getPropertyValue('--safe-area-' + edge)) || 0;
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const viewport = playerViewport({ width: window.innerWidth, height: window.innerHeight, visualHeight: window.visualViewport?.height,
      screenWidth: window.screen.width, screenHeight: window.screen.height,
      iosStandalone: mobile && ios && root.classList.contains('ios-standalone'),
      safeArea: { top: safe('top'), right: safe('right'), bottom: safe('bottom'), left: safe('left') } });
    width.value = viewport.width; height.value = viewport.height; insets.value = viewport.insets;
    if (!landscape.value) dismissed.value = false;
  }
  function settle() {
    settling.forEach(clearTimeout); settling.clear(); sync();
    for (const delay of [80, 240, 600]) {
      const timer = setTimeout(() => { settling.delete(timer); sync(); }, delay);
      settling.add(timer);
    }
  }
  function toggleWebFullscreen() {
    if (immersive.value) { explicit.value = false; dismissed.value = true; }
    else { sync(); explicit.value = true; }
  }
  function resetLandscape() { explicit.value = false; dismissed.value = false; }
  watch(isOpen, open => { if (!open) resetLandscape(); else settle(); });
  onMounted(() => {
    settle();
    window.addEventListener('resize', sync, { passive: true });
    window.addEventListener('orientationchange', settle, { passive: true });
    window.addEventListener('pageshow', settle);
    window.visualViewport?.addEventListener('resize', sync, { passive: true });
  });
  onBeforeUnmount(() => {
    settling.forEach(clearTimeout); settling.clear();
    window.removeEventListener('resize', sync);
    window.removeEventListener('orientationchange', settle);
    window.removeEventListener('pageshow', settle);
    window.visualViewport?.removeEventListener('resize', sync);
  });
  return { immersive, rotated, immersiveStyle, toggleWebFullscreen, resetLandscape };
}
