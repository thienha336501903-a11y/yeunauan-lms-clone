const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const records = [];
const requestRecords = new Map();
let video = null;
let sampleTimer = null;
let waitingStartedAt = null;
let abortController = null;

navigator.serviceWorker?.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type !== 'v5-playback-diagnostic' || !message.requestId) return;
  const current = requestRecords.get(message.requestId) || {};
  const merged = { ...current, ...message };
  if (message.phase === 'complete' && message.downloadMs > 0) {
    merged.throughputMiBs = round((Number(message.bytes || 0) / 1024 / 1024) / (message.downloadMs / 1000));
  }
  requestRecords.set(message.requestId, merged);
  add(`sw:${message.phase}`, Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'type')));
});

const isPreview = location.hostname.endsWith('.vercel.app');
$('course').value = params.get('course') || 'clone-factory-test-phase2-range-20260907';
$('asset').value = params.get('asset') || '61b6fb30-e5b7-4a16-8657-fc376ec15892';
$('chunk').value = ['4', '8', '16'].includes(params.get('chunkMiB')) ? params.get('chunkMiB') : '4';

function round(value) { return Number(Number(value || 0).toFixed(2)); }
function now() { return performance.now(); }
function buffered(videoElement) {
  const ranges = [];
  for (let index = 0; index < videoElement.buffered.length; index += 1) {
    ranges.push([round(videoElement.buffered.start(index)), round(videoElement.buffered.end(index))]);
  }
  return ranges;
}
function bufferedAhead(videoElement) {
  const current = videoElement.currentTime;
  for (const [start, end] of buffered(videoElement)) if (start <= current && current <= end) return round(end - current);
  return 0;
}
function add(kind, data = {}) {
  records.push({ elapsedMs: round(now()), at: new Date().toISOString(), kind, ...data });
  render();
}
function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)]);
}
function summarize() {
  const ranges = [...requestRecords.values()].filter(item => item.phase === 'complete' || item.downloadMs !== undefined);
  const headers = [...requestRecords.values()].filter(item => item.status);
  const stalls = records.filter(item => item.kind === 'video:stall-complete');
  const requestsByStatus = {};
  for (const item of headers) requestsByStatus[item.status] = (requestsByStatus[item.status] || 0) + 1;
  const finiteBrowserRanges = headers.filter(item => /^bytes=\d+-\d+$/i.test(item.browserRange || '')).length;
  const openBrowserRanges = headers.filter(item => /^bytes=\d+-$/i.test(item.browserRange || '')).length;
  const totalBytes = headers.map(item => parseContentRange(item.contentRange)?.total).find(Number.isFinite) || null;
  const lastVideo = [...records].reverse().find(item => item.kind === 'video:sample' || item.kind === 'video:loadedmetadata');
  const durationSeconds = Number.isFinite(lastVideo?.duration) && lastVideo.duration > 0 ? lastVideo.duration : null;
  const averageMbps = totalBytes && durationSeconds ? round(totalBytes * 8 / durationSeconds / 1_000_000) : null;
  const chunkBytes = Number($('chunk').value) * 1024 * 1024;
  const boundaryRequestsPerMinute = averageMbps ? round((60 * averageMbps * 1_000_000 / 8) / chunkBytes) : null;
  const requestTimes = headers.map(item => Number(item.at)).filter(Number.isFinite).sort((a, b) => a - b);
  const requestGaps = requestTimes.slice(1).map((time, index) => time - requestTimes[index]);
  return {
    previewOnly: isPreview,
    chunkMiB: Number($('chunk').value),
    preload: $('preload').value,
    mediaRequests: headers.length,
    browserRangePattern: { finite: finiteBrowserRanges, openEnded: openBrowserRanges, missing: headers.length - finiteBrowserRanges - openBrowserRanges },
    statusCounts: requestsByStatus,
    retries401_403_410: headers.reduce((sum, item) => sum + Number(item.retries || 0), 0),
    retrySourceStatuses: headers.map(item => item.retryFromStatus).filter(Boolean),
    leaseCacheHits: headers.filter(item => item.leaseCacheHit).length,
    leaseMs: { p50: percentile(headers.map(item => item.leaseMs), .5), p95: percentile(headers.map(item => item.leaseMs), .95) },
    ecdsaSignMs: { p50: percentile(headers.map(item => item.signMs), .5), p95: percentile(headers.map(item => item.signMs), .95) },
    workerTtfbMs: { p50: percentile(headers.map(item => item.workerTtfbMs), .5), p95: percentile(headers.map(item => item.workerTtfbMs), .95) },
    downloadMs: { p50: percentile(ranges.map(item => item.downloadMs), .5), p95: percentile(ranges.map(item => item.downloadMs), .95) },
    throughputMiBs: { p50: percentile(ranges.map(item => item.throughputMiBs).filter(Number.isFinite), .5), p95: percentile(ranges.map(item => item.throughputMiBs).filter(Number.isFinite), .95) },
    rangeGapMs: { p50: percentile(requestGaps, .5), p95: percentile(requestGaps, .95) },
    stalls: { count: stalls.length, totalMs: round(stalls.reduce((sum, item) => sum + item.durationMs, 0)), maxMs: round(Math.max(0, ...stalls.map(item => item.durationMs))) },
    media: {
      totalBytes,
      durationSeconds,
      averageMbps,
      estimatedBoundaryRequestsPerMinutePerLearner: boundaryRequestsPerMinute,
      estimatedBoundaryRequestsPerMinute100Learners: boundaryRequestsPerMinute ? round(boundaryRequestsPerMinute * 100) : null,
      estimatedBoundaryRequestsPerMinute300Learners: boundaryRequestsPerMinute ? round(boundaryRequestsPerMinute * 300) : null,
      estimatedChunkSecondsAtAverageBitrate: averageMbps ? round(chunkBytes * 8 / 1_000_000 / averageMbps) : null
    },
    lastVideoSample: [...records].reverse().find(item => item.kind === 'video:sample') || null
  };
}
function render() {
  $('summary').textContent = JSON.stringify(summarize(), null, 2);
  $('timeline').textContent = records.slice(-250).map(item => JSON.stringify(item)).join('\n');
}
function mediaUrl() {
  const course = $('course').value.trim();
  const asset = $('asset').value.trim();
  const query = new URLSearchParams({ course, v5diag: '1', chunkMiB: $('chunk').value });
  return `/v5/media/${encodeURIComponent(asset)}?${query}`;
}
async function ensureWorker() {
  if (!isPreview) throw new Error('Diagnostic bị khóa ngoài Vercel Preview.');
  await navigator.serviceWorker.register('/v5/media-sw.js', { scope: '/v5/', updateViaCache: 'none' });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
}
function stop() {
  abortController?.abort();
  abortController = null;
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = null;
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null; }
  waitingStartedAt = null;
  $('status').textContent = 'Đã dừng.';
}
function videoSnapshot(event) {
  return {
    event,
    currentTime: round(video.currentTime),
    duration: round(video.duration),
    buffered: buffered(video),
    bufferedAhead: bufferedAhead(video),
    readyState: video.readyState,
    networkState: video.networkState,
    paused: video.paused
  };
}
async function runPlayback() {
  stop();
  await ensureWorker();
  video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = $('preload').value;
  for (const name of ['loadstart', 'loadedmetadata', 'progress', 'canplay', 'playing', 'waiting', 'stalled', 'suspend', 'error', 'ended']) {
    video.addEventListener(name, () => {
      if ((name === 'waiting' || name === 'stalled') && waitingStartedAt === null) waitingStartedAt = now();
      if ((name === 'playing' || name === 'canplay') && waitingStartedAt !== null) {
        add('video:stall-complete', { durationMs: round(now() - waitingStartedAt), ...videoSnapshot(name) });
        waitingStartedAt = null;
      }
      add(`video:${name}`, videoSnapshot(name));
    });
  }
  $('player').replaceChildren(video);
  video.src = mediaUrl();
  sampleTimer = setInterval(() => video && add('video:sample', videoSnapshot('sample')), 1000);
  $('status').textContent = `Playback thật: ${$('chunk').value} MiB, preload=${$('preload').value}`;
  await video.play();
}
function parseContentRange(value) {
  const match = String(value || '').match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
  return match ? { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? null : Number(match[3]) } : null;
}
async function runBenchmark() {
  stop();
  await ensureWorker();
  abortController = new AbortController();
  const targetBytes = Number($('benchmarkMiB').value) * 1024 * 1024;
  let start = 0;
  let downloaded = 0;
  let requests = 0;
  $('status').textContent = `Benchmark ${$('chunk').value} MiB đang chạy…`;
  while (downloaded < targetBytes) {
    const requestStartedAt = now();
    const response = await fetch(mediaUrl(), { headers: { Range: `bytes=${start}-` }, cache: 'no-store', signal: abortController.signal });
    const headersAt = now();
    const reader = response.body.getReader();
    let bytes = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
    }
    const completeAt = now();
    const range = parseContentRange(response.headers.get('content-range'));
    const downloadMs = completeAt - headersAt;
    add('benchmark:range', {
      chunkMiB: Number($('chunk').value),
      requestedRange: `bytes=${start}-`,
      status: response.status,
      contentLength: Number(response.headers.get('content-length') || 0),
      contentRange: response.headers.get('content-range') || '',
      pageTtfbMs: round(headersAt - requestStartedAt),
      downloadMs: round(downloadMs),
      bytes,
      throughputMiBs: downloadMs > 0 ? round((bytes / 1024 / 1024) / (downloadMs / 1000)) : null
    });
    if (!response.ok || !range || bytes === 0) break;
    downloaded += bytes;
    requests += 1;
    start = range.end + 1;
    if (range.total !== null && start >= range.total) break;
  }
  abortController = null;
  $('status').textContent = `Benchmark xong: ${round(downloaded / 1024 / 1024)} MiB qua ${requests} request.`;
  add('benchmark:complete', { chunkMiB: Number($('chunk').value), downloaded, requests });
}

navigator.serviceWorker?.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'v5-playback-diagnostic') return;
  const item = { ...data };
  delete item.type;
  const existing = requestRecords.get(item.requestId) || {};
  const merged = { ...existing, ...item };
  if (item.phase === 'complete' && item.downloadMs > 0) merged.throughputMiBs = round((item.bytes / 1024 / 1024) / (item.downloadMs / 1000));
  requestRecords.set(item.requestId, merged);
  add(`sw:${item.phase}`, item);
});

$('play').addEventListener('click', () => runPlayback().catch(error => { $('status').textContent = error.message; add('playback:error', { error: error.message }); }));
$('benchmark').addEventListener('click', () => runBenchmark().catch(error => { if (error.name !== 'AbortError') add('benchmark:error', { error: error.message }); $('status').textContent = error.message; }));
$('stop').addEventListener('click', stop);
$('clear').addEventListener('click', () => { records.length = 0; requestRecords.clear(); render(); });
$('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), summary: summarize(), requests: [...requestRecords.values()], records }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `v5-playback-diagnostic-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

if (!isPreview) $('status').textContent = 'Diagnostic bị khóa: chỉ chạy trên hostname .vercel.app.';
render();
