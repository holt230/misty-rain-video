<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ListVideo, Settings2, PictureInPicture2, ChevronDown, ChevronLeft, Maximize, Lock, LockOpen, X } from '@lucide/vue';
import DanmakuModeIcon from './DanmakuModeIcon.vue';
import { createDirectPlayer } from '../../services/xgplayerAdapter';
import { useDialog } from '../../composables/useDialog';
import type { PlaybackSource } from '../../services/quarkStreamService';
import 'xgplayer/dist/index.min.css';

const props = defineProps<{
  video: HTMLVideoElement; ready: boolean; expanded: boolean; nativeFullscreen: boolean;
  allowNativeFullscreen?: boolean; subtitleLabel?: string;
  rotation?:0|90; danmakuMode?:'off'|'low'|'normal'; danmakuAvailable?:boolean; danmakuSummary?:string; danmakuPage?:'settings'|'search'|'episodes';
  pictureMode: 'contain' | 'cover' | 'crop'; sources: PlaybackSource[]; selectedSourceId: string;
}>();
const emit = defineEmits<{
  (event: 'fullscreen'): void;
  (event: 'native-fullscreen'): void;
  (event: 'cycle-danmaku'): void;
  (event: 'back-danmaku'): void;
  (event: 'panel-change', open:boolean): void;
  (event: 'lock-change', locked:boolean): void;
  (event: 'quality', source: PlaybackSource): void;
  (event: 'picture-mode', mode: 'contain' | 'cover' | 'crop'): void;
  (event: 'inset', pixels: number): void;
}>();
const tools = shallowRef<HTMLElement>();
const stage = shallowRef<HTMLElement>();
const overlayHost = shallowRef<HTMLElement>();
type PlayerMenu = 'episodes' | 'settings' | 'quality' | 'speed' | 'subtitles' | 'danmaku';
const menu = ref<PlayerMenu | null>(null);
const menuTitle=computed(()=>({episodes:'选集与片源',settings:'播放设置',quality:'画质',speed:'倍速',subtitles:'字幕',danmaku:props.danmakuPage==='search'?'匹配弹幕':props.danmakuPage==='episodes'?'集数与来源':'弹幕'}[menu.value||'settings']));
const locked=ref(false);
const lockVisible=ref(false);
let lockTimer: ReturnType<typeof setTimeout> | undefined;
const revealLock=()=>{if(!locked.value)return;lockVisible.value=true;clearTimeout(lockTimer);lockTimer=setTimeout(()=>{lockVisible.value=false;},2200);};
const danmakuLabel=computed(()=>props.danmakuMode==='normal'?'海量弹幕':props.danmakuMode==='low'?'少量弹幕':'关闭弹幕');
const panel = ref<HTMLElement | null>(null);
const buttons = ref<HTMLElement>();
const feedback = ref('');
const canPip = ref(false);
const preferencesOpen = ref(false);
const rate = ref(1);
const speeds = [.5, .75, 1, 1.25, 1.5, 2];
const pictureModes = [{ value: 'contain', label: '适应' }, { value: 'cover', label: '铺满' }, { value: 'crop', label: '裁切' }] as const;
const directSources = computed(() => props.sources.filter(source => source.delivery === 'direct'));
const qualityLabel = (source: PlaybackSource) => source.resolution === 'original' ? '原画' : source.label;
let adapter: ReturnType<typeof createDirectPlayer> | undefined;
let release = () => {};
let timer: ReturnType<typeof setTimeout> | undefined;
let trigger: HTMLElement | null = null;
const tell = (message: string) => { feedback.value = message; clearTimeout(timer); timer = setTimeout(() => { feedback.value = ''; }, 1400); };
const closeMenu = (restoreFocus = true) => { menu.value = null; if (restoreFocus) trigger?.focus({ preventScroll: true }); };
const toggleMenu = (value: PlayerMenu, event: MouseEvent) => {
  if(locked.value)return;
  trigger = event.currentTarget as HTMLElement;
  menu.value = menu.value === value ? null : value;
};
const changeQuality = (source: PlaybackSource) => {
  if (source.id !== props.selectedSourceId) emit('quality', source);
  closeMenu();
};
const changeRate = (value: number) => {
  if (adapter && speeds.includes(value)) adapter.player.playbackRate = value;
  closeMenu();
};
const measure = () => {
  const root=stage.value,controls=root?.querySelector<HTMLElement>('.xgplayer-controls');
  emit('inset',props.nativeFullscreen || locked.value || !menu.value && root?.classList.contains('xgplayer-inactive') ? 0 : Math.max(56,root&&controls?root.clientHeight-controls.offsetTop+8:0));
};
const cycleDanmaku=()=>{emit('cycle-danmaku');void nextTick(()=>tell(danmakuLabel.value));};
const toggleLock=()=>{locked.value=!locked.value;};
watch(() => props.video, video => {
  release(); adapter?.destroy(); menu.value = null;
  const root = video.parentElement!;
  stage.value = root; overlayHost.value = root.parentElement!;
  adapter = createDirectPlayer(root, video, { fullscreen: () => emit('fullscreen'), feedback: tell });
  adapter.setRotation(props.rotation||0);adapter.setLocked(locked.value);
  tools.value = adapter.tools; canPip.value = adapter.canPip;
  const syncRate = () => { rate.value = video.playbackRate; };
  const outside = (event: PointerEvent) => { if (!panel.value?.contains(event.target as Node) && !buttons.value?.contains(event.target as Node)) closeMenu(false); };
  document.addEventListener('pointerdown', outside);
  video.addEventListener('ratechange', syncRate);
  root.addEventListener('pointerup',revealLock);
  adapter.player.on('focus', measure); adapter.player.on('blur', measure);
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(root);
  syncRate(); measure();
  release = () => { root.removeEventListener('pointerup',revealLock);observer?.disconnect();document.removeEventListener('pointerdown', outside); video.removeEventListener('ratechange', syncRate); };
}, { immediate: true, flush: 'post' });
watch([() => props.ready, () => props.nativeFullscreen, stage], () => {
  stage.value?.classList.toggle('misty-controls-disabled', !props.ready || props.nativeFullscreen);
}, { immediate: true });
watch([() => props.expanded, () => props.nativeFullscreen, () => props.ready, tools], () => { menu.value = null; adapter?.setFullscreen(props.expanded || props.nativeFullscreen); }, { immediate: true });
watch(()=>props.rotation,value=>{adapter?.setRotation(value||0);void nextTick(measure);});
watch([()=>props.expanded,()=>props.nativeFullscreen],()=>{if(!props.expanded||props.nativeFullscreen)locked.value=false;});
watch(locked,value=>{emit('lock-change',value);clearTimeout(lockTimer);lockVisible.value=false;if(value){closeMenu(false);revealLock();}adapter?.setLocked(value);if(!value)adapter?.player.focus();measure();},{flush:'sync'});
watch(menu, value => {
  emit('panel-change',Boolean(value));
  if (value) {
    adapter?.player.controls?.pauseAutoHide();
  } else { adapter?.player.controls?.recoverAutoHide(); preferencesOpen.value = false; }
  measure();
});
useDialog(panel, () => Boolean(menu.value), () => closeMenu());
onBeforeUnmount(() => { release(); adapter?.destroy(); clearTimeout(timer);clearTimeout(lockTimer);emit('lock-change',false); emit('inset', 0);emit('panel-change',false); });
</script>
<template>
  <Teleport v-if="tools" :to="tools">
    <div ref="buttons" class="business-buttons">
      <button type="button" class="quick-setting quick-rate" aria-label="快捷倍速" :aria-expanded="menu==='speed'" @click="toggleMenu('speed',$event)">{{ rate }}×</button>
      <button v-if="directSources.length > 1" type="button" class="quick-setting" aria-label="快捷画质" :aria-expanded="menu==='quality'" @click="toggleMenu('quality',$event)">画质</button>
      <button class="quick-danmaku" type="button" :aria-label="`弹幕：${danmakuLabel}，点击切换`" :title="danmakuLabel" :data-mode="danmakuMode||'off'" :disabled="!ready||!danmakuAvailable" @click="cycleDanmaku"><DanmakuModeIcon :mode="danmakuMode||'off'"/></button>
      <button v-if="expanded" type="button" aria-label="选集与片源" :aria-expanded="menu === 'episodes'" aria-controls="player-options-panel" @click="toggleMenu('episodes', $event)"><ListVideo /></button>
      <button type="button" aria-label="播放设置" :aria-expanded="menu === 'settings'" aria-controls="player-options-panel" @click="toggleMenu('settings', $event)"><Settings2 /></button>
    </div>
  </Teleport>
  <Teleport v-if="stage" :to="stage"><span v-if="feedback" class="xg-gesture-feedback" role="status">{{ feedback }}</span><button v-if="expanded&&!nativeFullscreen" class="player-lock" :class="{'is-locked':locked,'lock-visible':lockVisible}" type="button" :aria-label="locked?'解锁屏幕':'锁定屏幕'" :title="locked?'解锁屏幕':'锁定屏幕'" :aria-pressed="locked" @pointerdown.stop @touchstart.stop @touchend.stop @click.stop="toggleLock"><Lock v-if="locked"/><LockOpen v-else/></button></Teleport>
  <Teleport v-if="overlayHost" :to="overlayHost">
    <Transition name="player-backdrop">
    <div v-if="menu&&!expanded" class="player-menu-backdrop inline-menu-backdrop" aria-hidden="true" @pointerdown.stop @touchstart.stop @touchend.stop @click="closeMenu(false)" @touchmove.prevent />
    </Transition>
    <Transition name="player-menu">
    <section v-show="menu" id="player-options-panel" ref="panel" role="dialog" aria-modal="true" class="player-business-menu" :class="{ 'inline-business-menu': !expanded, 'episodes-menu': menu==='episodes' }" :aria-label="menuTitle" @pointerdown.stop @click.stop @touchstart.stop @touchend.stop>
      <header><div class="player-panel-heading"><button v-if="menu === 'quality' || menu === 'speed' || menu === 'subtitles' || menu === 'danmaku'" type="button" :aria-label="menu==='danmaku' && danmakuPage!=='settings' ? '返回弹幕设置' : '返回播放设置'" @click="menu==='danmaku' && danmakuPage!=='settings' ? emit('back-danmaku') : menu='settings'"><ChevronLeft /></button><strong>{{ menuTitle }}</strong></div><button type="button" aria-label="关闭播放器菜单" @click="closeMenu()"><X /></button></header>
      <div class="business-menu-body">
        <div v-show="menu === 'settings'" class="player-settings-content">
          <button v-if="directSources.length" type="button" class="player-settings-row setting-navigation" @click="menu='quality'"><span>画质</span><span class="player-setting-value">{{ qualityLabel(directSources.find(source=>source.id===selectedSourceId)||directSources[0]!) }} ›</span></button>
          <button type="button" class="player-settings-row setting-navigation" @click="menu='speed'"><span>倍速</span><span class="player-setting-value">{{ rate }}× ›</span></button>
          <button type="button" class="player-settings-row setting-navigation" @click="menu='subtitles'"><span>字幕</span><span class="player-setting-value">{{ subtitleLabel || '自动' }} ›</span></button>
          <div class="player-settings-row"><span>画面</span><div class="picture-options" role="group" aria-label="画面比例"><button v-for="mode in pictureModes" :key="mode.value" type="button" :aria-pressed="pictureMode === mode.value" :title="mode.value === 'crop' ? '放大裁切 125%' : mode.label" @click="emit('picture-mode', mode.value)">{{ mode.label }}</button></div></div>
          <slot name="audio" />
          <button v-if="danmakuAvailable" type="button" class="player-settings-row setting-navigation" @click="menu='danmaku'"><span>弹幕</span><span class="player-setting-value">{{ danmakuSummary || danmakuLabel }} ›</span></button>
          <button class="player-preferences-toggle" type="button" :aria-expanded="preferencesOpen" aria-controls="player-preferences-content" @click="preferencesOpen = !preferencesOpen"><span>播放偏好</span><ChevronDown :class="{ rotated: preferencesOpen }" /></button>
          <div v-show="preferencesOpen" id="player-preferences-content" class="player-preferences-content"><slot name="settings" /></div>
          <button v-if="canPip" class="player-pip-action" type="button" @click="adapter?.togglePip(); closeMenu()"><PictureInPicture2 />画中画</button>
          <button v-if="allowNativeFullscreen" class="player-pip-action" type="button" :disabled="!ready" @click="closeMenu(false); emit('native-fullscreen')"><Maximize />系统全屏<small>无弹幕</small></button>
        </div>
        <div v-if="menu==='quality'" class="player-choice-list" role="group" aria-label="选择画质"><button v-for="source in directSources" :key="source.id" type="button" :aria-pressed="source.id===selectedSourceId" @click="changeQuality(source)">{{ qualityLabel(source) }}<span v-if="source.id===selectedSourceId" aria-hidden="true">✓</span></button></div>
        <div v-if="menu==='speed'" class="player-choice-list" role="group" aria-label="播放速度"><button v-for="speed in speeds" :key="speed" type="button" :aria-pressed="speed===rate" @click="changeRate(speed)">{{ speed }}×<span v-if="speed===rate" aria-hidden="true">✓</span></button></div>
        <div v-show="menu === 'danmaku'"><slot name="danmaku" :open="menu==='danmaku'" /></div>
        <div v-show="menu === 'subtitles'"><slot /></div>
        <div v-show="menu === 'episodes'"><slot name="episodes" /></div>
      </div>
    </section>
    </Transition>
  </Teleport>
