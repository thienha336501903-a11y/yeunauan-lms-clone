# Bài học (Lesson) — Nhận nhầm video chính thành ảnh (mất nút Play, video không mở)

**Trạng thái:** Điều tra chỉ-đọc (read-only), **không sửa code, không đổi dữ liệu, không commit, không deploy.**
**Ngày:** 2026-07-24
**Chi nhánh / worktree:** HEAD tách rời (detached) `2ff095a` — `…/_worktrees/restore-test-B04`.
**Cây làm việc:** chỉ file báo cáo này được thêm; **không file nguồn nào bị sửa**.
**Bản production đang chạy:** commit `67de9338cba94f1316d47f7fb3dc35a3be43ffba`, deployment `dpl_E6ZR1L8iFqAkP9yBFVekkcX9PWAR` (`READY / PROMOTED`) — xác nhận `lesson.html` deployed **byte-identical** với `67de933:lesson.html` (0 diff).
**Phiên sửa lỗi liên quan:** `docs/MAIN_MEDIA_MISCLASSIFICATION_FIX_AND_PRODUCTION_REPORT_2026-07-24.md` (sửa lỗi "ảnh chính bị nhận nhầm thành video", đã deploy).
**Phương pháp:** Đọc-trace ngược từ symptom render → phân loại client → payload server → Drive lookup; đối chiếu bản deployed `67de933` với báo cáo sửa lỗi phiên gần nhất và với `lms.html` chưa được sửa.
**Kỹ năng áp dụng:** `superpowers:systematic-debugging` — Phase 1 (Root Cause Investigation).

---

## 1. Hiện tượng (symptom)

Sau khi sửa lỗi "ảnh chính bị nhận nhầm thành video" (commit `67de933`), nhiều bài học có **video chính** không còn được nhận diện/hiển thị đúng:

- (a) Khu vực media chính vẫn chiếm chỗ.
- (b) Tiêu đề hoặc nội dung fallback có thể xuất hiện.
- (c) Ở giữa có **biểu tượng ảnh/video lỗi** (broken image icon).
- (d) **Không có thumbnail video đúng.**
- (e) **Không có nút ▶ Play đúng.**
- (f) **Video chính không mở được.**
- (g) **Media bổ sung bên dưới vẫn hiển thị bình thường.**

Đây là **hồi quy ngược (inverse regression)** của lỗi vừa sửa: trước đây ảnh bị khoác áo video (nút Play đè lên ảnh); nay video bị tước áo video (nút Play biến mất, chỉ còn ảnh gãy). Cùng một cơ chế phân loại, hai chiều hỏng ngược nhau.

---

## 2. Kết luận gốc rễ (root cause) — tóm tắt

Bản sửa `67de933` đã thêm **`return "image";`** làm **fallback cuối cùng** trong `getMainMediaType` (`lesson.html:958`). Mục đích hợp lệ: đóng lỗi "ảnh bị nhận nhầm thành video" cho bản ghi cũ không marker.

Nhưng cùng fallback đó **cũng nuốt luôn video không thể phân loại**. Một **video chính** thỏa đủ ba điều kiện:

1. **Không có marker `lms_media_type`** trong URL (bản ghi cũ, tạo trước commit `d1512e8`), và
2. **Drive `files.get` lookup thất bại** ở server (khoảng trống phân quyền per-file, token SA hết hạn, file bị xoá, hoặc mime không phải image/video) → server catch trả `mainMediaType:"unknown"` + `mainMediaMimeType:""` + `mainMediaName:""`, và
3. **URL là Drive opaque** (`/file/d/{id}/view` hoặc `uc?id=`, không có đuôi file),

thì **mọi tín hiệu phân loại đều cạn**: marker không có → server type `unknown` không khớp → mime rỗng → tên rỗng → URL không đuôi → rơi đúng vào `return "image";` (dòng 958). Khi đó `isMainMediaImage` → `true` → `lessonVideoUrl` trả `""` → `hasVideo` → `false` → render đi **nhánh ảnh** thay vì nhánh video. Nhánh ảnh vẽ một `<img>` trỏ tới `drive.google.com/thumbnail?id={videoFileId}&sz=w1000` (endpoint thumbnail **cũng có thể 403** với cùng khoảng trống phân quyền, và **không có `onerror`** để rơi về placeholder) → **biểu tượng ảnh gãy**, **không có nút Play**, và **video không mở được** (`playMainVideo` early-return tại dòng 1201 vì `videoUrl` rỗng).

