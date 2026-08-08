# Báo cáo Cổng 4A — Production schema migration multi-storefront

Ngày thực hiện: 2026-07-25  
Múi giờ báo cáo: Asia/Saigon (UTC+7)  
Phạm vi được duyệt: chỉ migration schema production có kiểm soát

## 1. Kết luận

Cổng 4A đạt.

- Supabase production: `aqozjkfwzmyfunqvcyjv`
- Trạng thái cuối: `ACTIVE_HEALTHY`
- PostgreSQL: `17.6` (`17.6.1.127` theo project metadata)
- Migration chạy thành công hai lần.
- Lần hai không lỗi và không tạo object trùng.
- Không backfill hoặc sửa/xóa dữ liệu cũ.
- Toàn bộ 7 bảng được đối chiếu semantic với backup và khớp.
- Code production cũ vẫn giữ exact artifact `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`.
- Không rollback vì không có điều kiện rollback nào xảy ra.
- Không deploy code mới, không promote Preview, không đổi domain/DNS/TXT và không sửa LMS/Portal.

## 2. Mốc thời gian

| Mốc | Thời gian UTC+7 |
|---|---|
| Preflight database | 2026-07-25 19:04:13 |
| Migration lần 1 bắt đầu | 2026-07-25 19:05:02.696 |
| Migration lần 1 kết thúc | 2026-07-25 19:05:04.051 |
| Migration lần 2 bắt đầu | 2026-07-25 19:06:23.111 |
| Migration lần 2 kết thúc | 2026-07-25 19:06:23.502 |
| Xác minh database cuối | 2026-07-25 19:11:45 |
| Kết thúc kiểm tra Cổng 4A | 2026-07-25 19:13:22 |

Thời lượng transaction:

- Lần 1: 1,355 giây.
- Lần 2: 0,391 giây.

Không bật maintenance page. Cửa sổ được giữ ngắn; không ghi nhận delta course/order trong cửa sổ.

## 3. Backup được duyệt và bản dự phòng thứ hai

