# V3 Production Port Package

## Mục tiêu

Đóng gói V3 Telegram Channel LMS đã kiểm thử trên Clone để có thể port sang hệ thống đang chạy tại `daubepnho.store` mà không thay thế V2 hiện tại và không phải thiết kế lại kiến trúc.

## Baseline Clone ổn định

- Repo: `thienha336501903-a11y/yeunauan-lms-clone`
- Feature branch: `feature/telegram-channel-composer`
- Stable checkpoint: `0a3b8df98a8909c0f389eef1385b88f53d876001`
- Backup branch: `backup/v3-clone-stable-20260813`
- PR: #9 (Draft, chưa merge main)

## Nguyên tắc port sang Production

1. V2 hiện tại phải giữ nguyên hành vi và dữ liệu.
2. V3 là lớp bổ sung, không thay schema bài học/enrollment.
3. Không đổi nghĩa kill switch V1/V2 đang tồn tại trên Production.
4. Khi bổ sung V3, nên có lớp fallback riêng của V3 về V2.
5. Ưu tiên hiệu lực đề xuất:
   - Global emergency kill switch Production đang có -> V1.
   - Nếu không có global kill và V3 emergency switch bật -> V2.
   - Nếu không có kill switch -> mode đã cấu hình V1/V2/V3.
6. Nếu DB/API/runtime config lỗi -> fail-safe về phiên bản ổn định hiện tại (V2 cho nhánh V3).
7. Chỉ route học viên thay đổi theo mode; dữ liệu khóa học, lesson, enrollment, Drive vẫn dùng hệ thống hiện có.

## Thành phần V3 đã kiểm thử trên Clone

### Runtime / routing

- `utils/v3-runtime-controller.js`
  - configured mode
  - effective mode
  - V3 kill switch
  - cache ngắn
  - fail-safe V2
- `api/learning.js`
  - URL học viên chung
  - V3 -> `/v3`
  - V2 có course -> `/lms.html?course=...`
  - V2 không có course -> `/v2-entry.html`
- `utils/lms-handlers/learning-mode.js`
- `utils/lms-handlers/admin-learning-mode.js`
- `system-mode.html`
- `admin-system-shell.html` (prototype tích hợp UI, không dùng nguyên xi trên Production)

### V3 learner

Entry/auth:
- `v3-entry.html`
- `utils/lms-handlers/v3-bootstrap.js`
- `api/lms/portal.js`

Feed stack:
- `channel-candidate.html`
- `channel-v2-safe-ui.html`
- `channel-v2-toc.html`
- `channel-v2-safe.html`
- `channel-v2.html`
- `channel.html`

Tính năng:
- continuous Telegram-style feed
- text dài Xem thêm / Thu gọn
- adaptive mosaic ảnh/video
- media viewer trong trang
- phụ lục tự động theo section/bài
- search, TOC, latest button
- auth/enrollment hiện có
- account chooser bắt buộc khi không có phiên học viên hợp lệ

### V2 resolver dùng cho Clone

- `v2-entry.html`

Lý do tồn tại trên Clone: `lms.html` có fallback course cũ khi URL không có `?course`, nên `/learning` cần resolver để tránh kiểm tra nhầm khóa.

Khi port Production: chỉ mang logic này sang nếu Production có cùng hành vi. Không thay `lms.html` chỉ để phục vụ V3.

### V3 Admin

- `channel-admin-candidate.html`
- `channel-admin-bg-count.html`
- `channel-admin-bg.html`
- `channel-admin.html`

Tính năng:
- Telegram composer
- drag/drop/paste nhiều media
- Background Upload Queue
- IndexedDB resume
- Drive resumable upload 8 MB/chunk
- tối đa 3 file đồng thời, 1 video
- global progress
- giữ thứ tự publish theo course
- course guard bằng `?course=...`
- tự đếm ảnh/video/tài liệu/dung lượng

### Backend dùng chung cần port có chọn lọc

- `utils/lms-handlers/admin-lessons.js`
  - normalize link trùng / Shopee tracking ở description
