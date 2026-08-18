import { createApp } from 'vue';
import App from './App.vue';
import './assets/styles/main.css';

const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
const isWebClipLaunch = new URLSearchParams(window.location.search).get('webclip') === '1';
const isStandalone = isWebClipLaunch
  || navigatorWithStandalone.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;
const isIosDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

document.documentElement.classList.toggle('ios-standalone', isStandalone);

const rootElement = document.documentElement;
const visualViewport = window.visualViewport;
let viewportFrame = 0;
let lastViewportHeight = 0;

const getStandaloneScreenHeight = () => {
  if (!isStandalone || !isIosDevice) return 0;

  const shortSide = Math.min(window.screen.width, window.screen.height);
  const longSide = Math.max(window.screen.width, window.screen.height);
  const screenOrientation = window.screen.orientation?.type;
  const legacyOrientation = (window as Window & { orientation?: number }).orientation;
  const isLandscape = screenOrientation
    ? screenOrientation.startsWith('landscape')
    : typeof legacyOrientation === 'number'
      ? Math.abs(legacyOrientation) === 90
      : window.innerWidth > window.innerHeight;
  const expectedScreenWidth = isLandscape ? longSide : shortSide;

  // Do not force the physical screen size in an iPad split window. A small
  // tolerance covers fractional CSS pixels and display zoom rounding.
  if (Math.abs(window.innerWidth - expectedScreenWidth) > 4) return 0;
  return isLandscape ? shortSide : longSide;
};

const measureViewportHeight = () => {
  viewportFrame = 0;

  // On the first Web Clip frame iOS can report the same undersized value for
  // both innerHeight and visualViewport.height. The orientation-aware screen
  // dimension is stable before the first scroll and represents the full
  // viewport-fit=cover canvas. It is used only for full-screen standalone
  // Apple devices, so desktop browsers and iPad split views keep their window.
  const viewportHeight = Math.max(
    window.innerHeight,
    visualViewport?.height ?? 0,
    getStandaloneScreenHeight()
  );
  const roundedHeight = Math.round(viewportHeight);
  if (!Number.isFinite(roundedHeight) || roundedHeight <= 0 || roundedHeight === lastViewportHeight) return;

  lastViewportHeight = roundedHeight;
  rootElement.style.setProperty('--app-viewport-height', `${roundedHeight}px`);
};

const syncViewportHeight = () => {
  if (viewportFrame) cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(measureViewportHeight);
};

const settleViewportHeight = () => {
  // WebKit finishes the standalone safe-area/viewport setup asynchronously.
  // Re-measuring through the first second removes the need for a manual scroll.
  [0, 60, 180, 420, 900].forEach(delay => window.setTimeout(syncViewportHeight, delay));
};

syncViewportHeight();
settleViewportHeight();
window.addEventListener('load', settleViewportHeight, { once: true });
window.addEventListener('pageshow', settleViewportHeight);
window.addEventListener('resize', syncViewportHeight, { passive: true });
window.addEventListener('orientationchange', settleViewportHeight, { passive: true });
visualViewport?.addEventListener('resize', syncViewportHeight, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') settleViewportHeight();
});

createApp(App).mount('#app');
