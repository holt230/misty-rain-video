import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { authFetch } from '../services/authService';
import { apiUrl, withAppBase } from '../services/appUrl';
import type { CatalogMetadataState } from '../types/catalog';

/** Cancel both requests and stale-cache followups when the selected subject changes. */
export function useCatalogDetails<T extends CatalogMetadataState>(url: () => string, normalize: (value: T) => T) {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref('');
  let generation = 0;
  let controller: AbortController | undefined;
  let followup: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { controller?.abort(); clearTimeout(followup); };
  const read = async (current: number, path: string, attempt = 0) => {
    if (current !== generation || !path) return;
    controller = new AbortController();
    const request = controller;
    const timeout = setTimeout(() => request.abort(), 20_000);
    try {
      const response = await authFetch(apiUrl(path), { signal: request.signal });
      const body = await response.json();
      if (!response.ok || body.code !== 0 || !body.data) throw new Error('资料暂时无法加载，可以稍后重试');
      if (current !== generation) return;
      data.value = normalize(body.data);
      error.value = '';
      if (body.data.refreshing && attempt < 5) followup = setTimeout(() => { void read(current, path, attempt + 1); }, 2000);
    } catch {
      if (current === generation) error.value = '资料暂时无法加载，可以稍后重试';
    } finally { clearTimeout(timeout); if (current === generation) loading.value = false; }
  };
  const refresh = () => {
    const current = ++generation; cancel();
    loading.value = Boolean(url()); error.value = '';
    return read(current, url());
  };
  watch(url, () => { data.value = null; void refresh(); }, { immediate: true });
  onBeforeUnmount(() => { generation++; cancel(); });
  return { data, loading, error, refresh };
}

export const catalogAvatar = <T extends { avatar: string }>(person: T): T => ({ ...person, avatar: withAppBase(person.avatar) });
