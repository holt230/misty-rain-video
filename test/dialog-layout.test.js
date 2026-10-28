import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const dom = new JSDOM('<html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const { createApp, defineComponent, h, nextTick, ref } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/dialog-layout-');
const outfile = path.resolve(folder, 'useDialog.mjs');
await build({ entryPoints: ['src/composables/useDialog.ts'], outfile, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { useDialog } = await import(pathToFileURL(outfile));
after(() => { fs.rmSync(folder, { recursive: true, force: true }); dom.window.close(); });

const Dialog = defineComponent({
  props: { open: Boolean, name: String },
  setup(props) {
    const panel = ref(null);
    useDialog(panel, () => props.open);
    return () => props.open ? h('section', { ref: panel, 'data-dialog': props.name }, [h('button', '确定')]) : null;
  }
});

function setup(t, { before = 1435, after = 1440, padding = '', cssPadding = '' } = {}) {
  document.head.innerHTML = cssPadding ? `<style>body { padding-right: ${cssPadding}; }</style>` : '';
  document.body.innerHTML = '<button id="launcher">打开</button><div id="mount"></div>';
  document.body.style.cssText = '';
  document.documentElement.style.cssText = '';
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'scroll';
  document.body.style.paddingRight = padding;
  let reads = 0;
  // JSDOM has no layout engine. These are the two measured browser geometry
  // states, selected by the real composable's document/body overflow changes.
  t.mock.method(document.body, 'getBoundingClientRect', () => {
    reads++;
    const locked = document.body.style.overflow === 'hidden' && document.documentElement.style.overflow === 'hidden';
    return new window.DOMRect(0, 0, locked ? after : before, 1000);
  });
  const first = ref(false), second = ref(false), renderFirst = ref(true);
  const app = createApp({ render: () => h('div', [
    renderFirst.value ? h(Dialog, { open: first.value, name: 'first' }) : null,
    h(Dialog, { open: second.value, name: 'second' })
  ]) });
  app.mount('#mount');
  let mounted = true;
  const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
  t.after(unmount);
  return { first, second, renderFirst, unmount, reads: () => reads };
}

test('classic scrollbar removal preserves content width and restores existing inline padding and overflow', async t => {
  const state = setup(t, { padding: '12px' });
  const launcher = document.querySelector('#launcher'); launcher.focus();
  state.first.value = true; await nextTick();
  assert.equal(document.body.style.paddingRight, '17px');
  assert.equal(document.body.getBoundingClientRect().width - parseFloat(getComputedStyle(document.body).paddingRight), 1435 - 12);
  assert.equal(document.body.style.overflow, 'hidden'); assert.equal(document.documentElement.style.overflow, 'hidden');
  assert.equal(document.activeElement.dataset.dialog, 'first');
  state.first.value = false; await nextTick();
  assert.equal(document.body.style.paddingRight, '12px');
  assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.documentElement.style.overflow, 'scroll');
  assert.equal(document.activeElement, launcher);
});

test('stylesheet padding is included in compensation but no inline padding is left behind on close', async t => {
  const state = setup(t, { cssPadding: '9px' });
  assert.equal(document.body.style.paddingRight, '');
  state.first.value = true; await nextTick(); assert.equal(document.body.style.paddingRight, '14px');
  state.first.value = false; await nextTick();
  assert.equal(document.body.style.paddingRight, ''); assert.equal(getComputedStyle(document.body).paddingRight, '9px');
});

test('nested dialogs measure and compensate once, retaining the lock until the last dialog closes', async t => {
  const state = setup(t, { padding: '8px' });
  state.first.value = true; await nextTick();
  assert.equal(state.reads(), 2); assert.equal(document.body.style.paddingRight, '13px');
  state.second.value = true; await nextTick();
  assert.equal(state.reads(), 2); assert.equal(document.body.style.paddingRight, '13px');
  state.first.value = false; await nextTick();
  assert.equal(document.body.style.overflow, 'hidden'); assert.equal(document.documentElement.style.overflow, 'hidden');
  assert.equal(document.body.style.paddingRight, '13px');
  state.second.value = false; await nextTick();
  assert.equal(document.body.style.paddingRight, '8px');
  assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.documentElement.style.overflow, 'scroll');
});

test('unmounting an active dialog restores padding and overflow even without a close action', async t => {
  const state = setup(t, { padding: '6px' });
  state.first.value = true; await nextTick(); assert.equal(document.body.style.paddingRight, '11px');
  state.unmount();
  assert.equal(document.body.style.paddingRight, '6px');
  assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.documentElement.style.overflow, 'scroll');
});

test('unmounting one nested dialog does not unlock the remaining dialog or lose the original padding', async t => {
  const state = setup(t, { padding: '4px' });
  state.first.value = true; await nextTick(); state.second.value = true; await nextTick();
  state.renderFirst.value = false; await nextTick();
  assert.equal(document.body.style.paddingRight, '9px'); assert.equal(document.body.style.overflow, 'hidden');
  state.unmount();
  assert.equal(document.body.style.paddingRight, '4px');
  assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.documentElement.style.overflow, 'scroll');
});

for (const afterWidth of [1440, 1438]) {
  test(`overlay or non-growing scrollbar geometry (${afterWidth}px) never invents right padding`, async t => {
    const state = setup(t, { before: 1440, after: afterWidth });
    state.first.value = true; await nextTick();
    assert.equal(document.body.style.paddingRight, ''); assert.equal(state.reads(), 2);
    state.first.value = false; await nextTick();
    assert.equal(document.body.style.paddingRight, '');
    assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.documentElement.style.overflow, 'scroll');
  });
}
