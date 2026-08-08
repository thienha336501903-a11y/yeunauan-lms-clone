# Bài học (Lesson) — Nhận nhầm ảnh chính thành video (lớp nút Play)

**Trạng thái:** Điều tra chỉ-đọc (read-only), **không sửa code, không đổi dữ liệu, không commit, không deploy.**
**Ngày:** 2026-07-24
**Chi nhánh / worktree:** HEAD tách rời (detached) `2ff095a` — `…/_worktrees/restore-test-B04`.
**Cây làm việc:** chỉ file báo cáo này được thêm; **không file nguồn nào bị sửa**.
**Trang tái hiện lỗi (production):** `https://www.daubepnho.store/lesson.html?id=e11e603f-f256-4c7a-b94f-28e6754f294`
**Bài ví dụ:** Bài 3 — "Cách đóng gói hút chân không".
**Phương pháp:** Đọc-trace nguồn (server handler → payload → client render) đối chiếu hai cơ chế phân loại media chính vs media bổ sung; xác minh tên trường `shortcutDetails` bằng grep toàn repo.
**Kỹ năng áp dụng:** `superpowers:systematic-debugging` — Phase 1 (Root Cause Investigation).

---

## 1. Hiện tượng (symptom)

Ở Bài 3 "Cách đóng gói hút chân không", **media chính thực tế là một ảnh** nhưng giao diện đang xử lý như video:

- Ảnh bị phủ **nút ▶ Play ở giữa** giống thumbnail video.
- Khi nhấn có thể kích hoạt logic player không cần thiết.
- **Media bổ sung (supplemental) bên dưới vẫn hiển thị đúng** là ảnh — bất đối xứng: cùng một ảnh dạng, hai kết quả khác nhau.

Đây là lỗi **nhận dạng (classification)**, không phải lỗi tải/hiển thị: ảnh vẫn hiện (lấy từ thumbnail Drive), nhưng bị "khoác áo" video.

---

## 2. Kết luận gốc rễ (root cause) — tóm tắt

Media chính dùng **phân loại động qua Google Drive API** (server hỏi `files.get` lấy `mimeType`), trong khi media bổ sung dùng **trường `type` lưu sẵn trong CSDL** (không hỏi Drive). Khi bước hỏi Drive thất bại hoặc trả về mime không khớp ảnh/video, server trả `mainMediaType:"unknown"` + `mainMediaMimeType:""` rỗng. Client **xử lý `"unknown"` như video** (chỉ công nhận đúng chuỗi `"image"` mới là ảnh), dẫn đến vẽ nút Play đè lên thumbnail ảnh.

**Đúng hơn:** lỗi nằm ở **đường hầm failure-path** kết hợp **thiết kế client coi "unknown" = video**, KHÔNG phải do sai tên trường `shortcutDetails`.

---

## 3. Đính chính quan trọng (correction)

Một bản tóm tắt nội bộ trước đó từng ghi nghi vấn "sai tên trường `shortcutDetail` (số ít) → typo là nguyên nhân". **Nghi vấn này bị bác bỏ** sau khi đối chiếu trực tiếp nguồn. Tất cả tham chiếu dùng dạng **số nhiều `shortcutDetails` (đúng)**:

```
utils/lms-media.js:65          metadata?.shortcutDetails?.targetId          ← đúng
utils/lms-media.js:66          metadata.shortcutDetails.targetId            ← đúng
utils/lms-handlers/lesson.js:119     fields: "...,shortcutDetails"          ← đúng
utils/lms-handlers/lesson.js:258     fields: "...,shortcutDetails,capabilities"  ← đúng
utils/lms-handlers/lesson.js:265-266 shortcutDetails?.targetId              ← đúng
utils/lms-handlers/course-data.js:125,226,234-235,239                       ← đúng
utils/lms-handlers/public-lesson.js:124,131-132,136                         ← đúng
```

Grep toàn repo cho `shortcutDetail` (số ít) **không trả về kết quả nào**. **Tên trường không phải nguyên nhân** và không cần sửa.

---

## 4. Hai cơ chế phân loại khác nhau (bất đối xứng)

### 4a. Media BỔ SUNG — dùng `type` lưu sẵn → luôn đúng

