<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowLeft, ChevronDown, Search, Star, Play } from '@lucide/vue';
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import ScrollLoad from '../common/ScrollLoad.vue';
import MediaPoster from '../common/MediaPoster.vue';
import { loadCatalogDetails, loadCatalogContent, type CatalogDetails, type CatalogPhoto, type CatalogComment } from '../../services/catalogDetails';
import FilmPhotoViewer from './FilmPhotoViewer.vue';
import MediaRail from './MediaRail.vue';
import { withAppBase } from '../../services/appUrl';
import type { DiscoveryItem } from '../../services/discoveryService';
const props = defineProps<{ id: string; seed?: DiscoveryItem | null; collected?: boolean }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'search', item: DiscoveryItem): void; (e: 'play-collection'): void }>();
const detail = ref<CatalogDetails | null>(null), loading = ref(false), failure = ref(''), expanded = ref(true);
const missingPortraits = ref(new Set<string>());
const loadedImages=ref(new Set<string>());
const photos = ref<CatalogPhoto[]>([]), comments = ref<CatalogComment[]>([]);
const photoNext = ref<number | null>(0), commentNext = ref<number | null>(0);
const photoTotal = ref(0), commentTotal = ref(0), photoLoading = ref(false), commentLoading = ref(false);
const photoError = ref(''), commentError = ref(''), photoStale = ref(false), commentStale = ref(false);
const commentExpanded = ref(true), photoIndex = ref(-1);
const contentControllers = new Map<string, AbortController>();
let viewerHistoryKey = '', viewerStartIndex = 0;
function closePhoto() {
  if (viewerHistoryKey && window.history.state?.mistyRainPhoto === viewerHistoryKey) window.history.back();
  else photoIndex.value = -1;
}
function openPhoto(index: number) {
  photoIndex.value = index; viewerStartIndex = index;
  viewerHistoryKey = `${props.id}:${Date.now()}`;
  window.history.pushState({ ...window.history.state, mistyRainPhoto: viewerHistoryKey }, '');
}
function photoPop(event: PopStateEvent) {
  if (photoIndex.value >= 0) photoIndex.value = -1;
  else if (event.state?.mistyRainPhoto === viewerHistoryKey) photoIndex.value = Math.min(viewerStartIndex, photos.value.length - 1);
}
window.addEventListener('popstate', photoPop);
async function more(section: 'photos' | 'comments', advance = false) {
  const next = section === 'photos' ? photoNext : commentNext;
  const busy = section === 'photos' ? photoLoading : commentLoading;
  const message = section === 'photos' ? photoError : commentError;
  if (busy.value || next.value === null) return;
  const id = props.id, start = next.value, previousLength = photos.value.length, requestedIndex = photoIndex.value;
  const controller = new AbortController(); contentControllers.get(section)?.abort(); contentControllers.set(section, controller);
  busy.value = true; message.value = '';
  try {
    if (section === 'photos') {
      const page = await loadCatalogContent<CatalogPhoto>(id, section, start, controller.signal);
      if (id !== props.id || controller.signal.aborted) return;
      const merged = new Map(photos.value.map(item => [item.id, item])); page.items.forEach(item => merged.set(item.id, item));
      photos.value = [...merged.values()]; photoTotal.value = page.total; photoStale.value = page.stale;
      next.value = (start > 0 && photos.value.length === previousLength) || page.nextStart === start ? null : page.nextStart;
      if (advance && requestedIndex >= 0 && photoIndex.value === requestedIndex && photos.value.length > previousLength) photoIndex.value++;
    } else {
      const page = await loadCatalogContent<CatalogComment>(id, section, start, controller.signal);
      if (id !== props.id || controller.signal.aborted) return;
      const previous = comments.value.length, merged = new Map(comments.value.map(item => [item.id, item]));
      page.items.forEach(item => merged.set(item.id, item)); comments.value = [...merged.values()]; commentTotal.value = page.total; commentStale.value = page.stale;
      next.value = (start > 0 && comments.value.length === previous) || page.nextStart === start ? null : page.nextStart;
    }
  } catch (error) { if (!controller.signal.aborted && id === props.id) message.value = error instanceof Error ? error.message : '加载失败'; }
  finally { if (contentControllers.get(section) === controller) { busy.value = false; contentControllers.delete(section); } }
}
function expandComments() { commentExpanded.value = !commentExpanded.value; if (commentExpanded.value && commentNext.value === 0) void more('comments'); }

