<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { Download, Eye, EyeOff } from '@lucide/vue';
import { apiUrl } from '../../services/appUrl';
import BrandMark from '../common/BrandMark.vue';

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
            <strong>烟雨影视</strong>
            <small>PRIVATE CINEMA</small>
          </div>
        </div>

        <div class="login-heading">
          <span>{{ checking ? '正在连接' : '私人片库' }}</span>
          <h1>{{ checking ? '正在准备片库' : '欢迎回来' }}</h1>
          <p>{{ checking ? '正在恢复登录状态…' : '登录后继续观看你的收藏与播放记录。' }}</p>
        </div>
      </header>

      <div v-if="checking" class="login-loader" role="status" aria-label="正在检查登录状态">
        <span></span><span></span><span></span>
      </div>

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
          {{ submitting ? '正在登录…' : '进入片库' }}
        </button>
      </form>

      <footer v-if="!checking" class="login-footer">
        <a class="ios-install-link" :href="installUrl">
          <Download aria-hidden="true" />
          安装 iPhone 桌面版
        </a>
        <p>仅限已有账户登录</p>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.login-shell {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: var(--app-viewport-height);
  align-items: stretch;
  justify-content: center;
  overflow-y: auto;
  padding: calc(var(--safe-area-top) + 44px) 24px calc(var(--safe-area-bottom) + 24px);
}

.login-card {
  display: flex;
  width: min(380px, 100%);
  min-height: calc(var(--app-viewport-height) - var(--safe-area-top) - var(--safe-area-bottom) - 68px);
  flex-direction: column;
}

.login-shell.is-checking {
  align-items: center;
  overflow: hidden;
  padding-top: calc(var(--safe-area-top) + 24px);
  padding-bottom: calc(var(--safe-area-bottom) + 24px);
}

.login-shell.is-checking .login-card {
  width: min(320px, 100%);
  min-height: 0;
  align-items: center;
}

.login-shell.is-checking .login-hero {
  margin: 0;
}

.login-shell.is-checking .brand-lockup {
  justify-content: center;
}

.login-shell.is-checking .login-heading {
  margin-top: 30px;
  text-align: center;
}

.login-shell.is-checking .login-loader {
  min-height: 0;
  margin-top: 26px;
}

.login-hero {
  margin-bottom: 34px;
}

.brand-lockup { display: flex; align-items: center; gap: 12px; }
.brand-mark {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  background: linear-gradient(145deg, #ff8468, #f05236);
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.26), 0 10px 24px rgba(255, 91, 57, 0.2);
  overflow: hidden;
}

.brand-mark :deep(.brand-mark-image) { border-radius: inherit; }
.brand-copy { display: grid; gap: 1px; }
.brand-copy strong { color: rgba(255, 255, 255, 0.94); font-size: 0.96rem; font-weight: 690; letter-spacing: -0.02em; }
.brand-copy small { color: var(--text-quaternary); font-size: 0.58rem; font-weight: 650; letter-spacing: 0.12em; }
.login-heading { margin-top: 42px; text-align: left; }
.login-heading span { color: var(--liquid-accent); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em; }
.login-heading h1 { margin: 7px 0 8px; color: #fff; font-size: clamp(2.2rem, 9.4vw, 2.55rem); font-weight: 760; line-height: 1.08; letter-spacing: -0.055em; }
.login-heading p { color: var(--text-tertiary); font-size: 0.9rem; line-height: 1.55; }

.login-loader {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.login-loader span { width: 7px; height: 7px; border-radius: 50%; background: var(--liquid-accent); animation: loader-pulse 1s ease-in-out infinite; }
.login-loader span:nth-child(2) { animation-delay: 0.12s; }
.login-loader span:nth-child(3) { animation-delay: 0.24s; }

.login-form,
.credential-group { display: grid; }
.credential-group {
  overflow: hidden;
  padding: 0 16px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.052);
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.035), 0 16px 36px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(22px) saturate(135%);
  -webkit-backdrop-filter: blur(22px) saturate(135%);
}

.input-shell {
  position: relative;
  display: grid;
  min-height: 68px;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  align-content: center;
  padding: 9px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.075);
}

.input-shell:last-child { border-bottom: 0; }
.input-shell::after { content: ''; position: absolute; right: 0; bottom: -1px; left: 0; height: 1px; background: var(--liquid-accent); opacity: 0; transform: scaleX(0); transform-origin: left; transition: opacity 0.2s ease, transform 0.2s ease; }
.input-shell:focus-within::after { opacity: 0.82; transform: scaleX(1); }