**Đúng hơn:** lỗi nằm ở **mặc định một chiều `"unknown" → "image"`** của bản `67de933`. Upstream chung của cả hai bug (ảnh-bị-nhận-nhầm-thành-video và video-bị-nhận-nhầm-thành-ảnh) là **Drive metadata lookup thất bại → trạng thái `unknown` rỗng tín hiệu**. Một mặc định một chiều chỉ có thể đúng cho **một trong hai** {ảnh thất bại, video thất bại} và **cố tình sai cho cái còn lại**. Bản sửa đã đóng bug ảnh và **mở bug video**.

---

## 3. Vì sao đây là hồi quy ngược của bản `67de933` (không phải bug mới độc lập)

Báo cáo sửa lỗi phiên gần nhất (`...FIX_AND_PRODUCTION_REPORT...`, §6.1) đã tuyên bố:

> "video có tín hiệu rõ vẫn được nhận là video trước khi chạm fallback. Fallback chỉ áp dụng cho bản ghi cũ không marker, không MIME, không filename và có URL Drive opaque."

Tuyên bố này **chỉ đúng khi video CÒN ÍT NHẤT MỘT tín hiệu** (marker / server-type / mime / filename). Nó **sai khi video KHÔNG CÓ tín hiệu nào** — đúng tình huống "Drive lookup thất bại + bản ghi cũ + URL opaque". Trong tình huống đó, video và ảnh **không thể phân biệt** ở client (cùng `unknown` + cùng rỗng + cùng URL opaque), nên mặc định `"image"` **bắt buộc phải sai** với video.

Đáng chú ý: báo cáo root-cause **gốc** (`...MAIN_MEDIA_MISCLASSIFICATION_ROOT_CAUSE_2026-07-24.md`, §11) đã cảnh báo trước chính dạng fix này:

> "Sửa client: coi `'unknown'` an toàn hơn ... nhưng cần cẩn thận regress video thật (xem `docs/MEDIA_REGRESSION.md` về black-frame SPA-nav)."

Cảnh báo đó **không được bản `67de933` đáp ứng** — fallback một chiều `return "image"` không có cơ chế nào bảo vệ video thật không-tín-hiệu.

---

## 4. Hai cơ chế phân loại vẫn bất đối xứng (giải thích triệu chứng g)

- **Media bổ sung** (`vendor/lms-media.js` `parseMediaLine`, dòng 48–62): đọc **trường `type` lưu sẵn trong CSDL** (`type|title|url|caption`), **không hỏi Drive**. → Luôn render đúng, bất kể Drive có truy cập được hay không. Đây là lý do triệu chứng (g) "media bổ sung vẫn bình thường".
- **Media chính**: phân loại **động qua Drive API** ở runtime. Khi bước hỏi hỏng → `unknown` → rơi fallback. → Bị ảnh hưởng bởi hồi quy.

Cùng bất đối xứng như bug trước — chỉ khác là giờ nhánh "động qua Drive" hỏng theo chiều **ngược lại** (video bị ém thành ảnh thay vì ảnh bị phình thành video).

---

## 5. Đường hầm lỗi (failure path) — trace đầy đủ trên bản deployed `67de933`

### Bước V1 — Server: Drive lookup thất bại → "unknown" rỗng tín hiệu
`utils/lms-media.js` `resolveMainMediaInfo` (dòng 47–83):
- URL opaque không đuôi → `classifyMediaType({url})` → `"unknown"` → không trả sớm.
- Trích `fileId`; `try { fetchDriveMetadata }` (dòng 63–79).
- **`catch` (dòng 80–82)** trả `{ mainMediaType: "unknown", mainMediaMimeType: "", mainMediaName: "" }`.

