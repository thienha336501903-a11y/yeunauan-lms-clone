from pathlib import Path

path = Path("lesson.html")
text = path.read_text(encoding="utf-8")


def replace_between(source, start_marker, end_marker, replacement, label):
    start = source.find(start_marker)
    if start < 0:
        raise SystemExit(f"missing start marker: {label}")
    end = source.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"missing end marker: {label}")
    return source[:start] + replacement + source[end:]


css_marker = "    /* Recipe text content rendering tags styling */"
if ".gdrive-play-button {" not in text:
    css = r'''    .gdrive-play-button {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 20;
      width: 56px;
      height: 56px;
      min-width: 52px;
      min-height: 52px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 9999px;
      background: rgba(42, 75, 42, 0.94);
      color: #fff;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.32);
      cursor: pointer;
      transform: translate(-50%, -50%);
      transition: background-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .gdrive-play-button:hover,
    .gdrive-play-button:focus-visible {
      background: #2A4B2A;
      box-shadow: 0 16px 38px rgba(0, 0, 0, 0.4), 0 0 0 4px rgba(255, 255, 255, 0.26);
      transform: translate(-50%, -50%) scale(1.04);
      outline: none;
    }
    .gdrive-play-button:active {
      transform: translate(-50%, -50%) scale(0.96);
    }
    .gdrive-play-icon {
      width: 0;
      height: 0;
      margin-left: 4px;
      border-top: 11px solid transparent;
      border-bottom: 11px solid transparent;
      border-left: 17px solid currentColor;
    }
    .supplemental-video-label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 34px;
      height: 24px;
      padding: 0 10px;
      border-radius: 9999px;
      background: rgba(42, 75, 42, 0.1);
      color: #2A4B2A;
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
    }
    @media (min-width: 640px) {
      .gdrive-play-button { width: 64px; height: 64px; }
      .gdrive-play-icon {
        border-top-width: 12px;
        border-bottom-width: 12px;
        border-left-width: 19px;
      }
    }

'''
    text = text.replace(css_marker, css + css_marker, 1)

helper_marker = "    function goMyCourses() {"
if "function openGoogleDrivePlayer(playerUrl, returnUrl)" not in text:
    helpers = r'''    function openGoogleDrivePlayer(playerUrl, returnUrl) {
      if (!playerUrl) return;
      if (returnUrl) sessionStorage.setItem("courseReturnUrl", returnUrl);
      window.location.href = playerUrl;
    }

    function getGoogleDrivePlayButtonHtml(playerUrl, returnUrl) {
      return `
        <button
          type="button"
          class="gdrive-play-button"
          aria-label="Mở video"
          data-player-url="${escapeHtml(playerUrl)}"
          data-return-url="${escapeHtml(returnUrl)}"
          onclick="openGoogleDrivePlayer(this.dataset.playerUrl, this.dataset.returnUrl)">
          <span class="gdrive-play-icon" aria-hidden="true"></span>
        </button>
      `;
    }

'''
    text = text.replace(helper_marker, helpers + helper_marker, 1)

parser = r'''    function decodeMediaCaption(value) {
      const raw = String(value || "");
      if (!raw) return "";
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }

    function renderMediaCaption(caption) {
      const value = String(caption || "").trim();
      if (!value) return "";
      return `<p data-media-caption class="mt-2 px-1 text-xs sm:text-sm leading-relaxed text-brandBrown/60 whitespace-pre-line">${escapeHtml(value)}</p>`;
    }

    function parseMediaUrls(raw) {
      if (!raw || typeof raw !== "string") return [];
      return raw.split("\n")
        .map(line => {
          const trimmed = line.trim();
          if (!trimmed) return null;
          const firstPipe = trimmed.indexOf("|");
          if (firstPipe === -1) return null;
          const secondPipe = trimmed.indexOf("|", firstPipe + 1);
          if (secondPipe === -1) return null;
          const thirdPipe = trimmed.indexOf("|", secondPipe + 1);
          const type = trimmed.slice(0, firstPipe).trim();
          const title = trimmed.slice(firstPipe + 1, secondPipe).trim();
          const url = (thirdPipe === -1 ? trimmed.slice(secondPipe + 1) : trimmed.slice(secondPipe + 1, thirdPipe)).trim();
          const caption = thirdPipe === -1 ? "" : decodeMediaCaption(trimmed.slice(thirdPipe + 1).trim()).slice(0, 250);
          if (!type || !url) return null;
          return { type, title, url, caption };
        })
        .filter(Boolean);
    }'''
