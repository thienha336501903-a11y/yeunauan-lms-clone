import { buildV5ViewModel, normalizeSearch } from './ui-model.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
let activeCourse = '';
let data = null;
let lessons = [];
let seen = new Set();
let lastSeen = '';
let activeFilter = 'all';
let searchQuery = '';
let activeVideo = null;
let videoProgress = null;
let observer = null;

const progressKey = () => `v5_progress_${activeCourse || 'unknown'}`;
const videoProgressKey = () => `v5_video_progress_${activeCourse || 'unknown'}`;
const mediaUrl = assetId => `/v5/media/${encodeURIComponent(assetId)}?course=${encodeURIComponent(activeCourse)}`;

function linkify(value) {
  return esc(value).replace(/(https?:\/\/[^\s<]+)/gi, match => {
    const clean = match.replace(/[.,;:!?]+$/, '');
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${match.slice(clean.length)}`;
  });
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateKey(value) {
  const date = validDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
}

function dateLabel(value) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'long' }).format(date) : '';
}

function timeLabel(value) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : '';
}

function formatBytes(value) {
  let number = Number(value || 0);
  if (!number) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  while (number >= 1024 && index < units.length - 1) { number /= 1024; index += 1; }
  return `${number.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDuration(milliseconds) {
  const total = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  if (!total) return '';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey()) || '{}');
    seen = new Set(Array.isArray(saved.seen) ? saved.seen.map(String) : []);
    lastSeen = String(saved.last || '');
    videoProgress = JSON.parse(localStorage.getItem(videoProgressKey()) || 'null');
  } catch { seen = new Set(); lastSeen = ''; videoProgress = null; }
}

function saveProgress() {
  try { localStorage.setItem(progressKey(), JSON.stringify({ seen: [...seen], last: lastSeen, updatedAt: new Date().toISOString() })); } catch {}
}

function unfinishedVideo(progress) {
  if (!progress?.assetId || !progress?.lessonId || !(Number(progress.currentTime) > .5)) return false;
  const duration = Number(progress.duration || 0);
  return !(duration > 0 && (progress.currentTime >= duration - 2 || progress.currentTime / duration >= .98));
}

function saveVideoProgress(video) {
  const cell = video.closest('[data-asset-id]');
  const card = video.closest('[data-lesson-id]');
  if (!cell || !card || !(video.currentTime > .5)) return;
  if (video.duration > 0 && (video.currentTime >= video.duration - 2 || video.currentTime / video.duration >= .98)) return clearVideoProgress(cell.dataset.assetId);
  videoProgress = { assetId: cell.dataset.assetId, lessonId: card.dataset.lessonId, currentTime: video.currentTime, duration: video.duration || 0, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(videoProgressKey(), JSON.stringify(videoProgress)); } catch {}
  updateProgressUI();
}

function clearVideoProgress(assetId = '') {
  if (assetId && videoProgress?.assetId && String(videoProgress.assetId) !== String(assetId)) return;
  videoProgress = null;
  try { localStorage.removeItem(videoProgressKey()); } catch {}
  updateProgressUI();
}

function markSeen(lessonId) {
  if (!lessonId) return;
  seen.add(String(lessonId));
  lastSeen = String(lessonId);
  saveProgress();
  updateProgressUI();
  document.querySelectorAll('.outline-item').forEach(item => item.classList.toggle('current', item.dataset.lessonId === String(lessonId)));
}

function getResumeLesson() {
  if (unfinishedVideo(videoProgress)) return lessons.find(lesson => String(lesson.id) === String(videoProgress.lessonId)) || null;
  return lessons.find(lesson => String(lesson.id) === lastSeen) || lessons[0] || null;
}

function updateProgressUI() {
  const realLessons = lessons.filter(lesson => lesson.id !== 'v5-loose-posts');
  const completed = realLessons.filter(lesson => seen.has(String(lesson.id))).length;
  const percent = realLessons.length ? Math.round(completed / realLessons.length * 100) : 0;
  $('progressPct').textContent = `${percent}%`;
  $('progressFill').style.width = `${percent}%`;
  $('mobileProgress').style.width = `${percent}%`;
  $('outlineSeen').textContent = `${completed} đã xem`;
  document.querySelectorAll('.outline-item').forEach(item => item.classList.toggle('seen', seen.has(item.dataset.lessonId)));
  document.querySelectorAll('.seen-check').forEach(check => { check.hidden = !seen.has(check.closest('[data-lesson-id]')?.dataset.lessonId); });
  const lesson = getResumeLesson();
  if (lesson) {
    $('resumeSideTitle').textContent = lesson.title;
    $('resumeSideLabel').textContent = seen.has(String(lesson.id)) ? 'Xem lại bài gần nhất' : 'Tiếp tục học';
  }
  const resumable = unfinishedVideo(videoProgress) && document.querySelector(`[data-asset-id="${CSS.escape(String(videoProgress.assetId))}"]`);
  $('resumeFloat').hidden = !resumable;
  if (resumable) {
    const seconds = Math.floor(Number(videoProgress.currentTime || 0));
    $('resumeFloatText').textContent = `Tiếp tục từ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}

function iconFor(category) {
  return category === 'video' ? '▶' : category === 'file' ? '📄' : category === 'recipe' ? '▤' : '•';
}

function renderOutline() {
  const itemHtml = lesson => `<button class="outline-item${seen.has(String(lesson.id)) ? ' seen' : ''}" data-lesson-id="${esc(lesson.id)}" type="button"><span class="outline-icon">${iconFor(lesson.category)}</span><span class="outline-text">${esc(lesson.title)}</span><span class="outline-time">${esc(timeLabel(lesson.date))}</span><span class="outline-seen"></span></button>`;
  const html = `<section class="date-block"><div class="date-title"><span class="date-dot"></span>Phụ lục<span class="date-count">${lessons.length}</span></div>${lessons.map(itemHtml).join('')}</section>`;
  $('outline').innerHTML = html;
  $('mobileOutline').innerHTML = html;
  $('outlineCount').textContent = `${lessons.length} bài học`;
  $('mobileOutlineCount').textContent = `${lessons.length} bài học · chọn để chuyển nhanh`;
  document.querySelectorAll('.outline-item').forEach(button => button.addEventListener('click', () => { closeOutline(); scrollToLesson(button.dataset.lessonId); }));
}

function assetHtml(asset, index, total) {
  if (!asset.playback_ready) return `<div class="unavailable">${esc(asset.original_filename || asset.type)} — media chưa sẵn sàng phát.</div>`;
  const url = mediaUrl(asset.id);
  const more = total > 6 && index === 5 ? `<span class="more-overlay">+${total - 6}</span>` : '';
  if (asset.type === 'video') {
    const duration = formatDuration(asset.duration_ms);
    return `<div class="media-cell" data-kind="video" data-asset-id="${esc(asset.id)}"><div class="video-poster">${esc(asset.original_filename || 'Video bài học')}</div>${duration ? `<span class="media-duration">${esc(duration)}</span>` : ''}<button class="play" type="button" data-v5-start aria-label="Phát video">▶</button>${more}</div>`;
  }
  if (asset.type === 'image' || asset.type === 'photo') return `<button class="media-cell" type="button" data-kind="image" data-src="${esc(url)}" data-asset-id="${esc(asset.id)}"><img loading="lazy" data-v5-image data-src="${esc(url)}" alt="${esc(asset.original_filename || 'Ảnh bài học')}">${more}</button>`;
  return `<a class="doc" href="${esc(url)}" target="_blank" rel="noopener"><span class="doc-icon">📄</span><span class="doc-copy"><span class="doc-name">${esc(asset.original_filename || 'Tài liệu')}</span><span class="doc-size">${esc(formatBytes(asset.bytes))} · Mở tài liệu</span></span></a>`;
}

function postHtml(post, lesson, firstPost) {
  const visuals = post.visualAssets.slice(0, 6);
  const visualHtml = visuals.length ? `<div class="media-grid ${post.mosaic}">${visuals.map((asset, index) => assetHtml(asset, index, post.visualAssets.length)).join('')}</div>` : '';
  const filesHtml = post.fileAssets.map(asset => assetHtml(asset, 0, 1)).join('');
  const source = post.sourceTitle || data.course?.title || 'Kênh bài học';
  return `${firstPost ? `<div class="lesson-chip" data-for-lesson="${esc(lesson.id)}">${esc(lesson.title)}</div>` : ''}<article class="lesson-card" id="post-${esc(post.id)}" data-post-id="${esc(post.id)}" data-lesson-id="${esc(lesson.id)}" data-category="${esc(post.category)}"><div class="sender">${esc(source)}</div>${post.textOnly ? `<div class="lesson-text">${linkify(post.textOnly)}</div>` : ''}${visualHtml}${filesHtml}${post.caption ? `<div class="caption">${linkify(post.caption)}</div>` : ''}<div class="footer"><span class="seen-check" ${seen.has(String(lesson.id)) ? '' : 'hidden'}>✓✓</span><span>${esc(timeLabel(post.sourceDate))}</span></div></article>`;
}

function renderFeed() {
  let html = '';
  let lastDate = '';
  for (const lesson of lessons) {
    lesson.posts.forEach((post, index) => {
      const key = dateKey(post.sourceDate);
      if (key && key !== lastDate) { html += `<div class="date-chip" data-date="${esc(key)}">${esc(dateLabel(post.sourceDate))}</div>`; lastDate = key; }
      html += postHtml(post, lesson, index === 0);
    });
  }
  $('feed').innerHTML = html || '<div class="empty">Khóa học chưa có nội dung được Publish.</div>';
  wireMedia();
  wireObservers();
}

function scrollToLesson(lessonId, flash = true) {
  const target = document.querySelector(`[data-lesson-id="${CSS.escape(String(lessonId))}"]`);
  if (!target) return;
  lastSeen = String(lessonId);
  saveProgress();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (flash) { target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash'); }
  document.querySelectorAll('.outline-item').forEach(item => item.classList.toggle('current', item.dataset.lessonId === String(lessonId)));
}

function highlight(text, query) {
  const raw = String(text || '');
  const folded = normalizeSearch(raw);
  const at = folded.indexOf(query);
  if (at < 0) return esc(raw);
  return `${esc(raw.slice(0, at))}<mark>${esc(raw.slice(at, at + query.length))}</mark>${esc(raw.slice(at + query.length))}`;
}

function searchResults(query) {
  const results = [];
  for (const lesson of lessons) for (const post of lesson.posts) if (normalizeSearch(`${lesson.title} ${post.body}`).includes(query)) results.push({ lesson, post });
  return results;
}

function applyFilter(filter = activeFilter) {
  activeFilter = filter;
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  const query = normalizeSearch(searchQuery);
  const searching = query.length >= 2;
  const results = searching ? searchResults(query) : [];
  $('feed').hidden = searching;
  $('searchResults').hidden = !searching;
  $('searchEmpty').hidden = !searching || results.length > 0;
  if (searching) {
    $('searchResultsTitle').textContent = `Tìm thấy ${results.length} kết quả`;
    $('searchResultList').innerHTML = results.map(({ lesson, post }, index) => `<button class="search-result" type="button" data-result="${index}"><span class="search-result-icon">${iconFor(post.category)}</span><span class="search-result-copy"><span class="search-result-title">${highlight(lesson.title, query)}</span><span class="search-result-snippet">${highlight(post.body.replace(/\s+/g, ' ').slice(0, 150), query)}</span></span><span class="search-result-meta">${esc(timeLabel(post.sourceDate))}</span></button>`).join('');
    $('searchResultList').querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => { const result = results[Number(button.dataset.result)]; clearSearch(); requestAnimationFrame(() => { highlightPost(result.post.id, query); scrollToLesson(result.lesson.id, false); }); }));
    $('mobileSearchStatus').textContent = `Tìm thấy ${results.length} kết quả`;
  } else {
    document.querySelectorAll('.lesson-card').forEach(card => { const visible = filter === 'all' || (filter === 'unread' ? !seen.has(card.dataset.lessonId) : card.dataset.category === filter); card.classList.toggle('filtered', !visible); });
    document.querySelectorAll('.lesson-chip').forEach(chip => {
      let node = chip.nextElementSibling;
      let visible = false;
      while (node && !node.classList.contains('lesson-chip') && !node.classList.contains('date-chip')) {
        if (node.classList.contains('lesson-card') && !node.classList.contains('filtered')) { visible = true; break; }
        node = node.nextElementSibling;
      }
      chip.hidden = !visible;
    });
    $('mobileSearchStatus').textContent = query ? 'Nhập ít nhất 2 ký tự để tìm' : 'Nhập từ khóa để tìm trong khóa học';
  }
}

function highlightPost(postId, query) {
  document.querySelectorAll('.search-hit').forEach(mark => mark.replaceWith(mark.textContent));
  const card = document.getElementById(`post-${postId}`);
  const root = card?.querySelector('.lesson-text,.caption');
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const at = normalizeSearch(node.nodeValue).indexOf(query);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at); range.setEnd(node, Math.min(node.nodeValue.length, at + query.length));
    const mark = document.createElement('mark'); mark.className = 'search-hit active'; range.surroundContents(mark); break;
  }
}

function clearSearch() {
  searchQuery = '';
  $('searchInput').value = '';
  $('mobileSearchInput').value = '';
  $('mobileSearchClear').hidden = true;
  applyFilter('all');
  setMobileSearch(false);
}

async function ensureMediaWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('Trình duyệt này không hỗ trợ phát media V5 an toàn.');
  await navigator.serviceWorker.register('/v5/media-sw.js', { scope: '/v5/', updateViaCache: 'none' });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Không thể kích hoạt bộ phát media V5. Hãy tải lại trang.')), 5000); navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true }); });
}

async function hydrateProtectedImages() {
  await ensureMediaWorker();
  document.querySelectorAll('img[data-v5-image][data-src]').forEach(image => {
    if (!image.getAttribute('src')) image.setAttribute('src', image.dataset.src);
  });
}

function releaseVideo(video) {
  if (!video) return;
  saveVideoProgress(video);
  video.pause(); video.removeAttribute('src'); video.load();
  if (activeVideo === video) activeVideo = null;
}

async function startVideo(cell) {
  if (cell.dataset.loading === '1') return;
  cell.dataset.loading = '1';
  const button = cell.querySelector('[data-v5-start]');
  if (button) button.disabled = true;
  try {
    await ensureMediaWorker();
    if (activeVideo) releaseVideo(activeVideo);
    const video = document.createElement('video');
    video.controls = true; video.playsInline = true; video.preload = 'none';
    video.setAttribute('controlsList', 'nodownload noremoteplayback'); video.setAttribute('disableRemotePlayback', '');
    video.addEventListener('contextmenu', event => event.preventDefault());
    video.addEventListener('loadedmetadata', () => { if (unfinishedVideo(videoProgress) && String(videoProgress.assetId) === cell.dataset.assetId) video.currentTime = Math.min(Number(videoProgress.currentTime || 0), Math.max(0, video.duration - 1)); });
    let lastSave = 0;
    video.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 1000) { lastSave = Date.now(); saveVideoProgress(video); } });
    video.addEventListener('pause', () => saveVideoProgress(video));
    video.addEventListener('ended', () => { clearVideoProgress(cell.dataset.assetId); markSeen(cell.closest('[data-lesson-id]')?.dataset.lessonId); });
    cell.replaceChildren(video);
    activeVideo = video;
    markSeen(cell.closest('[data-lesson-id]')?.dataset.lessonId);
    video.src = mediaUrl(cell.dataset.assetId);
    await video.play().catch(() => {});
  } catch (error) {
    cell.dataset.loading = '';
    if (button) { button.disabled = false; button.textContent = 'Thử lại'; }
  }
}

function openLightbox(source) { $('lightImage').src = source; $('lightbox').classList.add('open'); $('lightbox').setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
function closeLightbox() { $('lightbox').classList.remove('open'); $('lightbox').setAttribute('aria-hidden', 'true'); $('lightImage').removeAttribute('src'); document.body.style.overflow = ''; }
function wireMedia() {
  document.querySelectorAll('[data-kind="video"]').forEach(cell => cell.querySelector('[data-v5-start]')?.addEventListener('click', () => startVideo(cell)));
  document.querySelectorAll('[data-kind="image"]').forEach(cell => cell.addEventListener('click', async () => {
    try { await ensureMediaWorker(); openLightbox(cell.dataset.src); } catch {}
  }));
}

function wireObservers() {
  observer?.disconnect();
  if (!('IntersectionObserver' in window)) return;
  const timers = new Map();
  observer = new IntersectionObserver(entries => entries.forEach(entry => { const id = entry.target.dataset.lessonId; if (entry.isIntersecting && entry.intersectionRatio >= .45 && !timers.has(id)) timers.set(id, setTimeout(() => { markSeen(id); timers.delete(id); }, 900)); else if (!entry.isIntersecting && timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); } }), { threshold: [0, .45, .7] });
  document.querySelectorAll('.lesson-card').forEach(card => observer.observe(card));
}

function setMobileSearch(open) { $('mobileSearch').classList.toggle('show', open); $('mobileSearchBtn').setAttribute('aria-expanded', String(open)); if (open) $('mobileSearchInput').focus(); }
function openOutline() { setMobileSearch(false); $('mobileOutlineBackdrop').classList.add('open'); $('mobileOutlineSheet').classList.add('open'); $('mobileOutlineSheet').setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
function closeOutline() { $('mobileOutlineBackdrop').classList.remove('open'); $('mobileOutlineSheet').classList.remove('open'); $('mobileOutlineSheet').setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }

function render(payload) {
  data = payload;
  lessons = buildV5ViewModel(payload);
  loadProgress();
  const title = payload.course?.title || activeCourse;
  document.title = title;
  $('sideTitle').textContent = title; $('mobileTitle').textContent = title;
  const subtitle = `${lessons.length} bài học · ${payload.course?.slug || activeCourse}`;
  $('sideSub').textContent = subtitle; $('mobileSub').textContent = subtitle;
  if (payload.course?.imageUrl) for (const id of ['sideAvatar', 'mobileAvatar']) { $(id).classList.add('has-image'); $(id).style.backgroundImage = `url("${String(payload.course.imageUrl).replace(/["\\]/g, '')}")`; }
  renderOutline(); renderFeed(); updateProgressUI(); applyFilter();
  const lead = lessons.find(lesson => lesson.posts.some(post => post.isPinned)) || lessons[0];
  if (lead) { $('pinTitle').textContent = lead.title; $('pinAction').onclick = () => scrollToLesson(lead.id); } else $('pinStrip').hidden = true;
  $('state').hidden = true; $('app').hidden = false;
  hydrateProtectedImages().catch(() => {});
}