`vendor/lms-media.js` `parseMediaLine` (dòng 48–62) đọc **trường `type` đầu tiên** của dòng `mediaUrls` (định dạng `type|title|url|caption`), do admin nhập/grant khi lưu bài. **Không hỏi Google Drive.** Vì vậy ảnh bổ sung luôn render đúng bất kể Drive có truy cập được hay không.

### 4b. Media CHÍNH — phân loại động qua Drive API → có thể hỏng

`video_url` của bài (URL ảnh chính) **không mang đuôi file** (dạng `drive.google.com/file/d/{id}/view`), nên server không thể đoán loại bằng đuôi. Server phải gọi Drive để biết `mimeType`. Nếu bước gọi đó hỏng → `"unknown"`.

Đây là **gốc bất đối xứng**: media chính phụ thuộc mạng/Drive/SA ở runtime; media bổ sung thì không.

---

## 5. Đường hầm lỗi (failure path) — trace đầy đủ

### Bước S1 — Server không đoán được loại bằng đuôi
`utils/lms-media.js` `resolveMainMediaInfo` (dòng 47–83):
- URL rỗng → `"none"`.
- `classifyMediaType({url})` đoán bằng đuôi. Đuôi ảnh/video → trả luôn. **Drive `/view` không có đuõi → `"unknown"`** → tiếp tục xuống dưới.
- Trích `fileId`. Không có fileId / không có fetcher → `"unknown"`.
- `try { fetchDriveMetadata }` rồi `classifyMediaType` theo `mimeType`/`name`.

### Bước S2 — Bước hỏi Drive thất bại → "unknown"
Cùng hàm, dòng 63–82:
```js
try {
  let metadata = await fetchDriveMetadata(fileId);
  if (metadata?.mimeType === "application/vnd.google-apps.shortcut" && metadata?.shortcutDetails?.targetId) {
    metadata = await fetchDriveMetadata(metadata.shortcutDetails.targetId); // giải shortcut
  }
  const mainMediaType = classifyMediaType({ url, mimeType: metadata?.mimeType || "", name: metadata?.name || "" });
  return { mainMediaType, mainMediaMimeType: metadata?.mimeType || "", mainMediaName: metadata?.name || "" };
} catch (err) {
  return { mainMediaType: "unknown", mainMediaMimeType: "", mainMediaName: "" };
}
```
Hai nhánh tạo ra `"unknown"`:
1. **`files.get` ném lỗi** → bắt tại dòng 80 → `unknown` + mime rỗng. (Xem §7 về các nguyên nhân ném lỗi.)
2. **Gọi thành công nhưng `mimeType` không khớp** `image/*` hay `video/*` (xem `classifyMediaType` dòng 35–45) → `classifyMediaType` trả `"unknown"`.

Cả hai đều cho cùng kết quả wire: `mainMediaType:"unknown"`, `mainMediaMimeType:""`.

### Bước S3 — Server gắn vào payload, không fail request
`utils/lms-handlers/lesson.js`:
- Dòng 549–565: `resolveMainMediaInfo(lessonResolved.video_url, fileId => getDriveFileMetadataCached(fileId, timing))` chạy trong `Promise.all`.
- Dòng 619: `...mainMediaInfo` trải (spread) vào `formattedLesson`.
- Bản thân `resolveMainMediaInfo` **nuốt lỗi của chính nó** (try/catch ở S2) nên request vẫn 200, bài vẫn tải — chỉ là `mainMediaType` bị `"unknown"`.

### Bước S4 — Client phân loại lại, "unknown" không thành "image"
`lesson.html` `getMainMediaType` (dòng 917–926):
```js
const serverType = String(lesson?.mainMediaType || "").toLowerCase().trim();
if (serverType === "image" || serverType === "video") return serverType;   // "unknown" KHÔNG qua
const mime = String(lesson?.mainMediaMimeType || "").toLowerCase().trim();
if (mime.startsWith("image/")) return "image";                              // mime rỗng KHÔNG qua
if (mime.startsWith("video/")) return "video";
return inferMainMediaTypeFromUrl(lesson?.videoUrl || lesson?.secureVideoUrl || ""); // URL /view → "unknown"
```
→ `getMainMediaType` trả `"unknown"`.

