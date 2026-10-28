import Player from 'xgplayer/es/player';
import Plugin from 'xgplayer/es/plugin/plugin';
import Play from 'xgplayer/es/plugins/play';
import Progress from 'xgplayer/es/plugins/progress';
import Time from 'xgplayer/es/plugins/time';
import Volume from 'xgplayer/es/plugins/volume';
import Fullscreen from 'xgplayer/es/plugins/fullscreen';
import Pip from 'xgplayer/es/plugins/pip';
import Mobile from 'xgplayer/es/plugins/mobile';
import PC from 'xgplayer/es/plugins/pc';
import Keyboard from 'xgplayer/es/plugins/keyboard';
import I18N from 'xgplayer/es/lang/i18n';
import zh from 'xgplayer/es/lang/zh-cn';
import { isAppleTouchDevice } from './device';

I18N.use(zh);
class BusinessTools extends Plugin {
  static get pluginName() { return 'businesstools'; }
  static get defaultConfig() { return { position: Plugin.POSITIONS.CONTROLS_RIGHT, index: 2 }; }
  render() { return '<div class="misty-player-tools"></div>'; }
}

export function createDirectPlayer(root: HTMLElement, video: HTMLVideoElement, options: {
  fullscreen: () => void;
  feedback: (message: string) => void;
}) {
  const mobile = /Android/i.test(navigator.userAgent) || isAppleTouchDevice(navigator);
  const player = new Player({
    el: root, mediaEl: video, width: '100%', height: 'auto', lang: 'zh-cn',
    videoInit: false, autoplay: false, seekedStatus: 'auto', volume: video.volume, defaultPlaybackRate: video.playbackRate,
    remainMediaAfterDestroy: true, fullscreenTarget: root.parentElement!, cssFullscreen: false, closeVideoDblclick: true,
    controls: { mode: 'normal', autoHide: true, initShow: true },
    fullscreen: { useCssFullscreen: false, rotateFullscreen: false, switchCallback: options.fullscreen },
    pip: { showIcon: false, preferDocument: false },
    commonStyle: { playedColor: '#8fb8f1', cachedColor: '#ffffff55', sliderBtnStyle: { background: '#fff' } },
    mobile: { gestureY: false, darkness: false, disablePress: true },
    // Install only UI plugins. No MSE engine, network speed test, relay or second subtitle renderer.
    plugins: [Play, Progress, Time, Volume, Fullscreen, Pip, BusinessTools, ...(mobile ? [Mobile] : [PC, Keyboard])],
  });
  // Vue owns the media element and the sole direct-URL attachment pipeline.
  player.handleSource = false;
  // Playback is started by the direct-source owner, outside player.play(). Keep the
  // library's interaction lifecycle in sync so the first tap reveals controls.
  player.on('playing', () => { player.isPlaying = true; });
  player.on('emptied', () => { player.isPlaying = false; });
  void Promise.resolve(player.start()).then(() => {
    if (player.video === video && !video.paused && video.readyState >= 2) player.isPlaying = true;
  }).catch(() => options.feedback('播放器加载失败，请重新打开影片'));
  const mobilePlugin = player.plugins.mobile as Mobile | undefined;
  let locked=false;
  const gestureDisabled=mobilePlugin?.config.disableGesture;
  const keyboard=player.plugins.keyboard as Keyboard|undefined;
  const keyboardDisabled=keyboard?.config.disable;
  mobilePlugin?.useHooks('videoClick',()=>!locked);
  mobilePlugin?.useHooks('videoDbClick', (_plugin, data: { e: TouchEvent | MouseEvent }) => {
    if(locked)return false;
    const point = 'changedTouches' in data.e ? data.e.changedTouches[0] : data.e;
    const rect = root.getBoundingClientRect();
    const position = point ? player.rotateDeg === 90 ? (point.clientY-rect.top)/rect.height : (point.clientX-rect.left)/rect.width : .5;
    if (position >= .4 && position <= .6) return true;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      const delta = position < .4 ? -10 : 10;
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
      options.feedback(delta < 0 ? '后退 10 秒' : '快进 10 秒');
    }
    player.focus();
    return false;
  });
  // Core icons are custom elements; expose the same controls to keyboard/AT users.
  const iconLabels: Record<string, string> = { play: '播放或暂停', fullscreen: '全屏播放', volume: '音量' };
  for (const [name, label] of Object.entries(iconLabels)) {
    const icon = player.plugins[name]?.root as HTMLElement | undefined;
    if (!icon) continue;
    icon.setAttribute('role', 'button'); icon.setAttribute('aria-label', label); icon.tabIndex = 0;
    icon.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation();
      icon.click();
    });
  }
  return {
    player,
    tools: player.plugins.businesstools.root as HTMLElement,
    canPip: Boolean((player.plugins.pip as Pip).isPIPAvailable()),
    togglePip() { (player.plugins.pip as Pip).switchPIP(new Event('click')); },
    setRotation(degrees:0|90) { player.rotateDeg=degrees; },
    setLocked(value:boolean) {
      locked=value;root.classList.toggle('player-locked',value);
      if(mobilePlugin)mobilePlugin.config.disableGesture=value||gestureDisabled;
      if(keyboard)keyboard.config.disable=value||keyboardDisabled;
      for(const element of root.querySelectorAll<HTMLElement>('xg-trigger,.xgplayer-controls'))element.inert=value;
      if(value)player.blur();
    },
    setFullscreen(active: boolean) {
      (player.plugins.fullscreen as Fullscreen).animate(active);
      player.plugins.fullscreen.root?.setAttribute('aria-label', active ? '退出全屏' : '全屏播放');
    },
    destroy() { player.destroy(); },
  };
}
