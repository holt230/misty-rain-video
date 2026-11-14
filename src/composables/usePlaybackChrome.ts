import { onBeforeUnmount, watch } from 'vue';
import { acquirePlaybackChrome } from '../services/theme';

export function usePlaybackChrome(active: () => boolean) {
  let release: (() => void) | undefined;
  watch(active, enabled => {
    if (enabled) release ||= acquirePlaybackChrome();
    else { release?.(); release = undefined; }
  }, { immediate: true, flush: 'sync' });
  onBeforeUnmount(() => release?.());
}
