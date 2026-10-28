import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { clipboardDetection } from '../services/clipboardSettings';
import { parseLibraryInput } from '../services/libraryFeedback';
export interface ClipboardShare { url: string; passcode: string }
export type ClipboardNoticeMode = 'ready' | 'reading' | 'manual' | 'empty' | 'detected';

/** Reading stays local. Only an explicit Manage action opens the resource service. */
export function useClipboardShare(enabled: Ref<boolean>) {
  const share = ref<ClipboardShare | null>(null);
  const prompt = ref<Exclude<ClipboardNoticeMode, 'detected'> | null>(null);
  const notice = computed<ClipboardNoticeMode | null>(() => share.value ? 'detected' : prompt.value);
  const seen = new Set<string>();
  let mounted = false, busy = false, checking = false, revision = 0;
  let suppressed = false, failed = false, wasHidden = document.visibilityState === 'hidden';
  let permission: PermissionStatus | undefined;
  const active = () => mounted && enabled.value && clipboardDetection.value && document.visibilityState !== 'hidden';
  const key = (value: ClipboardShare) => `${value.url}\0${value.passcode}`;
  const remember = (value: ClipboardShare) => {
    if (seen.size >= 30) seen.delete(seen.values().next().value!);
    seen.add(key(value));
  };
  const invalidate = () => { revision++; busy = false; checking = false; share.value = null; prompt.value = null; };
  const dismiss = (value = share.value) => { if (value) remember(value); invalidate(); suppressed = true; };
  const offer = (mode: 'ready' | 'manual') => { if (!suppressed && !share.value && !prompt.value) prompt.value = mode; };
  const accept = (text: string, explicit: boolean) => {
    if (!active()) return;
    const parsed = text.length <= 20_000 ? parseLibraryInput(text) : null;
    share.value = null; prompt.value = null; suppressed = true;
    if (parsed?.kind !== 'share') { if (explicit) prompt.value = 'empty'; return; }
    const value = { url: parsed.url, passcode: parsed.passcode };
    if (explicit || !seen.has(key(value))) share.value = value;
  };
  const read = (explicit = true) => {
    if (!active() || busy) return;
    if (!navigator.clipboard?.readText) { prompt.value = 'manual'; return; }
    // Safari/Web Clip can report focus differently. An explicit trusted click is
    // passed straight to the browser, which remains the authority on permission.
    if (!explicit && !document.hasFocus()) return;
    const current = revision;
    busy = true; failed = false;
    if (explicit) prompt.value = 'reading';
    const rejected = () => {
      if (current !== revision || !active()) return;
      failed = true; suppressed = true;
      prompt.value = explicit ? 'manual' : 'ready';
    };
    const finished = () => { if (current === revision) busy = false; };
    // No permission query or await before this call: preserve transient activation.
    try {
      void navigator.clipboard.readText()
        .then(text => { if (current === revision && active()) accept(text, explicit); })
        .catch(rejected).finally(finished);
    } catch { rejected(); finished(); }
  };
  const automatic = async () => {
    if (!active() || busy || checking || failed || share.value || prompt.value) return;
    if (!navigator.clipboard?.readText) { offer('manual'); return; }
    const current = revision; checking = true;
    try {
      const status = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
      if (current !== revision || !active() || busy || share.value || prompt.value) return;
      if (permission !== status) {
        permission?.removeEventListener('change', permissionChanged);
        permission = status; permission.addEventListener('change', permissionChanged);
      }
      if (status.state === 'granted') read(false);
      else offer(status.state === 'denied' ? 'manual' : 'ready');
    } catch {
      // Safari and Firefox do not expose clipboard-read through Permissions API.
      if (current === revision && active() && !busy) offer('ready');
    } finally { if (current === revision) checking = false; }
  };
  function permissionChanged() { invalidate(); failed = false; suppressed = false; void automatic(); }
  const paste = (event: ClipboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input,textarea,[contenteditable=true]')) return;
    if (active()) { invalidate(); accept(event.clipboardData?.getData('text/plain') || '', true); }
  };
  const explicit = () => { read(); };
  const resume = () => { invalidate(); failed = false; suppressed = false; void automatic(); };
  const visible = () => {
    if (document.visibilityState === 'hidden') { wasHidden = true; invalidate(); }
    else if (wasHidden) { wasHidden = false; resume(); }
    else void automatic();
  };
  const pageShown = (event: PageTransitionEvent) => { if (event.persisted) resume(); else void automatic(); };
  watch([enabled, clipboardDetection], (values, previous) => {
    invalidate();
    if (!values[1]) seen.clear();
    if (values[1] && !previous[1]) { failed = false; suppressed = false; }
    if (active()) void automatic();
  }, { flush: 'sync' });
  onMounted(() => {
    mounted = true;
    window.addEventListener('focus', automatic);
    window.addEventListener('pageshow', pageShown);
    document.addEventListener('visibilitychange', visible);
    document.addEventListener('paste', paste);
    window.addEventListener('misty-clipboard-check', explicit);
    void automatic();
  });
  onBeforeUnmount(() => {
    mounted = false; invalidate(); seen.clear();
    permission?.removeEventListener('change', permissionChanged);
    window.removeEventListener('focus', automatic);
    window.removeEventListener('pageshow', pageShown);
    document.removeEventListener('visibilitychange', visible);
    document.removeEventListener('paste', paste);
    window.removeEventListener('misty-clipboard-check', explicit);
  });
  const clear = () => { invalidate(); seen.clear(); failed = false; suppressed = false; };
  return { share, notice, read, dismiss, clear };
}
