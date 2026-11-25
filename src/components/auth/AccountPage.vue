<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Download, LibraryBig, LogOut, Palette, Settings, ShieldCheck, Trash2, UserRound } from '@lucide/vue';
import CinemaStill from '../common/CinemaStill.vue';
import { cinemaBackdrop, cinemaWatchProgress, type CinemaBackdrops } from '../../services/cinemaPresentation';
import type { AppUser } from '../../services/authService';
import { apiUrl } from '../../services/appUrl';
import { QuarkStreamService } from '../../services/quarkStreamService';
import { useToast } from '../../composables/useToast';
import type { PlaybackHistoryEntry } from '../../types/media';
import UserAvatar from '../common/UserAvatar.vue';
import TvPlaybackAuth from './TvPlaybackAuth.vue';
import ThemeSwitch from '../common/ThemeSwitch.vue';
import LibraryMaintenanceStatus from './LibraryMaintenanceStatus.vue';

const props = defineProps<{ user: AppUser; history: PlaybackHistoryEntry[]; libraryCount: number; backdrops?: CinemaBackdrops; historyError?: string; loadingHistory?: boolean; deletingHistoryId?: string }>();
const emit = defineEmits<{
  (e: 'logout'): void;
  (e: 'auth-updated'): void;
  (e: 'play-history', entry: PlaybackHistoryEntry): void;
  (e: 'delete-history', id: string): void;
  (e: 'retry-history'): void;
  (e: 'section-change', section: string): void;
  (e: 'back'): void;
  (e: 'library'): void;
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
const titles = { overview: '我的', settings: '设置', account: '账户', history: '观看历史', playback: '播放与网盘', appearance: '外观设置', device: '桌面安装' };
const section = ref<keyof typeof titles>('overview');
const accountRole = computed(() => props.user.role === 'admin' ? '管理员账户' : '片库账户');
const profileEntry = ref<HTMLButtonElement | null>(null);
const pageTitle = ref<HTMLHeadingElement | null>(null);
const settingsEntry = ref<HTMLButtonElement | null>(null);
const advancedOpen = ref(false);
watch(section, (value, previous) => {
  emit('section-change', value);
  if (value !== 'overview') void nextTick(() => pageTitle.value?.focus({ preventScroll: true }));
  else if (previous === 'account') void nextTick(() => profileEntry.value?.focus({ preventScroll: true }));
  else if (previous === 'settings') void nextTick(() => settingsEntry.value?.focus({ preventScroll: true }));
});
const restoreSection = (value: string) => { section.value = Object.prototype.hasOwnProperty.call(titles, value) ? value as keyof typeof titles : 'overview'; };
const showHistory = () => { section.value = 'history'; historyExpanded.value = true; window.scrollTo({ top: 0 }); };
const openSection = (value: Exclude<keyof typeof titles, 'overview'>) => { section.value = value; window.scrollTo({ top: 0 }); };
const back = () => emit('back');
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
const recentHistory = computed(() => {
  const seen = new Set<string>();
  const items: PlaybackHistoryEntry[] = [];
  for (const entry of props.history) {
    const key = entry.media.quarkFid || entry.media.id;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(entry);
    if (items.length === 5) break;
  }
  return items;
});
const formatHistoryMeta = (entry: PlaybackHistoryEntry) => {
  const episode = entry.media.category === 'movie' ? '正片' : entry.episodeNumber > 0
    ? '第 ' + entry.episodeNumber + (entry.media.category === 'variety' ? ' 期' : ' 集') : entry.episodeTitle || '影片';
  if (entry.completed) return episode + ' · 已看完';
  const progress = cinemaWatchProgress(entry);
  return progress === undefined ? episode : episode + ' · 已看 ' + Math.round(progress) + '%';
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
  if (props.user.role === 'admin') { advancedOpen.value = true; showCredentialForm.value = true; }
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
    <header v-if="section === 'overview'" class="account-intro">
      <h1 class="account-title">我的</h1>
      <button ref="profileEntry" type="button" class="profile-entry" aria-label="查看账户" @click="openSection('account')">
        <UserAvatar class="profile-avatar" :username="user.username" aria-hidden="true" />
        <span class="profile-copy"><small>{{ user.username }}</small><strong aria-hidden="true">我的</strong></span>
      </button>
      <button ref="settingsEntry" class="settings-entry" type="button" @click="openSection('settings')"><Settings aria-hidden="true" />设置</button>
    </header>
    <header v-else class="page-heading">
      <button type="button" class="back-button" aria-label="返回" @click="back"><ChevronLeft aria-hidden="true" /></button>
      <h1 ref="pageTitle" class="cinema-page-title" tabindex="-1">{{ titles[section] }}</h1>
    </header>

    <section v-if="section === 'overview'" class="recent-history" aria-labelledby="recent-history-title">
      <div class="section-title-row">
        <h2 id="recent-history-title">观看历史</h2>
        <button type="button" class="text-link" aria-label="查看全部观看历史" @click="showHistory">全部<ChevronRight aria-hidden="true" /></button>
      </div>
      <div v-if="recentHistory.length" class="recent-history-rail" :class="{ 'has-more': recentHistory.length > 2 }">
        <button v-for="entry in recentHistory" :key="entry.id" type="button" class="recent-history-card" @click="emit('play-history', entry)">
          <CinemaStill :poster="entry.media.poster" :backdrop="cinemaBackdrop(entry.media, backdrops)" :progress="cinemaWatchProgress(entry)" />
          <strong :title="entry.media.title">{{ entry.media.title }}</strong>
          <small>{{ formatHistoryMeta(entry) }}</small>
        </button>
      </div>
      <p v-else class="history-empty">{{ loadingHistory ? '正在读取观看记录…' : historyError ? '暂时无法读取观看历史' : '看过的影片会出现在这里。' }}</p>
    </section>

    <nav v-if="section === 'overview'" class="account-menu account-library" aria-label="片库入口">
      <button type="button" @click="emit('library')"><LibraryBig aria-hidden="true" /><strong>我的片库</strong><small>{{ libraryCount }} 部</small><ChevronRight aria-hidden="true" /></button>
    </nav>

    <nav v-if="section === 'settings'" class="account-menu" aria-label="设置分类">
      <button type="button" @click="openSection('playback')"><ShieldCheck aria-hidden="true" /><strong>播放与网盘</strong><ChevronRight aria-hidden="true" /></button>
      <button type="button" @click="openSection('appearance')"><Palette aria-hidden="true" /><strong>外观设置</strong><ChevronRight aria-hidden="true" /></button>
      <button type="button" class="settings-install" @click="openSection('device')"><Download aria-hidden="true" /><strong>安装到桌面</strong><ChevronRight aria-hidden="true" /></button>
      <button type="button" @click="openSection('account')"><UserRound aria-hidden="true" /><strong>账户</strong><ChevronRight aria-hidden="true" /></button>
    </nav>

    <section v-if="section === 'history'" class="settings-section history-section" aria-labelledby="history-title">
      <div class="section-title-row compact">
        <h2 id="history-title" class="account-title">播放历史</h2>
        <small v-if="!historyError && !loadingHistory" class="history-count">{{ history.length }} 条</small>
      </div>

      <div v-if="historyError" class="inline-feedback" role="alert"><p>{{ historyError }}</p><button type="button" :disabled="loadingHistory" @click="emit('retry-history')">重新加载观看记录</button></div>
      <p v-else-if="loadingHistory && !history.length" class="history-empty" role="status">正在加载观看记录…</p>
      <div v-if="history.length" class="history-list">
        <article v-for="entry in visibleHistory" :key="entry.id" class="history-row">
          <button type="button" class="history-main" @click="emit('play-history', entry)">
<CinemaStill :poster="entry.media.poster" :backdrop="cinemaBackdrop(entry.media, backdrops)" :progress="cinemaWatchProgress(entry)" />
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
          <h2 id="auth-title">网盘连接</h2>
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

      <details v-if="user.role === 'admin'" class="advanced-account" :open="advancedOpen" @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open">
        <summary>管理员高级设置</summary>
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
      <LibraryMaintenanceStatus v-if="advancedOpen && section === 'playback'" />
      <TvPlaybackAuth
        v-if="advancedOpen && section === 'playback' && !loadingStatus && !statusError"
        :connected="directPlaybackConnected"
        :exchange-origin="tvTokenExchangeOrigin"
        @confirmed="refreshStatus(); emit('auth-updated'); toast.show('直连认证已保存', '✓')"
      />
      </details>
      <p v-else-if="!libraryConnected || !playbackConnected" class="managed-hint">网盘连接由管理员管理，无法播放时请联系管理员。</p>
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

    <section v-if="section === 'account'" class="account-session" aria-label="账户信息">
      <div class="profile-row">
        <UserAvatar class="profile-avatar" :username="user.username" aria-hidden="true" />
        <div class="profile-copy">
          <strong>{{ user.username }}</strong>
          <small>{{ accountRole }}</small>
        </div>
      </div>
      <button type="button" class="logout-button" @click="emit('logout')">
        <LogOut aria-hidden="true" />
        退出登录
      </button>
    </section>
    </div>
  </main>
</template>

<style scoped>
.advanced-account { margin-top: 16px; }
.advanced-account > summary { padding: 12px 0; color: var(--text-secondary); cursor: pointer; }
.account-content { display: flex; flex-direction: column; gap: 22px; max-width: 760px; min-width: 0; margin-inline: auto; }
.account-intro { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 64px; }
.account-title { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.page-heading { display: flex; align-items: center; gap: 4px; }
.back-button { display: grid; width: 44px; height: 44px; margin-inline-start: -9px; flex-shrink: 0; place-items: center; border: 0; border-radius: 50%; color: var(--text-primary); background: transparent; }
.back-button svg { width: 20px; height: 20px; }
.page-heading h1 { font-size: 1.55rem; }
.page-heading h1:focus { outline: none; }
.profile-avatar { width: 56px; height: 56px; flex-shrink: 0; border-radius: 50%; color: var(--liquid-accent); background: var(--surface-2); }
.profile-row, .profile-entry { display: flex; align-items: center; gap: 12px; }
.profile-entry { min-width: 0; min-height: 60px; padding: 0; border: 0; border-radius: var(--cinema-radius-control); color: var(--text-primary); background: transparent; text-align: left; }
.profile-copy { display: grid; flex: 1; min-width: 0; gap: 2px; }
.profile-copy strong { overflow-wrap: anywhere; font-size: 1.1rem; font-weight: 700; }
.profile-copy small { overflow: hidden; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; font-size: .76rem; }
.profile-entry .profile-copy strong { font: 700 clamp(28px, 8vw, 38px)/1.13 var(--cinema-serif); letter-spacing: .045em; }
.profile-entry .profile-copy small { color: var(--liquid-accent); letter-spacing: .05em; }
.settings-entry { display: flex; flex-shrink: 0; align-items: center; gap: 5px; min-height: 44px; padding: 0 8px; border: 0; border-radius: var(--cinema-radius-control); color: var(--text-secondary); background: transparent; font-size: 13px; }
.settings-entry svg { width: 17px; height: 17px; color: var(--liquid-accent); }
.account-session { display: grid; gap: 16px; max-width: 460px; }
.account-menu { display: grid; }
.account-menu button { display: flex; align-items: center; gap: 12px; min-height: 54px; padding: 2px 0; border: 0; border-bottom: 1px solid var(--divider); color: var(--text-primary); background: transparent; text-align: left; }
.account-menu button:last-child { border-bottom: 0; }
.account-menu button > svg:first-child { width: 20px; height: 20px; color: var(--liquid-accent); }
.account-menu button > svg:last-child { width: 15px; height: 15px; color: var(--text-tertiary); }
.account-menu strong { flex: 1; min-width: 0; font-size: 14px; font-weight: 640; }
.account-menu small { color: var(--text-tertiary); font-size: 12px; }
.account-library { border-top: 1px solid var(--divider); padding-top: 6px; }
.settings-section { min-width: 0; padding: 0; }
.section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.section-title-row > div > span { color: var(--text-tertiary); font-size: .71rem; }
.section-title-row h2 { color: var(--text-primary); font-size: 1.12rem; font-weight: 700; }
.history-count { color: var(--text-tertiary); font-size: .73rem; }
.recent-history { min-width: 0; }
.recent-history .section-title-row { margin-bottom: 6px; }
.recent-history-rail { display: grid; grid-auto-flow: column; grid-auto-columns: calc((100% - 12px) / 3); gap: 6px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; padding: 2px; margin-inline: -2px; }
.recent-history-rail::-webkit-scrollbar { display: none; }
.recent-history-card { display: grid; align-content: start; gap: 5px; min-width: 0; border: 0; border-radius: var(--cinema-radius-poster); background: transparent; color: var(--text-primary); text-align: left; scroll-snap-align: start; }
.recent-history-card:focus-visible { outline-offset: -2px; }
.recent-history-card strong, .recent-history-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-history-card strong { font-size: 14px; font-weight: 650; }
.recent-history-card small { color: var(--text-secondary); font-size: 11px; }
@media (hover: hover) and (pointer: fine) {
  .settings-entry:hover, .account-menu button:hover { background: var(--glass-bg-hover); }
}
.history-list { display: grid; }
.history-row { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--divider); }
.history-row:first-child { border: 0; }
.history-main { display: flex; align-items: center; min-width: 0; flex: 1; gap: 13px; padding: 12px 0; border: 0; color: var(--text-primary); background: transparent; text-align: left; }
.history-main .cinema-still { width: clamp(76px, 22vw, 108px); }
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
.credential-form textarea { width: 100%; min-height: 120px; padding: 13px; border: 1px solid var(--divider); border-radius: var(--cinema-radius-control); color: var(--text-primary); background: var(--glass-bg); font-size: 16px; resize: vertical; }
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
.logout-button { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 2px; border: 0; border-top: 1px solid var(--divider); color: var(--danger); background: transparent; font-size: 15px; font-weight: 550; text-align: left; }
.logout-button svg { width: 20px; height: 20px; }
.logout-button:focus-visible { outline-offset: -2px; }
.logout-button:active { background: var(--danger-surface); }
:global(html.ios-standalone .app-section), :global(html.ios-standalone .settings-install) { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (min-width: 768px) {
  .theme-section { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .theme-section .section-title-row { margin: 0; }
  .theme-section :deep(.theme-switch) { width: min(440px, 65%); }
}
@media (max-width: 767px) {
  .account-content { gap: 19px; }
  .profile-avatar { width: 53px; height: 53px; }
  .recent-history-rail { grid-auto-columns: calc((100% - 10px) / 2); gap: 10px; }
  .recent-history-rail.has-more { grid-auto-columns: 46%; }
  .history-main { gap: 10px; }
  .history-main .chevron { display: none; }
}
</style>
