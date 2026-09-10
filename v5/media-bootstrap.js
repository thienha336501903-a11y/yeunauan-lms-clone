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

    await new Promise(resolve => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
      setTimeout(finish, 1500);
    });

    if (navigator.serviceWorker.controller) {
      sessionStorage.removeItem(RELOAD_GUARD);
      return;
    }

    if (!sessionStorage.getItem(RELOAD_GUARD)) {
      sessionStorage.setItem(RELOAD_GUARD, '1');
      location.reload();
    }
  } catch {
    // app.js keeps the normal guarded fallback/error handling.
  }
}

ensureInitialMediaController();
