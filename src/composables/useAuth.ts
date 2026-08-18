import { computed, onMounted, onUnmounted, ref } from 'vue';
import { AUTH_REQUIRED_EVENT, AuthService, type AppUser } from '../services/authService';

export const useAuth = () => {
  const user = ref<AppUser | null>(null);
  const checking = ref(true);
  const loggingIn = ref(false);
  const errorMessage = ref('');
  const authenticated = computed(() => Boolean(user.value));

  const restore = async () => {
    checking.value = true;
    const state = await AuthService.session();
    user.value = state.authenticated ? state.user : null;
    checking.value = false;
  };

  const login = async (credentials: { username: string; password: string }) => {
    if (loggingIn.value) return;
    loggingIn.value = true;
    errorMessage.value = '';
    try {
      const state = await AuthService.login(credentials.username, credentials.password);
      user.value = state.user;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '登录失败，请稍后重试';
    } finally {
      loggingIn.value = false;
    }
  };

  const logout = async () => {
    await AuthService.logout();
    user.value = null;
    errorMessage.value = '';
  };

  const requireLogin = () => {
    user.value = null;
    errorMessage.value = '登录状态已失效，请重新登录';
  };

  onMounted(() => {
    window.addEventListener(AUTH_REQUIRED_EVENT, requireLogin);
    restore();
  });
  onUnmounted(() => window.removeEventListener(AUTH_REQUIRED_EVENT, requireLogin));

  return { user, authenticated, checking, loggingIn, errorMessage, login, logout };
};
