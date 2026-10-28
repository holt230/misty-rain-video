import { readonly, ref } from 'vue';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const installed = ref(false);
let prompt: InstallPrompt | null = null;
let initialized = false;
export const androidInstalled = readonly(installed);

/** Listen at app startup: Chrome may offer installation before Settings is opened. */
export function initializeAndroidInstall() {
  if (initialized || !/Android/i.test(navigator.userAgent)) return;
  initialized = true;
  const standalone = window.matchMedia('(display-mode: standalone)');
  installed.value = standalone.matches;
  standalone.addEventListener('change', event => { installed.value = event.matches; });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event as InstallPrompt; });
  window.addEventListener('appinstalled', () => { installed.value = true; prompt = null; });
}

export async function installAndroidApp(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const current = prompt;
  prompt = null;
  if (!current) return 'unavailable';
  try { await current.prompt(); return (await current.userChoice).outcome; }
  catch { return 'unavailable'; }
}
