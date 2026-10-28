<script setup lang="ts">
import {clipboardDetection,setClipboardDetection} from '../../services/clipboardSettings';
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { defineAsyncComponent, nextTick, ref } from 'vue';
import { ChevronLeft, ChevronRight, Download, LogOut, Settings2, Globe } from '@lucide/vue';
import type { AppUser } from '../../services/authService';
import { apiUrl } from '../../services/appUrl';
import { QuarkStreamService } from '../../services/quarkStreamService';
import { useToast } from '../../composables/useToast';
import ThemeSwitch from '../common/ThemeSwitch.vue';
import PageLoadState from '../common/PageLoadState.vue';
import { isAppleTouchDevice } from '../../services/device';
import { androidInstalled, installAndroidApp } from '../../services/androidInstall';

// Administrative forms are opened explicitly and are not needed for discovery.
const TvPlaybackAuth = defineAsyncComponent({ loader: () => import('./TvPlaybackAuth.vue'), loadingComponent: PageLoadState, errorComponent: PageLoadState, delay: 0 });
const SiteSettingsPanel = defineAsyncComponent({ loader: () => import('./SiteSettingsPanel.vue'), loadingComponent: PageLoadState, errorComponent: PageLoadState, delay: 0 });
const LibraryMaintenanceStatus = defineAsyncComponent({ loader: () => import('./LibraryMaintenanceStatus.vue'), loadingComponent: PageLoadState, errorComponent: PageLoadState, delay: 0 });

const props = defineProps<{ user: AppUser; loggingOut?:boolean }>();
const emit = defineEmits<{
  (e: 'logout'): void;
  (e: 'auth-updated'): void;
  (e: 'back'): void;
}>();

const toast = useToast();
const installUrl = apiUrl('/install/ios.mobileconfig');
const isAndroid = /Android/i.test(navigator.userAgent);
const isAppleMobile = isAppleTouchDevice(navigator);
const installHint = ref('');
const installApp = async () => {
  installHint.value = '';
  if (await installAndroidApp() === 'unavailable') installHint.value = '在 Chrome 菜单中选择“添加到主屏幕”或“安装应用”。';
};
const credential = ref('');
const loadingStatus = ref(true);
const statusError = ref('');
const credentialError = ref('');
const libraryConnected = ref(false);
const playbackConnected = ref(false);
const directPlaybackConnected = ref(false);
const tvTokenExchangeOrigin = ref('');
const isSaving = ref(false);
const showCredentialForm = ref(false);
const advancedConfiguration = ref(false);
const siteConfiguration = ref(false), siteBusy = ref(false);
const authSection = ref<HTMLElement | null>(null);
const refreshStatus = async () => {
  loadingStatus.value = true;
  statusError.value = '';
  try {
    const status = await QuarkStreamService.getConfig();
    libraryConnected.value = status.libraryConfigured ?? status.isConfigured;
    playbackConnected.value = status.isAuthenticated;
    directPlaybackConnected.value = Boolean(status.advancedPlaybackConfigured);
    tvTokenExchangeOrigin.value = status.tvTokenExchangeOrigin || '未配置';
  } catch {
    statusError.value = '暂时无法读取服务状态，请检查网络后重试。';
  } finally {
    loadingStatus.value = false;
  }
};

const saveCredential = async () => {
  const value = credential.value.trim();
  if (!value || isSaving.value) {
    if (!value) toast.show('请输入有效的 Cookie 字符串', '!');
    return;
  }

  isSaving.value = true;
  credentialError.value = '';
  try {
    const result = await QuarkStreamService.saveConfig(value);
    if (!result.success) {
      credentialError.value = result.message;
      return;
    }
    credential.value = '';
    libraryConnected.value = result.status?.libraryConfigured ?? result.status?.isConfigured ?? true;
    playbackConnected.value = result.status?.isAuthenticated ?? true;
    showCredentialForm.value = false;
    toast.show('Cookie 已验证并保存', '✓', 2800);
    emit('auth-updated');
  } finally {
    isSaving.value = false;
  }
};

