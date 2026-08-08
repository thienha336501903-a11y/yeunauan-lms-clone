# Yeubep final launch — preflight dry-run blocker

Thời gian: 2026-07-25 22:18 (Asia/Saigon)

## Kết quả

Quy trình được dừng an toàn trước bước tạo canary.

Exact source:

- HEAD: `c15e27c4ed09592fb8e24a4d32caca672565e782`
- `origin/feature/yeubep-shop`: cùng SHA
- Worktree sạch
- Full test: 63/63
- Learning Boundary: 13/13
- `git diff --check`, Node/HTML syntax: pass
- Secret scan: 0

Backup mới:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_backups\before-yeubep-launch-20260725-221847`

Baseline:

- courses: 8
- orders: 28
- student_enrollments: 20
- lessons: 39
- site_config: 73
- course_slug_mappings: 6

Backup chứa schema, sáu bảng production, counts, checksums và DNS/domain snapshot; JSON đã parse lại và thư mục có ACL riêng.

## Blocker chính xác

`api/register.js` có kiểm tra:

`process.env.EXTERNAL_SYNC_MODE !== "dry-run"`

Nhưng approve/revoke không đi qua guard này.

Đường thực tế:

`api/orders.js` → `syncEnrollmentToExternalSystems()` trong `utils/sync-helpers.js`

Helper này:

- không đọc `EXTERNAL_SYNC_MODE`;
- tạo canonical payload đúng learning slug;
- vẫn POST trực tiếp tới `SYSTEM3_URL/api/sync` và `SYSTEM1_URL/api/sync` nếu URL và `INTERNAL_SYNC_SECRET` tồn tại.

Vì vậy chỉ đặt `EXTERNAL_SYNC_MODE=dry-run` trên Preview không bảo đảm approve/revoke là dry-run. Chạy canary theo cấu hình yêu cầu có nguy cơ tạo external LMS/Portal mutation thật.

## Trạng thái khi dừng

- Không tạo Preview canary.
- Không cấp Supabase production credential cho Preview mới.
- Không tạo hai canary order.
- Không update order/enrollment.
- Không gọi LMS/Portal.
- Clone vẫn inactive/unpublished.
- Không Move/assign domain.
- Không đổi DNS/TXT.
- Không tạo tag.

## Điều kiện để tiếp tục

Cần một thay đổi code được review/test để `syncCourseToExternalSystems` và `syncEnrollmentToExternalSystems` trả dry-run result và payload canonical trước mọi outbox/fetch/email side effect khi `EXTERNAL_SYNC_MODE=dry-run`.

Sau khi có exact commit mới, cần chạy lại từ Phase 124 hoặc ít nhất xác minh backup delta/counts trước khi tạo canary.