→ Payload bài học vẫn HTTP 200 (lỗi bị nuốt, spread vào `formattedLesson`), nhưng `mainMediaType` = `"unknown"`, mime rỗng, name rỗng. **Đây chính là trạng thái "rỗng tín hiệu" — nguồn chung của cả hai bug.**

### Bước V2 — Client: cạn sạch tín hiệu → fallback "image"
`lesson.html` `getMainMediaType` (dòng 929–958), bản deployed verbatim:
```js
function getMainMediaType(lesson) {
  const explicitType = getExplicitMainMediaType(lesson?.videoUrl || lesson?.secureVideoUrl || "");
  if (explicitType) return explicitType;                       // (V2a) marker không có → bỏ qua
  const serverType = String(lesson?.mainMediaType || "").toLowerCase().trim();
  if (serverType === "image" || serverType === "video") return serverType;  // (V2b) "unknown" → bỏ qua
  const mime = String(lesson?.mainMediaMimeType || "").toLowerCase().trim();
  if (mime.startsWith("image/")) return "image";               // (V2c) mime rỗng → bỏ qua
  if (mime.startsWith("video/")) return "video";
  const nameType = inferMainMediaTypeFromText(lesson?.mainMediaName || "");
  if (nameType !== "unknown") return nameType;                 // (V2d) name rỗng → "unknown" → bỏ qua
  const urlType = inferMainMediaTypeFromText(lesson?.videoUrl || lesson?.secureVideoUrl || "");
  if (urlType !== "unknown") return urlType;                   // (V2e) URL opaque không đuôi → "unknown" → bỏ qua
  // ... comment ...
  return "image";                                              // (V2f) DÒNG 958 — nuốt video thành ảnh
}
```
Cho video rỗng-tín-hiệu, cả năm nhánh V2a–V2e đều **không khớp**, nên kết quả là `return "image";` (dòng 958). **Đây là dòng gây hồi quy.**

### Bước V3 — isMainMediaImage → true
`isMainMediaImage` (dòng 961): `return getMainMediaType(lesson) === "image";` → **`true`**.

### Bước V4 — lessonVideoUrl → "" (video bị tắt)
`lessonVideoUrl` (dòng 1046):
```js
function lessonVideoUrl(lesson) {
  const secure = lesson?.secureVideoUrl || "";
  const raw = lesson?.videoUrl || "";
  if (isMainMediaImage(lesson)) {   // true
    return "";                        // ← video bị trả rỗng
  }
  ... // bunny / youtube / drive / fallback: không bao giờ tới
}
```
→ `hasVideo = Boolean(lessonVideoUrl(...))` → **`false`**.

### Bước V5 — Render đi nhánh ảnh, không nhánh video
Hai nhánh render đồng nhất (hard-load dòng 1559–1578; SPA-swap dòng 1936–1969):
```js
const hasMainImage = isMainMediaImage(currentLesson);    // true
const hasVideo = Boolean(lessonVideoUrl(currentLesson)); // false
if (hasMainImage) {
  // videoBox.classList.remove("hidden");
  videoWrapper.innerHTML = getMainImageHtml(currentLesson);   // ← đi NHÁNH ẢNH
} else if (hasVideo) {
  // videoThumb.src = ...; playBtn.onclick = () => playMainVideo(...);   // ← NHÁNH VIDEO BỊ BỎ QUA
} else {
  videoBox.classList.add("hidden");
}
```
→ Renderer vẽ `getMainImageHtml` thay vì thumbnail + nút Play. **Đây là điểm render biến phân loại sai thành triệu chứng hiển thị.**

### Bước V6 — getMainImageHtml vẽ thumbnail gãy, không có nút Play
`getMainImageHtml` (dòng 969–978):
```js
function getMainImageHtml(lesson) {
  const src = escapeHtml(mainMediaImageUrl(lesson));   // = normalizeGoogleDriveImageUrl(videoUrl)
  const title = escapeHtml(lesson?.title || "Hinh anh bai hoc");
  return `
    <div class="relative w-full h-full flex items-center justify-center bg-brandCream">
      <img src="${src}" alt="${title}" class="w-full h-full object-contain bg-brandCream" loading="lazy" />
    </div>`;
}
```
- `mainMediaImageUrl` (dòng 965–966): `normalizeGoogleDriveImageUrl(lesson?.videoUrl || ...)`.
- `normalizeGoogleDriveImageUrl` (dòng 900–907): với Drive URL → `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`.

