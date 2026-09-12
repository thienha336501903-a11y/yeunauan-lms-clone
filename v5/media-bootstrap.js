const RELOAD_GUARD = 'v5_media_sw_bootstrap_reload_once';

async function ensureInitialMediaController() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/v5/media-sw.js', { scope: '/v5/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) {
      sessionStorage.removeItem(RELOAD_GUARD);
      return;
    }

    // Once an active /v5/ registration exists, the next navigation inside its
    // scope is controlled. Reload immediately once instead of holding protected
    // images on a fixed first-load delay before doing the same recovery.
    if (!sessionStorage.getItem(RELOAD_GUARD)) {
      sessionStorage.setItem(RELOAD_GUARD, '1');
      location.reload();
    }
  } catch {
    // app.js keeps the normal guarded fallback/error handling.
  }
}

ensureInitialMediaController();
