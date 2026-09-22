import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/** Keep video and DOM overlays together, including on portrait-locked phones. */
export function useMobileLandscape(mobile: boolean, isOpen: () => boolean) {
  const explicit = ref(false);
  const dismissed = ref(false);
  const width = ref(window.innerWidth);
  const height = ref(window.innerHeight);
  const landscape = computed(() => mobile && width.value > height.value && height.value <= 500);
  const immersive = computed(() => explicit.value || (landscape.value && !dismissed.value));
  const rotated = computed(() => explicit.value && height.value > width.value);
  const immersiveStyle = computed(() => immersive.value ? {
    '--player-width': `${width.value}px`, '--player-height': `${height.value}px`
  } : {});
  function sync() {
    width.value = window.visualViewport?.width || window.innerWidth;
    height.value = window.visualViewport?.height || window.innerHeight;
    if (!landscape.value) dismissed.value = false;
  }
  function toggleWebFullscreen() {
    if (immersive.value) { explicit.value = false; dismissed.value = true; }
    else { sync(); explicit.value = true; }
  }
  function resetLandscape() { explicit.value = false; dismissed.value = false; }
  watch(isOpen, open => { if (!open) resetLandscape(); else sync(); });
  onMounted(() => {
    sync();
    window.addEventListener('resize', sync, { passive: true });
    window.addEventListener('orientationchange', sync, { passive: true });
    window.visualViewport?.addEventListener('resize', sync, { passive: true });
  });
  onBeforeUnmount(() => {
    window.removeEventListener('resize', sync);
    window.removeEventListener('orientationchange', sync);
    window.visualViewport?.removeEventListener('resize', sync);
  });
  return { immersive, rotated, immersiveStyle, toggleWebFullscreen, resetLandscape };
}