`isMainMediaImage` (dòng 928–930): `return getMainMediaType(lesson) === "image";` → **chỉ đúng `"image"` mới true**. `"unknown"` → **false**.

### Bước S5 — Client coi "unknown" như video
`lessonVideoUrl` (dòng 1013–1032):
```js
if (isMainMediaImage(lesson)) return "";        // false, nên không về ""
...
return secure || raw;                            // Drive URL không rỗng → trả URL video
```
→ `lessonVideoUrl` trả **URL không rỗng** → `hasVideo = Boolean(lessonVideoUrl(...))` → **true**.

### Bước S6 — Render vẽ nút Play lên thumbnail ảnh
Hai nhánh render đồng nhất (hard-load dòng 1486–1528; SPA-swap dòng 1884–1934):
```js
const hasMainImage = isMainMediaImage(currentLesson);   // false
const hasVideo = Boolean(lessonVideoUrl(currentLesson)); // true
if (hasMainImage) { ...getMainImageHtml... }            // BỎ QUA
else if (hasVideo) {
  videoThumb.src = normalizeGoogleDriveImageUrl(currentLesson.thumbnailUrl || HERO_PLACEHOLDER_IMAGE); // = CHÍNH ảnh thumbnail
  playBtn.onclick = () => { ...iframe player... };      // ▶ Play button ở giữa
}
```
→ **Ảnh thumbnail bị gắn nút ▶ Play ở giữa**, đúng triệu chứng. Nhấn → logic player (còn bị chặn PC/CocCoc, thêm lấn cấn).

**Media bổ sung** đi `parseMediaUrls` → `type:"image"` từ CSDL → nhánh ảnh riêng, không qua `hasVideo` → **hiển thị đúng**, khớp quan sát.

---

## 6. Tại sao lỗi tái lập mỗi lần tải (reproducible)

`utils/lms-handlers/lesson.js` cache Drive-metadata (dòng 217–246): TTL 120s, **chỉ ghi cache khi fetch thành công** (`driveMetaCacheSet` gọi sau `await getDriveFileMetadata` ở dòng 243–244). **Lỗi không được cache.** Vì vậy một thất bại cố định (phân quyền/mime) **lặp lại y hệt mỗi request** — không tự khỏi, cũng không "thỉnh thoảng tốt".

---

## 7. Nguyên nhân hàng đầu của bước S2 (tại sao Drive trả "unknown")

Tên trường đã đúng, nên `"unknown"` chỉ đến từ **một trong các lý do thực**:

1. **`files.get` ném lỗi** (bắt ở dòng 80). Khả năng cao nhất:
   - **Khoảng trống phân quyền per-file**: Service Account chỉ có scope `drive.readonly` + `documents.readonly` (`lesson.js:98-101`). Scope toàn-cục **không đảm bảo** truy cập từng file — nếu file ảnh (hoặc **đích của shortcut**) **không được share trực tiếp cho `GOOGLE_CLIENT_EMAIL`** thì `files.get` ném `403`. Shortcut giải ở dòng 66 cũng ném tương tự nếu đích không share.
   - File bị xoá / ra khỏi Drive / chuyển private.
2. **`files.get` thành công nhưng `mimeType` không khớp** `image/*`/`video/*`: ví dụ Drive trả `application/vnd.google-apps.shortcut` mà **không có `shortcutDetails.targetId`** (shortcut hỏng), hoặc file là Google Docs/Sheet (không phải ảnh/video) → `classifyMediaType` về `"unknown"`.
3. (ít khả năng) **fileId không trích được** từ URL lưu → rơi nhánh dòng 59–61 `"unknown"` mà chưa kịp gọi Drive.

**Không thể xác định 100% nhánh nào** trong phạm vi chỉ-đọc/không-sửa-code: cần hoặc log server (xem §9) hoặc gọi Drive API thử bằng SA (xem §10) — cả hai ngoài scope điều tra này.

---

## 8. Yếu tố góp phần (contributing factors)

