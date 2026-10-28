import { shallowRef } from 'vue';
import { authFetch } from './authService';
import { apiUrl, withAppBase } from './appUrl';
export interface SiteSettings {
  name: string; revision: string; customIcon: boolean;
  iconUrl: string; faviconUrl: string; touchIconUrl: string;
  defaults: { name: string; iconUrl: string };
}
export interface SiteSettingsInput { revision: string; name: string; icons?: Record<string,string> | null }
const defaults = { name: '烟雨影视', iconUrl: '/brand-mark.png' };
const normalize = (value: SiteSettings): SiteSettings => ({ name:value.name,revision:value.revision,customIcon:value.customIcon,iconUrl: withAppBase(value.iconUrl), faviconUrl: withAppBase(value.faviconUrl), touchIconUrl: withAppBase(value.touchIconUrl), defaults: { name:value.defaults.name,iconUrl: withAppBase(value.defaults.iconUrl) } });
function bootstrap(): SiteSettings | null {
  try { const value = JSON.parse(document.getElementById('site-settings')?.textContent || 'null'); return value?.revision && typeof value.name === 'string' ? normalize(value) : null; } catch { return null; }
}
const initial = bootstrap();
export const siteSettings = shallowRef<SiteSettings>(initial || normalize({ ...defaults, revision: '', customIcon: false, faviconUrl: '/apple-touch-icon.png', touchIconUrl: '/apple-touch-icon.png', defaults }));
let pending: Promise<SiteSettings> | null = null, epoch = 0, lastLoaded = initial ? Date.now() : 0;
function apply(value: SiteSettings) {
  siteSettings.value = normalize(value); lastLoaded = Date.now();
  if (typeof document === 'undefined') return;
  document.title = value.name;
  for (const [selector, attribute, content] of [
    ['meta[name="apple-mobile-web-app-title"]', 'content', value.name],
    ['link[rel="icon"]', 'href', siteSettings.value.faviconUrl], ['link[rel="apple-touch-icon"]', 'href', siteSettings.value.touchIconUrl]
  ]) document.querySelector(selector!)?.setAttribute(attribute!, content!);
}
export function loadSiteSettings(): Promise<SiteSettings> {
  if (pending) return pending;
  const current = epoch;
  const task = (async () => {
    const response = await authFetch(apiUrl('/api/site-settings'), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const json = await response.json();
    if (!response.ok || json.code !== 0 || !json.data?.revision) throw new Error('站点信息暂时无法加载');
    if (current === epoch) apply(json.data);
    return siteSettings.value;
  })().finally(() => { if (pending === task) pending = null; });
  pending = task; return task;
}
export async function saveSiteSettings(input: SiteSettingsInput) {
  const response = await authFetch(apiUrl('/api/site-settings'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
  const json = await response.json();
  if (!response.ok || json.code !== 0 || !json.data?.revision) throw Object.assign(new Error(json.message || '保存失败，请稍后重试'), { statusCode: response.status });
  epoch++; apply(json.data); return siteSettings.value;
}
export function initializeSiteSettings() {
  apply(siteSettings.value);
  const refresh = () => { if (document.visibilityState === 'visible' && Date.now() - lastLoaded > 30000) void loadSiteSettings().catch(() => {}); };
  window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
  if (!initial) void loadSiteSettings().catch(() => {});
}

/** Decode locally and fit within a square; only bounded raster PNG variants leave the browser. */
export async function prepareSiteIcons(file: File): Promise<Record<string,string>> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的 PNG、JPG 或 WebP 图片');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('图片无法读取')); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片尺寸过大，请先缩小图片');
    const result: Record<string,string> = {};
    for (const size of [180,192,512]) {
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法处理图片');
      const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height); result[size] = canvas.toDataURL('image/png');
    }
    return result;
  } finally { URL.revokeObjectURL(url); }
}
