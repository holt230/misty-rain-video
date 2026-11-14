import { ref } from 'vue';
export type AppTheme = 'dark' | 'light';
export type ThemePreference = AppTheme | 'system';
const storageKey = 'misty_rain_theme';
const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const readPreference = (): ThemePreference => {
  try { const saved = localStorage.getItem(storageKey); return saved === 'dark' || saved === 'light' ? saved : 'system'; }
  catch { return 'system'; }
};
export const themePreference = ref<ThemePreference>(readPreference());
const resolveTheme = (): AppTheme => themePreference.value === 'system'
  ? mediaQuery?.matches ? 'dark' : 'light' : themePreference.value;
export const currentTheme = ref<AppTheme>(resolveTheme());
const playbackChromeOwners = new Set<symbol>();
const updateBrowserChrome = () => {
  const immersive = playbackChromeOwners.size > 0;
  document.documentElement.classList.toggle('immersive-playback', immersive);
  document.documentElement.style.colorScheme = immersive ? 'dark' : currentTheme.value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', immersive ? '#000000' : currentTheme.value === 'light' ? '#f4f6fa' : '#0b0b0d');
};
/** Keep iOS browser chrome and its safe-area canvas dark until the last player exits. */
export const acquirePlaybackChrome = () => {
  const owner = Symbol('playback');
  playbackChromeOwners.add(owner);
  updateBrowserChrome();
  return () => { playbackChromeOwners.delete(owner); updateBrowserChrome(); };
};
export const applyTheme = (theme: AppTheme) => {
  currentTheme.value = theme;
  document.documentElement.dataset.theme = theme;
  updateBrowserChrome();
};
let initialized = false;
export const initializeTheme = () => {
  applyTheme(resolveTheme());
  if (initialized) return;
  initialized = true;
  mediaQuery?.addEventListener('change', () => {
    if (themePreference.value === 'system') applyTheme(resolveTheme());
  });
};
export const setTheme = (preference: ThemePreference) => {
  themePreference.value = preference;
  applyTheme(resolveTheme());
  try { localStorage.setItem(storageKey, preference); } catch { /* The selected theme still applies in this session. */ }
};
