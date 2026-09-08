import { onBeforeUnmount, watch, type Ref } from 'vue';

const openDialogs: HTMLElement[] = [];
let originalOverflow = '';
let originalRootOverflow = '';
const focusable = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]';

/** 统一弹层的滚动锁定、键盘焦点循环和关闭后焦点恢复。 */
export const useDialog = (element: Ref<HTMLElement | null>, isOpen: () => boolean, close?: () => void) => {
  let active: HTMLElement | null = null;
  let previousFocus: HTMLElement | null = null;
  const release = () => {
    if (!active) return;
    const index = openDialogs.indexOf(active);
    if (index >= 0) openDialogs.splice(index, 1);
    active = null;
    if (!openDialogs.length) {
      document.body.style.overflow = originalOverflow;
      document.documentElement.style.overflow = originalRootOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (!active || openDialogs.at(-1) !== active) return;
    if (event.key === 'Escape' && close) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key !== 'Tab') return;
    const targets = [...active.querySelectorAll<HTMLElement>(focusable)].filter(node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const first = targets[0];
    const last = targets.at(-1);
    if (!first || !last) { event.preventDefault(); active.focus(); return; }
    if (!active.contains(document.activeElement) || document.activeElement === active || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };
  document.addEventListener('keydown', onKeydown, true);
  watch([element, isOpen], ([node, open]) => {
    if (!open || !node) { release(); return; }
    if (active === node) return;
    release();
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!openDialogs.length) {
      originalOverflow = document.body.style.overflow;
      originalRootOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
    active = node;
    openDialogs.push(node);
    node.tabIndex = -1;
    // 不自动聚焦输入框，避免手机一打开弹层就弹出键盘。
    node.focus({ preventScroll: true });
  }, { flush: 'post', immediate: true });
  onBeforeUnmount(() => {
    release();
    document.removeEventListener('keydown', onKeydown, true);
  });
};
