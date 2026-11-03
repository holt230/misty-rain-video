<script setup lang="ts">
import { RefreshCw, X } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import type { CatalogCredit, CatalogPersonDetails } from '../../types/catalog';
import { catalogAvatar, useCatalogDetails } from '../../composables/useCatalogDetails';
import CatalogPersonAvatar from './CatalogPersonAvatar.vue';
const props = defineProps<{ person: CatalogCredit }>();
defineEmits<{ (event: 'close'): void }>();
const panel = ref<HTMLElement | null>(null);
const { data, loading, error, refresh } = useCatalogDetails<CatalogPersonDetails>(() => '/api/catalog/people/' + props.person.id, catalogAvatar);
onMounted(() => { panel.value?.focus({ preventScroll: true }); panel.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
</script>
<template>
  <section ref="panel" class="person-insight" tabindex="-1" role="region" aria-labelledby="person-insight-title" :aria-busy="loading">
    <header class="person-insight-header">
      <CatalogPersonAvatar :src="data?.avatar || person.avatar" :name="person.name" />
      <div><span class="eyebrow">人物资料</span><h3 id="person-insight-title">{{ data?.name || person.name }}</h3><p v-if="data?.latinName || person.latinName">{{ data?.latinName || person.latinName }}</p></div>
      <button type="button" class="icon-control" aria-label="关闭人物介绍" @click.stop.prevent="$emit('close')"><X /></button>
    </header>
    <p v-if="loading && !data" class="person-note" role="status">正在加载人物介绍…</p>
    <div v-if="error || data?.message" class="person-feedback" role="status"><span>{{ error || data?.message }}</span><button type="button" class="text-link" :disabled="loading" @click="refresh"><RefreshCw />重试</button></div>
    <template v-if="data">
      <p v-if="data.description" class="person-description">{{ data.description }}</p>
      <p v-else-if="!loading" class="person-note">资料源暂未提供更多人物介绍。</p>
      <dl v-if="data.info.length" class="person-facts"><div v-for="field in data.info" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl>
    </template>
  </section>
</template>
<style scoped>
.person-insight { min-width: 0; margin-top: 24px; padding: 24px; scroll-margin-top: 100px; border: 1px solid rgb(var(--accent-rgb) / .25); border-radius: var(--cinema-radius-card); background: var(--liquid-accent-subtle); }
.person-insight-header { display: flex; align-items: center; gap: 18px; }
.person-insight-header > div { flex: 1; min-width: 0; }
.person-insight-header > button { align-self: start; }
h3 { margin: 6px 0; font-size: 22px; overflow-wrap: anywhere; }
.person-insight-header p { font-size: 12px; color: var(--text-tertiary); overflow-wrap: anywhere; }
.person-description { margin-top: 22px; font-size: 14px; line-height: 1.9; white-space: pre-line; overflow-wrap: anywhere; }
.person-note, .person-feedback { color: var(--text-tertiary); font-size: 13px; line-height: 1.8; margin-top: 18px; }
.person-feedback { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.person-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 24px; }
.person-facts div { min-width: 0; }
dt { font-size: 11px; color: var(--text-tertiary); margin-bottom: 6px; }
dd { color: var(--text-primary); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
@media (max-width: 767px) { .person-insight { padding: 20px; } .person-insight-header { gap: 12px; } .person-insight-header :deep(.person-avatar) { width: 60px; height: 60px; } .person-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; } h3 { font-size: 20px; } }
</style>
