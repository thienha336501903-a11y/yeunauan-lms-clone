# Báo cáo sửa lỗi và triển khai production — Media chính bị nhận nhầm thành video

**Ngày thực hiện:** 2026-07-24  
**Sự cố:** Ảnh chính của bài học bị hiển thị như video, có nút ▶ Play phủ lên ảnh  
**Trang tái hiện:** `https://www.daubepnho.store/lesson.html?id=e11e603f-f256-4c7a-b94f-28e6754f294`  
**Bài ví dụ:** Bài 3 — “Cách đóng gói hút chân không”  
**Trạng thái cuối:** Đã sửa và triển khai production thành công  
**Production deployment:** `dpl_E6ZR1L8iFqAkP9yBFVekkcX9PWAR`  
**Production commit:** `67de9338cba94f1316d47f7fb3dc35a3be43ffba`  
**Vercel status:** `READY / PROMOTED`

---

## 1. Mục tiêu của phiên làm việc

Phiên làm việc có hai mục tiêu:

1. Đọc và kiểm chứng báo cáo nguyên nhân gốc:
   `docs/MAIN_MEDIA_MISCLASSIFICATION_ROOT_CAUSE_2026-07-24.md`.
2. Sửa failure-path khiến media chính chưa xác định được loại bị mặc định thành video, sau đó đưa bản sửa đã kiểm thử lên production.

Phạm vi được giữ hẹp:

- Không sửa dữ liệu bài học.
- Không thay đổi quyền Google Drive hoặc credential.
- Không sửa `shortcutDetails`, vì báo cáo đã chứng minh tên trường số nhiều đang đúng.
- Không thay đổi database, migration, routing hoặc authentication.
- Không force-push hoặc ghi đè nhánh `main`.

---

## 2. Kết luận kỹ thuật được xác nhận

### 2.1. Failure-path phía server

URL media chính là URL Google Drive dạng opaque, không có đuôi ảnh/video. Server phải gọi Drive API để lấy metadata.

Khi metadata lookup thất bại hoặc không đủ thông tin phân loại, payload có dạng:

```json
{
  "mainMediaType": "unknown",
  "mainMediaMimeType": "",
  "mainMediaName": ""
}
```

Request bài học vẫn trả thành công vì lỗi metadata được bắt và chuyển thành trạng thái `"unknown"`.

### 2.2. Failure-path phía client

Trước khi sửa:

- Client chỉ coi đúng `"image"` là ảnh.
- `"unknown"` không qua nhánh ảnh.
- URL Drive vẫn được `lessonVideoUrl()` chuyển thành URL preview video.
- `hasVideo` trở thành `true`.
- Renderer vẽ thumbnail và nút ▶ Play.

Kết quả là ảnh thật bị trình bày như một video.

### 2.3. Vì sao media bổ sung vẫn đúng

Media bổ sung dùng trường `type` đã được lưu trong `mediaUrls`, nên không phụ thuộc vào Drive metadata lookup lúc runtime. Đây là nguyên nhân tạo ra sự bất đối xứng giữa media chính và media bổ sung.

### 2.4. Nghi vấn typo đã bị loại trừ

Không có lỗi `shortcutDetail` số ít. Code đang dùng đúng:

```js
shortcutDetails
```

Không thực hiện bất kỳ thay đổi nào đối với trường này.

---

## 3. Khảo sát code và ràng buộc hồi quy

Các khu vực đã được đối chiếu:

- `utils/lms-media.js`: phân loại media và fallback `"unknown"`.
- `utils/lms-handlers/lesson.js`: lấy Drive metadata, cache và gắn thông tin media vào payload.
- `lesson.html`: phân loại lại ở client, tạo URL video và render hard-load/SPA.
- `lms.html`: helper phân loại tương tự cho danh sách và mobile/desktop detail.
- `vendor/lms-media.js`: parser media bổ sung.
- `docs/MEDIA_REGRESSION.md`: lỗi black-frame SPA trước đây và cấu trúc placeholder đã được sửa.

Ràng buộc chính:

- Không phá video đã được xác định rõ qua marker, MIME, filename hoặc server type.
- Không làm sống lại lỗi black-frame khi điều hướng SPA.
- Không dùng thumbnail làm bằng chứng tuyệt đối rằng media là ảnh, vì video cũng có thumbnail.
- Với media không thể xác minh, hành vi an toàn hơn là poster tĩnh thay vì cung cấp nút Play sai.

---

## 4. Bản vá thử nghiệm trong worktree

