/**
 * In the Home Screen app, iPadOS can keep reporting the old height to CSS
 * after a rotation, so the layout runs off the screen. Size the app from the
 * window itself, and look again shortly after, since the new size arrives late.
 * (Moved from main.ts in 0.17.0.)
 */
let appHeight = 0;

function syncAppHeight(): void {
  // The stale value is always the larger (the old portrait height), so take the smaller reading.
  const height = Math.round(Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity));
  if (height <= 0 || height === appHeight) return;
  appHeight = height;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

export function watchAppHeight(): void {
  let timers: number[] = [];
  const sync = () => {
    syncAppHeight();
    for (const timer of timers) window.clearTimeout(timer);
    timers = [150, 400, 800].map((delay) => window.setTimeout(syncAppHeight, delay));
  };
  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", sync);
  window.visualViewport?.addEventListener("resize", sync);
  new ResizeObserver(sync).observe(document.documentElement);
  // Backstop in case a rotation arrives without any of those events.
  window.setInterval(() => { if (document.visibilityState === "visible") syncAppHeight(); }, 1000);
  syncAppHeight();
}
