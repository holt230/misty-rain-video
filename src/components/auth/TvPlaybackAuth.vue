<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { onBeforeUnmount, ref } from 'vue';
import { QuarkStreamService } from '../../services/quarkStreamService';

defineProps<{ connected: boolean; exchangeOrigin: string }>();
const emit = defineEmits<{ (e: 'confirmed'): void }>();
const expanded = ref(false);
const busy = ref(false);
const qr = ref<{ sessionId: string; qrCode: string; expiresAt: string } | null>(null);
const message = ref('');
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const cancel = () => {
  sequence += 1;
  clearTimeout(timer);
  qr.value = null;
  busy.value = false;
  expanded.value = false;
  message.value = '';
};

const poll = async (generation: number) => {
  const current = qr.value;
  if (!current || generation !== sequence) return;
  if (Date.now() >= Date.parse(current.expiresAt)) {
    qr.value = null;
    message.value = '二维码已过期，请重新生成。';
    return;
  }
  try {
    const result = await QuarkStreamService.pollTvAuthSession(current.sessionId);
    if (generation !== sequence) return;
    if (result.state === 'confirmed') {
      qr.value = null;
      expanded.value = false;
      emit('confirmed');
      return;
    }
    if (result.state === 'expired') {
      qr.value = null;
      message.value = '二维码已过期，请重新生成。';
      return;
    }
    timer = setTimeout(() => void poll(generation), 2500);
  } catch (error) {
    if (generation !== sequence) return;
    qr.value = null;
    message.value = error instanceof Error ? error.message : '认证暂时不可用，请重试。';
  }
};

const start = async () => {
  if (busy.value) return;
  clearTimeout(timer);
  const generation = ++sequence;
  busy.value = true;
  qr.value = null;
  message.value = '';
  try {
    const result = await QuarkStreamService.createTvAuthSession();
    if (generation !== sequence) return;
    qr.value = result;
    timer = setTimeout(() => void poll(generation), 2500);
  } catch (error) {
    if (generation === sequence) message.value = error instanceof Error ? error.message : '无法生成二维码。';
  } finally {
    if (generation === sequence) busy.value = false;
  }
};

onBeforeUnmount(cancel);
</script>

<template>
  <div class="tv-auth">
    <div class="tv-auth-heading"><strong>网盘直连</strong><span>{{ connected ? '已认证' : '未开启' }}</span></div>
    <p>支持的影片使用网盘直连播放。</p>
    <button v-if="!expanded" type="button" @click="expanded = true">{{ connected ? '重新扫码认证' : '扫码开启直连' }}</button>
    <div v-else class="tv-auth-editor">
      <p>认证服务 <strong>{{ exchangeOrigin }}</strong> 会接收本次授权码和后续刷新令牌，不会接收网页 Cookie。</p>
      <template v-if="qr">
        <img :src="qr.qrCode" alt="使用夸克 App 扫描此二维码并确认登录" width="230" height="230" />
        <p role="status">使用夸克 App 扫码确认，5 分钟内有效。</p>
      </template>
      <p v-if="message" class="tv-auth-error" role="alert">{{ message }}</p>
      <LoadingSkeleton v-if="busy && !qr" class="qr-placeholder" variant="cards" :count="1" label="正在生成二维码" />
      <div class="tv-auth-actions">

        <button v-if="!qr" type="button" :disabled="busy" @click="start">{{ busy ? '正在生成…' : '同意并生成二维码' }}</button>
        <button type="button" class="secondary" @click="cancel">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qr-placeholder{width:230px;max-width:100%}.qr-placeholder :deep(.skeleton-cover){aspect-ratio:1}.qr-placeholder :deep(.skeleton-description){display:none}
.tv-auth { margin-top:40px; padding-top:28px; border-top:1px solid var(--divider); }.tv-auth-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; }.tv-auth-heading strong { font-size:1.1rem; font-weight:650; }.tv-auth-heading span { color:var(--text-tertiary); font-size:.8rem; }
.tv-auth p { max-width:680px; margin:12px 0 20px; color:var(--text-secondary); font-size:.84rem; line-height:1.7; overflow-wrap:anywhere; }.tv-auth button { min-height:44px; padding:10px 20px; border:1px solid var(--liquid-accent); border-radius:4px; color:var(--accent-ink); background:var(--liquid-accent); font-size:.85rem; font-weight:600; }.tv-auth button:disabled { opacity:.45; }.tv-auth-actions { display:flex; flex-wrap:wrap; gap:12px; }.tv-auth .secondary { color:var(--text-primary); background:none; border-color:var(--divider); }
.tv-auth-editor img { display:block; width:min(230px,100%); height:auto; padding:12px; border-radius:6px; background:#fff; }.tv-auth .tv-auth-error { color:var(--danger); }
</style>