const item = computed(() => detail.value || (props.seed?.id === props.id ? props.seed : null));
const provider = computed(() => props.id.startsWith('bangumi-') ? 'Bangumi' : '豆瓣');
const sourceUrl = computed(() => props.id.startsWith('bangumi-') ? `https://bgm.tv/subject/${props.id.slice(8)}` : `https://movie.douban.com/subject/${props.id.slice(7)}/`);
const categories = { tv: '电视剧', movie: '电影', anime: '动漫', variety: '综艺' };
const meta = computed(() => item.value ? [item.value.year, ...(item.value.countries || []), categories[item.value.category]].filter(Boolean).join(' · ') : '');
const facts = computed(() => detail.value ? [
  ['导演', detail.value.directors.join(' / ')], ['编剧', (detail.value.writers || []).join(' / ')], ['类型', detail.value.genres?.join(' / ')],
  ['语言', detail.value.languages.join(' / ')], ['上映', detail.value.premieres.join(' / ')],
  ['片长', detail.value.durations.join(' / ')], ['集数', detail.value.episodeCount ? `${detail.value.episodeCount} 集` : ''],
  ['别名', detail.value.aliases.join(' / ')], ['IMDb', detail.value.imdb || '']
].filter(([, value]) => value) : []);
const creditLimit=ref(24);
const credits = computed(() => detail.value?.credits.slice(0,creditLimit.value));
let controller: AbortController | undefined, sequence = 0;
async function load() {
  controller?.abort(); const seq = ++sequence; controller = new AbortController();
  loading.value = true; failure.value = '';
  try { const result = await loadCatalogDetails(props.id, controller.signal); if (seq === sequence) { detail.value = result; if (!photos.value.length) photos.value = result.photos; if (!comments.value.length) comments.value = result.comments; photoTotal.value = result.photoCount; commentTotal.value = result.commentCount; } }
  catch (error) { if (seq === sequence) failure.value = error instanceof Error ? error.message : '详情暂时无法加载'; }
  finally { if (seq === sequence) loading.value = false; }
}
watch(() => props.id, () => { for (const controller of contentControllers.values()) controller.abort(); contentControllers.clear();
  photos.value = []; comments.value = []; photoNext.value = 0; commentNext.value = 0; photoLoading.value = false; commentLoading.value = false; photoError.value = ''; commentError.value = ''; photoStale.value = false; commentStale.value = false; commentExpanded.value = true; photoIndex.value = -1;
  detail.value = null; creditLimit.value=24; expanded.value = true; missingPortraits.value = new Set();loadedImages.value=new Set(); void load(); }, { immediate: true });
onBeforeUnmount(() => { sequence++; controller?.abort(); for (const request of contentControllers.values()) request.abort(); window.removeEventListener('popstate', photoPop); });
function search() {
  if (!item.value) return;
  // Use the durable poster identity in saved items/history, not the short-lived detail image handle.
  emit('search', { ...item.value, poster: withAppBase(`/api/discovery/posters/${props.id}`) });
}
</script>

