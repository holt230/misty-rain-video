import { computed, onBeforeUnmount, onMounted, readonly, ref, watch, type Ref } from 'vue';
import { dialogOpenCount } from './useDialog';

interface AutoCarouselOptions {
  element: Ref<HTMLElement | null>;
  count: () => number;
  active: () => boolean;
  onAdvance: () => void;
  intervalMs?: number;
  pauseOnHover?: boolean;
}

/** One timer for supplied slides. Temporary interruptions never erase a user's pause. */
export function useAutoCarousel(options: AutoCarouselOptions) {
  const intervalMs = Number.isFinite(options.intervalMs) && (options.intervalMs || 0) > 0 ? options.intervalMs! : 7000;
  const mounted = ref(false), inView = ref(false), foreground = ref(true), hovered = ref(false), pointerHeld = ref(false);
  const reducedMotion = ref(false), focusPaused = ref(false);
  const preference = ref<'default' | 'play' | 'pause'>('default');
  const cycle = ref(0);
  const canRotate = computed(() => options.count() > 1);
  const paused = computed(() => preference.value === 'pause' || focusPaused.value || (preference.value === 'default' && reducedMotion.value));
  const running = computed(() => mounted.value && canRotate.value && options.active() && inView.value && foreground.value
    && dialogOpenCount.value === 0 && !paused.value && !hovered.value && !pointerHeld.value);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;
  let observedElement: HTMLElement | null = null;
  let motionQuery: MediaQueryList | undefined;
  const pointers = new Set<number>();
  let pointerOrigin: Node | null = null;
  let pointerStartedAt = -Infinity;

  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const restart = () => {
    clearTimer();
    if (!running.value) return;
    cycle.value++;
    timer = setTimeout(() => {
      timer = undefined;
      if (!running.value) return;
      options.onAdvance();
      restart();
    }, intervalMs);
  };
  const toggle = () => {
    if (paused.value) { preference.value = 'play'; focusPaused.value = false; }
    else preference.value = 'pause';
  };
  const onPointerEnter = (event: PointerEvent) => {
    if (options.pauseOnHover !== false && event.pointerType !== 'touch') hovered.value = true;
  };
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') hovered.value = false;
  };
  const onPointerDown = (event: PointerEvent) => {
    pointers.add(event.pointerId); pointerHeld.value = true;
    pointerOrigin = event.target instanceof Node ? event.target : options.element.value;
    pointerStartedAt = Date.now();
  };
  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId); pointerHeld.value = pointers.size > 0;
  };
  const onPointerCancel = (event: PointerEvent) => {
    onPointerUp(event);
    if (!pointers.size) { pointerOrigin = null; pointerStartedAt = -Infinity; }
  };
  const onFocusIn = (event: FocusEvent) => {
    const node = options.element.value, target = event.target;
    if (!node || !(target instanceof Node) || !node.contains(target)) return;
    // A tap can focus its button on pointerup/click. Do not turn a first Pause
    // click into Resume because its own pointer focus arrived before click.
    const fromPointer = pointerOrigin && (pointerOrigin.contains(target) || target.contains(pointerOrigin))
      && (pointerHeld.value || Date.now() - pointerStartedAt < 500);
    if (!fromPointer) focusPaused.value = true;
  };
  const onKeydown = () => { pointerOrigin = null; pointerStartedAt = -Infinity; };
  const resetPointers = () => {
    pointers.clear(); pointerHeld.value = false; pointerOrigin = null; pointerStartedAt = -Infinity;
  };
  const refreshHover = () => {
    hovered.value = options.pauseOnHover !== false && Boolean(options.element.value?.matches(':hover') && window.matchMedia?.('(hover: hover)').matches);
  };
  const onVisibilityChange = () => {
    foreground.value = document.visibilityState !== 'hidden';
    if (!foreground.value) { resetPointers(); hovered.value = false; }
    else refreshHover();
  };
  const onMotionChange = () => { reducedMotion.value = Boolean(motionQuery?.matches); };
  const observeElement = () => {
    if (!mounted.value || observedElement === options.element.value) return;
    observer?.disconnect(); observer = undefined;
    observedElement = options.element.value;
    inView.value = false; hovered.value = false; resetPointers();
    if (!observedElement) return;
    refreshHover();
    if (typeof IntersectionObserver === 'undefined') { inView.value = true; return; }
    const current = new IntersectionObserver(entries => {
      if (observer !== current) return;
      const entry = entries.find(item => item.target === observedElement);
      if (entry) inView.value = entry.isIntersecting && entry.intersectionRatio > 0;
    }, { threshold: 0.01 });
    observer = current; current.observe(observedElement);
  };

  watch(running, restart, { flush: 'sync' });
  watch(() => options.count(), restart);
  watch(options.active, active => {
    if (!active) { resetPointers(); hovered.value = false; }
    else refreshHover();
  }, { flush: 'sync' });
  watch(options.element, observeElement, { flush: 'post' });
  onMounted(() => {
    foreground.value = document.visibilityState !== 'hidden';
    motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    onMotionChange(); motionQuery?.addEventListener('change', onMotionChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    mounted.value = true; observeElement();
  });
  onBeforeUnmount(() => {
    mounted.value = false; clearTimer(); observer?.disconnect(); observer = undefined;
    motionQuery?.removeEventListener('change', onMotionChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    pointers.clear();
  });

  return { running, paused, canRotate, cycleId: readonly(cycle), intervalMs, toggle, restart,
    onPointerEnter, onPointerLeave, onFocusIn, onPointerDown, onPointerUp, onPointerCancel };
}
