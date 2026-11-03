import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

/** Keep recommendations still while the viewer is reading or operating them. */
export function useFeaturedCarousel(items: () => string[], active: () => boolean, root: Ref<HTMLElement | null>) {
  const index = ref(0);
  const enabled = ref(true);
  const hovered = ref(false);
  const focused = ref(false);
  const touching = ref(false);
  const inView = ref(true);
  const visible = ref(!document.hidden);
  const mounted = ref(false);
  const running = computed(() => mounted.value && enabled.value && active() && items().length > 1 && visible.value && inView.value && !hovered.value && !focused.value && !touching.value);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;
  let motion: MediaQueryList | undefined;
  let startX: number | null = null;
  let startY: number | null = null;
  let startTime = 0;
  const stop = () => { clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    stop();
    if (running.value) timer = setTimeout(() => { index.value = (index.value + 1) % items().length; schedule(); }, 6000);
  };
  const select = (value: number) => {
    if (!items().length) return;
    index.value = (value + items().length) % items().length;
    schedule();
  };
  const updateVisibility = () => { visible.value = !document.hidden; };
  const updateMotion = () => { enabled.value = !motion?.matches; };
  watch(running, schedule, { flush: 'sync' });
  watch(() => items().join('|'), () => { index.value = 0; schedule(); });
  onMounted(() => {
    motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    updateMotion();
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    if (typeof IntersectionObserver !== 'undefined' && root.value) {
      observer = new IntersectionObserver(entries => { inView.value = entries[0]?.isIntersecting ?? false; }, { threshold: 0.1 });
      observer.observe(root.value);
    }
    mounted.value = true;
  });
  onBeforeUnmount(() => {
    stop(); observer?.disconnect();
    motion?.removeEventListener('change', updateMotion);
    document.removeEventListener('visibilitychange', updateVisibility);
  });
  return {
    index, running, select,
    step: (direction: number) => select(index.value + direction),
    enter: (event: PointerEvent) => { if (event.pointerType === 'mouse') hovered.value = true; },
    leave: () => { hovered.value = false; touching.value = false; },
    focus: () => { if (!touching.value) focused.value = true; },
    blur: (event: FocusEvent) => { focused.value = event.relatedTarget instanceof Node && Boolean(root.value?.contains(event.relatedTarget)); },
    press: (event?: PointerEvent) => {
      touching.value = true;
      focused.value = false;
      if (event && typeof event.clientX === 'number') {
        startX = event.clientX;
        startY = event.clientY;
        startTime = Date.now();
      } else {
        startX = null;
        startY = null;
      }
    },
    release: (event?: PointerEvent) => {
      touching.value = false;
      if (startX !== null && startY !== null && event && typeof event.clientX === 'number') {
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const elapsed = Date.now() - startTime;
        if (Math.abs(deltaX) >= 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2 && elapsed < 800) {
          if (deltaX < 0) select(index.value + 1);
          else select(index.value - 1);
        }
      }
      startX = null;
      startY = null;
    }
  };
}