<template>
  <article class="film-detail" aria-label="影片详情" :aria-busy="loading">
    <nav class="detail-nav"><button type="button" aria-label="返回上一页" title="返回上一页" @click="emit('back')"><ArrowLeft aria-hidden="true" /></button><button v-if="item" type="button" class="search-resources" :aria-label="`搜索《${item.title}》的播放资源`" title="搜索播放资源" @click="search"><Search aria-hidden="true" /></button></nav>
    <div v-if="item" class="detail-layout">
      <div class="detail-atmosphere" aria-hidden="true"><MediaPoster :src="item.poster" :catalog-id="id" alt="" loading="eager" /></div>
      <aside class="detail-aside"><div class="detail-cover"><MediaPoster :src="item.poster" :catalog-id="id" :alt="item.title + '海报'" loading="eager" fetchpriority="high" /></div>

      </aside>
      <header class="detail-heading">
        <p class="film-kind">{{ meta }}</p>
        <div class="detail-title-row"><h1>{{ item.title }}</h1>      </div>
        <p v-if="detail?.originalTitle && detail.originalTitle !== item.title" class="original-title">{{ detail.originalTitle }}</p>
        <div class="rating-line"><template v-if="item.rating"><Star aria-hidden="true" /><strong>{{ item.rating.toFixed(1) }}</strong><span>{{ provider }}评分<span v-if="item.ratingCount"> · {{ item.ratingCount.toLocaleString() }} 人评价</span></span></template><span v-else>暂无评分</span></div>
        <p v-if="detail?.episodeCount || item.subtitle" class="release-line">{{ item.subtitle || `全 ${detail?.episodeCount} 集` }}</p>
        <button v-if="collected" type="button" class="play-collection" :aria-label="`播放收藏《${item.title}》`" title="播放收藏" @click="emit('play-collection')"><Play fill="currentColor" aria-hidden="true" /></button>


      </header>

      <div class="detail-body">
        <LoadingSkeleton v-if="loading" variant="text" :count="4" label="正在加载详情" />
        <p v-else-if="failure" class="detail-notice" role="alert">{{ failure }}<button type="button" @click="load">重试</button></p>
        <p v-else-if="detail?.stale" class="detail-notice" role="status">当前展示上次获取的信息<button type="button" @click="load">刷新</button></p>
        <section v-if="detail?.description" class="detail-section synopsis"><div class="section-heading"><h2>剧情简介</h2><button type="button" :aria-expanded="expanded" :aria-label="expanded ? '收起剧情简介' : '展开剧情简介'" :title="expanded ? '收起剧情简介' : '展开剧情简介'" @click="expanded = !expanded"><ChevronDown :class="{ rotated: expanded }" aria-hidden="true" /></button></div><p :class="{ collapsed: !expanded }">{{ detail.description }}</p></section>
        <MediaRail v-if="detail?.credits.length" :key="`${id}:credits`" class="detail-section credits-rail" title="演职员" :item-count="credits?.length">
          <div v-for="(person,index) in credits" :key="`${person.name}:${index}`" class="credit"><img v-if="person.image && !missingPortraits.has(person.name)" :src="person.image" :class="{'image-loading':!loadedImages.has(person.image)}" @load="loadedImages.add(person.image)" alt="" loading="lazy" @error="missingPortraits.add(person.name)" /><span v-else class="portrait-fallback">{{ person.name.slice(0, 1) }}</span><strong :title="person.name">{{ person.name }}</strong><small :title="person.role">{{ person.role }}</small></div>
          <ScrollLoad v-if="creditLimit < detail.credits.length" horizontal :more="true" :progress="`${id}:credits:${creditLimit}`" @load="creditLimit += 24" />
        </MediaRail>
        <MediaRail v-if="detail?.provider === 'douban' && (photos.length || detail.photoCount)" :key="`${id}:photos`" class="detail-section photos-rail" title="剧照" :item-count="photos.length + (photoLoading ? 1 : 0)">
          <template #status><small v-if="photoTotal" class="photo-total">{{ photoTotal }}</small></template>
          <button v-for="(photo, index) in photos" :key="photo.id" class="photo-tile" type="button" :aria-label="`查看剧照 ${index + 1}`" @click="openPhoto(index)"><img :src="photo.image" :class="{'image-loading':!loadedImages.has(photo.image)}" @load="loadedImages.add(photo.image)" @error="loadedImages.add(photo.image)" :alt="photo.description || `${item.title}剧照 ${index + 1}`" loading="lazy" /></button>
          <ScrollLoad v-if="photoNext !== null || photoError" horizontal skeleton="cards" :more="photoNext !== null" :pending="loading || photoLoading" :error="photoError" :progress="`${id}:photos:${photoNext}:${photos.length}`" @load="more('photos')" />
        </MediaRail>
        <details v-if="facts.length" :key="id" class="detail-section detail-facts" open><summary>影片资料<ChevronDown aria-hidden="true" /></summary><dl><template v-for="[label, value] in facts" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template></dl><p v-if="detail?.honors.length" class="honors">{{ detail.honors.join(' · ') }}</p></details>
        <section v-if="detail?.provider === 'douban' && (comments.length || detail.commentCount)" class="detail-section"><div class="section-heading"><h2>热门短评 <small v-if="commentTotal">{{ commentTotal.toLocaleString() }}</small></h2><button type="button" :aria-expanded="commentExpanded" :aria-label="commentExpanded ? '收起短评' : '更多短评'" :title="commentExpanded ? '收起短评' : '更多短评'" @click="expandComments"><ChevronDown :class="{ rotated: commentExpanded }" aria-hidden="true" /></button></div><div v-for="comment in commentExpanded ? comments : comments.slice(0, 3)" :key="comment.id" class="short-comment"><header><strong>{{ comment.author }}</strong><span v-if="comment.rating" :aria-label="`${comment.rating} 星`">{{ '★'.repeat(comment.rating) }}</span><time>{{ comment.date }}</time></header><p>{{ comment.text }}</p><small v-if="comment.votes">{{ comment.votes.toLocaleString() }} 人觉得有用</small></div>
          <ScrollLoad v-if="commentExpanded" skeleton="text" :more="commentNext !== null" :pending="loading || commentLoading" :error="commentError" :progress="`${id}:comments:${commentNext}:${comments.length}`" @load="more('comments')" />
        </section>
        <footer v-if="detail" class="detail-attribution"><a :href="sourceUrl" target="_blank" rel="noopener noreferrer">资料来源 · {{ provider }}</a><span v-if="detail.partial"> · 部分资料暂未取得</span></footer>
      </div>
    </div>
    <LoadingSkeleton v-else-if="loading" variant="detail" label="正在加载影片" />
    <div v-else class="detail-empty" :role="failure ? 'alert' : 'status'"><h1>{{ failure || '正在加载影片…' }}</h1><button v-if="failure" type="button" @click="load">重新加载</button></div>
    <FilmPhotoViewer :photos="photos" :index="photoIndex" :total="photoTotal" :loading="photoLoading" :has-more="photoNext !== null" :error="photoError" @close="closePhoto" @select="photoIndex = $event" @more="more('photos', true)" />
  </article>
