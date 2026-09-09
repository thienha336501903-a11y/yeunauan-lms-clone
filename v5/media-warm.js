const WARM_MESSAGE = 'v5-warm-lease';
const COURSE = new URLSearchParams(location.search).get('course') || '';
const warmed = new Set();
let warmObserver = null;
let mutationObserver = null;

async function mediaController() {
  if (!('serviceWorker' in navigator) || !COURSE) return null;
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
  if (!assetId || warmed.has(assetId)) return;
  warmed.add(assetId);
  const controller = await mediaController().catch(() => null);
  controller?.postMessage({ type: WARM_MESSAGE, course: COURSE, assetId });
}

function observeVideoCells() {
  if (!warmObserver) return;
  document.querySelectorAll('[data-kind="video"][data-asset-id]:not([data-v5-warm-observed])').forEach(cell => {
    cell.dataset.v5WarmObserved = '1';
    warmObserver.observe(cell);
  });
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
      if (!assetId || warmed.has(assetId)) continue;
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
