const APP_BASE_URL = import.meta.env.BASE_URL || '/';

const isExternalUrl = (value: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);

/** 将站内绝对路径映射到当前应用的部署基路径。 */
export const withAppBase = (value: string): string => {
  const url = String(value || '').trim();
  if (!url || isExternalUrl(url) || url.startsWith('#')) return url;
  if (APP_BASE_URL !== '/' && url.startsWith(APP_BASE_URL)) return url;
  return `${APP_BASE_URL}${url.replace(/^\/+/, '')}`;
};

export const apiUrl = (path: string): string => withAppBase(path);
