<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { onMounted, onUnmounted, ref } from 'vue';
import { apiUrl } from '../../services/appUrl';

interface MaintenanceItem {
  quarkFid: string;
  title: string;
  message: string;
  status: string;
  lastAction: string;
  lastActionAt: string;
  checkedAt?: string;
  nextCheckAt?: number;
}
interface MaintenanceStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  checkedAt: string;
  message: string;
  items: MaintenanceItem[];
}
const status = ref<MaintenanceStatus | null>(null);
const error = ref('');
const loading = ref(false);
const controller = new AbortController();
let timer: ReturnType<typeof setInterval> | undefined;
const refresh = async () => {
  if (loading.value || controller.signal.aborted) return;
  loading.value = true;
  try {
    const response = await fetch(apiUrl('/api/library-maintenance'), { credentials: 'same-origin', signal: controller.signal });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) throw new Error('status unavailable');
    status.value = payload.data;
    error.value = '';
  } catch {
    if (!controller.signal.aborted) error.value = '暂时无法读取自动追更状态';
  } finally { loading.value = false; }
};
const timeLabel = (value: string | number) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
onMounted(() => {
  void refresh();
  timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
});
onUnmounted(() => { clearInterval(timer); controller.abort(); });
</script>

<template>
  <div class="maintenance">
    <div class="maintenance-heading">
      <strong>自动追更</strong>
      <span>{{ error ? '待重试' : !status ? '读取中' : !status.enabled ? '未启用' : status.running ? '维护中' : '已开启' }}</span>
    </div>
    <p v-if="error" role="status">{{ error }}</p>
    <LoadingSkeleton v-else-if="loading && !status" variant="text" :count="3" label="正在读取维护状态" />
    <template v-else-if="status">
      <small v-if="status.enabled">每 {{ status.intervalMinutes }} 分钟检查</small>
      <small v-else>未运行</small>
      <small v-if="status.checkedAt">上次检查：{{ timeLabel(status.checkedAt) }}</small>
      <small v-else-if="status.enabled">等待首次检查</small>
      <p v-if="status.message" role="status">{{ status.message }}</p>
      <details v-if="status.items.length">
        <summary>查看 {{ status.items.length }} 部影片的维护情况</summary>
        <ul>
          <li v-for="item in status.items" :key="item.quarkFid">
            <strong>{{ item.title }}</strong>
            <p>{{ item.message }}</p>
            <small v-if="item.checkedAt">本片检查：{{ timeLabel(item.checkedAt) }}</small>
            <small v-if="item.status === 'retrying' && item.nextCheckAt">下次自动复查：{{ timeLabel(item.nextCheckAt) }}</small>
            <small v-if="item.lastActionAt">{{ timeLabel(item.lastActionAt) }} · {{ item.lastAction }}</small>
          </li>
        </ul>
      </details>
    </template>
    <button type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新状态' }}</button>
  </div>
</template>

<style scoped>
.maintenance { margin-top:40px; padding-top:28px; border-top:1px solid var(--divider); }.maintenance-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; }.maintenance-heading strong { font-size:1.1rem; font-weight:650; }.maintenance-heading span { color:var(--text-secondary); font-size:.8rem; }
p,small { display:block; margin-top:9px; color:var(--text-tertiary); font-size:.8rem; line-height:1.7; } details { margin-top:16px; color:var(--text-secondary); font-size:.84rem; } summary { display:list-item; min-height:44px; padding:12px 0; cursor:pointer; } ul { max-height:360px; padding:0; overflow:auto; list-style:none; } li { padding:18px 0; border-top:1px solid var(--divider); } li strong { color:var(--text-primary); font-size:.88rem; font-weight:550; } li p { margin-top:5px; }
button { min-height:44px; margin-top:16px; padding:10px 18px; border:1px solid var(--divider); border-radius:4px; color:var(--text-primary); background:none; font-size:.83rem; }
</style>