Backup nguồn:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_backups\supabase-before-multistore-20260725-154808`

Bản sao thứ hai:

`C:\Users\gaomi\Documents\CommerceBackupSecondary\supabase-before-multistore-20260725-154808-efs`

Kết quả:

- 17 file nguồn và 17 file đích.
- 17/17 file đích có thuộc tính mã hóa Windows EFS.
- ACL của thư mục đích đã tắt inheritance và chỉ cấp quyền đầy đủ cho tài khoản Windows hiện tại.
- 0 file thiếu.
- 0 SHA-256 mismatch.
- SHA-256 của `checksums.sha256` ở bản sao:
  `04180c3315b0136cf9c57445b6aefe3e56f56a3772d712a9e3742f265b4d7e6a`
- Backup nguồn không bị thay đổi.

Giới hạn: bản dự phòng nằm ở vị trí local riêng nhưng vẫn trên ổ `C:`. EFS bảo vệ nội dung theo tài khoản/chứng chỉ Windows, nhưng không thay thế một bản sao trên ổ vật lý khác khi cần chống hỏng ổ đĩa.

## 4. Preflight

### Project

- Project ref: `aqozjkfwzmyfunqvcyjv`
- Region: `ap-southeast-1`
- Status: `ACTIVE_HEALTHY`
- PostgreSQL server: `17.6`
- Project database version metadata: `17.6.1.127`

### Row counts

| Bảng | Backup | Preflight | Delta |
|---|---:|---:|---:|
| `courses` | 7 | 7 | 0 |
| `orders` | 28 | 28 | 0 |
| `site_config` | 73 | 73 | 0 |
| `course_slug_mappings` | 6 | 6 | 0 |
| `lessons` | 39 | 39 | 0 |
| `portal_post_course_mappings` | 0 | 0 | 0 |
| `student_enrollments` | 20 | 20 | 0 |

Không cần tạo delta export vì toàn bộ count khớp backup.

### Schema và lock

Trước migration, cả năm cột sau đều chưa tồn tại:

- `courses.sales_site`
- `orders.sales_site`
- `orders.sales_host`
- `orders.idempotency_key`
- `orders.price_snapshot`

Không có object của migration chạy dở:

- 0/2 check constraint mục tiêu.
- 0/3 index mục tiêu.

Global unique slug vẫn tồn tại:

`CREATE UNIQUE INDEX courses_slug_key ON public.courses USING btree (slug)`

Lock/transaction:

- 0 ungranted lock trên `courses`/`orders`.
- 0 session khác giữ lock mục tiêu.
- 0 transaction dài hơn 5 phút.

## 5. SQL đã chạy

File:

`migration.sql`

SHA-256 xác minh ngay trước chạy:

`f1ae3cf4f7e65f0a4162104dde87359ed32046edfbe1b3d653a164ae8f4bb7f7`

File byte-identical với bản đã đóng trong backup.

SQL được chạy nguyên trạng, với session guard bên ngoài:

- `lock_timeout = 5s`
- `statement_timeout = 60s`

Migration tự bọc `BEGIN`/`COMMIT`. Không sửa migration trong lúc chạy.

## 6. Kết quả migration lần 1

Lần 1 commit thành công.

Năm cột mới đều:

- Kiểu `text`.
- Nullable.
- Không có default.

Object được tạo:

### Constraints

- `courses_sales_site_check`
- `orders_sales_site_check`

Hai constraint chỉ cho phép:

- `NULL`
- `yeunauan`
- `yeubep`

### Indexes

- `idx_courses_sales_site_active_sort`
  trên `(sales_site, active, sort_order)`
- `idx_orders_sales_site_course_status`
  trên `(sales_site, course_slug, status)`
- `idx_orders_sales_site_idempotency`
  unique partial trên `(sales_site, idempotency_key)`
  khi `idempotency_key IS NOT NULL`

Global unique `courses.slug` vẫn còn đúng một index.

## 7. Transaction tests có rollback

Các test được thực hiện trong transaction/subtransaction và không commit dữ liệu:

- `courses.sales_site = '__invalid_gate4a__'` bị check constraint từ chối.
- `orders.sales_site = '__invalid_gate4a__'` bị check constraint từ chối.
- Hai order cùng tenant và cùng idempotency key test bị unique index từ chối.
- Sau test: 0 course thay đổi tồn tại.
- Sau test: 0 order thay đổi tồn tại.

Không dùng hoặc in dữ liệu khách hàng.

## 8. Kết quả migration lần 2

Chạy lại cùng file và cùng checksum.

- Commit thành công.
- Không lỗi duplicate object.
- Vẫn đúng 5 cột.
- Vẫn đúng 2 constraint.
- Vẫn đúng 3 index.
- Không thay đổi row count.
- Không thay đổi dữ liệu.
- Không phát sinh object dư.

Migration được xác nhận idempotent trên production schema hiện tại.

## 9. Xác minh dữ liệu sau migration

| Bảng | Sau migration |
|---|---:|
| `courses` | 7 |
| `orders` | 28 |
| `site_config` | 73 |
| `course_slug_mappings` | 6 |
| `lessons` | 39 |
| `portal_post_course_mappings` | 0 |
| `student_enrollments` | 20 |

Legacy NULL:

- 7/7 `courses.sales_site` là `NULL`.
- 28/28 `orders.sales_site` là `NULL`.
- 28/28 `orders.sales_host` là `NULL`.
- 28/28 `orders.idempotency_key` là `NULL`.
- 28/28 `orders.price_snapshot` là `NULL`.
- Tổng legacy new-field non-NULL: 0.

Không có backfill.

### Đối chiếu backup

Đã đọc lại dữ liệu production của bảy bảng, bỏ đúng năm cột schema mới khỏi phép so sánh, canonical hóa object/array và so SHA-256 semantic với JSON backup.

Kết quả:

- `courses`: khớp 7/7.
- `orders`: khớp 28/28.
- `site_config`: khớp 73/73.
- `course_slug_mappings`: khớp 6/6.
- `lessons`: khớp 39/39.
- `portal_post_course_mappings`: khớp 0/0.
- `student_enrollments`: khớp 20/20.

Không phát hiện update/delete ngoài dự kiến.

### Cloudinary

- 28/28 URL biên lai Cloudinary vẫn tồn tại.
- URL Cloudinary nằm trong phép đối chiếu semantic của `orders`, nên khớp backup.
- Course image URL cũng nằm trong phép đối chiếu `courses`.
- Không upload, xóa, di chuyển hoặc ghi đè asset Cloudinary.

## 10. Smoke test code cũ

Exact deployment vẫn là:

`dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`

Vercel xác nhận:

- Project: `web-ban-hang-chinh-thuc`
- Target: `production`
- State: `READY`
- Alias không thay đổi.

HTTP:

| Kiểm tra | Kết quả |
|---|---:|
| `https://shop.yeunauan.live` | 200 |
| Course mẫu `?course=thitxiennuongchaungoc` | 200 |
| `/admin.html` | 200 |
| `/api/config?course=thitxiennuongchaungoc` | 200 |
| `/api/courses` không có auth | 401 đúng thiết kế |
| `/api/orders` không có auth | 401 đúng thiết kế |
| `https://www.daubepnho.store` | 200 |

