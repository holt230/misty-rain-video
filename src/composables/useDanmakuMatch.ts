import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue';
import { DanmakuService, DanmakuRequestError, type DanmakuInput, type DanmakuSource, type DanmakuWork, type DanmakuOptions, type DanmakuSelection, type DanmakuBinding } from '../services/danmakuService';

/** Browsing is a draft. Only a successful selection replaces the active source. */
export function useDanmakuMatch(input: () => DanmakuInput, enabled: Ref<boolean>) {
  const source = shallowRef<DanmakuSource | null>(null);
  const binding = shallowRef<DanmakuBinding | null>(null);
  const retryable = ref(false);
  const candidates = ref<DanmakuWork[]>([]), options = ref<DanmakuOptions | null>(null);
  const page = ref<'settings' | 'search' | 'episodes'>('settings');
  const phase = ref<'idle' | 'auto' | 'search' | 'select' | 'episodes'>('idle');
  const issue = ref(''), query = ref(''), pendingWork = ref('');
  const busy = computed(() => phase.value !== 'idle');
  let controller = new AbortController(), generation = 0;
  let retryAction: (() => Promise<void>) | undefined;
  const cancel = () => { generation++; controller.abort(); controller = new AbortController(); phase.value = 'idle'; };
  const commit = (selected: DanmakuSource) => {
    if (options.value?.workId !== selected.workId) options.value = null;
    pendingWork.value = selected.workId || '';
    source.value = selected; page.value = 'settings'; issue.value = ''; enabled.value = true;
  };
  const run = async (kind: typeof phase.value, action: (signal: AbortSignal) => Promise<void>, repeat: () => Promise<void>) => {
    cancel(); const seq = generation; const signal = controller.signal;
    phase.value = kind; issue.value = ''; retryable.value = false; retryAction = repeat;
    try { await action(signal); }
    catch (error) {
      if (seq !== generation) return;
      retryable.value = !(error instanceof DanmakuRequestError && error.code === 'DANMAKU_EPISODE_NOT_FOUND');
      issue.value = error instanceof DanmakuRequestError && error.code === 'DANMAKU_EPISODE_NOT_FOUND' ? '这个来源暂无对应集数，可选择其他来源或粘贴本集链接'
        : error instanceof Error ? error.message : '暂时无法读取弹幕，请重试';
    } finally { if (seq === generation) phase.value = 'idle'; }
  };
  const valid = (signal: AbortSignal) => !signal.aborted;
  async function automatic() {
    if (source.value || busy.value) return;
    await run('auto', async signal => {
      const result = await DanmakuService.match(input(), signal);
      if (!valid(signal)) return;
      candidates.value = result.candidates;
      binding.value = result.binding || null;
      pendingWork.value = result.binding?.workId || '';
      retryable.value = result.status === 'unavailable';
      if (result.selected) commit(result.selected);
      else issue.value = result.message || (result.candidates.length ? '确认作品和当前集，后续自动沿用' : '暂未找到弹幕，可搜索片名或粘贴本集链接');
    }, automatic);
  }
  async function select(selection: DanmakuSelection) {
    if (phase.value === 'select') return;
    const seq = generation + 1;
    await run('select', async signal => {
      const selected = await DanmakuService.select(input(), selection, signal);
      if (valid(signal)) {
        if(selected.seriesLinked) binding.value={workId:selected.workId,title:selected.title,year:selected.year,platform:selected.platform,offset:(selected.episodeNumber ?? input().episodeNumber)-input().episodeNumber};
        commit(selected);
      }
    }, () => select(selection));
    // Keep the chosen work available for a direct episode correction after a
    // missing-episode response, without falling back to an unrelated title.
    if (seq === generation && selection.workId) pendingWork.value = selection.workId;
  }
  async function search(value = query.value, scope: 'season' | 'episode' = 'season') {
    const text = value.trim(); if (!text) return;
    const links = text.match(/https?:\/\/[^\s<>"“”]+/gi);
    if (links?.length === 1) { await select({ url: links[0]!.replace(/[，。；）)]+$/, ''), scope }); return; }
    await run('search', async signal => {
      const result = await DanmakuService.match(input(), signal, text);
      if (!valid(signal)) return;
      candidates.value = result.candidates;
      issue.value = result.candidates.length ? '' : '没有找到，试试更短的片名或本集链接';
    }, () => search(text, scope));
  }
  function openSearch() {
    if (phase.value === 'auto') cancel();
    page.value = 'search';
    if (!query.value) query.value = input().title;
    if (!candidates.value.length && !busy.value) void search();
  }
  async function openEpisodes(workId = source.value?.workId || binding.value?.workId || pendingWork.value) {
    if (!workId) { openSearch(); return; }
    page.value = 'episodes'; pendingWork.value = workId;
    if (options.value?.workId === workId && !options.value.partial) { issue.value = ''; return; }
    options.value = null;
    await run('episodes', async signal => {
      const result = await DanmakuService.options(input(), workId, signal);
      if (valid(signal)) options.value = result;
    }, () => openEpisodes(workId));
  }
  const back = () => { if (phase.value === 'search' || phase.value === 'episodes') cancel(); page.value = 'settings'; issue.value = ''; };
  const retry = () => { if (!busy.value) void (retryAction || automatic)(); };
  watch(enabled, value => {
    if (value && !source.value) void automatic();
    else if (!value) cancel();
  });
  watch(() => `${input().associationKey || input().mediaKey}:${input().seasonNumber || ''}:${input().episodeNumber}:${input().episodePart || ''}:${input().episodeTitle}`, () => {
    cancel(); source.value = null; binding.value = null; candidates.value = []; options.value = null; pendingWork.value = '';
    query.value = ''; page.value = 'settings'; issue.value = ''; retryAction = undefined;
    if (enabled.value) void automatic();
  }, { immediate: true });
  onBeforeUnmount(cancel);
  return { source, binding, retryable, candidates, options, page, phase, busy, issue, query, pendingWork, automatic, select, search, openSearch, openEpisodes, back, retry };
}