.field-name { grid-column: 1; color: var(--text-tertiary); font-size: 0.69rem; font-weight: 620; line-height: 1.35; letter-spacing: 0.02em; }
.input-shell input { grid-row: 2; grid-column: 1; width: 100%; min-width: 0; min-height: 30px; padding: 0; border: 0; outline: 0; color: #fff; background: transparent; font: inherit; font-size: 17px; line-height: 1.4; }
.input-shell input::placeholder { color: rgba(255, 255, 255, 0.28); }
.password-toggle { display: grid; width: 44px; height: 44px; grid-row: 1 / span 2; grid-column: 2; place-items: center; align-self: center; margin-right: -8px; border: 0; border-radius: 50%; color: rgba(255, 255, 255, 0.48); background: transparent; cursor: pointer; touch-action: manipulation; transition: color 0.2s ease, background 0.2s ease; }
.password-toggle:hover { color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.05); }
.password-toggle svg { width: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

.login-error { margin: 11px 4px 0; color: #ffaaa2; font-size: 0.78rem; line-height: 1.45; }
.login-button { display: flex; min-height: 54px; align-items: center; justify-content: center; gap: 9px; margin-top: 16px; border: 0; border-radius: 17px; color: #fff; background: linear-gradient(145deg, #ff7658, #ed5135); box-shadow: 0 10px 28px rgba(255, 83, 52, 0.2); font-size: 0.94rem; font-weight: 700; cursor: pointer; touch-action: manipulation; transition: filter 0.2s ease, transform 0.2s ease, opacity 0.2s ease; }
.login-button:hover { filter: brightness(1.07); }
.login-button:active { transform: scale(0.99); }
.login-button:disabled { opacity: 0.5; cursor: default; }
.button-spinner { width: 17px; height: 17px; border: 2px solid rgba(255, 255, 255, 0.32); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }

.login-footer { margin-top: auto; padding-top: 30px; text-align: center; }
.ios-install-link { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 7px; color: rgba(255, 255, 255, 0.52); font-size: 0.78rem; font-weight: 580; text-decoration: none; }
.ios-install-link:hover { color: rgba(255, 255, 255, 0.76); }
.ios-install-link svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.login-footer p { margin-top: 2px; color: rgba(255, 255, 255, 0.24); font-size: 0.66rem; letter-spacing: 0.02em; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes loader-pulse { 0%, 100% { opacity: 0.28; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-4px); } }

@media (max-width: 480px) {
  .login-shell {
    padding: calc(var(--safe-area-top) + 34px) calc(22px + var(--safe-area-right)) calc(var(--safe-area-bottom) + 18px) calc(22px + var(--safe-area-left));
  }

  .login-card { width: 100%; min-height: calc(var(--app-viewport-height) - var(--safe-area-top) - var(--safe-area-bottom) - 52px); }
  .login-hero { margin-bottom: 30px; }
  :global(html.ios-standalone .ios-install-link) { display: none; }
  :global(html.ios-standalone .login-footer p) { display: none; }
}

@media (max-height: 700px) {
  .login-shell { padding-top: calc(var(--safe-area-top) + 20px); }
  .login-card { min-height: auto; }
  .login-hero { margin-bottom: 22px; }
  .login-heading { margin-top: 24px; }
  .login-heading h1 { font-size: 2rem; }
  .login-footer { margin-top: 18px; padding-top: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .login-loader span,
  .button-spinner { animation: none; }
  .login-button,
  .input-shell::after,
  .password-toggle { transition: none; }
}
</style>

<style scoped>
.login-shell::before {
  content: '';
  position: fixed;
  top: -18vh;
  left: 50%;
  width: min(680px, 120vw);
  height: 52vh;
  pointer-events: none;
  background: radial-gradient(ellipse, rgb(120 139 232 / 0.22), rgb(46 55 108 / 0.08) 48%, transparent 72%);
  filter: blur(28px);
  transform: translateX(-50%);
}

.login-card { position: relative; }
.brand-mark {
  border-color: rgb(235 239 255 / 0.16);
  background: rgb(9 11 18 / 0.92);
  box-shadow: inset 0 1px rgb(255 255 255 / .24), 0 10px 26px var(--liquid-accent-glow);
}
.brand-copy small { color: var(--text-quaternary); }
.login-heading span { color: var(--liquid-accent); }
.login-heading h1 { color: var(--text-primary); }
.login-heading p { color: var(--text-tertiary); }

.credential-group {
  border-color: rgb(239 241 255 / 0.10);
  background: rgb(237 240 255 / 0.04);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.045), 0 18px 42px rgb(0 0 0 / 0.20);
}
.input-shell { border-color: rgb(239 241 255 / 0.075); }
.input-shell::after { background: var(--liquid-accent); }
.field-name { color: var(--text-tertiary); }
.input-shell input::placeholder { color: var(--text-quaternary); }
.password-toggle { color: var(--text-tertiary); }
.password-toggle:hover { color: var(--liquid-accent); background: var(--liquid-accent-muted); }
.login-error { color: #ffaaa3; }

.login-button {
  color: var(--accent-ink);
  background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong));
  box-shadow: 0 12px 30px var(--liquid-accent-glow);
}
.login-button:hover { filter: brightness(1.06) saturate(1.04); }
.ios-install-link { color: var(--text-secondary); }
.ios-install-link:hover { color: var(--liquid-accent); }
.login-footer p { color: var(--text-quaternary); }

@media (max-width: 480px) {
  .login-shell {
    padding: calc(var(--safe-area-top) + 32px) calc(22px + var(--safe-area-right)) calc(var(--safe-area-bottom) + 18px) calc(22px + var(--safe-area-left));
  }
  .login-hero { margin-bottom: 24px; }
  .brand-mark { width: 40px; height: 40px; border-radius: 13px; }
  .brand-copy strong { font-size: 0.94rem; }
  .login-heading { margin-top: 28px; }
  .login-heading h1 { margin-top: 7px; font-size: clamp(2rem, 9vw, 2.35rem); }
  .login-heading p { max-width: 310px; }
  .credential-group { border-radius: 18px; }
  .login-button { border-radius: 16px; }
}
</style>