Trước khi phát hiện artifact đã review sẵn, một bản vá cục bộ đã được tạo để kiểm chứng hướng xử lý.

### 4.1. File được sửa cục bộ

- `lesson.html`
- `lms.html`
- `tests/main-media-classification.test.mjs` — test mới

### 4.2. Hành vi của bản thử cục bộ

- Chấp nhận riêng server type `"none"` để bài không có media không rơi xuống `"unknown"`.
- Nếu media type là `"unknown"` nhưng có URL hoặc thumbnail, hiển thị như poster tĩnh.
- Video đã xác nhận vẫn đi theo nhánh video.
- Cả hard-load và SPA của `lesson.html` dùng chung helper nên cùng nhận hành vi mới.
- `lms.html` được sửa đồng nhất để desktop/mobile không phân loại khác trang lesson.

### 4.3. Test của bản thử cục bộ

Test mới kiểm tra:

1. URL Drive opaque + type `"unknown"` → được coi là ảnh tĩnh.
2. Server type `"video"` → vẫn là video.
3. MIME `video/mp4` → vẫn là video.
4. Server type `"none"` → không bị coi thành ảnh dù có course poster.

Kết quả:

```text
4 tests
4 pass
0 fail
```

`git diff --check` cũng pass.

---

## 5. Kết quả chạy toàn bộ test suite

Lệnh đã chạy:

```bash
node --test tests/*.test.mjs
```

Kết quả:

```text
276 tests
270 pass
6 fail
```

Sáu lỗi không nằm trong phần media vừa sửa:

- Hai test file không khởi động vì thiếu `SUPABASE_URL` hoặc `SUPABASE_SERVICE_ROLE_KEY`.
- Bốn test session/deferTouch gọi hostname test `rp2b1-test.supabase.co`, nhưng hostname không phân giải được; response nhận `fetch failed`/status khác kỳ vọng.

Các test hồi quy media mới đều pass. Không có failure nào trỏ tới `lesson.html`, `lms.html` hoặc logic phân loại media vừa thay đổi.

---

## 6. Phát hiện bản sửa đã review và có Preview sẵn

Trong lúc chuẩn bị production, lịch sử Git và Vercel được kiểm tra lại.

Phát hiện repo đã có commit xử lý đúng sự cố:

```text
67de933 fix(lms): default unclassifiable main media to image
```

Commit này thay đổi đúng hai file:

```text
lesson.html                           | 11 ++++++++++-
tests/lesson-main-video-play.test.mjs | 10 ++++++++++
2 files changed, 20 insertions(+), 1 deletion(-)
```

Commit đã có Vercel Preview:

```text
Deployment: dpl_9u8fNTHe1u9jN1tusmuKEEAAjKNj
Status: READY
Commit: 67de9338cba94f1316d47f7fb3dc35a3be43ffba
```

### 6.1. Logic của bản được triển khai

Bản `67de933` dùng chuỗi ưu tiên phân loại đầy đủ hơn:

1. Upload marker `lms_media_type` trong URL.
2. `mainMediaType` từ server.
3. `mainMediaMimeType`.
4. `mainMediaName` do Drive trả về.
5. Đuôi file trong URL nếu có.
6. Nếu tất cả tín hiệu đều không xác định được, fallback thành `"image"`.

Điểm quan trọng: video có tín hiệu rõ vẫn được nhận là video trước khi chạm fallback. Fallback chỉ áp dụng cho bản ghi cũ không marker, không MIME, không filename và có URL Drive opaque.

### 6.2. Test hồi quy của bản được triển khai

`tests/lesson-main-video-play.test.mjs` bổ sung trường hợp:

- `mainMediaType: "unknown"`
- `mainMediaMimeType: ""`
- `mainMediaName: ""`
- URL Drive opaque

Kỳ vọng:

```js
getMainMediaType(...) === "image"
```

Test cũ cho ảnh theo filename, video theo filename và marker override vẫn được giữ.

---

## 7. Quyết định triển khai

Không deploy trực tiếp từ worktree hiện tại vì worktree có:

- File báo cáo chưa track.
- Các file planning nội bộ.
- Bản thử cục bộ khác artifact đã review.
- Detached HEAD.

Ngoài ra:

- Vercel project khai báo production branch là `main`.
- Remote `main` đang ở lineage cũ `f9220e8`.
- Production trước phiên này được deploy thủ công từ detached commit `2ff095a`, không phải từ tip của `main`.

Vì vậy không force-push hoặc fast-forward `main`.

