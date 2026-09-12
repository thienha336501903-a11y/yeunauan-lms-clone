const WARM_MESSAGE = 'v5-warm-lease';
const COURSE = new URLSearchParams(location.search).get('course') || '';
const IMMEDIATE_WARM_BUDGET = 2;
const warmed = new Set();
const warming = new Map();
let warmObserver = null;
let mutationObserver = null;

async function mediaController() {
  if (!('serviceWorker' in navigator) || !COURSE) return null;
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 5000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      clearTimeout(timer);
      resolve(navigator.serviceWorker.controller || null);
    }, { once: true });
  });
}

async function warmLease(cell) {
  const assetId = String(cell?.dataset?.assetId || '').trim();
  if (!assetId || warmed.has(assetId)) return true;
  if (warming.has(assetId)) return warming.get(assetId);

  const request = (async () => {
    const controller = await mediaController().catch(() => null);
    if (!controller) return false;

    // Wait for the Service Worker to confirm the lease is actually in its
    // in-memory cache. This never fetches media bytes; it only moves the
    // existing short V5 lease work ahead of the user's Play tap.
    if (typeof MessageChannel === 'undefined') {
      controller.postMessage({ type: WARM_MESSAGE, course: COURSE, assetId });
      warmed.add(assetId);
      cell.dataset.v5LeaseReady = '1';
      return true;
    }

    const channel = new MessageChannel();
    const acknowledged = new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 5000);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        resolve(event.data?.ok === true);
      };
    });
    controller.postMessage({ type: WARM_MESSAGE, course: COURSE, assetId }, [channel.port2]);
    const ok = await acknowledged;
    if (ok) {
      warmed.add(assetId);
      cell.dataset.v5LeaseReady = '1';
    }
    return ok;
  })().finally(() => warming.delete(assetId));

  warming.set(assetId, request);
  return request;
}

function warmFirstVideoCells() {
  let budget = IMMEDIATE_WARM_BUDGET;
  document.querySelectorAll('[data-kind="video"][data-asset-id]').forEach(cell => {
    if (budget <= 0) return;
    const assetId = String(cell.dataset.assetId || '').trim();
    if (!assetId || warmed.has(assetId) || warming.has(assetId)) return;
    warmLease(cell).catch(() => {});
    budget -= 1;
  });
}

function observeVideoCells() {
  if (!warmObserver) return;
  document.querySelectorAll('[data-kind="video"][data-asset-id]:not([data-v5-warm-observed])').forEach(cell => {
    cell.dataset.v5WarmObserved = '1';
    warmObserver.observe(cell);
  });
  // MutationObserver runs as soon as the feed inserts its media cells. Warm the
  // first couple of video leases immediately instead of waiting for a later
  // IntersectionObserver delivery, which is noticeably less deterministic on
  // mobile browsers under load.
  warmFirstVideoCells();
}

if ('serviceWorker' in navigator && COURSE && 'IntersectionObserver' in window) {
  warmObserver = new IntersectionObserver(entries => {
    let budget = 2;
    const candidates = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
    for (const entry of candidates) {
      if (budget <= 0) break;
      const assetId = String(entry.target.dataset.assetId || '').trim();
      if (!assetId || warmed.has(assetId) || warming.has(assetId)) continue;
      warmObserver.unobserve(entry.target);
      warmLease(entry.target).catch(() => {});
      budget -= 1;
    }
  }, { rootMargin: '700px 0px', threshold: 0.01 });

  const feed = document.getElementById('feed');
  if (feed) {
    mutationObserver = new MutationObserver(observeVideoCells);
    mutationObserver.observe(feed, { childList: true, subtree: true });
  }
  observeVideoCells();
  window.addEventListener('pagehide', () => {
    warmObserver?.disconnect();
    mutationObserver?.disconnect();
  }, { once: true });
}
