<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Clock3, Download, LogOut, Palette, ShieldCheck, Trash2 } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { AppUser } from '../../services/authService';
import { apiUrl } from '../../services/appUrl';
import { QuarkStreamService } from '../../services/quarkStreamService';
import { useToast } from '../../composables/useToast';
import type { PlaybackHistoryEntry } from '../../types/media';
import UserAvatar from '../common/UserAvatar.vue';
import TvPlaybackAuth from './TvPlaybackAuth.vue';
import ThemeSwitch from '../common/ThemeSwitch.vue';
import LibraryMaintenanceStatus from './LibraryMaintenanceStatus.vue';

const props = defineProps<{ user: AppUser; history: PlaybackHistoryEntry[]; historyError?: string; loadingHistory?: boolean; deletingHistoryId?: string }>();
const emit = defineEmits<{
  (e: 'logout'): void;
  (e: 'auth-updated'): void;
  (e: 'back'): void;
  (e: 'play-history', entry: PlaybackHistoryEntry): void;
  (e: 'delete-history', id: string): void;
  (e: 'retry-history'): void;
  (e: 'section-change', section: string): void;
}>();

const toast = useToast();
const installUrl = apiUrl('/install/ios.mobileconfig');
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
const historyExpanded = ref(false);
const section = ref<'overview' | 'history' | 'playback' | 'appearance' | 'device'>('overview');
const titles = { overview: '我的', history: '观看历史', playback: '播放与片库', appearance: '外观设置', device: '桌面安装' };
watch(section, value => emit('section-change', value));
const restoreSection = (value: string) => { section.value = Object.prototype.hasOwnProperty.call(titles, value) ? value as keyof typeof titles : 'overview'; };
const showHistory = () => { section.value = 'history'; historyExpanded.value = true; window.scrollTo({ top: 0 }); };
const back = () => { if (section.value === 'overview') emit('back'); else section.value = 'overview'; };
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

const onTouchStart = (e: TouchEvent) => {
  if (section.value === 'overview' || e.touches.length !== 1) return;
  const touch = e.touches[0];
  if (touch.clientX < 50) {
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
  } else {
    touchStartX = 0;
  }
};

const onTouchEnd = (e: TouchEvent) => {
  if (!touchStartX || e.changedTouches.length !== 1) return;
  const touch = e.changedTouches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = Math.abs(touch.clientY - touchStartY);
  const elapsed = Date.now() - touchStartTime;
  touchStartX = 0;
  if (deltaX > 60 && deltaY < 50 && elapsed < 500) {
    back();
  }
};
const authSection = ref<HTMLElement | null>(null);
const continueHistory = computed(() => props.history
  .filter(entry => !entry.completed && entry.position >= 5 && entry.duration > 0)
  .slice(0, 8));
const visibleHistory = computed(() => {
  if (historyExpanded.value) return props.history;
  const continuingIds = new Set(continueHistory.value.map(entry => entry.id));
  return props.history.filter(entry => !continuingIds.has(entry.id)).slice(0, 3);
});
const historyProgress = (entry: PlaybackHistoryEntry) => Math.max(2, Math.min(100, entry.position / entry.duration * 100));
const formatHistoryMeta = (entry: PlaybackHistoryEntry) => {
  const episode = entry.episodeNumber > 0 ? `第 ${entry.episodeNumber} 集` : entry.episodeTitle;
  const minutes = Math.max(1, Math.floor(entry.position / 60));
  return `${episode || '影片'} · ${entry.completed ? '已看完' : `看到 ${minutes} 分钟`}`;
};

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

