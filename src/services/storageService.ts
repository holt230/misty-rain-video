import type { AppSettings } from '../types/search';

export const CONFIG = {
  DEFAULT_BASE_URL: 'https://so.252035.xyz/api/search',
  DEFAULT_CORS_PROXY: 'https://corsproxy.io/?url=',
  STORAGE_KEY_SETTINGS: 'misty_rain_vue_settings',
  SEARCH_THROTTLE_MS: 300,
  REQUEST_TIMEOUT_MS: 8000
};

export class StorageService {
  static getSettings(): AppSettings {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY_SETTINGS);
      return raw ? JSON.parse(raw) : {
        baseUrl: CONFIG.DEFAULT_BASE_URL,
        authToken: '',
        corsProxy: CONFIG.DEFAULT_CORS_PROXY
      };
    } catch {
      return {
        baseUrl: CONFIG.DEFAULT_BASE_URL,
        authToken: '',
        corsProxy: CONFIG.DEFAULT_CORS_PROXY
      };
    }
  }

  static saveSettings(settings: AppSettings): void {
    localStorage.setItem(CONFIG.STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  }
}
