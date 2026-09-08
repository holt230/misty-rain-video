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
    <section class="login-card glass-rim" :aria-busy="checking || submitting">
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
.login-shell { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; min-height: var(--app-viewport-height); padding: calc(30px + var(--safe-area-top)) 24px calc(30px + var(--safe-area-bottom)); }
.login-card { position: relative; width: min(420px, 100%); padding: 40px 30px 26px; border: var(--glass-border); border-radius: 38px; background: var(--glass-material); box-shadow: var(--glass-highlight-inner), 0 30px 80px rgb(74 100 155 / .13); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
.brand-lockup { display: flex; align-items: center; gap: 12px; }
.brand-mark { width: 54px; height: 54px; overflow: hidden; border: 1px solid #fff; border-radius: 19px; box-shadow: 0 7px 18px rgb(44 81 157 / .15); }
.brand-mark :deep(.brand-mark-image) { border-radius: inherit; }
.brand-copy { display: grid; gap: 3px; }
.brand-copy strong { font-size: 1.15rem; font-weight: 740; letter-spacing: -.04em; }
.brand-copy small { color: var(--text-tertiary); font-size: .56rem; font-weight: 650; letter-spacing: .18em; }
.login-heading { margin: 38px 0 28px; }
.login-heading > span { color: var(--liquid-accent); font-size: .76rem; font-weight: 600; }
.login-heading h1 { margin: 7px 0 9px; color: #233450; font-size: 2.45rem; font-weight: 780; letter-spacing: -.065em; line-height: 1.15; }
.login-heading p { color: var(--text-secondary); font-size: .87rem; line-height: 1.7; }
.credential-group { padding: 0 16px; border: 1px solid rgb(255 255 255 / .95); border-radius: 23px; background: rgb(255 255 255 / .58); box-shadow: inset 0 1px #fff, 0 3px 12px rgb(65 96 153 / .03); }
.input-shell { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; min-height: 74px; align-content: center; gap: 3px; padding: 10px 0; border-bottom: 1px solid rgb(100 122 161 / .12); }
.input-shell:last-child { border-bottom: 0; }
.field-name { grid-column: 1; font-size: .73rem; color: var(--text-tertiary); }
.input-shell input { width: 100%; min-width: 0; min-height: 30px; grid-column: 1; grid-row: 2; padding: 0; border: 0; outline: 0; color: var(--text-primary); background: transparent; font-size: 17px; }
.input-shell input::placeholder { color: var(--text-quaternary); }
.input-shell:focus-within .field-name { color: var(--liquid-accent); }
.password-toggle { display: grid; width: 44px; height: 44px; grid-column: 2; grid-row: 1 / span 2; align-self: center; place-items: center; margin-right: -6px; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; }
.password-toggle svg { width: 20px; height: 20px; }
.login-error { margin: 12px 0 0; padding: 11px 13px; border-radius: 13px; color: #a12f42; background: #fff0f2; font-size: .83rem; }
.login-button { display: flex; width: 100%; min-height: 54px; align-items: center; justify-content: center; gap: 9px; margin-top: 20px; border: 1px solid rgb(255 255 255 / .7); border-radius: 28px; color: #fff; background: linear-gradient(170deg, #6799ed, #2860c9 52%, #477cd5); box-shadow: inset 0 2px 2px rgb(255 255 255 / .65), inset 0 -2px 2px rgb(18 53 128 / .2), 0 7px 20px rgb(59 110 213 / .2); font-size: .96rem; font-weight: 650; transition: filter .2s; }
.login-button:hover:not(:disabled) { filter: brightness(1.07); }
.login-footer { margin-top: 27px; text-align: center; }
.ios-install-link { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; color: var(--text-secondary); font-size: .78rem; text-decoration: none; }
.ios-install-link svg { width: 16px; height: 16px; }
.login-footer p { color: var(--text-tertiary); font-size: .69rem; }
.login-loader { display: flex; justify-content: center; gap: 7px; padding: 20px; }
.login-loader span { width: 7px; height: 7px; border-radius: 50%; background: var(--liquid-accent); animation: pulse 1s ease-in-out infinite; }
.login-loader span:nth-child(2) { animation-delay: .15s; }
.login-loader span:nth-child(3) { animation-delay: .3s; }
.button-spinner { width: 17px; height: 17px; border: 2px solid rgb(255 255 255 / .4); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 50% { opacity: .25; transform: translateY(-3px); } }
:global(html.ios-standalone .login-footer) { display: none; }
@media (max-width: 480px) { .login-shell { padding-right: 20px; padding-left: 20px; } .login-card { padding: 32px 24px 24px; border-radius: 34px; } .login-heading { margin-top: 32px; } .login-heading h1 { font-size: 2.3rem; } }
@media (max-height: 650px) { .login-shell { align-items: flex-start; } .login-card { padding-top: 24px; } .login-heading { margin: 20px 0; } .login-heading h1 { font-size: 2rem; } .login-footer { margin-top: 16px; } }
</style>