Với **file video** (đặc biệt khi cùng khoảng trống phân quyền khiến thumbnail cũng 403, hoặc video không có thumbnail công khai), endpoint `thumbnail?id={videoFileId}` trả **ảnh gãy/403** → **biểu tượng ảnh/video lỗi ở giữa** (triệu chứng c, d). **`<img>` trong `getMainImageHtml` KHÔNG có `onerror`** (xác nhận tại dòng 969–978) nên không rơi về `HERO_PLACEHOLDER_IMAGE` mà giữ nguyên icon gãy.

> Lưu ý phân biệt: `onerror="swapToHeroPlaceholder(this)"` tồn tại ở **dòng 1260**, nhưng đó là `<img>` **COVER của section-header** (`object-cover opacity-60`) — **không phải** `<img>` media chính trong `getMainImageHtml`. Hai ảnh khác nhau, chỉ ảnh chính mới gãy không có fallback.

Không có `playBtn` trong nhánh ảnh → **không có nút ▶ Play** (triệu chứng e).

### Bước V7 — Video không mở được
Dù render đi nhánh ảnh, `playMainVideo` vẫn được tham chiếu bởi `playBtn.onclick` ở nhánh video (dòng 1576 / 1969) — nhưng **nhánh video không được chạy**, nên không có handler Play nào gắn. Ngay cả khi user somehow gọi `playMainVideo`, dòng 1201 vẫn chặn:
```js
const videoUrl = lessonVideoUrl(lesson);   // "" (vì isMainMediaImage true)
if (!videoUrl) return;                       // dòng 1201 — early return, không mở player
```
→ **Video chính không mở được** (triệu chứng f).

### Bước V8 — Media bổ sung không ảnh hưởng
`parseMediaUrls`/`parseMediaLine` (`vendor/lms-media.js`) đọc `type` từ CSDL → đi nhánh ảnh/video riêng theo `type`, **không qua `getMainMediaType`/`hasVideo`**. → **Media bổ sung bình thường** (triệu chứng g).

---

## 6. Ánh xạ 7 triệu chứng (tất cả khớp)

| # | Triệu chứng báo | Giải thích từ trace |
|---|---|---|
| a | Khu vực media chính vẫn chiếm chỗ | Nhánh ảnh `videoBox.classList.remove("hidden")` + `getMainImageHtml` vẽ container `w-full h-full`. |
| b | Tiêu đề/fallback xuất hiện | `getMainImageHtml` đặt `alt="${title}"` (title bài học); khi ảnh gãy, trình duyệt hiện alt text. |
| c | Biểu tượng ảnh/video lỗi ở giữa | `mainMediaImageUrl` = `drive.google.com/thumbnail?id={videoFileId}` — 403/gãy cho file video; `<img>` không `onerror` (dòng 969–978) → giữ icon gãy. |
| d | Không có thumbnail video đúng | Nhánh ảnh dùng endpoint **thumbnail**, không phải thumbnail riêng của video; cùng khoảng trống phân quyền → gãy. |
| e | Không có nút ▶ Play đúng | Nhánh ảnh không có `playBtn`; `playBtn` chỉ được gắn ở nhánh video (1576/1969) vốn bị bỏ qua. |
| f | Video chính không mở được | `lessonVideoUrl` → `""` (V4); `playMainVideo` early-return tại dòng 1201; không có handler Play nào gắn. |
| g | Media bổ sung bình thường | `parseMediaLine` đọc `type` lưu sẵn trong CSDL, không phụ thuộc Drive → không bị ảnh hưởng. |

Cả 7 triệu chứng đều nhất quán với **một** cơ chế: video rỗng-tín-hiệu bị fallback `"image"` đẩy sang nhánh ảnh.

---

## 7. Gốc chung: Drive lookup thất bại → trạng thái "unknown rỗng tín hiệu"