API public `/api/config` đã đọc course thành công qua code cũ, chứng minh SDK/query cũ tương thích với cột nullable mới.

Danh sách course/order được xác minh ở tầng database production bằng read-only query và đối chiếu đủ 7/28 row. Việc smoke hai endpoint admin có auth không được tự động hóa vì Vercel CLI redacted `ADMIN_PASSWORD` khi pull env; hệ thống không dùng endpoint debug rò secret để lấy mật khẩu. Trang admin và các function vẫn deploy/READY, và request không auth trả đúng 401 thay vì 500.

## 11. Rollback

Không rollback.

Không có điều kiện kích hoạt rollback:

- Không giảm row count.
- Không mutation dữ liệu.
- Không lỗi schema/API public.
- Không ảnh hưởng FK, lessons hoặc enrollments.
- Shop/admin/LMS vẫn hoạt động.
- Object migration đúng tên và đúng kiểu.

File rollback vẫn giữ nguyên:

`rollback.sql`

SHA-256:

`aac9ad177cb0008b52924bea255f2531904050d4529df3ae50801bb3a2d2fa6b`

Không import JSON vì dữ liệu không mất/hỏng.

## 12. Xác nhận các thao tác không thực hiện

- Không deploy code mới vào commerce cũ.
- Không deploy/promote Production project yeubep.
- Không promote Preview.
- Không merge branch production.
- Không chuyển/gắn/remove/claim domain.
- Không Move domain ownership.
- Không chỉnh DNS, TXT, apex hoặc `www`.
- Không nhận đơn yeubep.
- Không sửa LMS hoặc Portal.
- Không backfill course/order legacy.
- Không sửa/xóa record production hiện hữu.
- Không restore dữ liệu.

## 13. Vấn đề còn tồn tại

1. Bản sao EFS thứ hai vẫn cùng ổ vật lý `C:`; nên bổ sung thêm bản mã hóa trên ổ ngoài khi có sẵn.
2. Không có hosted staging Supabase riêng; Gate 3.5 trước đó vẫn thiếu môi trường staging.
3. Smoke API admin có auth chưa chạy tự động vì không dùng/rò mật khẩu production. Cần kiểm tra đăng nhập admin thủ công hoặc cung cấp credential test an toàn trước Gate 4B.
4. Source production cũ có nhánh debug GET trong `api/check-auth.js` có khả năng trả env nếu gọi query đặc biệt. Endpoint này không được gọi trong Cổng 4A. Đây là rủi ro bảo mật có sẵn cần được xử lý có kiểm soát trong một bản code được review trước khi Production tiếp theo.

## 14. Trạng thái gate

Cổng 4A hoàn tất. Hệ thống dừng tại schema mới + code cũ.

Chưa được tự động chuyển sang Cổng 4B, Production deployment hoặc domain.
