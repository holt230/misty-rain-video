<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { ChevronRight, Download, LogOut, ShieldCheck, X } from '@lucide/vue';
import type { AppUser } from '../../services/authService';
import { apiUrl } from '../../services/appUrl';
import UserAvatar from '../common/UserAvatar.vue';

const props = defineProps<{ open: boolean; user: AppUser | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-auth'): void;
  (e: 'logout'): void;
}>();

const installUrl = apiUrl('/install/ios.mobileconfig');
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open) emit('close');
};
onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open && user" class="account-backdrop" role="dialog" aria-modal="true" aria-labelledby="account-title" @click.self="emit('close')">
      <section class="account-sheet">
        <div class="drag-handle" aria-hidden="true"></div>
        <header class="account-heading">
          <UserAvatar class="avatar" :username="user.username" />
          <div>
            <span>{{ user.role === 'admin' ? '管理员' : '片库用户' }}</span>
            <h2 id="account-title">{{ user.username }}</h2>
          </div>
          <button type="button" class="close-button" aria-label="关闭账户菜单" @click="emit('close')">
            <X aria-hidden="true" />
          </button>
        </header>

        <div class="account-actions">
          <button v-if="user.role === 'admin'" type="button" class="action-row" @click="emit('open-auth'); emit('close')">
            <span class="action-icon"><ShieldCheck aria-hidden="true" /></span>
            <span><strong>播放服务</strong><small>配置高清播放凭证</small></span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>

          <a class="action-row" :href="installUrl" @click="emit('close')">
            <span class="action-icon"><Download aria-hidden="true" /></span>
            <span><strong>安装 iPhone 桌面版</strong><small>从桌面全屏打开烟雨影视</small></span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </a>

          <button type="button" class="action-row logout-row" @click="emit('logout'); emit('close')">
            <span class="action-icon"><LogOut aria-hidden="true" /></span>
            <span><strong>退出登录</strong><small>返回账号登录页面</small></span>
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.account-backdrop { position: fixed; inset: 0; z-index: 1800; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(3, 6, 13, 0.74); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
.account-sheet { width: min(420px, 100%); padding: 24px; border: 1px solid rgba(255,255,255,.16); border-radius: 26px; color: #fff; background: rgba(19,24,38,.98); box-shadow: 0 28px 80px rgba(0,0,0,.58), inset 0 1px rgba(255,255,255,.12); }
.drag-handle { display: none; }
.account-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.avatar { flex: 0 0 auto; display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid rgba(255,151,105,.38); border-radius: 50%; }
.account-heading > div:nth-child(2) { min-width: 0; flex: 1; }
.account-heading span { color: var(--text-tertiary); font-size: .72rem; }
.account-heading h2 { margin-top: 2px; overflow: hidden; font-size: 1.1rem; text-overflow: ellipsis; white-space: nowrap; }
.close-button { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid rgba(255,255,255,.12); border-radius: 50%; color: rgba(255,255,255,.68); background: rgba(255,255,255,.055); cursor: pointer; }
.close-button svg { width: 19px; fill: none; stroke: currentColor; stroke-width: 2; }
.account-actions { display: grid; gap: 9px; }
.action-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 9px 12px; border: 1px solid rgba(255,255,255,.11); border-radius: 17px; color: #fff; text-align: left; text-decoration: none; background: rgba(255,255,255,.045); cursor: pointer; touch-action: manipulation; transition: background .2s ease, border-color .2s ease; }
.action-row:hover { border-color: rgba(255,255,255,.22); background: rgba(255,255,255,.085); }
.action-icon { flex: 0 0 auto; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; color: #ff9b72; background: rgba(255,107,53,.1); }
.action-icon svg, .chevron { width: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.action-row > span:nth-child(2) { display: grid; gap: 2px; min-width: 0; flex: 1; }
.action-row strong { font-size: .9rem; }
.action-row small { color: var(--text-tertiary); font-size: .72rem; }
.chevron { width: 17px; color: rgba(255,255,255,.34); }
.logout-row { margin-top: 4px; }
.logout-row .action-icon { color: #ff8d86; background: rgba(239,68,68,.1); }

@media (max-width: 640px) {
  .account-backdrop { align-items: flex-end; padding: 0; }
  .account-sheet { width: 100%; padding: 10px 16px calc(18px + env(safe-area-inset-bottom)); border-radius: 26px 26px 0 0; animation: account-in .24s ease-out; }
  .drag-handle { display: block; width: 42px; height: 5px; margin: 0 auto 16px; border-radius: 999px; background: rgba(255,255,255,.25); }
}
@keyframes account-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .account-sheet { animation: none; } }
</style>