Cả bug cũ (ảnh → video) và bug mới (video → ảnh) đều khởi từ **cùng một upstream failure**:
- Server `resolveMainMediaInfo` bắt lỗi Drive `files.get` → `{ mainMediaType: "unknown", mainMediaMimeType: "", mainMediaName: "" }` (`utils/lms-media.js:80-82`).
- Hoặc Drive trả mime không phải `image/*`/`video/*` → `classifyMediaType` → `"unknown"` (dòng 35–45).

Trạng thái này **không mang thông tin** để phân biệt ảnh thật với video thật. Do đó:
- **Trước `67de933`:** client coi `unknown` = video → ảnh bị phình thành video (bug cũ).
- **Sau `67de933`:** client coi `unknown` = ảnh → video bị ém thành ảnh (bug mới).

**Một mặc định một chiều không thể đúng cho cả hai.** Đây là vì sao bản sửa bug ảnh lại mở bug video — không phải bug độc lập, mà là **hai mặt của cùng một thất bại upstream**.

Các nguyên nhân khiến Drive lookup thất bại (không đổi so với báo cáo gốc, vẫn không xác định được nhánh cụ thể trong scope chỉ-đọc):
1. **Khoảng trống phân quyền per-file**: SA chỉ có scope `drive.readonly`+`documents.readonly` (`utils/lms-handlers/lesson.js:91-103`); nếu file video (hoặc đích shortcut) không được share trực tiếp cho `GOOGLE_CLIENT_EMAIL` → `files.get` ném 403.
2. **Token SA hết hạn** (đúng ví dụ trong comment bản `67de933` dòng 954–957).
3. **File bị xoá / ra khỏi Drive / chuyển private.**
4. **Mime không phải image/video** (Google Docs/Sheet, shortcut hỏng không `shortcutDetails.targetId`).

> **Quan trọng cho chẩn đoán phân biệt bug cũ vs bug mới:** nếu file bị ảnh hưởng là **ảnh** → bug cũ (trước fix) / nay đã sửa; nếu file bị ảnh hưởng là **video** → bug mới (sau fix). Cùng khoảng trống phân quyền có thể ảnh hưởng cả ảnh lẫn video; bản `67de933` chỉ cứu được ảnh, đẩy video sang phía bên kia.

---

## 8. Hồi quy ngược chéo trang (cross-page divergence) — `lms.html` chưa được sửa

Bản `67de933` **chỉ thay `lesson.html`** (`git show --stat 67de933`: đúng 2 file `lesson.html` + `tests/lesson-main-video-play.test.mjs`; `git log 2ff095a..67de933 -- lms.html` **rỗng**). Hậu quả:

- `lesson.html` (deployed `67de933`): `getMainMediaType` kết thúc bằng **`return "image";`** (dòng 958) → `unknown` → **ảnh**. → Bị **bug mới** (video → ảnh).
- `lms.html` (deployed không đổi, `getMainMediaType` dòng 586): kết thúc bằng `return inferMainMediaTypeFromUrl(...)` → `unknown` → **vẫn `unknown`** (không fallback `image`). `isMainMediaImage` (dòng 597) `if (mediaType !== "unknown") return false;` → `unknown` → **không phải ảnh** → vẫn đi nhánh video. → **Bug cũ (ảnh → video) vẫn còn trên trang list/detail mobile/desktop.**

Tức là sau bản `67de933`, hai trang **phân loại khác nhau** cho cùng trạng thái `unknown`:
- `lesson.html`: `unknown` → ảnh (sửa được bug ảnh, mở bug video).
- `lms.html`: `unknown` → video (vẫn còn bug ảnh).

Đây là **sự bất nhất chéo trang mà bản `67de933` không thừa nhận** — cùng một bài học có thể hiện nút Play ảo trên `lms.html` nhưng hiện ảnh gãy trên `lesson.html`.

---

## 9. Lỗ hổng test (coverage blind spot) — vì sao CI không bắt được hồi quy

`tests/lesson-main-video-play.test.mjs` (deployed, test 3 "uses the Drive file name before its opaque URL") có bốn assertion:

| # | Input | Kỳ vọng | Nhánh giải |
|---|---|---|---|
| 3i | `unknown` + name `...jpg` + opaque URL | `"image"` | `nameType` (V2d) — có tín hiệu tên |
| 3ii | `unknown` + name `...mp4` + opaque URL | `"video"` | `nameType` (V2d) — có tín hiệu tên |
| 3iii | server `video` + marker `lms_media_type=image` | `"image"` | `explicitType` (V2a) — có marker |
| 3iv | `unknown` + name `""` + mime `""` + opaque URL | `"image"` | **fallback (V2f, dòng 958)** |

**Lỗ hổng:** test 3iv khóa chặt `unknown (rỗng tín hiệu) → "image"` nhưng **không có assertion ngược `unknown (rỗng tín hiệu) → "video"`**. Test 3ii có case video nhưng **mang tên file** (`Huong dan dong goi.mp4`) nên được giải bởi nhánh `nameType` (V2d), **không chạm fallback** — nó không bảo vệ chống việc fallback nuốt video rỗng-tín-hiệu.

Tóm lại: test suite **không có một case "video không-tín-hiệu phải vẫn là video"** → hồi quy **không thể bị CI phát hiện**. Đây là vì sao bản `67de933` pass test mà vẫn mở bug production.

> Test 1 ("main Drive video opens the dedicated player on the first Play tap") và test 2 ("hard-load and SPA share one-tap Play handler") kiểm tra **luồng video đã được phân loại đúng**, không kiểm tra **phân loại** — nên cũng không bắt được.

---

## 10. Vì sao lỗi tái lập (reproducible) và vô hình với operator

- **Tái lập:** cache Drive-metadata (`utils/lms-handlers/lesson.js:217-246`) **chỉ ghi cache khi fetch thành công**; lỗi không được cache → một thất bại cố định (phân quyền/token/mime) **lặp lại y hệt mỗi request**.
- **Vô hình:** theo handover §5.2/§6, log Vercel production trả **403** cho các query theo `level`/`error`/5xx → lỗi Drive-lookup **không hiển thị** với người vận hành; bug tồn tại âm thầm.
- **Marker không có:** marker `lms_media_type` (commit `d1512e8`) chỉ có ở **upload mới**; bản ghi cũ không mang → rơi đúng nhánh fallback.

---

## 11. Hướng khắc phục (gợi ý, KHÔNG thực hiện trong scope này)

Không sửa code trong scope điều tra. Ghi lại để bên thứ 3 đánh giá, theo thứ tự tác động/độ rủi ro:

- **Sửa dữ liệu (rủi ro thấp nhất, có thể đủ):** share file video (và/hoặc đích shortcut) cho `GOOGLE_CLIENT_EMAIL` để Drive `files.get` thành công → server trả đúng `mainMediaType:"video"` + mime + name → không bao giờ chạm fallback. Đây là cách **chống cả hai bug cùng lúc** ở nguồn upstream.
- **Bổ sung marker cho bản ghi cũ:** gắn `lms_media_type=video` vào `video_url` của các bài video cũ (qua admin) → client dùng nhánh `explicitType` (V2a) → không chạm fallback. Cần migration dữ liệu có chủ đích, không tự mở rộng (theo handover §8).
- **Sửa fallback một chiều:** thay `return "image";` (dòng 958) bằng cơ chế **không mặc định một chiều** — ví dụ giữ `unknown` và render như **poster tĩnh không-nút-Play nhưng vẫn cho mở video** (không vẽ nút Play ảo, không tắt `lessonVideoUrl`), hoặc dùng tín hiệu khác (Drive thumbnail có thể render? `videoProvider`? `secureVideoUrl`?) để phân biệt. **Bất kỳ cách nào cũng phải thêm assertion ngược `unknown (rỗng tín hiệu) → "video"` trong test** (lấp lỗ hổng §9).
- **Đồng bộ `lms.html`:** bất kỳ fix nào cũng phải áp dụng cho `lms.html:586` để hai trang phân loại nhất quán — nếu không, bug cũ tiếp tục tồn tại trên list/detail.
- **Sửa server:** log/telemetry lỗi Drive-lookup (hiện vô hình do log Vercel 403); cân nhắc cache-negative ngắn; cân nhắc trả marker `mainMediaType` rõ ràng hơn cho video (không để video rơi về `unknown` rỗng).
- **Giám sát:** bật query log Vercel theo lỗi để lộ failure-path (theo handover §5.2/§6).