- **URL Drive không đuôi file**: `video_url` dạng `/file/d/{id}/view` khiến đoán-by-đuôi (S1) vô dụng → bắt buộc phụ thuộc Drive API runtime cho media chính.
- **Client thiết kế "unknown" = video**: `isMainMediaImage` chỉ chấp nhận đúng `"image"`; `lessonVideoUrl` trả URL không rỗng cho `"unknown"` → `hasVideo` true. **Đây là điểm thiết kế khiến failure server biến thành symptom hiển thị.**
- **Lỗi không cache** (§6) → tái lập.
- **Log mù của operator**: theo báo cáo handover §5.2/§6, log Vercel production trả **403** cho các query theo `level`/`error`/5xx → **lỗi Drive-lookup vô hình** với người vận hành; lỗi âm thầm tồn tại mà không cảnh báo.
- **Bất đối xứng hai cơ chế** (§4): dễ gây ảo giác "ảnh thì vẫn hiện được, sao bài này lại hỏng" — thực ra media bổ sung đi nhánh khác không phụ thuộc Drive.

---

## 9. Bước thu thập chứng cứ KHÔNG sửa code (cho bên thứ 3 / owner)

Mục đích: xác định nhánh S2 cụ thể (lỗi phân quyền vs mime vs fileId) mà không động code.

1. **Mở DevTools → Network** trên trang lỗi, tải lại. Tìm request `GET /api/lms/portal?endpoint=lesson&id=e11e603f-...`. Xem JSON trả về, kiểm tra:
   - `lesson.videoUrl` (URL ảnh chính — xác nhận dạng `/view` không đuôi).
   - `lesson.mainMediaType` → kỳ vọng `"unknown"`.
   - `lesson.mainMediaMimeType` → kỳ vọng `""` (rỗng).
   - `lesson.thumbnailUrl` (nguồn ảnh đang hiện dưới nút Play).
   - `lesson.mediaUrls` (media bổ sung — kỳ vọng các dòng `image|...|...`).
2. **Trích `fileId`** từ `lesson.videoUrl` (phần `file/d/(...)/`).
3. **Kiểm tra phân quyền file** bằng `GOOGLE_CLIENT_EMAIL` của SA (xem `getGoogleAuth` `lesson.js:91-103`): mở trình duyệt ẩn danh, thử `https://drive.google.com/file/d/{fileId}/view` — nếu **403/yêu cầu quyền** → **xác nhận nhánh 1 (khoảng trống phân quyền)**: file chưa share cho SA. Đây là **dấu hiệu mạnh nhất**.
4. Nếu file mở được công khai (xem được ảnh) nhưng SA vẫn `unknown` → nghi **shortcut đích không share** (nhánh 1 con) hoặc **mime không ảnh/video** (nhánh 2).
5. (Tùy chọn) **Gọi Drive API thử** bằng chính SA (xem §10) để lấy `mimeType` + `shortcutDetails` thật — đây là cách chốt sạch nhất nhưng cần credential, **không dùng credential production nếu chưa được owner cho phép**.

---

## 10. Xác minh trực tiếp bằng Service Account (ngoài scope điều tra, gợi ý)

Nếu owner đồng ý, bên thứ 3 có thể chạy (một lần, độc lập, không sửa app):
```bash
# Trích fileId từ URL rồi:
gcloud  # hoặc node script dùng googleapis với cùng GOOGLE_CLIENT_EMAIL/PRIVATE_KEY
drive.files.get({ fileId, fields: "id,name,mimeType,shortcutDetails", supportsAllDrives:true })
```
- Ném lỗi 403 → **nhánh phân quyền** (§7.1): fix = share file/đích-shortcut cho SA email.
- Trả `mimeType` không phải `image/*`/`video/*` → **nhánh mime** (§7.2): file đó không phải ảnh/video thật, cần xem lại dữ liệu bài.
- Trả `application/vnd.google-apps.shortcut` mà **không có `shortcutDetails.targetId`** → shortcut hỏng: cần tạo lại shortcut hoặc đổi `video_url` sang file đích thật.

---

## 11. Hướng khắc phục (gợi ý, KHÔNG thực hiện trong scope này)

Không sửa code trong scope điều tra. Ghi lại để bên thứ 3 đánh giá, theo thứ tự tác động/độ rủi ro:

