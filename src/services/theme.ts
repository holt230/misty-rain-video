import { ref } from 'vue';
export type AppTheme = 'dark' | 'light';
export type ThemePreference = AppTheme | 'system';
const storageKey = 'misty_rain_theme';
const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const readPreference = (): ThemePreference => {
  try { const saved = localStorage.getItem(storageKey); return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'dark'; }
  catch { return 'dark'; }
};
export const themePreference = ref<ThemePreference>(readPreference());
const resolveTheme = (): AppTheme => themePreference.value === 'system'
  ? mediaQuery?.matches ? 'dark' : 'light' : themePreference.value;
export const currentTheme = ref<AppTheme>(resolveTheme());
export const applyTheme = (theme: AppTheme) => {
  currentTheme.value = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#fcfcfc' : '#08090b');
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