Bất kỳ sửa code nào đều cần qua cổng duyệt owner + reviewer độc lập theo quy trình repo; không tự mở rộng (theo handover §8: không tự mở V3/DB migration/token rotation/routing/auth/E2E/force-push/tag V1).

---

## 12. Bước thu thập chứng cứ KHÔNG sửa code (cho bên thứ 3 / owner)

Mục đích: chốt rằng các bài bị ảnh hưởng đúng là **video rỗng-tín-hiệu** (xác nhận cơ chế V1–V8) và xác định nhánh Drive-lookup thất bại cụ thể.

1. **DevTools → Network** trên một bài video bị lỗi, tải lại. Tìm `GET /api/lms/portal?endpoint=lesson&id=...`. Xem JSON:
   - `lesson.videoUrl` — xác nhận dạng Drive opaque không đuôi.
   - `lesson.mainMediaType` → kỳ vọng `"unknown"`.
   - `lesson.mainMediaMimeType` → kỳ vọng `""`.
   - `lesson.mainMediaName` → kỳ vọng `""`.
   - `lesson.mediaUrls` (bổ sung) → kỳ vọng `type` đúng (`video|...` hoặc `image|...`).
2. **Trích `fileId`** từ `lesson.videoUrl`. Mở ẩn danh `https://drive.google.com/file/d/{fileId}/view`:
   - **403/yêu cầu quyền** → **xác nhận nhánh phân quyền** (§7.1): file video chưa share cho SA → share để sửa **cả hai bug cùng lúc**.
   - Mở được nhưng là video → SA vẫn `unknown` → nghi **token SA** (§7.2) hoặc **mime** (§7.4).
3. (Tùy chọn, cần owner cho phép) **Gọi Drive API thử** bằng SA: `drive.files.get({ fileId, fields: "id,name,mimeType,shortcutDetails", supportsAllDrives:true })` — 403 = phân quyền; mime không image/video = nhánh mime; shortcut hỏng = cần tạo lại.

---

## 13. Bằng chứng dòng lệnh (evidence anchors) — bản deployed `67de933:lesson.html`

