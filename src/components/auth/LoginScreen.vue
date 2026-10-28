<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { siteSettings } from '../../services/siteSettings';
import { nextTick, ref, watch } from 'vue';
import { Download, Eye, EyeOff } from '@lucide/vue';
import { apiUrl } from '../../services/appUrl';
import BrandMark from '../common/BrandMark.vue';
import { isAppleTouchDevice } from '../../services/device';

const props = defineProps<{
  checking: boolean;
  submitting: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  (e: 'login', credentials: { username: string; password: string }): void;
}>();

const username = ref(localStorage.getItem('misty_rain_last_username') || '');
const password = ref('');
const showPassword = ref(false);
const usernameInput = ref<HTMLInputElement | null>(null);
const installUrl = apiUrl('/install/ios.mobileconfig');
const isAppleMobile = isAppleTouchDevice(navigator);

watch(() => props.checking, async value => {
  if (value || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  await nextTick();
  usernameInput.value?.focus({ preventScroll: true });
}, { immediate: true });

const submit = () => {
  if (props.submitting || !username.value.trim() || !password.value) return;
  const normalizedUsername = username.value.trim();
  localStorage.setItem('misty_rain_last_username', normalizedUsername);
  emit('login', { username: normalizedUsername, password: password.value });
};
</script>

<template>
  <main class="login-shell" :class="{ 'is-checking': checking }">
    <section class="login-card" :aria-busy="checking || submitting">
      <header class="login-hero">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true">
            <BrandMark />
          </div>
          <div class="brand-copy">
            <strong>{{ siteSettings.name }}</strong>
          </div>
        </div>

        <div class="login-heading">
          <h1>{{ checking ? '正在加载' : '欢迎回来' }}</h1>
          <p v-if="checking">正在恢复登录状态…</p>
        </div>
      </header>

      <LoadingSkeleton v-if="checking" variant="form" :count="3" label="正在检查登录状态" />

      <form v-else class="login-form" @submit.prevent="submit">
        <div class="credential-group">
          <label class="input-shell" for="login-username">
            <span class="field-name">账号</span>
            <input
              id="login-username"
              ref="usernameInput"
              v-model="username"
              name="username"
              type="text"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              enterkeyhint="next"
              placeholder="请输入账号"
              :disabled="submitting"
              required
            />
          </label>

          <label class="input-shell password-shell" for="login-password">
            <span class="field-name">密码</span>
            <input
              id="login-password"
              v-model="password"
              name="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              enterkeyhint="go"
              placeholder="请输入密码"
              :disabled="submitting"
              required
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :aria-pressed="showPassword"
              @click.prevent="showPassword = !showPassword"
            >
              <Eye v-if="!showPassword" aria-hidden="true" />
              <EyeOff v-else aria-hidden="true" />
            </button>
          </label>
        </div>

        <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>

        <button type="submit" class="login-button" :disabled="submitting || !username.trim() || !password">
          <span v-if="submitting" class="button-spinner" aria-hidden="true"></span>
          {{ submitting ? '正在登录…' : '登录' }}
        </button>
      </form>

      <footer v-if="!checking" class="login-footer">
        <a v-if="isAppleMobile" class="ios-install-link" :href="installUrl">
          <Download aria-hidden="true" />
          安装到主屏幕
        </a>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.login-shell { --text-primary:#f5f5f7; --text-secondary:#c7c8ce; --text-tertiary:#a3a5ad; --text-quaternary:#8d9099; --liquid-accent:#fff; --accent-ink:#08090b; --divider:rgb(255 255 255 / .2); position:relative; z-index:1; display:flex; align-items:center; justify-content:center; min-height:var(--app-viewport-height); padding:calc(120px + var(--safe-area-top)) 24px 72px; color:#f5f5f7; background:radial-gradient(ellipse at 70% 0,#202127 0,transparent 55%),#08090b; color-scheme:dark; }
.login-shell::before { content:''; position:absolute; inset:0; pointer-events:none; opacity:.25; background:repeating-linear-gradient(0deg,transparent 0 3px,rgb(255 255 255 / .012) 4px 5px); }
.login-card { position:static; width:min(400px,100%); }
.brand-lockup { position:absolute; top:calc(32px + var(--safe-area-top)); left:var(--content-gutter); display:flex; align-items:center; gap:12px; max-width:calc(100% - 48px); }
.brand-mark { width:36px; height:36px; flex-shrink:0; overflow:hidden; border-radius:7px; }
.brand-copy { min-width:0; }.brand-copy strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:1.25rem; font-weight:750; letter-spacing:-.03em; }
.login-heading { margin-bottom:32px; }.login-heading h1 { color:#fff; font-size:2rem; font-weight:700; letter-spacing:-.035em; line-height:1.25; }.login-heading p { margin-top:12px; color:var(--text-secondary); font-size:.9rem; }
.credential-group { display:grid; gap:16px; }
.input-shell { position:relative; display:grid; grid-template-columns:minmax(0,1fr) auto; align-content:center; gap:4px; min-height:66px; padding:10px 16px; border:1px solid rgb(255 255 255 / .24); border-radius:4px; background:rgb(24 25 29 / .8); }
.input-shell:focus-within { border-color:#fff; box-shadow:0 0 0 1px #fff; }
.field-name { grid-column:1; color:#b4b6bf; font-size:.74rem; }
.input-shell input { grid-column:1; grid-row:2; width:100%; min-width:0; min-height:26px; padding:0; border:0; outline:0; color:#fff; background:transparent; font-size:16px; }
.input-shell input::placeholder { color:#90939e; }
.password-toggle { display:grid; grid-column:2; grid-row:1 / span 2; align-self:center; place-items:center; width:44px; height:44px; margin-right:-8px; padding:0; border:0; border-radius:4px; color:#c7c8ce; background:transparent; }
.password-toggle svg { width:20px; height:20px; }
.login-error { margin-top:16px; color:#ffaaa4; font-size:.84rem; line-height:1.6; }
.login-button { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; min-height:50px; margin-top:24px; padding:12px 20px; border:0; border-radius:4px; color:#08090b; background:#fff; font-size:1rem; font-weight:700; transition:background .16s ease; }
.login-button:hover:not(:disabled) { background:#dedee2; }.login-button:disabled { opacity:.45; }
.login-footer { margin-top:24px; text-align:center; }.login-footer:empty { display:none; }
.ios-install-link { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; color:#c7c8ce; font-size:.82rem; text-decoration:none; }.ios-install-link svg { width:17px; height:17px; }
.login-loader { display:flex; justify-content:flex-start; gap:8px; padding:10px 0 42px; }.login-loader span { width:6px; height:6px; border-radius:50%; background:#fff; animation:pulse 1.2s ease-in-out infinite; }.login-loader span:nth-child(2) { animation-delay:.15s; }.login-loader span:nth-child(3) { animation-delay:.3s; }
.button-spinner { width:17px; height:17px; border:2px solid rgb(0 0 0 / .2); border-top-color:#08090b; border-radius:50%; animation:spin .8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } } @keyframes pulse { 50% { opacity:.25; } }
:global(html.ios-standalone .login-footer) { display:none; }
@media(max-width:640px) { .login-shell { align-items:flex-start; padding:calc(152px + var(--safe-area-top)) 24px 48px; }.brand-lockup { top:calc(24px + var(--safe-area-top)); left:24px; }.login-heading { margin-bottom:28px; } }
@media(max-height:650px) { .login-shell { align-items:flex-start; padding-top:calc(106px + var(--safe-area-top)); }.login-heading { margin-bottom:20px; } }
@media(prefers-reduced-motion:reduce) { .login-loader span,.button-spinner { animation:none; }.login-button { transition:none; } }
</style>
