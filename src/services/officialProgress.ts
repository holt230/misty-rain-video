import type { ResourceItem, SearchCategory } from '../types/search';
import type { OfficialProgress, OfficialWorkProgress } from '../types/search';
import { authFetch } from './authService';
import { apiUrl } from './appUrl';
import { searchTitleKey } from '../../server/searchTitles.js';
import { matchesResourceTitle } from './resourceTitles';

export async function readOfficialProgress(title: string, category: SearchCategory, signal: AbortSignal): Promise<OfficialProgress> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(cancel, 4000);
  try {
    const result = await Promise.race([
      (async () => {
        const response = await authFetch(`${apiUrl('/api/official-progress')}?${new URLSearchParams({ kw: title, category })}`, { signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        return response.ok && body.code === 0 && Array.isArray(body.data?.works) ? body.data as OfficialProgress : undefined;
      })(),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new Error('cancelled'));
        else controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      })
    ]);
    if (result) return result;
  } catch { /* Official availability must not hide verified resource results. */ }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  return { status: 'unavailable', works: [], checkedAt: '', message: '官方进度暂未确认。' };
}

export function chooseOfficialProgress(data: OfficialProgress, title: string, category: SearchCategory, resources: ResourceItem[], year?: string): OfficialWorkProgress | undefined {
  const resourceCategories = new Set(resources.map(item => item.category).filter(Boolean));
  const kind = category === 'all' && resourceCategories.size === 1 ? [...resourceCategories][0] : category;
  const works = data.works.filter(work => (kind === 'all' || kind === work.category) && (!year || work.year === year));
  const structured = works.filter(work => resources.some(resource => resource.workTitle && searchTitleKey(resource.workTitle) === searchTitleKey(work.title)
    && (!resource.year || resource.year === work.year) && (!resource.category || resource.category === work.category)));
  if (structured.length === 1) return structured[0];
  if (structured.length > 1) return undefined;
  if (resources.some(resource => resource.workTitle)) return undefined;
  const named = works.filter(work => resources.some(resource => matchesResourceTitle(work.title, resource.title)));
  if (named.length === 1) return named[0];
  const exact = works.filter(work => searchTitleKey(work.title) === searchTitleKey(title));
  if (exact.length === 1 && (kind !== 'all' || works.length === 1)) return exact[0];
  return works.length === 1 ? works[0] : undefined;
}