- **Sửa dữ liệu (rủi ro thấp nhất, có thể đủ):** share file ảnh (và/hoặc đích shortcut) cho `GOOGLE_CLIENT_EMAIL`; hoặc đổi `video_url` của bài sang URL có đuôi `.jpg/.png` / sang file đích thật. Có thể giải quyết ngay không cần code.
- **Sửa client (gốc symptom):** ở `lesson.html`, coi `"unknown"` an toàn hơn (ví dụ: khi mime rỗng và URL là ảnh-thumbnail, ưu tiên nhánh ảnh) — nhưng cần cẩn thận regress video thật (xem `docs/MEDIA_REGRESSION.md` về black-frame SPA-nav).
- **Sửa server:** log/telemetry lỗi Drive-lookup (hiện vô hình do log Vercel 403); cân nhắc cache-negative ngắn để giảm tải; cân nhắc trả `mainMediaType:"image"` khi chỉ có thumbnail-ảnh mà không xác định được.
- **Giám sát:** bật được query log Vercel theo lỗi để lộ failure-path (theo handover §5.2/§6).

Bất kỳ sửa code nào đều cần qua cổng duyệt owner + reviewer độc lập theo quy trình repo; không tự mở rộng (theo handover §8: không tự mở V3/DB migration/token rotation/routing/auth/E2E/force-push/tag V1).

---

## 12. Bằng chứng dòng lệnh (evidence anchors)

| Vai trò | File:Dòng | Ghi chú |
|---|---|---|
| Scope SA | `utils/lms-handlers/lesson.js:91-103` | `drive.readonly`+`documents.readonly` |
| `fields` đúng số nhiều | `utils/lms-handlers/lesson.js:119,258,265-266,270` | `shortcutDetails` |
| Drive get (không try/catch cục bộ) | `utils/lms-handlers/lesson.js:115-123` | lỗi lan ra `resolveMainMediaInfo` |
| Cache: lỗi không lưu | `utils/lms-handlers/lesson.js:217-246` | chỉ set khi success |
| Gọi resolve + spread payload | `utils/lms-handlers/lesson.js:549-565,619` | request vẫn 200 |
| Phân loại server (try/catch → unknown) | `utils/lms-media.js:47-83` | catch dòng 80 |
| `classifyMediaType` | `utils/lms-media.js:35-45` | mime-first, else đuôi, else unknown |
| Tên trường đúng số nhiều | `utils/lms-media.js:65-66` | `shortcutDetails` |
| Routing lesson | `api/lms/portal.js:25-27` | `endpoint==="lesson"` |
| Client `getMainMediaType`/`isMainMediaImage` | `lesson.html:917-930` | chỉ "image" mới true |
| Client `lessonVideoUrl` (unknown→URL) | `lesson.html:1013-1032` | `return secure||raw` |
| Client đoán-by-URL | `lesson.html:908-915` | `/view`→unknown |
| Render hard-load (nút Play) | `lesson.html:1486-1528` | hasVideo true → Play |
| Render SPA-swap (nút Play) | `lesson.html:1884-1934` | đồng nhất |
| Media bổ sung (type lưu sẵn) | `vendor/lms-media.js:48-62` | không hỏi Drive → đúng |

---

## 13. Kết luận

- **Nguyên nhân gốc:** media chính của Bài 3 là ảnh Google Drive nhưng `video_url` không đuôi → server phải hỏi Drive để phân loại; bước hỏi **thất bại (phân quyền per-file trên file/đích-shortcut, khả năng cao nhất) hoặc trả mime không ảnh/video** → `mainMediaType:"unknown"`. Client **coi `"unknown"` như video** (`isMainMediaImage` chỉ nhận `"image"`; `lessonVideoUrl` trả URL không rỗng) → render **nút ▶ Play đè lên thumbnail ảnh**.
- **Media bổ sung đúng** vì đọc `type` lưu sẵn trong CSDL (`vendor/lms-media.js`), không phụ thuộc Drive.
- **Tên trường `shortcutDetails` đúng số nhiều khắp repo** — nghi vấn "typo số ít" **bị bác bỏ**, không phải nguyên nhân, không cần sửa.
- **Lỗi tái lập** vì cache chỉ ghi khi thành công; **vô hình với operator** vì log Vercel production 403 theo handover.
- **Không sửa code** trong scope này. Bên thứ 3 chạy §9/§10 để chốt nhánh S2 cụ thể; §11 là gợi ý hướng khắc phục sau khi có chứng cứ.