text = replace_between(text, "    function parseMediaUrls(raw) {", "\n\n    // ── Watermark system", parser, "media parser")

player = r'''    function getIframePlayerHtml(url) {
      const isDrive = url.includes("drive.google.com");
      if (isDrive) {
        const previewUrl = normalizeGoogleDrivePreviewUrl(url) || url;
        const fileId = getGoogleDriveFileId(url);
        const returnUrl = window.location.href;
        const playerUrl = `/gdrive-player.html?id=${encodeURIComponent(fileId)}&returnUrl=${encodeURIComponent(returnUrl)}`;
        const thumbUrl = normalizeGoogleDriveImageUrl(previewUrl) || normalizeGoogleDriveImageUrl(url);
        return `
          <div class="relative w-full h-full flex items-center justify-center bg-black">
            <img src="${escapeHtml(thumbUrl)}" alt="" class="absolute inset-0 w-full h-full object-cover opacity-60" loading="lazy">
            ${getGoogleDrivePlayButtonHtml(playerUrl, returnUrl)}
          </div>
        `;
      }
      return `
        <iframe
          class="w-full h-full border-0 absolute inset-0 z-10"
          src="${url}"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowfullscreen
          referrerpolicy="origin"
          loading="lazy">
        </iframe>
      `;
    }

    function resetMainVideoPlayer(videoWrapper, iframe) {
      if (!videoWrapper) return;
      if (videoWrapper.mainVideoLoadTimer) {
        clearTimeout(videoWrapper.mainVideoLoadTimer);
        videoWrapper.mainVideoLoadTimer = null;
      }
      if (iframe && iframe.parentNode === videoWrapper) iframe.remove();
      const thumbnail = videoWrapper.querySelector("#videoThumb");
      const playButton = videoWrapper.querySelector("#playBtn");
      if (thumbnail) thumbnail.classList.remove("hidden");
      if (playButton) {
        playButton.classList.remove("hidden");
        playButton.disabled = false;
        playButton.removeAttribute("aria-busy");
      }
      videoWrapper.dataset.mainVideoState = "idle";
    }

    function mountMainVideoIframe(videoWrapper, videoUrl, lesson, email) {
      if (!videoWrapper || videoWrapper.dataset.mainVideoState === "loading" || videoWrapper.dataset.mainVideoState === "ready") return;
      const playButton = videoWrapper.querySelector("#playBtn");
      videoWrapper.dataset.mainVideoState = "loading";
      if (playButton) {
        playButton.disabled = true;
        playButton.setAttribute("aria-busy", "true");
      }

      const iframe = document.createElement("iframe");
      iframe.className = "main-video-player w-full h-full border-0 absolute inset-0 z-10 opacity-0 pointer-events-none";
      iframe.allow = "autoplay; encrypted-media; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = "origin";
      iframe.setAttribute("playsinline", "");
      iframe.setAttribute("webkit-playsinline", "");

      const finishLoading = () => {
        if (iframe.parentNode !== videoWrapper || videoWrapper.dataset.mainVideoState !== "loading") return;
        if (videoWrapper.mainVideoLoadTimer) {
          clearTimeout(videoWrapper.mainVideoLoadTimer);
          videoWrapper.mainVideoLoadTimer = null;
        }
        const thumbnail = videoWrapper.querySelector("#videoThumb");
        const currentPlayButton = videoWrapper.querySelector("#playBtn");
        iframe.classList.remove("opacity-0", "pointer-events-none");
        if (thumbnail) thumbnail.classList.add("hidden");
        if (currentPlayButton) {
          currentPlayButton.classList.add("hidden");
          currentPlayButton.disabled = false;
          currentPlayButton.removeAttribute("aria-busy");
        }
        videoWrapper.dataset.mainVideoState = "ready";
        if (lesson.videoProvider === "bunny_embed") createWatermark(videoWrapper, email);
        else clearWatermarkFrom(videoWrapper);
      };

      iframe.addEventListener("load", finishLoading, { once: true });
      iframe.addEventListener("error", () => resetMainVideoPlayer(videoWrapper, iframe), { once: true });
      videoWrapper.appendChild(iframe);
      iframe.src = videoUrl;
      videoWrapper.mainVideoLoadTimer = setTimeout(() => resetMainVideoPlayer(videoWrapper, iframe), 15000);
    }

    function playMainVideo(videoWrapper, lesson, email) {
      if (!videoWrapper || !lesson) return;
      if (videoWrapper.dataset.mainVideoState === "loading" || videoWrapper.dataset.mainVideoState === "ready") return;
      if (isCocCocBrowser()) {
        videoWrapper.innerHTML = getCocCocBlockedHtml();
        clearWatermarkFrom(videoWrapper);
        return;
      }
      if (!isMobileDevice()) {
        videoWrapper.innerHTML = getPCBlockedHtml();
        clearWatermarkFrom(videoWrapper);
        return;
      }

      const videoUrl = lessonVideoUrl(lesson);
      if (!videoUrl) return;
      if (videoUrl.includes("drive.google.com")) {
        const fileId = getGoogleDriveFileId(videoUrl);
        if (fileId) {
          const returnUrl = window.location.href;
          const playerUrl = `/gdrive-player.html?id=${encodeURIComponent(fileId)}&returnUrl=${encodeURIComponent(returnUrl)}`;
          videoWrapper.dataset.mainVideoState = "loading";
          try {
            openGoogleDrivePlayer(playerUrl, returnUrl);
          } catch (error) {
            resetMainVideoPlayer(videoWrapper);
          }
          return;
        }
      }

      mountMainVideoIframe(videoWrapper, videoUrl, lesson, email);
    }'''
