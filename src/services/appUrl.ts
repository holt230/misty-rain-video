const APP_BASE_URL = import.meta.env.BASE_URL || '/';
// A separately hosted frontend can share the existing same-origin API and its session cookie.
// Restrict this override to deployment paths, never a third-party host receiving credentials.
const configuredApiBase = import.meta.env?.VITE_API_BASE_PATH || '';
const API_BASE_URL = /^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(configuredApiBase) ? configuredApiBase : APP_BASE_URL;

const isExternalUrl = (value: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);

/** 将站内路径映射到页面或同源 API 的部署基路径。 */
export const withAppBase = (value: string): string => {
  const url = String(value || '').trim();
  if (!url || isExternalUrl(url) || url.startsWith('#')) return url;
  if (APP_BASE_URL !== '/' && url.startsWith(APP_BASE_URL)) return url;
  if (API_BASE_URL !== '/' && url.startsWith(API_BASE_URL)) return url;
  const path = url.replace(/^\/+/, '');
  const base = /^api(?:\/|\?|$)/.test(path) ? API_BASE_URL : APP_BASE_URL;
  return `${base}${path}`;
};

export const apiUrl = (path: string): string => withAppBase(path);