const focusAuth = async () => {
  section.value = 'playback';
  await nextTick();
  if (loadingStatus.value) await refreshStatus();
  if (props.user.role === 'admin') showCredentialForm.value = true;
  await nextTick();
  authSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const initializeAccount = async () => {
  await refreshStatus();
  if (props.user.role === 'admin' && !statusError.value && !libraryConnected.value) showCredentialForm.value = true;
};

onMounted(initializeAccount);
defineExpose({ focusAuth, refreshStatus, showHistory, restoreSection });
</script>

<template>
  <main class="account-page" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
    <div class="account-content">
    <header class="page-heading">
      <div class="heading-copy">
        <button type="button" class="back-button" aria-label="返回上一页" @click="back">
          <ChevronLeft aria-hidden="true" />
        </button>
        <div>
        <span class="heading-kicker">个人中心</span>
        <h1>{{ titles[section] }}</h1>
        </div>
      </div>
    </header>

    <section v-if="section === 'overview'" class="profile-card" aria-labelledby="profile-title">
      <UserAvatar class="profile-avatar" :username="user.username" />
      <div class="profile-copy">
        <small>{{ user.role === 'admin' ? '管理员账户' : '片库账户' }}</small>
        <h2 id="profile-title">{{ user.username }}</h2>
        <p>收藏喜欢的影片，接着上次的故事。</p>
      </div>
      <span class="folder-chip">专属片库</span>
    </section>

    <nav v-if="section === 'overview'" class="account-menu" aria-label="个人中心功能">
      <button type="button" @click="showHistory"><span class="account-menu-icon"><Clock3 /></span><span class="account-menu-copy"><strong>观看历史</strong><small>找回每一段观影时光</small></span><ChevronRight class="account-menu-arrow" /></button>
      <button type="button" @click="section = 'playback'"><span class="account-menu-icon"><ShieldCheck /></span><span class="account-menu-copy"><strong>播放与片库</strong><small>认证、直连与自动追更</small></span><ChevronRight class="account-menu-arrow" /></button>
      <button type="button" @click="section = 'appearance'"><span class="account-menu-icon"><Palette /></span><span class="account-menu-copy"><strong>外观设置</strong><small>切换你喜欢的主题</small></span><ChevronRight class="account-menu-arrow" /></button>
      <button type="button" @click="section = 'device'"><span class="account-menu-icon"><Download /></span><span class="account-menu-copy"><strong>安装到桌面</strong><small>随时回来，接着看</small></span><ChevronRight class="account-menu-arrow" /></button>
    </nav>

    <section v-if="section === 'overview' && continueHistory.length" class="continue-history-section" aria-labelledby="continue-history-title">
      <div class="section-title-row compact">
        <div>
          <span>接着看</span>
          <h2 id="continue-history-title">继续观看</h2>
        </div>
      </div>
      <div class="continue-history-scroll">
        <button
          v-for="entry in continueHistory"
          :key="entry.id"
          type="button"
          class="continue-history-card"
          @click="emit('play-history', entry)"
        >
<MediaPoster :src="entry.media.poster" :alt="`${entry.media.title}封面`" loading="lazy" decoding="async" />
          <span class="continue-history-shade" aria-hidden="true"></span>
          <span class="continue-history-copy">
            <strong>{{ entry.media.title }}</strong>
            <small>{{ entry.episodeNumber > 0 ? `第 ${entry.episodeNumber} 集` : (entry.episodeTitle || '继续播放') }}</small>
          </span>
          <span class="continue-history-progress" aria-hidden="true"><i :style="{ width: `${historyProgress(entry)}%` }"></i></span>
        </button>
      </div>
    </section>

    <section v-if="section === 'history'" class="settings-section history-section" aria-labelledby="history-title">
      <div class="section-title-row compact">
        <div>
          <span>观看记录</span>
          <h2 id="history-title">播放历史</h2>
        </div>
        <small v-if="!historyError && !loadingHistory" class="history-count">{{ history.length }} 条</small>
      </div>

      <div v-if="historyError" class="inline-feedback" role="alert"><p>{{ historyError }}</p><button type="button" :disabled="loadingHistory" @click="emit('retry-history')">重新加载观看记录</button></div>
      <p v-else-if="loadingHistory && !history.length" class="history-empty" role="status">正在加载观看记录…</p>
      <div v-if="history.length" class="history-list">
        <article v-for="entry in visibleHistory" :key="entry.id" class="history-row">
          <button type="button" class="history-main" @click="emit('play-history', entry)">
<MediaPoster :src="entry.media.poster" :alt="`${entry.media.title}封面`" loading="lazy" decoding="async" />
            <span class="history-copy">
              <strong>{{ entry.media.title }}</strong>
              <small>{{ formatHistoryMeta(entry) }}</small>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="history-delete"
            :disabled="!!deletingHistoryId"
            :aria-label="`删除${entry.media.title}的播放记录`"
            @click="emit('delete-history', entry.id)"
          >
            <Trash2 aria-hidden="true" />
          </button>
        </article>

        <button
          v-if="history.length > visibleHistory.length || historyExpanded"
          type="button"
          class="history-toggle"
          :aria-expanded="historyExpanded"
          @click="historyExpanded = !historyExpanded"
        >
          {{ historyExpanded ? '收起播放历史' : `查看全部 ${history.length} 条记录` }}
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <p v-else-if="!historyError && !loadingHistory" class="history-empty">开始播放影片后，这里会同步保存观看进度。</p>
    </section>

    <section v-show="section === 'playback'" ref="authSection" class="settings-section auth-section" aria-labelledby="auth-title">
      <div class="section-title-row">
        <div>
          <span>设置</span>
          <h2 id="auth-title">播放与片库</h2>
        </div>
        <div class="status-pill" :class="{ ready: libraryConnected && playbackConnected && !statusError }">
          <span class="status-dot" aria-hidden="true"></span>
          {{ loadingStatus ? '检查中' : statusError ? '待重试' : (libraryConnected && playbackConnected ? '已连接' : '待认证') }}
        </div>
      </div>

      <div v-if="statusError" class="inline-feedback" role="alert"><p>{{ statusError }}</p><button type="button" :disabled="loadingStatus" @click="refreshStatus">重新检查</button></div>
      <div v-else class="service-summary">
        <div class="service-icon" aria-hidden="true">
          <ShieldCheck />
        </div>
        <div>
          <strong>{{ loadingStatus ? '正在检查服务状态' : (libraryConnected && playbackConnected ? '片库与播放服务已连接' : (libraryConnected ? '片库服务已连接' : '连接个人片库')) }}</strong>
          <p>
            {{ loadingStatus
              ? '正在读取安全连接状态，请稍候。'
              : libraryConnected
              ? playbackConnected ? '片库与播放服务均可使用。' : '片库可以读取，播放认证需要更新。'
              : '认证信息只会加密保存在服务端。' }}
          </p>
        </div>
      </div>

      <template v-if="user.role === 'admin'">
        <div v-if="loadingStatus" class="credential-loading" role="status">
          <span class="status-spinner" aria-hidden="true"></span>
          正在加载认证设置
        </div>

        <button
          v-else-if="libraryConnected && !showCredentialForm"
          type="button"
          class="reconfigure-button"
          @click="showCredentialForm = true"
        >
          更新播放认证
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
            <small class="credential-hint">验证成功后会安全覆盖旧值，当前内容不会回显。</small>
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

      <p v-else class="managed-hint">播放认证由管理员统一维护。如无法读取内容，请联系管理员更新。</p>
      <LibraryMaintenanceStatus />
      <TvPlaybackAuth
        v-if="user.role === 'admin' && !loadingStatus && !statusError"
        :connected="directPlaybackConnected"
        :exchange-origin="tvTokenExchangeOrigin"
        @confirmed="refreshStatus(); emit('auth-updated'); toast.show('直连认证已保存', '✓')"
      />
    </section>

    <section v-if="section === 'appearance'" class="settings-section theme-section" aria-labelledby="theme-title">
      <div class="section-title-row"><div><span>外观</span><h2 id="theme-title">主题颜色</h2></div></div>
      <ThemeSwitch />
    </section>

    <section v-if="section === 'device'" class="settings-section app-section" aria-labelledby="app-title">
      <div class="section-title-row compact">
        <div>
          <span>设备</span>
          <h2 id="app-title">iPhone 桌面版</h2>
        </div>
      </div>
      <a class="settings-row ios-install-link" :href="installUrl">
        <span class="row-icon" aria-hidden="true">
          <Download />
        </span>
        <span class="row-copy"><strong>安装到桌面</strong><small>以独立全屏页面打开烟雨影视</small></span>
        <ChevronRight class="chevron" aria-hidden="true" />
      </a>
    </section>

    <button v-if="section === 'overview'" type="button" class="logout-button" @click="emit('logout')">
      <LogOut aria-hidden="true" />
      退出登录
    </button>
    </div>
  </main>
</template>

<style scoped>
.account-content { display: flex; flex-direction: column; gap: 24px; max-width: 1080px; min-width: 0; margin-inline: auto; }
.page-heading, .heading-copy { display: flex; align-items: center; gap: 13px; }
.page-heading { justify-content: space-between; }
.back-button { display: grid; width: 46px; height: 46px; flex-shrink: 0; place-items: center; border: var(--glass-border); border-radius: 50%; color: var(--text-secondary); background: var(--glass-bg); box-shadow: var(--glass-highlight-inner), var(--glass-shadow-sm); }
.back-button svg { width: 22px; height: 22px; }
.heading-kicker { color: var(--text-tertiary); font-size: .72rem; }
.page-heading h1 { font-size: 1.9rem; line-height: 1.3; font-weight: 780; letter-spacing: -.05em; }
.profile-avatar { width: 64px; height: 64px; flex-shrink: 0; border: 1px solid var(--divider); border-radius: 50%; color: var(--liquid-accent); background: var(--surface-2); }
.profile-card { position: relative; display: flex; align-items: center; gap: 20px; padding: 28px; border: 1px solid var(--divider); border-radius: var(--cinema-radius-panel); background: radial-gradient(ellipse at 100% 0, rgb(var(--accent-rgb) / .08), transparent 70%), var(--surface-1); }
.profile-copy { min-width: 0; flex: 1 1 160px; }
.profile-copy small { display: block; padding-right: 80px; color: var(--liquid-accent); font-size: .73rem; font-weight: 600; }
.profile-copy h2 { margin: 5px 0; overflow-wrap: anywhere; font-size: 1.3rem; font-weight: 750; letter-spacing: -.03em; }
.profile-copy p { color: var(--text-tertiary); font-size: .79rem; }
.folder-chip { position: absolute; top: 24px; right: 24px; max-width: 100%; padding: 8px 12px; overflow: hidden; border-radius: 12px; color: var(--text-secondary); background: var(--glass-bg); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
.account-menu { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.account-menu button { position: relative; display: flex; flex-direction: column; align-items: start; gap: 16px; min-width: 0; min-height: 142px; padding: 24px; border: 1px solid var(--divider); border-radius: var(--cinema-radius-card); color: var(--text-primary); background: var(--surface-1); text-align: left; transition: border-color .2s, background .2s; }
.account-menu-icon { display: grid; place-items: center; width: 42px; height: 42px; flex-shrink: 0; border-radius: 14px; background: var(--liquid-accent-subtle); color: var(--liquid-accent); }
.account-menu-icon svg { width: 22px; height: 22px; }
.account-menu-copy { display: grid; gap: 6px; min-width: 0; }
.account-menu-copy strong { font-size: 15px; font-weight: 650; }
.account-menu-copy small { font-size: 12px; line-height: 1.7; color: var(--text-tertiary); }
.account-menu-arrow { position: absolute; top: 26px; right: 18px; width: 18px; height: 18px; color: var(--text-tertiary); }
.settings-section { padding: 28px; border: 1px solid var(--divider); border-radius: var(--cinema-radius-panel); background: var(--surface-1); }
.section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 17px; }
.section-title-row > div > span { color: var(--text-tertiary); font-size: .71rem; }
.section-title-row h2 { margin-top: 2px; color: var(--text-primary); font-size: 1.08rem; font-weight: 700; letter-spacing: -.025em; }
.history-count { color: var(--text-tertiary); font-size: .73rem; }
.continue-history-section { min-width: 0; }
.continue-history-scroll { display: flex; gap: 12px; overflow-x: auto; padding: 2px 2px 12px; scroll-snap-type: x proximity; }
.continue-history-card { position: relative; width: 220px; height: 148px; flex: 0 0 220px; overflow: hidden; border: 1px solid var(--divider); border-radius: var(--cinema-radius-card); text-align: left; background: #253b5a; scroll-snap-align: start; }
.continue-history-card img { width: 100%; height: 100%; object-fit: cover; object-position: center 28%; }
.continue-history-shade { position: absolute; inset: 0; background: linear-gradient(180deg, transparent, rgb(8 21 44 / .88)); }
.continue-history-copy { position: absolute; right: 13px; bottom: 17px; left: 13px; display: grid; gap: 2px; color: #fff; }
.continue-history-copy strong { overflow: hidden; font-size: .84rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.continue-history-copy small { color: #dde6f6; font-size: .7rem; }
.continue-history-progress { position: absolute; right: 13px; bottom: 9px; left: 13px; height: 3px; overflow: hidden; border-radius: 4px; background: var(--glass-bg); }
.continue-history-progress i { display: block; height: 100%; background: var(--liquid-accent); }
.history-list { display: grid; }
.history-row { display: flex; align-items: center; gap: 8px; border-top: 1px solid rgb(78 105 150 / .09); }
.history-row:first-child { border: 0; }
.history-main { display: flex; align-items: center; min-width: 0; flex: 1; gap: 13px; padding: 12px 0; border: 0; color: var(--text-primary); background: transparent; text-align: left; }
.history-main img { width: 42px; height: 56px; flex-shrink: 0; object-fit: cover; border-radius: 10px; }
.history-copy { display: grid; min-width: 0; flex: 1; gap: 4px; }
.history-copy strong { overflow: hidden; font-size: .87rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.history-copy small { color: var(--text-tertiary); font-size: .72rem; }
.chevron { width: 17px; height: 17px; flex-shrink: 0; color: var(--text-tertiary); }
.history-delete { display: grid; width: 44px; height: 44px; flex-shrink: 0; place-items: center; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; }
.history-delete svg { width: 18px; height: 18px; }
.history-delete:hover { color: var(--danger); background: var(--danger-surface); }
.history-toggle { display: flex; width: 100%; align-items: center; justify-content: center; gap: 5px; min-height: 44px; margin-top: 9px; border: 0; border-radius: 16px; color: var(--liquid-accent); background: var(--glass-bg); font-size: .8rem; }
.history-toggle svg { width: 16px; height: 16px; }
.history-empty { padding: 12px 0; color: var(--text-secondary); font-size: .84rem; line-height: 1.7; }
.status-pill { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; border-radius: 17px; color: var(--text-tertiary); background: var(--surface-2); font-size: .73rem; white-space: nowrap; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.service-summary { display: flex; align-items: center; gap: 13px; padding: 13px 0; }
.service-icon { display: grid; width: 36px; height: 42px; flex-shrink: 0; place-items: center; color: var(--text-secondary); }
.service-icon svg { width: 22px; height: 22px; }
.service-summary strong { font-size: .88rem; font-weight: 650; }
.service-summary p { margin-top: 4px; color: var(--text-tertiary); font-size: .76rem; line-height: 1.6; }
.reconfigure-button, .save-credential, .cancel-edit { display: inline-flex; min-height: 46px; align-items: center; justify-content: center; gap: 8px; padding: 0 17px; border: var(--glass-border); border-radius: 23px; font-size: .83rem; font-weight: 600; }
.reconfigure-button { justify-content: space-between; width: 100%; margin-top: 12px; color: var(--liquid-accent); background: var(--glass-bg); box-shadow: var(--glass-shadow-sm); }
.reconfigure-button svg { width: 17px; height: 17px; }
.credential-form { display: grid; gap: 10px; margin-top: 18px; }
.credential-form label { color: var(--text-secondary); font-size: .8rem; }
.credential-form textarea { width: 100%; min-height: 120px; padding: 13px; border: 1px solid rgb(95 120 166 / .2); border-radius: 17px; color: var(--text-primary); background: var(--glass-bg); font-size: 16px; resize: vertical; }
.credential-hint, .managed-hint { color: var(--text-tertiary); font-size: .73rem; line-height: 1.65; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 3px; }
.save-credential { color: var(--accent-ink); background: var(--liquid-accent); }
.cancel-edit { color: var(--text-secondary); background: var(--surface-elevated); }
.credential-loading { display: flex; align-items: center; gap: 9px; padding: 15px 0; color: var(--text-secondary); font-size: .83rem; }
.button-spinner, .status-spinner { width: 16px; height: 16px; flex-shrink: 0; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
.settings-row { display: flex; align-items: center; gap: 12px; min-height: 64px; color: var(--text-primary); text-decoration: none; }
.row-icon { display: grid; width: 36px; height: 42px; flex-shrink: 0; place-items: center; color: var(--text-secondary); }
.row-icon svg { width: 21px; height: 21px; }
.row-copy { display: grid; min-width: 0; flex: 1; gap: 3px; }
.row-copy strong { font-size: .88rem; font-weight: 650; }
.row-copy small { color: var(--text-tertiary); font-size: .73rem; }
.logout-button { display: flex; width: 100%; min-height: 52px; align-items: center; justify-content: center; gap: 8px; margin-top: 8px; border: 1px solid var(--divider); border-radius: var(--cinema-radius-control); color: var(--danger); background: var(--surface-1); font-size: .9rem; font-weight: 600; }
.logout-button svg { width: 19px; height: 19px; }
:global(html.ios-standalone .app-section) { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (min-width: 1024px) {
  .account-menu { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .logout-button { width: 180px; }
}
@media (min-width: 768px) {
  .theme-section { display: flex; align-items: center; justify-content: space-between; gap: 32px; }
  .theme-section .section-title-row { margin: 0; }
  .theme-section :deep(.theme-switch) { width: min(480px, 65%); }
}
@media (min-width: 1024px) and (max-width: 1279px) { .account-menu { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) {
  .account-content { gap: 24px; }
  .page-heading h1 { font-size: 1.75rem; }
  .profile-card { padding: 22px; gap: 16px; }
  .profile-avatar { width: 52px; height: 52px; }
  .profile-copy { flex-basis: 140px; }
  .folder-chip { top: 18px; right: 18px; }
  .account-menu { gap: 12px; }
  .account-menu button { padding: 18px; gap: 14px; min-height: 148px; }
  .account-menu-arrow { top: 23px; right: 14px; width: 16px; height: 16px; }
  .account-menu-copy strong { font-size: 14px; }
  .account-menu-copy small { font-size: 11px; }
  .settings-section { padding: 22px; }
  .continue-history-card { width: 200px; height: 136px; flex-basis: 200px; }
  .history-main { gap: 10px; }
  .history-main .chevron { display: none; }
}
</style>