| Vai trò | File:Dòng | Ghi chú |
|---|---|---|
| Placeholder ảnh | `lesson.html:477` | `HERO_PLACEHOLDER_IMAGE` (data URI) |
| Trích Drive fileId | `lesson.html:876` | `getGoogleDriveFileId` |
| Chuẩn hóa → thumbnail | `lesson.html:900-907` | `normalizeGoogleDriveImageUrl` → `drive.google.com/thumbnail?id=...&sz=w1000` |
| Đoán loại bằng đuôi | `lesson.html:909-916` | `inferMainMediaTypeFromText` (URL opaque → `unknown`) |
| Đọc marker upload | `lesson.html:918-924` | `getExplicitMainMediaType` (`lms_media_type`) |
| **Phân loại client (fallback gây hồi quy)** | `lesson.html:929-958` | `getMainMediaType`; **`return "image";` tại dòng 958** |
| `isMainMediaImage` | `lesson.html:961` | chỉ đúng `"image"` mới true |
| URL ảnh cho nhánh ảnh | `lesson.html:965-966` | `mainMediaImageUrl` = `normalizeGoogleDriveImageUrl(videoUrl)` |
| **HTML nhánh ảnh (KHÔNG onerror)** | `lesson.html:969-978` | `getMainImageHtml` — `<img>` gãy không rơi placeholder |
| Tắt video khi là ảnh | `lesson.html:1046-1050` | `lessonVideoUrl` `if (isMainMediaImage) return "";` |
| **Early-return chặn mở video** | `lesson.html:1201` | `if (!videoUrl) return;` trong `playMainVideo` |
| Cover section-header (có onerror, KHÔNG phải ảnh chính) | `lesson.html:1244,1249,1260` | `swapToHeroPlaceholder` — phân biệt với `getMainImageHtml` |
| Render hard-load (nhánh ảnh vs video) | `lesson.html:1559-1578` | `hasMainImage`/`hasVideo`; ảnh 1566, Play 1576 |
| SPA reset | `lesson.html:1885-1890` | `videoThumb.src=""`, `playBtn.onclick=null` |
| Render SPA-swap (nhánh ảnh vs video) | `lesson.html:1936-1969` | đồng nhất với hard-load |
| Server: catch → unknown rỗng | `utils/lms-media.js:80-82` | nguồn upstream chung hai bug |
| Server: classify (mime→ext→unknown) | `utils/lms-media.js:35-45` | mime không image/video → unknown |
| Server: SA scope | `utils/lms-handlers/lesson.js:91-103` | `drive.readonly`+`documents.readonly` |
| Server: Drive get (không try/catch cục bộ) | `utils/lms-handlers/lesson.js:115-123` | lỗi lan ra catch `resolveMainMediaInfo` |
| Server: cache lỗi không lưu | `utils/lms-handlers/lesson.js:217-246` | → tái lập |
| **Test blind spot** | `tests/lesson-main-video-play.test.mjs` (test 3, case 3iv) | `unknown rỗng → "image"`; thiếu case ngược `unknown rỗng → "video"` |
| **Chéo trang: `lms.html` không được `67de933` sửa** | `lms.html:586,597` | vẫn `unknown`→video → bug cũ còn trên list/detail |

---

## 14. Kết luận

- **Nguyên nhân gốc của hồi quy mới:** bản sửa lỗi `67de933` thêm **`return "image";`** làm fallback cuối cùng trong `getMainMediaType` (`lesson.html:958`). Một **video chính rỗng-tín-hiệu** (không marker `lms_media_type` + Drive `files.get` thất bại → server `mainMediaType:"unknown"` + mime rỗng + name rỗng + URL Drive opaque) làm cạn sạch năm nhánh phân loại V2a–V2e và rơi đúng fallback → `isMainMediaImage` true → `lessonVideoUrl` `""` → `hasVideo` false → render đi **nhánh ảnh** (`getMainImageHtml`, vẽ `drive.google.com/thumbnail?id={videoFileId}` gãy, không có `onerror`, không có nút Play) → **biểu tượng ảnh/video lỗi, không thumbnail video, không nút Play, video không mở được**; media bổ sung bình thường vì đọc `type` lưu sẵn. Khớp tất cả 7 triệu chứng.
- **Đây là hồi quy ngược của bug ảnh vừa sửa**, không phải bug độc lập: cùng upstream "Drive lookup thất bại → `unknown` rỗng tín hiệu"; mặc định một chiều `"unknown" → "image"` chỉ đúng cho ảnh thất bại, cố tình sai cho video thất bại. Báo cáo root-cause gốc (§11) đã cảnh báo trước dạng fix này nhưng không được đáp ứng.
- **Chéo trang:** `lms.html` không được `67de933` sửa → vẫn `unknown`→video → **bug cũ (ảnh→video) còn trên list/detail**; hai trang giờ phân loại khác nhau.
- **Lỗ hổng test:** test 3 khóa `unknown rỗng → "image"` mà không có assertion ngược `unknown rỗng → "video"` → CI không thể phát hiện hồi quy; case video trong test 3 mang tên file nên giải bởi nhánh `nameType`, không chạm fallback.
- **Lỗi tái lập** (cache chỉ ghi khi thành công) và **vô hình** (log Vercel 403).
- **Không sửa code** trong scope này. Bên thứ 3 chạy §12 để chốt các bài bị ảnh hưởng đúng là video rỗng-tín-hiệu và xác định nhánh Drive-lookup thất bại; §11 là gợi ý hướng khắc phục sau khi có chứng cứ — lưu ý phải lấp lỗ hổng test (§9) và đồng bộ `lms.html` (§8) để không mở bug ngược lại.