const openAdvanced = async () => {
  if (props.user.role !== 'admin') return;
  siteConfiguration.value = false; advancedConfiguration.value = true;
  await refreshStatus();
  if (props.user.role === 'admin' && !statusError.value && !libraryConnected.value) showCredentialForm.value = true;
};
const focusAuth = async () => {
  if (props.user.role !== 'admin') { toast.show('认证由管理员维护', '!'); return; }
  await openAdvanced();
  if (props.user.role === 'admin') showCredentialForm.value = true;
  await nextTick();
  authSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
const back = () => {
  if (siteBusy.value) return;
  if (siteConfiguration.value) siteConfiguration.value = false;
  else if (advancedConfiguration.value) { advancedConfiguration.value = false; credential.value = ''; showCredentialForm.value = false; }
  else emit('back');
};

defineExpose({ focusAuth, refreshStatus });
</script>

<template>
  <main class="account-page">
    <header v-if="advancedConfiguration || siteConfiguration" class="page-heading">
      <button type="button" class="back-button" :disabled="siteBusy" :aria-label="advancedConfiguration || siteConfiguration ? '返回设置' : '返回上一页'" @click="back"><ChevronLeft aria-hidden="true" /></button>
      <h1>{{ siteConfiguration ? '站点设置' : advancedConfiguration ? '高级配置' : '设置' }}</h1>
    </header>
    <template v-if="!advancedConfiguration && !siteConfiguration">
      <section class="settings-section general-settings" aria-label="系统配置">
        <div class="theme-row"><span>主题</span><ThemeSwitch /></div>
        <button v-if="user.role === 'admin'" class="settings-row" type="button" @click="siteConfiguration = true"><Globe aria-hidden="true" /><span>站点设置</span><ChevronRight class="chevron" aria-hidden="true" /></button>
        <button v-if="user.role === 'admin'" class="settings-row" type="button" @click="openAdvanced"><Settings2 aria-hidden="true" /><span>高级配置</span><ChevronRight class="chevron" aria-hidden="true" /></button>
        <template v-if="isAndroid">
          <button v-if="!androidInstalled" class="settings-row" type="button" @click="installApp"><Download aria-hidden="true" /><span>安装到桌面</span><ChevronRight class="chevron" aria-hidden="true" /></button>
          <p v-if="installHint && !androidInstalled" class="install-hint" role="status">{{ installHint }}</p>
        </template>
        <a v-else-if="isAppleMobile" class="settings-row ios-install-link" :href="installUrl"><Download aria-hidden="true" /><span>安装到桌面</span><ChevronRight class="chevron" aria-hidden="true" /></a>
      </section>
      <section class="settings-section clipboard-settings" aria-labelledby="clipboard-title"><h2 id="clipboard-title">便捷功能</h2><div class="settings-row clipboard-row"><span>剪贴板识别</span><button data-clipboard-setting type="button" role="switch" aria-label="剪贴板识别" :aria-checked="clipboardDetection" class="clipboard-switch" @click="setClipboardDetection(!clipboardDetection)"><i></i></button></div></section>
      <section class="settings-section account-actions" aria-labelledby="account-title"><h2 id="account-title">账号</h2><button type="button" class="logout-button" :disabled="loggingOut" aria-label="退出登录" @click="emit('logout')"><LoadingSkeleton v-if="loggingOut" variant="inline" :count="1" label="正在退出登录" /><LogOut v-else aria-hidden="true" />{{ loggingOut ? '退出中…' : '退出登录' }}</button></section>
    </template>
    <SiteSettingsPanel v-else-if="siteConfiguration && user.role === 'admin'" @busy="siteBusy = $event" />
    <section v-else-if="user.role === 'admin'" ref="authSection" class="settings-section auth-section" aria-labelledby="auth-title">
      <div class="section-title-row">
        <div>
          <h2 id="auth-title">网盘认证</h2>
        </div>
        <div class="status-pill" :class="{ ready: libraryConnected && playbackConnected && !statusError }">
          <span class="status-dot" aria-hidden="true"></span>
          {{ loadingStatus ? '检查中' : statusError ? '待重试' : (libraryConnected && playbackConnected ? '已连接' : '待认证') }}
        </div>
      </div>

      <div v-if="statusError" class="inline-feedback" role="alert"><p>{{ statusError }}</p><button type="button" :disabled="loadingStatus" @click="refreshStatus">重新检查</button></div>
      <template v-if="user.role === 'admin'">
        <LoadingSkeleton v-if="loadingStatus" variant="form" :count="3" label="正在加载认证设置" />

        <button
          v-else-if="libraryConnected && !showCredentialForm"
          type="button"
          class="reconfigure-button"
          @click="showCredentialForm = true"
        >
          更新 Cookie
          <ChevronRight aria-hidden="true" />
        </button>

        <div v-else-if="!statusError" class="credential-editor">
          <form class="credential-form" @submit.prevent="saveCredential">
            <label for="playback-credential">Cookie 字符串</label>
            <textarea
              id="playback-credential"
              v-model="credential"
              rows="4"
              autocapitalize="none"
              autocomplete="off"
              spellcheck="false"
              placeholder="粘贴从已登录浏览器复制的完整 Cookie"
              :disabled="isSaving"
              :aria-invalid="!!credentialError"
              :aria-describedby="credentialError ? 'credential-error' : undefined"
              @input="credentialError = ''"
            ></textarea>
            <p v-if="credentialError" id="credential-error" class="inline-feedback" role="alert">{{ credentialError }}</p>
            <small class="credential-hint">凭证加密保存，不回显。</small>
            <div class="form-actions">
              <button v-if="libraryConnected" type="button" class="cancel-edit" :disabled="isSaving" @click="showCredentialForm = false; credential = ''">取消</button>
              <button type="submit" class="save-credential" :disabled="isSaving || !credential.trim()">
                <span v-if="isSaving" class="button-spinner" aria-hidden="true"></span>
                {{ isSaving ? '正在验证…' : (libraryConnected ? '确认更新' : '验证并保存') }}
              </button>
            </div>
          </form>
        </div>
      </template>

      <p v-else class="managed-hint">由管理员维护认证</p>
      <LibraryMaintenanceStatus />
      <TvPlaybackAuth
        v-if="user.role === 'admin' && !loadingStatus && !statusError"
        :connected="directPlaybackConnected"
        :exchange-origin="tvTokenExchangeOrigin"
        @confirmed="refreshStatus(); emit('auth-updated'); toast.show('直连认证已保存', '✓')"
      />
    </section>

  </main>
</template>

<style scoped>
.clipboard-settings h2,.account-actions h2{margin:0 0 16px;font-size:1rem;font-weight:600}.clipboard-settings{padding:22px 0 28px}.clipboard-row{display:flex;justify-content:space-between}.settings-row.clipboard-row:hover{background:none}.clipboard-switch{position:relative;display:flex;align-items:center;width:48px;height:44px;padding:0 4px;border:0;border-radius:6px;background:none}.clipboard-switch::before{content:"";position:absolute;left:4px;top:10px;width:40px;height:24px;border-radius:20px;background:var(--surface-3)}.clipboard-switch i{position:relative;display:block;width:18px;height:18px;margin-left:3px;border-radius:50%;background:var(--text-primary);transition:transform .18s}.clipboard-switch[aria-checked=true]::before{background:var(--text-primary)}.clipboard-switch[aria-checked=true] i{transform:translateX(16px);background:var(--surface-1)}.account-actions .logout-button{margin-top:0}@media(prefers-reduced-motion:reduce){.clipboard-switch i{transition:none}}
.account-page { position:relative; z-index:1; width:100%; max-width:1040px; min-height:calc(var(--app-viewport-height) - var(--app-header-height)); margin:0 auto; padding:24px var(--content-gutter) 80px; color:var(--text-primary); }
.page-heading { display:flex; align-items:center; gap:14px; margin-bottom:44px; }.page-heading h1 { font-size:2.25rem; line-height:1.2; font-weight:700; letter-spacing:-.035em; }
.back-button { display:grid; flex:0 0 44px; place-items:center; width:44px; height:44px; padding:0; border:0; border-radius:4px; color:var(--text-secondary); background:none; }.back-button svg { width:22px; height:22px; }
.settings-section { padding:0; margin-bottom:36px; border:0; background:none; }
.theme-row { display:grid; grid-template-columns:140px minmax(0,1fr); align-items:center; gap:24px; min-height:100px; padding:20px 0 28px; font-size:1rem; font-weight:550; }.theme-row .theme-switch { width:100%; max-width:360px; }
.settings-row { display:flex; align-items:center; gap:16px; width:100%; min-height:76px; padding:12px 16px; border:0; border-radius:8px; transition:background .18s; color:var(--text-primary); background:none; text-decoration:none; text-align:left; font-size:1rem; }.settings-row > svg { flex-shrink:0; width:21px; height:21px; color:var(--text-secondary); }.settings-row > span { flex:1; }.settings-row .chevron { width:17px; height:17px; color:var(--text-tertiary); }
.section-title-row { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; }.section-title-row h2 { font-size:1.15rem; font-weight:650; }
.status-pill { display:inline-flex; align-items:center; gap:7px; padding:0; color:var(--text-tertiary); background:none; font-size:.8rem; }.status-pill.ready { color:var(--success); background:none; }.status-dot { width:5px; height:5px; border-radius:50%; background:currentColor; }
.reconfigure-button,.save-credential,.cancel-edit { display:inline-flex; align-items:center; justify-content:center; gap:12px; min-height:44px; padding:10px 20px; border:1px solid var(--divider); border-radius:4px; color:var(--text-primary); background:none; font-size:.86rem; font-weight:600; }.reconfigure-button svg { width:17px; height:17px; }.save-credential { color:var(--accent-ink); background:var(--liquid-accent); border-color:var(--liquid-accent); }
.credential-form { display:grid; gap:12px; }.credential-form label { color:var(--text-secondary); font-size:.85rem; }.credential-form textarea { display:block; width:100%; min-height:148px; padding:14px 16px; resize:vertical; border:1px solid var(--divider); border-radius:4px; color:var(--text-primary); background:var(--surface-1); font-size:16px; }
.credential-hint,.credential-loading { color:var(--text-tertiary); font-size:.8rem; line-height:1.6; }.form-actions { display:flex; justify-content:flex-end; gap:12px; margin-top:6px; }
.logout-button { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:46px; padding:10px 22px; border:1px solid var(--divider); border-radius:4px; color:var(--text-primary); background:none; font-size:.9rem; font-weight:550; }.logout-button svg { width:18px; height:18px; }.logout-button:hover { color:var(--danger); border-color:var(--danger); }
.install-hint { margin-top:-8px; padding:0 0 18px; color:var(--text-secondary); font-size:.82rem; line-height:1.6; }
:global(html.ios-standalone .ios-install-link) { display:none; }
@media(hover:hover) and (pointer:fine) { .settings-row:hover,.back-button:hover { color:var(--text-primary); background:var(--glass-bg); } }
@media(max-width:640px) { .account-page { padding:16px calc(var(--mobile-gutter) + var(--safe-area-right)) var(--mobile-content-bottom) calc(var(--mobile-gutter) + var(--safe-area-left)); }.page-heading { margin-bottom:28px; gap:8px; }.page-heading h1 { font-size:1.8rem; }.theme-row { grid-template-columns:1fr; gap:16px; padding:8px 0 28px; }.theme-row .theme-switch { max-width:none; }.settings-row { min-height:68px; }.section-title-row h2 { font-size:1.05rem; } }
</style>
