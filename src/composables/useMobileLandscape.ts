import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { playerViewport } from '../services/playerViewport';

/** Follow the device's real orientation without rotating the document. */
export function useMobileLandscape(mobile: boolean, isOpen: () => boolean, isFullscreen: () => boolean = () => false) {
  const explicit = ref(false);
  const dismissed = ref(false);
  const width = ref(window.innerWidth);
  const height = ref(window.innerHeight);
  const top = ref(0);
  const left = ref(0);
  const insets = ref({ top: 0, right: 0, bottom: 0, left: 0 });
  const settling = new Set<ReturnType<typeof setTimeout>>();
  const landscape = computed(() => mobile && width.value > height.value && height.value <= 600);
  const immersive = computed(() => isOpen() && (isFullscreen() || explicit.value || (landscape.value && !dismissed.value)));
  const immersiveStyle = computed(() => ({
    '--player-width': `${width.value}px`, '--player-height': `${height.value}px`,
    '--player-top': `${top.value}px`, '--player-left': `${left.value}px`,
    '--player-inset-top': `${insets.value.top}px`, '--player-inset-right': `${insets.value.right}px`,
    '--player-inset-bottom': `${insets.value.bottom}px`, '--player-inset-left': `${insets.value.left}px`
  }));
  function sync() {
    const root = document.documentElement;
    const css = window.getComputedStyle(root);
    const safe = (edge: string) => parseFloat(css.getPropertyValue('--safe-area-' + edge)) || 0;
    const visual = window.visualViewport;
    const viewport = playerViewport({ width: window.innerWidth, height: window.innerHeight,
      visualWidth: visual?.width, visualHeight: visual?.height, offsetTop: visual?.offsetTop, offsetLeft: visual?.offsetLeft,
      safeArea: { top: safe('top'), right: safe('right'), bottom: safe('bottom'), left: safe('left') } });
    width.value = viewport.width; height.value = viewport.height; insets.value = viewport.insets;
    top.value = viewport.top; left.value = viewport.left;
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
    if (immersive.value) { explicit.value = false; dismissed.value = landscape.value; }
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
    window.visualViewport?.addEventListener('scroll', sync, { passive: true });
  });
  onBeforeUnmount(() => {
    settling.forEach(clearTimeout); settling.clear();
    window.removeEventListener('resize', sync);
    window.removeEventListener('orientationchange', settle);
    window.removeEventListener('pageshow', settle);
    window.visualViewport?.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('scroll', sync);
  });
  return { immersive, immersiveStyle, toggleWebFullscreen, resetLandscape };
}