</template>

<style scoped>
.image-loading{animation:detail-image-loading 1.4s ease-in-out infinite}@keyframes detail-image-loading{50%{opacity:.4}}@media(prefers-reduced-motion:reduce){.image-loading{animation:none}}
.film-detail { max-width: 1320px; margin: 0 auto; color: var(--text-primary); }
.detail-nav { position:relative;z-index:1;display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; }
.detail-nav button { display:grid; width:44px; height:44px; place-items:center; border-radius:50%; background:#ffffff16;color:#fff;border:1px solid #ffffff14; }
button, a { -webkit-tap-highlight-color:transparent; }
button { cursor:pointer; }
a { color:inherit; text-decoration:none; }
.detail-section button, .detail-notice button { border:0; color:var(--text-secondary); padding:0; }
.detail-section button,.detail-notice button { background:transparent; }
svg { width:18px; height:18px; flex-shrink:0; }
.detail-nav a, .section-heading a, .section-more, .detail-attribution { color:var(--text-tertiary); font-size:.8rem; }
.detail-layout { position:relative; display:grid; grid-template-columns:minmax(0,1fr) minmax(220px,29%); grid-template-rows:auto 1fr; gap:64px 7%; align-items:center; isolation:isolate; }
.detail-atmosphere { --surface-2:#202226;--surface-3:#303238;position:absolute;grid-row:1 / 2;grid-column:1/-1;z-index:-1;top:-96px;bottom:-64px;left:50%;width:100vw;transform:translateX(-50%);overflow:hidden;pointer-events:none;background:#08090b; }
.detail-atmosphere :deep(img) { width:100%;height:100%;object-fit:cover;object-position:center 35%;filter:blur(7px) saturate(1.1);opacity:.82;transform:scale(1.04); }
.detail-atmosphere::after{content:'';position:absolute;inset:0;background:linear-gradient(0deg,var(--liquid-canvas),transparent 64px),linear-gradient(90deg,#08090bdd,#08090b60 60%,#08090b25),linear-gradient(180deg,#08090b60,transparent 40%)}
.detail-aside { grid-column:2; grid-row:1; width:100%; max-width:300px; justify-self:center; }
.detail-cover { grid-column:1; grid-row:1; }
.detail-cover :deep(img) { display:block; width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:8px; background:var(--surface-2); }
.detail-heading { --text-primary:#fff;--text-secondary:#e3e3e7;--text-tertiary:#ccccd3;--liquid-accent:#fff;--surface-1:#111215;grid-column:1;grid-row:1;padding:24px 0;color:#fff; }
.film-kind, .original-title, .genre-line, .release-line { color:var(--text-secondary); font-size:.87rem; line-height:1.7; }
h1 { font-size:clamp(2rem,4vw,3.75rem); font-weight:750; letter-spacing:-.04em; line-height:1.2; margin:12px 0; overflow-wrap:anywhere; }
.original-title { color:var(--text-tertiary); margin-bottom:14px; }
.rating-line { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:16px 0 10px; }
.rating-line svg { color:var(--liquid-accent); width:16px; }
.rating-line strong { font-size:1.5rem; line-height:1; }
.rating-line span { color:var(--text-tertiary); font-size:.78rem; line-height:1.5; }
.detail-title-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-width:0}.detail-title-row h1{min-width:0}.detail-actions { display:flex;align-items:center;gap:8px;flex-shrink:0;padding:0; }
.detail-actions button { display:grid; width:48px; height:48px; place-items:center; border:0; border-radius:50%; }
.detail-actions svg { width:21px; height:21px; }
.detail-actions .play-collection svg { margin-left:2px; }
.search-resources { background:#ffffff0f;box-shadow:inset 0 0 0 1px #ffffff24;color:var(--text-primary);transition:background .18s,box-shadow .18s,transform .18s; }
@media(hover:hover) and (pointer:fine){.search-resources:hover{background:#ffffff29;box-shadow:inset 0 0 0 1px #ffffff52,0 5px 18px #0002;transform:translateY(-2px)}.detail-nav button:hover{background:#ffffff29}}
.search-resources:active{transform:scale(.96);background:#ffffff35}
.detail-heading > .play-collection { display:grid;width:44px;height:44px;place-items:center;margin-top:12px;border:0;border-radius:50%;}
.play-collection { background:var(--text-primary); color:var(--surface-1); }
.detail-body { grid-column:1 / -1; grid-row:2; min-width:0; }
.detail-section { padding:28px 0; border-top:1px solid var(--divider); }
.synopsis p { max-width:900px; }
h2 { margin:0 0 16px; font-size:1.15rem; font-weight:650; }
.synopsis p { white-space:pre-line; font-size:.9rem; line-height:1.9; color:var(--text-secondary); }
.synopsis p.collapsed { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
.section-heading button { display:grid; width:44px; height:44px; flex-shrink:0; place-items:center; border-radius:50%; }
.section-heading button:hover { background:var(--surface-2); }
.section-heading svg { transition:transform .18s ease; }
.section-heading svg.rotated { transform:rotate(180deg); }
.section-heading { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:10px; }
.section-heading h2 { margin:0; }
.section-heading a, .section-more { display:inline-flex; align-items:center; gap:2px; }

.credits-rail{--rail-item-width:96px}.photos-rail{--rail-item-width:clamp(220px,26vw,320px);--scroll-load-aspect-ratio:1.6}
.credits-rail :deep(.rail-track > .scroll-load),.photos-rail :deep(.rail-track > .scroll-load){flex:0 0 2px}
.photos-rail :deep(.rail-track > .scroll-load.has-feedback){flex-basis:var(--rail-item-width)}
.credit{min-width:0}.credit img,.portrait-fallback{display:grid;width:100%;aspect-ratio:1;object-fit:cover;border-radius:50%;background:var(--surface-2);place-items:center;color:var(--text-tertiary);font-size:1.6rem}
.credit strong,.credit small{display:block;margin-top:7px;font-size:.76rem;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.credit small{margin-top:3px;color:var(--text-tertiary);font-size:.7rem}.photo-total{color:var(--text-tertiary);font-size:.75rem}
.photo-tile{align-self:flex-start;text-align:left;border-radius:7px;overflow:hidden}.photo-tile img{display:block;width:100%;aspect-ratio:1.6;object-fit:cover;background:var(--surface-2);transition:transform .25s}
@media(hover:hover) and (pointer:fine){.photo-tile:hover img{transform:scale(1.035)}}
dl { display:grid; grid-template-columns:50px minmax(0,1fr); gap:12px 16px; font-size:.84rem; line-height:1.7; }
dt { color:var(--text-tertiary); } dd { margin:0; color:var(--text-secondary); overflow-wrap:anywhere; }
.honors { color:var(--liquid-accent); margin-top:20px; font-size:.8rem; }
.short-comment + .short-comment { margin-top:24px; }
.short-comment header { display:flex; align-items:center; gap:10px; font-size:.75rem; }
.short-comment header strong { font-weight:550; } .short-comment header span { color:var(--liquid-accent); letter-spacing:1px; }
.short-comment time { margin-left:auto; color:var(--text-tertiary); font-size:.7rem; }
.short-comment p { margin-top:8px; color:var(--text-secondary); font-size:.83rem; line-height:1.8; white-space:pre-line; }
.detail-attribution { padding:12px 0 24px; line-height:1.8; }
.detail-attribution a { display:flex; align-items:center; gap:2px; margin-top:8px; }
.detail-notice { display:flex; gap:14px; align-items:center; color:var(--text-tertiary); font-size:.8rem; padding:16px 0; }
.detail-notice button { color:var(--liquid-accent); min-height:44px; padding:0 8px; }
.detail-empty { padding:60px 0; text-align:center; color:var(--text-secondary); }
.detail-empty h1 { font-size:1.2rem; } .detail-empty button, .detail-empty a { display:inline-block; margin:16px; padding:10px; color:var(--liquid-accent); background:transparent; border:0; }
@media(max-width:767px) {
  .detail-nav { margin-bottom:20px; }
  .detail-aside { display:block; grid-column:1; grid-row:1; align-self:start; }
  .detail-layout { grid-template-columns:112px minmax(0,1fr); gap:0 20px; align-items:start; }
  .detail-atmosphere { top:-84px; }
  .detail-cover :deep(img) { border-radius:6px; }
  .detail-heading { grid-column:2; padding:0; min-height:168px; }
  h1 { font-size:1.4rem; margin:4px 0 8px; }
  .film-kind, .genre-line, .original-title, .release-line { font-size:.72rem; line-height:1.6; }
  .original-title { margin-bottom:6px; }
  .rating-line { gap:5px; margin:12px 0 7px; }
  .rating-line strong { font-size:1.2rem; }
  .rating-line span { font-size:.68rem; }
  .rating-line > span { flex-basis:100%; }
  .rating-line span span { white-space:nowrap; }
  .detail-body { grid-column:1 / -1; grid-row:2; padding-top:64px; }
  .detail-section { padding:22px 0; }
  .detail-title-row{gap:8px;align-items:flex-start}.detail-actions { padding-top:0; gap:4px; }
  .detail-actions button { width:44px; height:44px; }
  .credits-rail{--rail-item-width:80px}.photos-rail{--rail-item-width:200px}
}
.detail-facts summary { display:flex; align-items:center; justify-content:space-between; min-height:44px; cursor:pointer; list-style:none; font-size:1.15rem; font-weight:650; }
.detail-facts summary::-webkit-details-marker { display:none; }
.detail-facts summary svg { margin-right:13px; transition:transform .18s ease; }
.detail-facts[open] summary { margin-bottom:18px; }
.detail-facts[open] summary svg { transform:rotate(180deg); }
button:focus-visible,summary:focus-visible { outline:2px solid var(--liquid-accent); outline-offset:3px; }
@media(prefers-reduced-motion:reduce) { .section-heading svg,.detail-facts summary svg,.search-resources,.photo-tile img { transition:none;transform:none; } }
.section-heading h2 small { color:var(--text-tertiary); font-size:.72rem; font-weight:400; margin-left:6px; }
.content-pagination { display:grid; gap:10px; justify-items:center; padding-top:14px; color:var(--text-tertiary); font-size:.8rem; }
.content-pagination button { min-height:44px; padding:0 18px; border:1px solid var(--divider); border-radius:8px; color:var(--text-secondary); }
.content-pagination button:disabled { opacity:.5; }
.short-comment > small { display:block; color:var(--text-tertiary); font-size:.7rem; margin-top:8px; }
.detail-attribution a { display:inline-flex; margin:0; }
</style>