text = replace_between(text, "    function getIframePlayerHtml(url) {", "\n\n    function toggleRecipeMore() {", player, "main player")

media = r'''    function formatSupplementalVideoNumber(index) {
      return String(index + 1).padStart(2, "0");
    }

    function getSupplementalVideoLabelHtml(index) {
      return `<span class="supplemental-video-label">${formatSupplementalVideoNumber(index)}</span>`;
    }

    function swapToHeroPlaceholder(imgEl) {
      if (imgEl && !imgEl.dataset.fb) {
        imgEl.dataset.fb = "1";
        imgEl.src = HERO_PLACEHOLDER_IMAGE;
      }
    }

    function getSupplementalVideoCoverImgHtml(lesson) {
      const coverSrc = normalizeGoogleDriveImageUrl(lesson?.thumbnailUrl || HERO_PLACEHOLDER_IMAGE);
      return `<img src="${escapeHtml(coverSrc)}" alt="" class="absolute inset-0 w-full h-full object-cover opacity-60" loading="lazy" onerror="swapToHeroPlaceholder(this)">`;
    }

    function getSupplementalPlayButtonHtml(onclickJs) {
      return `<button type="button" class="gdrive-play-button" aria-label="Mở video" onclick="${onclickJs}"><span class="gdrive-play-icon" aria-hidden="true"></span></button>`;
    }

    function playSupplementalBunny(containerId) {
      const container = document.getElementById(containerId);
      if (!container || container.dataset.played) return;
      container.dataset.played = "1";
      const url = container.dataset.bunnyUrl || "";
      container.innerHTML = `<iframe class="absolute inset-0 w-full h-full border-0" src="${escapeHtml(url)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="origin"></iframe>`;
      createWatermark(container, studentEmail);
    }

    function playSupplementalYouTube(containerId) {
      const container = document.getElementById(containerId);
      if (!container || container.dataset.played) return;
      container.dataset.played = "1";
      const ytId = container.dataset.ytId || "";
      container.innerHTML = `<iframe class="absolute inset-0 w-full h-full border-0" src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    }

    function renderMediaItems(lesson) {
      const section = document.getElementById("mediaItemsSection");
      if (!section) return;
      section.querySelectorAll("[data-bunny-media-container]").forEach(c => clearWatermarkFrom(c));

      const parsedItems = parseMediaUrls(lesson?.mediaUrls);
      if (parsedItems.length === 0) {
        section.classList.add("hidden");
        section.innerHTML = "";
        return;
      }

      let supplementalVideoIndex = 0;
      const html = parsedItems.map(item => {
        const safeTitle = escapeHtml(item.title || "");
        const captionHtml = renderMediaCaption(item.caption);
        if (item.type === "video") {
          let url = extractIframeSrc(item.url).replace(/&amp;/g, "&").trim();
          if (url.startsWith("error:")) {
            return `<div class="bg-red-50 text-red-700 border border-red-200 rounded-2xl p-4 mb-4 font-semibold text-sm">⚠️ ${escapeHtml(url.replace("error:", ""))}</div>`;
          }
          const label = getSupplementalVideoLabelHtml(supplementalVideoIndex++);
          const header = `<div class="px-4 pt-3 pb-2 flex items-center gap-2">${label}${safeTitle ? `<span class="font-bold text-sm text-brandBrown">${safeTitle}</span>` : ""}</div>`;
          const coverImg = getSupplementalVideoCoverImgHtml(lesson);
          const ytId = getYouTubeVideoId(url);
          if (ytId) {
            const containerId = "yt_media_" + Math.random().toString(36).slice(2, 11);
            return `<div class="bg-white border border-brandBrown/5 rounded-2xl overflow-hidden shadow-sm mb-4">${header}<div id="${containerId}" class="aspect-video relative bg-black flex items-center justify-center" data-yt-id="${escapeHtml(ytId)}">${coverImg}${getSupplementalPlayButtonHtml(`playSupplementalYouTube('${containerId}')`)}</div>${captionHtml ? `<div class="px-4 pb-4">${captionHtml}</div>` : ""}</div>`;
          }
          const driveId = getGoogleDriveFileId(url);
          if (driveId) {
            const returnUrl = window.location.href;
            const playerUrl = `/gdrive-player.html?id=${encodeURIComponent(driveId)}&returnUrl=${encodeURIComponent(returnUrl)}`;
            return `<div class="bg-white border border-brandBrown/5 rounded-2xl overflow-hidden shadow-sm mb-4">${header}<div class="aspect-video relative bg-black flex items-center justify-center">${coverImg}${getGoogleDrivePlayButtonHtml(playerUrl, returnUrl)}</div>${captionHtml ? `<div class="px-4 pb-4">${captionHtml}</div>` : ""}</div>`;
          }
          if (url.includes("mediadelivery.net") || url.includes("bunnycdn.com")) {
            url = url.replace(/^https?:\/\/player\.mediadelivery\.net\//, "https://iframe.mediadelivery.net/").replace(/\/play\//, "/embed/");
            const containerId = "bunny_media_" + Math.random().toString(36).slice(2, 11);
            return `<div class="bg-white border border-brandBrown/5 rounded-2xl overflow-hidden shadow-sm mb-4">${header}<div id="${containerId}" class="aspect-video relative bg-black flex items-center justify-center" data-bunny-media-container data-bunny-url="${escapeHtml(url)}">${coverImg}${getSupplementalPlayButtonHtml(`playSupplementalBunny('${containerId}')`)}</div>${captionHtml ? `<div class="px-4 pb-4">${captionHtml}</div>` : ""}</div>`;
          }
          const isImage = /\.(jpg|jpeg|png|webp|gif|svg)(?:\?.*)?$/i.test(url);
          if (isImage) {
            return `<div class="bg-white border border-brandBrown/5 rounded-2xl overflow-hidden shadow-sm mb-4">${header}<div class="p-4"><img src="${escapeHtml(url)}" alt="${safeTitle}" class="w-full rounded-xl object-contain max-h-[400px]" loading="lazy"/>${captionHtml}</div></div>`;
          }
          return `<div class="bg-white border border-brandBrown/5 rounded-2xl overflow-hidden shadow-sm p-4 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div class="flex-1">${header}${captionHtml}</div><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="px-4 py-2 bg-brandGreen hover:bg-brandGreen/90 text-white font-bold text-xs rounded-xl">Mở video ↗</a></div>`;
        }
        if (item.type === "youtube") {
          const ytId = getYouTubeVideoId(item.url);
          if (!ytId) return "";
          const label = getSupplementalVideoLabelHtml(supplementalVideoIndex++);
          const header = `<div class="px-4 pt-3 pb-2 flex items-center gap-2">${label}${safeTitle ? `<span class="font-bold text-sm text-brandBrown">${safeTitle}</span>` : ""}</div>`;
          const containerId = "yt_media_" + Math.random().toString(36).slice(2, 11);
          const coverImg = getSupplementalVideoCoverImgHtml(lesson);
          return `<div class="bg-white border border-brandBrown/5 rounded-2xl overflow-hidden shadow-sm mb-4">${header}<div id="${containerId}" class="aspect-video relative bg-black flex items-center justify-center" data-yt-id="${escapeHtml(ytId)}">${coverImg}${getSupplementalPlayButtonHtml(`playSupplementalYouTube('${containerId}')`)}</div>${captionHtml ? `<div class="px-4 pb-4">${captionHtml}</div>` : ""}</div>`;
        }
        if (item.type === "image") {
          let imgSrc = extractIframeSrc(item.url).replace(/&amp;/g, "&").trim();
          imgSrc = normalizeGoogleDriveImageUrl(imgSrc);
          return `<div class="bg-white border border-brandBrown/5 rounded-2xl overflow-hidden shadow-sm mb-4">${safeTitle ? `<div class="px-4 pt-4 font-bold text-sm text-brandBrown">${safeTitle}</div>` : ""}<div class="p-4"><img src="${escapeHtml(imgSrc)}" alt="${safeTitle}" class="w-full rounded-xl object-contain max-h-[400px]" loading="lazy"/>${captionHtml}</div></div>`;
        }
        return "";
      }).filter(Boolean).join("");

      if (!html) {
        section.classList.add("hidden");
        section.innerHTML = "";
        return;
      }

      section.innerHTML = `<div class="font-black text-brandGreen text-base flex items-center gap-2 mb-3 mt-6"><span>🎬</span> TÀI LIỆU BỔ SUNG</div>${html}`;
      section.classList.remove("hidden");
    }'''
