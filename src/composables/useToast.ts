import { ref } from 'vue';

interface ToastItem {
  id: number;
  message: string;
  icon: string;
  duration: number;
}

const toasts = ref<ToastItem[]>([]);
let toastIdCounter = 0;

export function useToast() {
  const show = (message: string, icon = '·', duration = 2500) => {
    const id = ++toastIdCounter;
    toasts.value.push({ id, message, icon, duration });

    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id);
    }, duration);
  };

  return {
    toasts,
    show
  };
}