</template>
<style>
.video-stage.xgplayer { display:block; font-family:inherit; }
.video-stage.xgplayer video { position:absolute; inset:0; width:100%; height:100%; }
/* Keep the mobile input surface above Vue's video, below captions and transport. */
.video-stage.xgplayer > xg-trigger { z-index:2; }
.misty-controls-disabled > .xgplayer-controls, .misty-controls-disabled > xg-trigger { display:none !important; }
.video-stage .xgplayer-controls { z-index:8; bottom:0; left:0; right:0; width:100%; padding:0 10px; box-sizing:border-box; color:#fff; }
.video-stage .xg-left-grid, .video-stage .xg-right-grid { flex-wrap:nowrap; flex-shrink:0; align-items:center; gap:2px; }
.video-stage .xgplayer-controls .xg-left-grid, .video-stage .xgplayer-controls .xg-right-grid { height:44px; }
.video-stage .xgplayer-controls .xg-inner-controls { height:44px; }
.video-stage .xgplayer-controls .xgplayer-icons { height:44px; }
.video-stage .xgplayer-controls xg-icon[role="button"] { flex:0 0 44px; width:44px !important; min-height:44px; margin:0; }
.video-stage .xgplayer-time { white-space:nowrap; font-size:11px; font-variant-numeric:tabular-nums; }
.misty-player-tools, .business-buttons { display:flex; align-items:center; color:white; }
.business-buttons > button { display:grid; place-items:center; width:44px; height:44px; border:0; background:transparent; color:inherit; cursor:pointer; padding:8px; }
.quick-setting { position:relative; display:grid; place-items:center; flex:0 0 44px; width:44px; height:44px; font-size:12px; line-height:1; color:#fff; }
.quick-setting > span { max-width:100%; overflow:hidden; white-space:nowrap; pointer-events:none; }
.quick-setting > select { position:absolute; inset:0; width:100%; height:100%; min-width:0; margin:0; padding:0; opacity:0; font-size:16px; cursor:pointer; }
.quick-setting:focus-within { outline:2px solid white; outline-offset:-3px; border-radius:6px; }
.business-buttons svg { width:21px; height:21px; }
.business-buttons button:focus-visible { outline:2px solid white; outline-offset:-3px; border-radius:6px; }
.player-menu-backdrop { position:absolute; z-index:14; inset:0; background:#0006; }
.player-business-menu { position:absolute; z-index:15; right:12px; bottom:58px; display:flex; flex-direction:column; width:min(370px,calc(100% - 24px)); max-height:calc(100% - 76px); overflow:hidden; border:1px solid var(--divider); border-radius:16px; background:var(--surface-elevated,var(--surface-1)); color:var(--text-primary); box-shadow:0 12px 36px #0003; color-scheme:inherit; }
.player-business-menu header { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; padding:4px 8px 4px 20px; min-height:56px; border-bottom:1px solid var(--divider); }
.player-business-menu strong { font-size:15px; font-weight:600; }
.player-business-menu header button { display:grid; place-items:center; width:44px; height:44px; border:0; background:transparent; color:inherit; cursor:pointer; border-radius:6px; }
.player-business-menu header svg { width:20px; height:20px; }
.player-business-menu button:focus-visible, .player-business-menu select:focus-visible { outline:2px solid var(--liquid-accent); outline-offset:-2px; }
.player-menu-enter-active, .player-menu-leave-active { transition:opacity .18s ease, transform .18s var(--spring-ease); }
.player-menu-enter-from, .player-menu-leave-to { opacity:0; transform:translateY(10px); }
.player-backdrop-enter-active, .player-backdrop-leave-active { transition:opacity .18s ease; }
.player-backdrop-enter-from, .player-backdrop-leave-to { opacity:0; }
.episodes-menu .business-menu-body{flex:1;overflow:hidden}.episodes-menu .business-menu-body>div{height:100%}
.business-menu-body { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
.player-settings-content { padding:0 20px 12px; }
.player-settings-row { display:grid; grid-template-columns:56px minmax(0,1fr); align-items:center; gap:12px; min-height:56px; border-bottom:1px solid var(--divider); font-size:14px; }
.setting-navigation{width:100%;padding:0;background:transparent;color:inherit;text-align:left;border:0;border-bottom:1px solid var(--divider);font:inherit;font-size:14px;cursor:pointer}
.player-choice-list{display:grid;grid-auto-rows:44px;align-content:start;gap:4px;padding:8px 12px}
.player-choice-list button{display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;height:44px;min-height:44px;max-height:44px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--text-secondary);font:inherit;font-size:14px;line-height:20px;cursor:pointer}
.player-choice-list button:hover{background:var(--surface-2)}
.player-choice-list button[aria-pressed=true]{background:var(--liquid-accent);color:var(--accent-ink)}
.player-setting-select { width:100%; min-width:0; max-width:100%; height:44px; padding:0 2px 0 8px; border:0; border-radius:6px; background:transparent; color:var(--text-secondary); font:inherit; text-align:right; text-align-last:right; text-overflow:ellipsis; }
.player-setting-select option { background:var(--surface-1); color:var(--text-primary); }
.player-setting-value { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; color:var(--text-secondary); }
.player-panel-heading { display:flex; align-items:center; min-width:0; gap:4px; }
.player-panel-heading:has(button) { margin-left:-12px; }
.picture-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; min-width:0; }
.picture-options button { min-width:0; min-height:44px; padding:0 4px; border:1px solid transparent; border-radius:8px; background:transparent; color:var(--text-secondary); font:inherit; font-size:13px; cursor:pointer; }
.picture-options button[aria-pressed=true] { color:var(--text-primary); border-color:var(--divider); background:var(--surface-2); }
.player-preferences-toggle { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:52px; padding:0; border:0; border-bottom:1px solid var(--divider); background:transparent; color:var(--text-primary); font:inherit; font-size:14px; cursor:pointer; }
.player-preferences-toggle svg { width:16px; height:16px; color:var(--text-tertiary); transition:transform .15s; }
.player-preferences-toggle .rotated { transform:rotate(180deg); }
.player-preferences-content { padding:4px 0 8px; border-bottom:1px solid var(--divider); }
.player-pip-action { display:flex; align-items:center; gap:10px; width:100%; min-height:48px; padding:0; border:0; background:transparent; color:var(--text-secondary); font:inherit; font-size:14px; cursor:pointer; }
.player-pip-action svg { width:19px; height:19px; }
.player-pip-action small{margin-left:auto;color:var(--text-tertiary);font-size:12px}
.xg-gesture-feedback { position:absolute; z-index:10; top:40%; left:50%; transform:translateX(-50%); background:#000b; color:white; padding:8px 14px; border-radius:8px; pointer-events:none; }
@media(max-width:820px) {
  .video-stage .xgplayer-volume { display:none; }
  .video-stage .xgplayer-controls { padding:0 10px; }
  .video-stage .xgplayer-time { font-size:11px; }
  .player-menu-backdrop.inline-menu-backdrop { position:fixed; }
  .player-business-menu.inline-business-menu { position:fixed; left:max(8px,env(safe-area-inset-left)); right:max(8px,env(safe-area-inset-right)); bottom:max(8px,env(safe-area-inset-bottom)); width:auto; border-radius:20px; max-height:min(580px,72dvh); }
  .player-setting-select { font-size:16px; }
}
@media(max-width:380px) {
  .video-stage .xgplayer-controls { padding:0 6px; }
  .business-buttons > button { width:44px; padding:8px; }
  .quick-setting { width:44px; flex-basis:44px; }
  .video-stage .xg-left-grid, .video-stage .xg-right-grid { gap:0; }
  .video-stage .xgplayer-time { font-size:10px; margin:0; }
  .video-stage .xgplayer-time .time-duration, .video-stage .xgplayer-time .time-separator { display:none; }
}
@media(prefers-reduced-motion:reduce) { .player-preferences-toggle svg, .player-menu-enter-active, .player-menu-leave-active, .player-backdrop-enter-active, .player-backdrop-leave-active { transition:none; } }
</style>

<style>
.web-fullscreen .video-stage .xgplayer-controls{bottom:var(--player-safe-bottom,0px);padding-left:max(10px,var(--player-safe-left,0px));padding-right:max(10px,var(--player-safe-right,0px))}
.video-stage.xgplayer-mobile .xgplayer-volume{display:none}
.player-fullscreen .player-business-menu{--text-primary:#f5f5f7;--text-secondary:#c5c5ca;--text-tertiary:#a0a0a8;--surface-1:#101114;--surface-2:#222327;--surface-elevated:#101114;--glass-bg-active:#ffffff14;--liquid-accent:#f5f5f7;--accent-ink:#111215;--divider:#ffffff16;position:relative;grid-column:2;grid-row:1;inset:auto;min-width:0;width:100%;height:100%;max-height:none;border:0;border-left:1px solid var(--divider);border-radius:0;box-shadow:none;background:#101114;color:#f5f5f7;padding-top:var(--player-safe-top,0px);padding-bottom:var(--player-safe-bottom,0px);padding-right:var(--player-safe-right,0px);box-sizing:border-box;color-scheme:dark}
.player-fullscreen .player-menu-enter-from,.player-fullscreen .player-menu-leave-to{transform:translateX(12px)}
.player-fullscreen .player-business-menu header{min-height:48px;padding-left:18px}
.player-fullscreen .player-settings-content{padding:0 18px 12px}.player-fullscreen .player-settings-row{min-height:50px}.player-fullscreen .business-menu-body{touch-action:auto}
.player-lock{position:absolute;z-index:12;left:max(8px,var(--player-safe-left,0px));top:50%;transform:translateY(-50%);display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;color:#fff;background:#0005;cursor:pointer;transition:opacity .2s}
.player-lock svg{width:22px;height:22px}.xgplayer-inactive .player-lock:not(.is-locked){opacity:0;pointer-events:none}.player-lock.is-locked{background:#0008}.player-lock.is-locked:not(.lock-visible){opacity:0;pointer-events:none}.player-lock:focus-visible{outline:2px solid #fff;outline-offset:2px}
.video-stage.xgplayer.player-locked>.xgplayer-controls,.video-stage.xgplayer.player-locked>xg-trigger{display:none!important;visibility:hidden!important;pointer-events:none!important}
.quick-danmaku[data-mode=off]{opacity:.6}.quick-danmaku:disabled{opacity:.35}
@media(max-width:480px){.video-column:not(.player-fullscreen) .quick-rate,.web-portrait .quick-rate{display:none}}

@media(prefers-reduced-motion:reduce){.player-lock{transition:none}}
</style>