Quyết định an toàn là promote chính artifact Preview đã:

- Build thành công.
- Có test hồi quy.
- Gắn đúng commit `67de933`.
- Không chứa file kế hoạch/báo cáo cục bộ.

---

## 8. Triển khai production

### 8.1. Production trước khi triển khai

```text
Deployment: dpl_HbL7zAdCY9HM11QN5wtE6wtE7BQx
Commit: 2ff095ac4af13f637d287b880f9ef40652b324d2
Status: READY / PROMOTED
```

### 8.2. Thao tác promote

Artifact Preview được promote bằng Vercel:

```bash
vercel promote dpl_9u8fNTHe1u9jN1tusmuKEEAAjKNj --yes
```

Vercel tạo production deployment mới:

```text
dpl_E6ZR1L8iFqAkP9yBFVekkcX9PWAR
```

### 8.3. Theo dõi build

Deployment được polling cho đến trạng thái terminal. Trong thời gian build, production alias cũ vẫn phục vụ bình thường; alias không bị chuyển sớm.

Trạng thái cuối:

```text
State: READY
Substate: PROMOTED
Commit: 67de9338cba94f1316d47f7fb3dc35a3be43ffba
Deployment URL: web-lms-chinh-thuc-7vlwbfyy2.vercel.app
```

Alias được gán:

- `www.daubepnho.store`
- `daubepnho.store`
- `web-lms-chinh-thuc.vercel.app`
- Alias mặc định của project/team

---

## 9. Smoke test production

Sau khi deployment đạt `READY / PROMOTED`, các request được gửi kèm cache-busting query và `Cache-Control: no-cache`.

Kết quả:

| Endpoint | Kết quả |
|---|---:|
| `https://www.daubepnho.store/` | HTTP 200 |
| `https://www.daubepnho.store/lms.html` | HTTP 200 |
| Trang lesson tái hiện lỗi | HTTP 200 |
| `/api/lms/portal?endpoint=public-config` | HTTP 200 |

HTML production được kiểm tra và xác nhận có:

- Fallback `return "image"`.
- Logic dùng `mainMediaName`.
- Comment marker của bản sửa “unclassifiable main media”.

Điều này xác nhận domain production đang phục vụ artifact mới, không còn artifact `2ff095a`.

---

## 10. Phân biệt bản thử cục bộ và bản thực tế trên production

Đây là điểm audit quan trọng:

| Hạng mục | Bản thử cục bộ | Bản production |
|---|---|---|
| Nguồn | Worktree detached tại `2ff095a` | Commit đã review `67de933` |
| File source sửa | `lesson.html`, `lms.html` | `lesson.html` |
| Test mới | `tests/main-media-classification.test.mjs` | `tests/lesson-main-video-play.test.mjs` |
| Fallback | `unknown` có media → poster tĩnh | Sau marker/server/MIME/name/URL đều unknown → `"image"` |
| Đã deploy | Không | Có |

Bản production không lấy các thay đổi chưa commit trong worktree. Nó lấy chính tree đã build của Preview `67de933`.

---

## 11. File không được đưa lên production

Các file sau chỉ tồn tại cục bộ trong worktree và không nằm trong artifact production:

- `task_plan.md`
- `findings.md`
- `progress.md`
- `tests/main-media-classification.test.mjs`
- `docs/MAIN_MEDIA_MISCLASSIFICATION_ROOT_CAUSE_2026-07-24.md`
- Báo cáo hiện tại tại thời điểm triển khai
- Các thay đổi thử nghiệm cục bộ trong `lesson.html` và `lms.html`

Không commit hoặc deploy nhầm các file planning.

---

## 12. Kết quả cuối cùng

- Root cause đã được kiểm chứng.
- Nghi vấn typo `shortcutDetails` đã bị loại trừ.
- Failure-path `"unknown" → video` đã được thay bằng fallback ảnh an toàn cho bản ghi cũ không thể phân loại.
- Video có marker, MIME, filename hoặc server type rõ vẫn giữ nguyên luồng video.
- Regression test cho URL Drive opaque đã được thêm trong commit production.
- Artifact đã review được promote, không deploy từ worktree bẩn.
- Deployment production đạt `READY / PROMOTED`.
- Domain production và các endpoint chính đều trả HTTP 200.
- HTML production đã được xác nhận chứa logic fix.

**Trạng thái bàn giao:** Hoàn tất. Production đang chạy commit `67de9338cba94f1316d47f7fb3dc35a3be43ffba`.

