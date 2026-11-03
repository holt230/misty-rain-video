<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { MessageCircle, RefreshCw, Star, ThumbsUp } from '@lucide/vue';
import type { CatalogComment, CatalogComments, CatalogItem } from '../../types/catalog';
import { useCatalogDetails } from '../../composables/useCatalogDetails';
const props = defineProps<{ item: CatalogItem }>();
const start = ref(0);
const pages = shallowRef<Record<number, CatalogComments>>({});
watch(() => props.item.catalogId, () => { start.value = 0; pages.value = {}; }, { flush: 'sync' });
const { data, loading, error, refresh } = useCatalogDetails<CatalogComments>(
  () => '/api/catalog/works/' + props.item.catalogId.replace(/^douban:/, '') + '/comments?category=' + props.item.category + '&start=' + start.value,
  value => value
);
watch(data, value => {
  if (value && value.catalogId === props.item.catalogId && value.start === start.value && value.updatedAt) pages.value = { ...pages.value, [value.start]: value };
}, { flush: 'sync' });
const lastPage = computed(() => Object.values(pages.value).sort((a, b) => b.start - a.start)[0]);
const comments = computed(() => {
  const seen = new Set<string>(); const items: CatalogComment[] = [];
  for (const page of Object.values(pages.value).sort((a, b) => a.start - b.start)) {
    for (const item of page.items) if (!seen.has(item.id)) { items.push(item); seen.add(item.id); }
  }
  return items;
});
const loadMore = () => {
  const next = (lastPage.value?.start || 0) + 10;
  if (next === start.value) void refresh(); else start.value = next;
};
const countFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const firstCharacter = (name: string) => Array.from(name)[0] || '影';
</script>
<template>
  <section class="detail-information catalog-comments" aria-labelledby="catalog-comments-title" :aria-busy="loading">
    <header class="comments-heading"><div><h2 id="catalog-comments-title"><MessageCircle />观众短评</h2><p>看看观众怎么说 · 热门短评</p></div><span v-if="lastPage?.total">共 {{ countFormat.format(lastPage.total) }} 条</span></header>
    <p v-if="loading && !comments.length" class="comments-note" role="status">正在加载观众短评…</p>
    <div v-if="error || data?.message" class="comments-feedback" role="status"><span>{{ error || data?.message }}</span><button type="button" class="text-link" :disabled="loading" @click="refresh"><RefreshCw />重新加载短评</button></div>
    <div v-if="comments.length" class="comment-list">
      <article v-for="comment in comments" :key="comment.id" class="comment-item">
        <header class="comment-heading"><span class="comment-avatar" aria-hidden="true">{{ firstCharacter(comment.author) }}</span><div class="comment-author"><strong>{{ comment.author }}</strong><time v-if="comment.createdAt">{{ comment.createdAt.slice(0, 16) }}</time></div><span v-if="comment.rating" class="comment-rating" :aria-label="comment.rating + ' / 5 星'"><Star v-for="star in 5" :key="star" :class="{ filled: star <= comment.rating }" aria-hidden="true" /></span></header>
        <p class="comment-text">{{ comment.text }}</p>
        <span v-if="comment.upvotes" class="comment-votes"><ThumbsUp />{{ countFormat.format(comment.upvotes) }} 人觉得有用</span>
      </article>
    </div>
    <p v-else-if="!loading && !error && !data?.message" class="comments-note">这部作品暂时还没有可展示的短评。</p>
    <button v-if="lastPage?.hasMore" type="button" class="more-films" :disabled="loading" @click="loadMore">{{ loading ? '正在加载更多…' : '加载更多短评' }}</button>
  </section>
</template>
<style scoped>
.catalog-comments { min-width: 0; }
.comments-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.comments-heading h2 { display: flex; align-items: center; gap: 8px; margin: 0; }
.comments-heading h2 svg { width: 19px; height: 19px; }
.comments-heading p, .comments-heading > span { color: var(--text-tertiary); font-size: 11px; line-height: 1.8; margin: 6px 0 0; }
.comments-heading > span { flex-shrink: 0; }
.comment-item { padding: 24px 0; border-bottom: 1px solid var(--divider); }
.comment-item:last-child { border-bottom: 0; padding-bottom: 4px; }
.comment-heading { display: flex; align-items: center; gap: 12px; }
.comment-avatar { display: grid; place-items: center; width: 38px; height: 38px; flex-shrink: 0; border-radius: 50%; background: var(--surface-2); color: var(--text-secondary); font-size: 14px; }
.comment-author { display: grid; gap: 4px; min-width: 0; flex: 1; }
.comment-author strong { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
time { color: var(--text-tertiary); font-size: 11px; }
.comment-rating { display: flex; flex-shrink: 0; gap: 2px; color: var(--text-tertiary); }
.comment-rating svg { width: 13px; height: 13px; }
.comment-rating .filled { color: #d99b4d; fill: currentColor; }
.comment-text { white-space: pre-line; overflow-wrap: anywhere; font-size: 14px; line-height: 1.9; margin: 16px 0 12px; }
.comment-votes { display: inline-flex; align-items: center; gap: 6px; color: var(--text-tertiary); font-size: 11px; }
.comment-votes svg { width: 13px; height: 13px; }
.comments-note, .comments-feedback { color: var(--text-tertiary); font-size: 13px; line-height: 1.8; padding-top: 16px; }
.comments-feedback { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
@media (max-width: 359px) { .comment-rating svg { width: 11px; height: 11px; } .comment-rating { gap: 1px; } .comment-heading { gap: 8px; } }
</style>
