<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ImagePlus } from '@lucide/vue';
import { siteSettings, loadSiteSettings, saveSiteSettings, prepareSiteIcons } from '../../services/siteSettings';
import { useToast } from '../../composables/useToast';
const emit = defineEmits<{ (event: 'busy', busy: boolean): void }>();
const toast = useToast(), name = ref(''), revision = ref('');
const icons = ref<Record<string,string> | null | undefined>(), loading = ref(true), saving = ref(false), processing = ref(false), error = ref('');
const input = ref<HTMLInputElement | null>(null), conflict = ref(false); let alive = true, imageSequence = 0;
const preview = computed(() => icons.value ? icons.value[512] : icons.value === null ? siteSettings.value.defaults.iconUrl : siteSettings.value.iconUrl);
const hasChanges = computed(() => name.value.trim() !== siteSettings.value.name || icons.value !== undefined);
async function reload() {
  loading.value = true; error.value = '';
  try {
    const value = await loadSiteSettings(); if (!alive) return;
    name.value = value.name; revision.value = value.revision; icons.value = undefined; conflict.value = false;
  } catch (e) { if (alive) error.value = e instanceof Error ? e.message : '加载失败'; }
  finally { if (alive) loading.value = false; }
}
async function selectIcon(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (input.value) input.value.value = ''; if (!file) return;
  const seq = ++imageSequence; processing.value = true; error.value = ''; emit('busy', true);
  try { const result = await prepareSiteIcons(file); if (alive && seq === imageSequence) icons.value = result; }
  catch (e) { if (alive && seq === imageSequence) error.value = e instanceof Error ? e.message : '图片无法读取'; }
  finally { if (alive && seq === imageSequence) { processing.value = false; emit('busy', false); } }
}
function reset() { const value = siteSettings.value.defaults; name.value = value.name; icons.value = null; error.value = ''; }
async function save() {
  if (!revision.value || saving.value || processing.value || !name.value.trim()) return;
  saving.value = true; error.value = ''; conflict.value = false; emit('busy', true);
  try {
    const value = await saveSiteSettings({ name: name.value, revision: revision.value, ...(icons.value !== undefined ? { icons: icons.value } : {}) });
    if (!alive) return; name.value = value.name; revision.value = value.revision; icons.value = undefined; conflict.value = false; toast.show('站点信息已保存', '✓');
  } catch (e) { if (alive) { error.value = e instanceof Error ? e.message : '保存失败'; conflict.value = (e as { statusCode?: number }).statusCode === 409; } }
  finally { if (alive) { saving.value = false; emit('busy', false); } }
}
onMounted(reload); onBeforeUnmount(() => { alive = false; imageSequence++; });
</script>
<template>
  <section class="site-settings" aria-label="站点设置">
    <LoadingSkeleton v-if="loading" variant="form" :count="2" label="正在加载站点设置" />
    <form v-else @submit.prevent="save">
      <div class="site-icon-row"><img :src="preview" alt="站点图标预览" /><div><button type="button" class="choose-icon" :disabled="saving || processing || !revision" @click="input?.click()"><ImagePlus aria-hidden="true" />{{ processing ? '处理图片…' : '更换图标' }}</button><small>PNG、JPG、WebP，最大 5 MB</small></div><input ref="input" type="file" tabindex="-1" accept="image/png,image/jpeg,image/webp" aria-label="上传站点图标" @change="selectIcon" /></div>
      <label>站点名称<input v-model="name" name="site-name" maxlength="32" required :disabled="saving || !revision" autocomplete="off" /></label>
      <p v-if="error" class="site-error" role="alert">{{ error }}<button v-if="conflict || !revision" type="button" @click="reload">重新加载</button></p>
      <footer><button type="button" :disabled="saving || processing || !revision" @click="reset">恢复默认</button><button class="save-site" type="submit" :disabled="saving || processing || !name.trim() || !hasChanges || !revision">{{ saving ? '保存中…' : '保存' }}</button></footer>
      <p class="site-hint">已安装的桌面图标可能需要重新安装才能更新。</p>
    </form>
  </section>
</template>
<style scoped>
.site-settings { padding:0; border:0; background:none; }
form { display:grid; gap:28px; }.site-icon-row { display:flex; align-items:center; gap:24px; margin-bottom:12px; }.site-icon-row img { width:88px; height:88px; flex-shrink:0; border:1px solid var(--divider); border-radius:12px; object-fit:contain; background:var(--surface-1); }.site-icon-row div { display:grid; gap:10px; }.site-icon-row small,.site-hint { color:var(--text-tertiary); font-size:.78rem; line-height:1.6; }.site-icon-row input { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
button { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:10px 18px; border:1px solid var(--divider); border-radius:4px; color:var(--text-primary); background:none; font-size:.85rem; font-weight:550; }.choose-icon svg { width:18px; height:18px; }
label { display:grid; grid-template-columns:112px minmax(0,1fr); align-items:center; gap:20px; color:var(--text-secondary); font-size:.9rem; } label input { width:100%; min-height:50px; padding:12px 14px; border:1px solid var(--divider); border-radius:4px; color:var(--text-primary); background:var(--surface-1); font-size:16px; }
footer { display:flex; align-items:center; justify-content:flex-end; gap:12px; padding-top:24px; border-top:1px solid var(--divider); }.save-site { min-width:112px; color:var(--accent-ink); background:var(--liquid-accent); border-color:var(--liquid-accent); }
button:disabled { cursor:default; opacity:.4; }.site-error { color:var(--danger); font-size:.84rem; line-height:1.7; }.site-error button { margin-left:10px; }.site-hint { font-size:.75rem; }
@media(max-width:640px) { form { gap:24px; } label { grid-template-columns:1fr; gap:10px; }.site-icon-row { gap:16px; }.site-icon-row img { width:72px; height:72px; }.site-icon-row small { font-size:.72rem; } }
</style>