text = replace_between(text, "    function renderMediaItems(lesson) {", "\n\n    // ── Load Lesson Details", media, "supplemental media")

click_start = "            playBtn.onclick = () => {"
click_end = "\n          } else {\n            videoBox.classList.add(\"hidden\");"
start = text.find(click_start)
if start < 0:
    raise SystemExit("missing main play click start")
end = text.find(click_end, start)
if end < 0:
    raise SystemExit("missing main play click end")
text = text[:start] + "            playBtn.onclick = () => playMainVideo(videoWrapper, currentLesson, studentEmail);" + text[end:]

required = [
    "function playMainVideo(",
    "function mountMainVideoIframe(",
    "function playSupplementalBunny(",
    "function playSupplementalYouTube(",
    "function renderMediaCaption(",
    'thirdPipe = trimmed.indexOf("|", secondPipe + 1)',
    "playBtn.onclick = () => playMainVideo(",
]
for needle in required:
    if needle not in text:
        raise SystemExit(f"missing required result: {needle}")

forbidden = [
    "Video bảo mật phát qua Google Drive",
    "playBtn.onclick = () => {\n              if (isCocCocBrowser())",
]
for needle in forbidden:
    if needle in text:
        raise SystemExit(f"old media behavior still present: {needle}")

path.write_text(text, encoding="utf-8")

marker = "<!-- SCRIPT LOGIC -->"
marker_pos = text.find(marker)
script_start = text.find("<script>", marker_pos)
script_end = text.find("</script>", script_start)
if marker_pos < 0 or script_start < 0 or script_end < 0:
    raise SystemExit("cannot isolate main inline script")
Path("/tmp/lesson-inline.js").write_text(text[script_start + len("<script>"):script_end], encoding="utf-8")