- `utils/lms-handlers/admin-upload-gdrive-video.js`
  - mở rộng folder helper cho image/video/material

Hai patch này không đổi schema và đã được dùng bởi V3 Admin.

## Database / config

Clone dùng `site_config`:
- `clone_learning_mode`: `v2` | `v3`
- `clone_v3_kill_switch`: boolean

Không có migration schema mới cho V3.

Production nên dùng storage/config runtime hiện có của hệ thống V1/V2 thay vì copy nguyên tên key `clone_*`.

## Auth / session

V3 bootstrap ưu tiên:
1. explicit Google account choice khi người dùng chủ động chọn account;
2. verified LMS session/device nếu còn hợp lệ;
3. student session token;
4. nếu chưa có session -> Google account chooser bắt buộc.

Không bỏ enrollment check. Tài khoản Admin không có enrollment sẽ không vào được lớp V3.

## URL chuẩn trên Clone

- Common learner: `/learning?course=<slug>`
- V3 direct: `/v3?course=<slug>`
- V3 Admin: `/v3-admin?course=<slug>`
- V2 direct: `/lms.html?course=<slug>`
- Integrated Clone Admin prototype: `/admin-system-shell.html`

## Những thứ KHÔNG nên port nguyên xi

- `admin-system-shell.html`: chỉ là shell thử nghiệm vì Clone không có System tab Production gốc. Production phải thêm V3 trực tiếp vào panel Hệ Thống hiện có.
- Tên config `clone_*`.
- Các URL Preview Vercel của Clone.
- Bất kỳ endpoint cleanup test nào (đã xóa khỏi branch).

## Cách tích hợp vào màn Hệ Thống Production

Giữ nguyên V1/V2 hiện tại, thêm card/nút:

- V1 — hệ thống cũ
- V2 — hệ thống học hiện tại
- V3 — Telegram Channel LMS

Hiển thị riêng:
- Mode đã chọn
- Mode hiệu lực
- Global kill switch hiện tại (giữ semantics cũ)
- V3 kill switch (ép V2)

Không dùng một kill switch duy nhất cho cả hai lớp rollback nếu điều đó làm thay đổi semantics hiện có.

## Rollback Production đề xuất

Mức 1 — runtime:
- bật V3 kill switch -> effective V2 ngay, không xóa cấu hình V3.

Mức 2 — mode:
- chuyển configured mode V3 -> V2.

Mức 3 — code:
- revert commit/PR tích hợp V3; V2 không cần migration rollback vì V3 không đổi schema.

## Test matrix trước Production

1. V2 -> V3 -> V2 -> V3 nhiều lần qua URL chung.
2. V3 configured + V3 kill switch ON -> effective V2.
3. Tắt V3 kill -> tự trở lại V3.
4. Global Production kill switch vẫn giữ hành vi V1 cũ.
5. V2 direct URL vẫn hoạt động.
6. V3 direct URL vẫn hoạt động.
7. Google account Admin không có enrollment bị từ chối rõ ràng.
8. Google account học viên có nhiều khóa nhận đúng danh sách.
9. V3 feed: text/media/mosaic/viewer/TOC/search/scroll.
10. V3 Admin: multiple uploads/background queue/F5 resume/order.
11. Không thay baseline course/enrollment.
12. Không còn test data `__clone_factory_test*`.

## Trạng thái cleanup Clone

- 6 bài test đã dọn.
- 43 file Drive test đã dọn.
- Endpoint cleanup tạm đã gỡ khỏi router và repo.

## Quy trình port an toàn

1. Lấy đúng commit/deployment Production hiện chạy làm base.
2. Tạo feature branch mới; không commit trực tiếp main.
3. Tích hợp runtime V3 trước, chưa route traffic.
4. Thêm V3 Admin/learner files.
5. Thêm V3 vào System panel Production.
6. Deploy Preview riêng.
7. Test với tài khoản học viên thật trong Preview.
8. Test V3 kill -> V2 và global kill -> V1.
9. Chỉ sau PASS mới xin xác nhận merge.
10. Sau merge theo dõi runtime/logs; giữ rollback branch/tag.