async function load() {
  activeCourse = new URLSearchParams(location.search).get('course') || '';
  if (!activeCourse) { $('stateCard').innerHTML = 'Thiếu mã khóa học.<br><a href="/my-courses.html">Về danh sách khóa học</a>'; return; }
  try {
    const response = await fetch(`/api/lms/portal?endpoint=v5-feed&course=${encodeURIComponent(activeCourse)}`, { cache: 'no-store', credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) { location.replace(`/v3?return=v5&course=${encodeURIComponent(activeCourse)}`); return; }
    if (!response.ok || !payload.success) throw new Error(payload.error || `HTTP ${response.status}`);
    render(payload);
  } catch (error) { $('stateCard').innerHTML = `<strong>Không thể mở khóa học</strong><p>${esc(error.message)}</p><button onclick="location.reload()">Thử lại</button>`; }
}

function bind() {
  const syncSearch = value => { searchQuery = value; $('searchInput').value = value; $('mobileSearchInput').value = value; $('mobileSearchClear').hidden = !value; applyFilter(); };
  $('searchInput').addEventListener('input', event => syncSearch(event.target.value));
  $('mobileSearchInput').addEventListener('input', event => syncSearch(event.target.value));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => applyFilter(button.dataset.filter)));
  $('mobileSearchBtn').addEventListener('click', () => setMobileSearch(!$('mobileSearch').classList.contains('show')));
  $('mobileSearchClear').addEventListener('click', clearSearch); $('searchCancel').addEventListener('click', clearSearch);
  $('mobileOutlineBtn').addEventListener('click', openOutline); $('mobileOutlineBackdrop').addEventListener('click', closeOutline); $('mobileOutlineClose').addEventListener('click', closeOutline);
  $('lightClose').addEventListener('click', closeLightbox); $('lightbox').addEventListener('click', event => { if (event.target === $('lightbox')) closeLightbox(); });
  $('resumeSide').addEventListener('click', () => { const lesson = getResumeLesson(); if (lesson) scrollToLesson(lesson.id); });
  $('resumeFloat').addEventListener('click', () => { const cell = unfinishedVideo(videoProgress) ? document.querySelector(`[data-asset-id="${CSS.escape(String(videoProgress.assetId))}"]`) : null; cell?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeLightbox(); closeOutline(); setMobileSearch(false); } });
  addEventListener('pagehide', () => releaseVideo(activeVideo));
}

bind();
load();
