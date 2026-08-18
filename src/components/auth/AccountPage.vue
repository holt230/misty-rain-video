<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { ChevronLeft, ChevronRight, Download, LogOut, ShieldCheck, Trash2 } from '@lucide/vue';
import type { AppUser } from '../../services/authService';
import { apiUrl } from '../../services/appUrl';
import { QuarkStreamService } from '../../services/quarkStreamService';
import { useToast } from '../../composables/useToast';
import type { PlaybackHistoryEntry } from '../../types/media';
import UserAvatar from '../common/UserAvatar.vue';

const props = defineProps<{ user: AppUser; history: PlaybackHistoryEntry[] }>();
const emit = defineEmits<{
  (e: 'logout'): void;
  (e: 'auth-updated'): void;
  (e: 'back'): void;
  (e: 'play-history', entry: PlaybackHistoryEntry): void;
  (e: 'delete-history', id: string): void;
}>();

const toast = useToast();
const installUrl = apiUrl('/install/ios.mobileconfig');
const credential = ref('');
const loadingStatus = ref(true);
const libraryConnected = ref(false);
const playbackConnected = ref(false);
const isSaving = ref(false);
const showCredentialForm = ref(false);
const historyExpanded = ref(false);
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
  try {
    const status = await QuarkStreamService.getConfig();
    libraryConnected.value = status.libraryConfigured ?? status.isConfigured;
    playbackConnected.value = status.isAuthenticated;
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
  try {
    const result = await QuarkStreamService.saveConfig(value);
    if (!result.success) {
      toast.show(result.message, '!');
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
  if (loadingStatus.value) await refreshStatus();
  if (props.user.role === 'admin') showCredentialForm.value = true;
  await nextTick();
  authSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const initializeAccount = async () => {
  await refreshStatus();
  if (props.user.role === 'admin' && !libraryConnected.value) showCredentialForm.value = true;
};

onMounted(initializeAccount);
defineExpose({ focusAuth, refreshStatus });
</script>

<template>
  <main class="account-page">
    <header class="page-heading">
      <div class="heading-copy">
        <button type="button" class="back-button" aria-label="返回片库" @click="emit('back')">
          <ChevronLeft aria-hidden="true" />
        </button>
        <div>
        <span class="heading-kicker">个人中心</span>
        <h1>我的</h1>
        </div>
      </div>
      <UserAvatar class="profile-avatar" :username="user.username" />
    </header>

    <section class="profile-card" aria-labelledby="profile-title">
      <div class="profile-copy">
        <small>{{ user.role === 'admin' ? '管理员账户' : '片库账户' }}</small>
        <h2 id="profile-title">{{ user.username }}</h2>
        <p>你的影视内容保存在独立的个人片库目录中。</p>
      </div>
      <span class="folder-chip">{{ user.folder }}</span>
    </section>

    <section v-if="continueHistory.length" class="continue-history-section" aria-labelledby="continue-history-title">
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
          <img :src="entry.media.poster" :alt="`${entry.media.title}封面`" loading="lazy" decoding="async" />
          <span class="continue-history-shade" aria-hidden="true"></span>
          <span class="continue-history-copy">
            <strong>{{ entry.media.title }}</strong>
            <small>{{ entry.episodeNumber > 0 ? `第 ${entry.episodeNumber} 集` : (entry.episodeTitle || '继续播放') }}</small>
          </span>
          <span class="continue-history-progress" aria-hidden="true"><i :style="{ width: `${historyProgress(entry)}%` }"></i></span>
        </button>
      </div>
    </section>

    <section class="settings-section history-section" aria-labelledby="history-title">
      <div class="section-title-row compact">
        <div>
          <span>观看记录</span>
          <h2 id="history-title">播放历史</h2>
        </div>
        <small class="history-count">{{ history.length }} 条</small>
      </div>

      <div v-if="history.length" class="history-list">
        <article v-for="entry in visibleHistory" :key="entry.id" class="history-row">
          <button type="button" class="history-main" @click="emit('play-history', entry)">
            <img :src="entry.media.poster" :alt="`${entry.media.title}封面`" loading="lazy" decoding="async" />
            <span class="history-copy">
              <strong>{{ entry.media.title }}</strong>
              <small>{{ formatHistoryMeta(entry) }}</small>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="history-delete"
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
      <p v-else class="history-empty">开始播放影片后，这里会同步保存观看进度。</p>
    </section>

    <section ref="authSection" class="settings-section auth-section" aria-labelledby="auth-title">
      <div class="section-title-row">
        <div>
          <span>设置</span>
          <h2 id="auth-title">播放与片库</h2>
        </div>
        <div class="status-pill" :class="{ ready: libraryConnected }">
          <span class="status-dot" aria-hidden="true"></span>
          {{ loadingStatus ? '检查中' : (libraryConnected ? '已连接' : '待配置') }}
        </div>
      </div>

      <div class="service-summary">
        <div class="service-icon" aria-hidden="true">
          <ShieldCheck />
        </div>
        <div>
          <strong>{{ loadingStatus ? '正在检查服务状态' : (libraryConnected && playbackConnected ? '片库与播放服务已连接' : (libraryConnected ? '片库服务已连接' : '连接个人片库')) }}</strong>
          <p>
            {{ loadingStatus
              ? '正在读取安全连接状态，请稍候。'
              : libraryConnected
              ? '可扫描片库并直接播放，更新时会再次验证写入会话。'
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

        <div v-else class="credential-editor">
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
            ></textarea>
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
    </section>

    <section class="settings-section app-section" aria-labelledby="app-title">
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

    <button type="button" class="logout-button" @click="emit('logout')">
      <LogOut aria-hidden="true" />
      退出登录
    </button>
  </main>
</template>

<style scoped>
.account-page {
  position: relative;
  z-index: 1;
  width: min(760px, 100%);
  margin: 0 auto;
  padding: calc(40px + var(--safe-area-top)) 18px calc(112px + var(--safe-area-bottom));
}
.page-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.heading-copy { display: flex; align-items: center; gap: 12px; }
.back-button { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid rgba(255, 255, 255, 0.075); border-radius: 50%; color: var(--text-secondary); background: rgba(255, 255, 255, 0.045); cursor: pointer; }
.back-button svg { width: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.heading-kicker,
.section-title-row span { color: var(--liquid-accent); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; }
.page-heading h1 { margin-top: 2px; font-size: 2rem; font-weight: 760; letter-spacing: -0.045em; }
.profile-avatar { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; color: var(--accent-ink); background: var(--liquid-accent); font-weight: 800; box-shadow: 0 9px 22px var(--liquid-accent-glow); }
.profile-card,
.settings-section {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.028);
}
.profile-card { display: flex; align-items: center; gap: 16px; padding: 20px; }
.profile-copy { min-width: 0; flex: 1; }
.profile-copy small { color: var(--text-tertiary); }
.profile-copy h2 { margin-top: 2px; font-size: 1.12rem; }
.profile-copy p { margin-top: 5px; color: var(--text-tertiary); font-size: 0.8rem; }
.folder-chip { max-width: 42%; padding: 5px 10px; overflow: hidden; border-radius: 999px; color: var(--text-secondary); background: rgba(255, 255, 255, 0.055); font-size: 0.72rem; text-overflow: ellipsis; white-space: nowrap; }
.settings-section { margin-top: 16px; padding: 20px; scroll-margin-top: 18px; }
.section-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.section-title-row h2 { margin-top: 3px; font-size: 1.12rem; letter-spacing: -0.02em; }
.status-pill { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; border-radius: 999px; color: var(--text-tertiary); background: rgba(255, 255, 255, 0.055); font-size: 0.72rem; font-weight: 650; white-space: nowrap; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #85858d; }
.status-pill.ready { color: var(--success); background: var(--success-subtle); }
.status-pill.ready .status-dot { background: var(--success); box-shadow: 0 0 0 3px rgb(var(--success-rgb) / 0.12); }
.service-summary { display: flex; gap: 12px; margin-top: 18px; padding: 14px 0 0; border-top: 1px solid rgba(255, 255, 255, 0.055); border-radius: 0; background: transparent; }
.service-icon { flex: 0 0 auto; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 13px; color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.service-icon svg,
.row-icon svg,
.chevron,
.logout-button svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.service-icon svg { width: 22px; }
.service-summary strong { font-size: 0.9rem; }
.service-summary p { margin-top: 3px; color: var(--text-tertiary); font-size: 0.75rem; line-height: 1.5; }
.reconfigure-button { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 48px; margin-top: 14px; padding: 0 14px; border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 14px; color: var(--text-primary); background: rgba(255, 255, 255, 0.035); font-size: 0.86rem; font-weight: 650; cursor: pointer; }
.credential-loading { display: flex; align-items: center; gap: 9px; min-height: 48px; margin-top: 14px; padding: 0 14px; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 14px; color: var(--text-tertiary); background: rgba(255, 255, 255, 0.025); font-size: 0.82rem; }
.status-spinner { width: 15px; height: 15px; border: 2px solid rgba(255, 255, 255, 0.15); border-top-color: var(--liquid-accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
.reconfigure-button svg { width: 17px; fill: none; stroke: var(--text-tertiary); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.credential-editor { margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.07); }
.credential-form { display: grid; }
.credential-form label { margin: 0 2px 7px; color: var(--text-secondary); font-size: 0.78rem; font-weight: 600; }
.credential-form textarea { width: 100%; min-height: 112px; padding: 12px 13px; resize: vertical; border: 1px solid rgba(255, 255, 255, 0.075); border-radius: 14px; outline: 0; color: #fff; background: rgba(255, 255, 255, 0.045); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 16px; line-height: 1.5; }
.credential-form textarea:focus { border-color: rgb(var(--accent-rgb) / 0.42); box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 0.10); }
.credential-form textarea::placeholder { color: var(--text-quaternary); }
.credential-hint { margin: 7px 2px 0; color: var(--text-tertiary); font-size: .7rem; line-height: 1.5; }
.form-actions { display: flex; gap: 8px; margin-top: 10px; }
.credential-form .form-actions button { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; margin: 0; border-radius: 14px; font-weight: 700; cursor: pointer; }
.cancel-edit { flex: 0 0 92px; border: 1px solid rgba(255, 255, 255, 0.075); color: var(--text-secondary); background: rgba(255, 255, 255, 0.045); }
.save-credential { flex: 1; border: 0; color: #fff; background: var(--liquid-accent); }
.credential-form button:disabled { opacity: 0.48; cursor: default; }
.button-spinner { width: 16px; height: 16px; border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff; border-radius: 50%; animation: spin 0.75s linear infinite; }
.managed-hint { margin-top: 14px; color: var(--text-tertiary); font-size: 0.8rem; line-height: 1.6; }
.continue-history-section { margin-top: 18px; }
.continue-history-scroll { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(210px, 42%); gap: 10px; overflow-x: auto; padding-bottom: 3px; scrollbar-width: none; scroll-snap-type: x proximity; }
.continue-history-scroll::-webkit-scrollbar { display: none; }
.continue-history-card { position: relative; aspect-ratio: 16 / 9; overflow: hidden; border: 0; border-radius: 14px; color: #fff; background: var(--surface-2); text-align: left; cursor: pointer; scroll-snap-align: start; }
.continue-history-card img { width: 100%; height: 100%; object-fit: cover; }
.continue-history-shade { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 25%, rgba(0,0,0,.82)); }
.continue-history-copy { position: absolute; right: 10px; bottom: 11px; left: 10px; display: grid; min-width: 0; }
.continue-history-copy strong { overflow: hidden; font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
.continue-history-copy small { color: rgba(255,255,255,.62); font-size: .67rem; }
.continue-history-progress { position: absolute; right: 7px; bottom: 5px; left: 7px; height: 3px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.2); }
.continue-history-progress i { display: block; height: 100%; border-radius: inherit; background: var(--liquid-accent); }
.section-title-row.compact { margin-bottom: 14px; }
.history-count { align-self: center; color: var(--text-tertiary); font-size: .72rem; }
.history-list { display: grid; gap: 0; }
.history-row { display: flex; align-items: stretch; overflow: hidden; border: 0; border-top: 1px solid rgba(255,255,255,.055); border-radius: 0; background: transparent; }
.history-row:first-child { border-top: 0; }
.history-main { display: flex; align-items: center; min-width: 0; min-height: 68px; flex: 1; gap: 11px; padding: 8px 7px 8px 8px; border: 0; color: #fff; background: transparent; text-align: left; cursor: pointer; }
.history-main img { width: 44px; height: 52px; flex: 0 0 auto; border-radius: 8px; object-fit: cover; background: var(--surface-2); }
.history-copy { display: grid; min-width: 0; flex: 1; }
.history-copy strong { overflow: hidden; font-size: .86rem; text-overflow: ellipsis; white-space: nowrap; }
.history-copy small { margin-top: 3px; color: var(--text-tertiary); font-size: .7rem; }
.history-delete { display: grid; place-items: center; width: 48px; flex: 0 0 auto; border: 0; color: rgba(255,98,89,.72); background: transparent; cursor: pointer; }
.history-delete svg { width: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.history-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 48px; margin-top: 5px; padding: 0 10px; border: 0; border-top: 1px solid rgba(255,255,255,.055); color: var(--text-secondary); background: transparent; font-size: .78rem; cursor: pointer; }
.history-toggle svg { width: 17px; color: var(--text-quaternary); transition: transform .2s ease; }
.history-toggle[aria-expanded='true'] svg { transform: rotate(-90deg); }
.history-empty { padding: 16px 2px 4px; color: var(--text-tertiary); font-size: .78rem; line-height: 1.55; }
.settings-row { display: flex; align-items: center; gap: 12px; min-height: 62px; padding: 10px 12px; border: 1px solid rgba(255, 255, 255, 0.065); border-radius: 15px; color: #fff; text-decoration: none; background: rgba(255, 255, 255, 0.03); }
.row-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.row-icon svg { width: 20px; }
.row-copy { display: grid; min-width: 0; flex: 1; }
.row-copy strong { font-size: 0.88rem; }
.row-copy small { color: var(--text-tertiary); font-size: 0.72rem; }
.chevron { width: 17px; color: var(--text-quaternary); }
.logout-button { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 50px; margin-top: 16px; border: 1px solid rgba(255, 98, 89, 0.15); border-radius: 16px; color: #ff8b84; background: rgba(255, 98, 89, 0.07); font-weight: 650; cursor: pointer; }
.logout-button svg { width: 20px; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .account-page { padding: calc(16px + var(--safe-area-top)) calc(var(--mobile-gutter) + var(--safe-area-right)) var(--mobile-content-bottom) calc(var(--mobile-gutter) + var(--safe-area-left)); }
  .page-heading { margin-bottom: 20px; }
  .page-heading h1 { margin-top: 0; font-size: 1.52rem; }
  .heading-kicker { display: none; }
  .profile-avatar { width: 38px; height: 38px; box-shadow: none; font-size: .8rem; }
  .back-button { display: none; }
  .profile-card,
  .settings-section { border-radius: 17px; }
  .profile-card { align-items: flex-start; gap: 10px; padding: 14px; }
  .profile-copy p { margin-top: 3px; line-height: 1.45; }
  .folder-chip { max-width: 34%; padding: 4px 8px; }
  .settings-section { margin-top: 14px; padding: 16px; }
  .continue-history-section { margin-top: 18px; }
  .continue-history-scroll { grid-auto-columns: 72%; margin-right: calc(-1 * (var(--mobile-gutter) + var(--safe-area-right))); padding-right: calc(var(--mobile-gutter) + var(--safe-area-right)); }
  .section-title-row h2 { margin-top: 1px; font-size: 1.04rem; }
  .section-title-row span { font-size: 0.68rem; }
  .status-pill { min-height: 28px; padding: 0 9px; }
  .service-summary { margin-top: 13px; padding: 12px; border-radius: 14px; }
  .service-icon { width: 38px; height: 38px; border-radius: 12px; }
  .credential-form textarea { min-height: 104px; }
  .credential-form:focus-within { padding-bottom: 12px; }
  .logout-button { min-height: 48px; margin-top: 12px; border-radius: 14px; }
}

@media (max-width: 370px) {
  .profile-card { display: block; }
  .folder-chip { display: inline-flex; max-width: 100%; margin-top: 10px; }
  .section-title-row { gap: 8px; }
  .status-pill { padding: 0 8px; }
}

:global(html.ios-standalone .ios-install-link) { display: none; }
:global(html.ios-standalone .app-section) { display: none; }
@media (prefers-reduced-motion: reduce) { .button-spinner, .status-spinner { animation-duration: 1.8s; } }
</style>

<style scoped>
.account-page { max-width: 780px; }
.heading-kicker,
.section-title-row span { color: var(--liquid-accent); }
.page-heading h1 { color: rgba(250, 255, 252, 0.98); }
.back-button {
  border-color: rgb(239 241 255 / 0.09);
  color: var(--text-secondary);
  background: rgb(237 240 255 / 0.04);
}
.profile-avatar { color: var(--accent-ink); background: var(--liquid-accent); box-shadow: 0 9px 24px var(--liquid-accent-glow); }

.profile-card,
.settings-section {
  border-color: rgb(239 241 255 / 0.08);
  background: rgb(237 240 255 / 0.028);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.04);
}

.profile-card {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(70% 160% at 100% 110%, rgb(var(--accent-rgb) / 0.15), transparent 70%),
    rgb(237 240 255 / 0.035);
}
.profile-card::after { content: ''; position: absolute; right: -48px; bottom: -78px; width: 170px; height: 170px; border: 1px solid rgb(var(--accent-rgb) / 0.10); border-radius: 50%; box-shadow: 0 0 54px rgb(var(--accent-rgb) / .06), inset 0 0 38px rgb(var(--accent-rgb) / .04); pointer-events: none; }
.profile-copy,
.folder-chip { position: relative; z-index: 1; }
.folder-chip { color: var(--text-secondary); background: var(--liquid-accent-muted); }

.status-pill { background: rgb(237 240 255 / 0.045); }
.status-pill.ready { color: var(--success); background: var(--success-subtle); }
.status-pill.ready .status-dot { background: var(--success); box-shadow: 0 0 0 3px rgb(var(--success-rgb) / 0.12), 0 0 13px rgb(var(--success-rgb) / 0.20); }
.service-summary { border-color: rgb(239 241 255 / 0.07); }
.service-icon,
.row-icon { color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.reconfigure-button,
.credential-loading,
.settings-row { border-color: rgb(239 241 255 / 0.08); background: rgb(237 240 255 / 0.035); }
.reconfigure-button:hover,
.settings-row:hover { border-color: rgb(var(--accent-rgb) / 0.20); background: var(--liquid-accent-muted); }
.status-spinner { border-top-color: var(--liquid-accent); }
.credential-editor,
.history-row,
.history-toggle { border-color: rgb(239 241 255 / 0.065); }
.credential-form textarea { border-color: rgb(239 241 255 / 0.08); background: rgb(237 240 255 / 0.035); }
.credential-form textarea:focus { border-color: rgb(var(--accent-rgb) / 0.42); box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 0.10); }
.cancel-edit { border-color: rgb(239 241 255 / 0.08); background: rgb(237 240 255 / 0.035); }
.save-credential { color: var(--accent-ink); background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong)); }

.continue-history-card { border: 1px solid rgb(239 241 255 / 0.08); box-shadow: 0 10px 26px rgb(0 0 0 / 0.2); }
.continue-history-progress i { background: var(--liquid-accent); box-shadow: 0 0 8px var(--liquid-accent-glow); }
.history-main img { border: 1px solid rgb(239 241 255 / 0.08); }
.history-main:hover { background: var(--liquid-accent-muted); }
.logout-button { border-color: rgba(255, 98, 89, 0.14); background: rgba(255, 98, 89, 0.055); }

@media (max-width: 640px) {
  .account-page { padding-top: calc(18px + var(--safe-area-top)); }
  .page-heading { min-height: 46px; margin-bottom: 16px; }
  .page-heading h1 { font-size: 1.36rem; }
  .profile-card,
  .settings-section { border-radius: 18px; }
  .profile-card { padding: 16px; }
  .settings-section { padding: 16px; }
  .profile-avatar { width: 42px; height: 42px; }
  .continue-history-card { border-radius: 16px; }
  .service-summary {
    margin-top: 14px;
    padding: 14px 2px 0;
    border-radius: 0;
    background: transparent;
  }
  .reconfigure-button {
    min-height: 52px;
    margin-top: 13px;
    padding: 0 2px;
    border: 0;
    border-top: 1px solid rgb(239 241 255 / 0.065);
    border-radius: 0;
    background: transparent;
  }
  .settings-row {
    min-height: 58px;
    padding: 10px 2px 0;
    border: 0;
    border-top: 1px solid rgb(239 241 255 / 0.065);
    border-radius: 0;
    background: transparent;
  }
  .logout-button { margin-top: 18px; }
}
</style>
