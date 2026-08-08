# Báo cáo Cổng 5C — Production Learning Course Boundary và commerce clone inactive

Thời gian thực hiện: 2026-07-25 21:20–21:28 (Asia/Saigon)

## 1. Kết luận

Cổng 5C đạt toàn bộ điều kiện được phê duyệt:

- Learning Course Boundary đã được migration lên Supabase production `aqozjkfwzmyfunqvcyjv`.
- Migration chạy hai lần thành công và idempotent, không backfill hoặc sửa row hiện hữu.
- Cả hai Vercel project Production chạy exact commit `c15e27c4ed09592fb8e24a4d32caca672565e782`.
- Đã tạo đúng một commerce clone inactive/unpublished.
- Clone dùng sales slug `thitxiennuongchaungoc-yeubep`, nhưng canonical LMS target vẫn là `thitxiennuongchaungoc`.
- Không tạo order, enrollment, lesson, LMS course alias, mapping row hoặc sync mutation.
- Domain, DNS và TXT không thay đổi.
- Không cần rollback.

## 2. Exact source và kiểm thử

- Branch: `feature/yeubep-shop`
- Worktree HEAD: `c15e27c4ed09592fb8e24a4d32caca672565e782`
- `origin/feature/yeubep-shop`: cùng exact SHA.
- Worktree sạch trước deploy.
- Full suite: `63/63 pass`.
- Targeted Learning Course Boundary: `13/13 pass`.
- 50 test baseline cũ không regression.
- `npm ci`: pass, 0 vulnerability.
- `git diff --check`: pass.
- HTML inline scripts của `index.html`, `admin.html`, `orders.html`: pass.
- `node --check` toàn bộ API/helper/script: pass.
- Secret scan: 0 secret thật.

Artifact deploy là git-archive exact commit đã khóa:

- ZIP: `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_artifacts\gate5b-learning-boundary-c15e27c.zip`
- SHA-256: `FF0F80E9B4DE3849F6EFDE26CE14EF65E322E5DB719810E4EBD3501C1C46DDA8`

## 3. Backup mới trước migration

Đường dẫn:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_backups\supabase-before-learning-boundary-20260725-212045`

Snapshot gồm schema catalog, dữ liệu các bảng được yêu cầu, row counts, migration, rollback, checksums và restore notes. Toàn bộ 7 JSON đã được parse lại thành công. Thư mục được đặt ACL riêng cho tài khoản local hiện tại và không commit/upload.

Baseline snapshot:

- courses: 7
- orders: 28
- site_config: 73
- student_enrollments: 20
- lessons: 39
- course_slug_mappings: 6

Các SHA-256 chính:

- `schema-before.json`: `053c077e87c634e0a529d0fbee0fa1d866aa440b794f0dcb2b3cbcfddd548e15`
- `courses-data.json`: `a24007553cf6050eb48296fa35e3db55583c602024b6a8d5366889b56bc9aa09`
- `orders-data.json`: `95726959d5dc597f96b7d8b239a9b15fe69fbabd5ca336396d3cc2b4cfad3f4a`
- `site_config-data.json`: `11971a8fcb46a30f5155622064f4ea2ea28e277caab91233e6c674a3150c26d2`
- `student_enrollments-data.json`: `be7df2c34a0ae0073d4fb8e4e5ed5aa884fd66e4f2b9b3078c9be46a368460ba`
- `lessons-data.json`: `9eabeff58b0a552844d3f8a3a1a547cd71cb80dccb112b7f4f20cdd8a420fcba`
- `course_slug_mappings-data.json`: `4e6a56ee327542679ea6362ba874cde91318eab136a7cafac3db506e79628437`

Backup trước Cổng 4A vẫn giữ nguyên, không bị overwrite.

## 4. Preflight và migration

Preflight:

- Project: `aqozjkfwzmyfunqvcyjv`
- Status: `ACTIVE_HEALTHY`
- PostgreSQL: `17.6`
- Hai column Learning Boundary trước migration: 0
- Hai index Learning Boundary trước migration: 0
- Global unique constraint `courses.slug`: còn nguyên
- Target slug: 0 row
- Lock bất thường trên `courses`, `orders`, `student_enrollments`: 0
- Course nguồn đúng ID, active, sales_site NULL/effective yeunauan và có 4 lesson.

File:

- Migration: `migrations/20260725_learning_course_boundary.sql`
- SHA-256: `9b197d4ae3118f7fd848dbb14299937d05feebe350a526f3e8ac24ab6b0cd756`
- Rollback: `migrations/20260725_learning_course_boundary_rollback.sql`
- SHA-256: `f6205df2d79bc2a53f12a31221aae09088c6abee4199962acda6eb7534e4707b`

Migration lần 1: pass trong transaction với lock/statement timeout.

Migration lần 2: pass, verification state byte-equivalent với lần 1.

Objects mới:

- `courses.learning_course_slug` nullable
- `orders.learning_course_slug` nullable
- `idx_courses_learning_course_slug`
- `idx_orders_learning_entitlement`

Sau migration:

- 7 course legacy vẫn `learning_course_slug IS NULL`.
- 28 order legacy vẫn `learning_course_slug IS NULL`.
- Không backfill.
- Row counts, enrollments, lessons và global unique slug không đổi.

## 5. Production deployments

### Project commerce cũ

- Project: `web-ban-hang-chinh-thuc`
- Project ID: `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D`
- Deployment mới: `dpl_B3vCWsYFi73LTnHHUNhip7yY1UNN`
- State/target: `READY / production`
- Source metadata: exact `c15e27c4ed09592fb8e24a4d32caca672565e782`
- Branch metadata: `feature/yeubep-shop`
- Domain assignments giữ nguyên: `shop.yeunauan.live`, `yeubep.shop` và hai alias `.vercel.app`.

Smoke:

- `/`, `/admin.html`, `/orders.html`: HTTP 200.
- 7/7 legacy course slugs: HTTP 200.
- Slug không tồn tại: HTTP 404.
- `check-auth?debug=env`: HTTP 405, không lộ env.
- LMS root: HTTP 200.

### Project yeubep mới

- Project: `web-ban-hang-yeubep-shop`
- Project ID: `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8`
- Deployment mới: `dpl_CUYJ7zCJVPmnsmp3CswCvS3LfD3G`
- Deployment URL: `https://web-ban-hang-yeubep-shop-gv08aueyz.vercel.app`
- Stable project alias: `https://web-ban-hang-yeubep-shop-thienha100022653824678-stacks-projects.vercel.app`
- State/target: `READY / production`
- Source metadata: exact `c15e27c4ed09592fb8e24a4d32caca672565e782`
- Chỉ có alias `.vercel.app`; không custom domain.
- Trước clone, các legacy slugs được probe đều trả 404.

Trong smoke có một project Vercel rỗng bị CLI tạo nhầm khi thư mục artifact chưa được link. Project chính xác tên `gate5b-learning-boundary-c15e27c`, không có deployment/domain/env và đã được xóa ngay. Hai project production không bị thay đổi bởi sự cố này.

## 6. Commerce clone

Clone được tạo bằng một transaction server-side tối thiểu, không dùng upsert:

- Source ID: `b780c8f0-78d1-435d-a01c-731619b38af6`
- Clone ID: `fb2dd9ac-3353-48c9-85c2-9be634bd121d`
- Source slug: `thitxiennuongchaungoc`
- Clone sales slug: `thitxiennuongchaungoc-yeubep`
- `sales_site`: `yeubep`
- `learning_course_slug`: `thitxiennuongchaungoc`
- `active`: false
- `is_published`: false
- `sort_order`: 1, là giá trị hợp lệ tiếp theo; 7 row cũ không reorder.

Đã sao chép:

- title, subtitle, description, price
- teacher_name, expected_start_date
- image_url
- raw_data bằng giá trị JSON độc lập
- cấu hình ngân hàng/QR/nội dung chuyển khoản nằm trong raw_data

Đã reset hoặc không sao chép:

- ID và timestamps
- drive folder/permission
- sync LMS/Portal status và sync error
- order, enrollment, lesson, progress
- retry/correlation/idempotency/order history

Read-after-write xác nhận đúng ID/slug/tenant/learning target/trạng thái/sort order. Canonical target active và có 4 lesson.

Source hash trong schema sau migration:

- Trước clone: `3302022d0a6218824e66eda260d78d45`
- Sau clone: `3302022d0a6218824e66eda260d78d45`

Hash khác fingerprint cũ trước migration vì `to_jsonb(courses)` sau migration có thêm field nullable; fingerprint trước/sau clone trong cùng schema là hoàn toàn giống nhau.

## 7. Final database verification

- courses: 8
- orders: 28
- site_config: 73
- student_enrollments: 20
- lessons: 39
- course_slug_mappings: 6
- Clone rows: 1
- Clone orders: 0
- Clone enrollments: 0
- Clone lessons: 0
- Legacy courses sales_site NULL: 7
- Legacy orders sales_site NULL: 28
- Legacy courses learning slug NULL: 7
- Legacy orders learning slug NULL: 28
- Orders có idempotency key: 0
- Orders có price snapshot: 0
- Cloudinary proof URLs: 28

Không Cloudinary asset mới và không mất liên kết URL hiện hữu.

## 8. Tenant/storefront verification

Website cũ:

- `thitxiennuongchaungoc`: HTTP 200
- `thitxiennuongchaungoc-yeubep`: HTTP 404

Website yeubep `.vercel.app`:

- `thitxiennuongchaungoc`: HTTP 404 do tenant isolation
- `thitxiennuongchaungoc-yeubep`: HTTP 404 đúng vì clone inactive/unpublished

Không tạm kích hoạt clone và không gửi form checkout.

## 9. Sync/LMS/Portal no-mutation evidence

- Clone inactive không tự sync.
- Sync fields của clone là NULL, không copy trạng thái thành công của source.
- Alias manual sync theo exact code trả `MAPPED_NOT_REQUIRED`, không gửi `syncCourse` bằng sales alias.
- `syncEnrollment` tương lai dùng immutable canonical snapshot `thitxiennuongchaungoc`.
- `revokeEnrollment`, Portal và outbox tương lai dùng cùng canonical slug.
- Không có HTTP request mutation tới LMS/Portal trong Cổng 5C.
- Không tạo LMS course alias hoặc clone lesson.
- LMS/Portal repository và deployment không sửa.

## 10. Admin owner checklist

Owner có thể mở `admin.html` và chỉ kiểm tra read-only:

- Tổng 8 course.
- Course nguồn: website `yeunauan.live`, LMS target “Dùng chính khóa học này”, 4 lesson.
- Clone: website `yeubep.shop`, LMS target `thitxiennuongchaungoc`, 4 lesson, inactive và unpublished.
- Sales URL dự kiến: `https://yeubep.shop/?course=thitxiennuongchaungoc-yeubep`.
- Không bấm Active, Save hoặc Manual Sync.

## 11. Domain/DNS

Không thực hiện Move/remove/attach domain hoặc thay DNS/TXT.

Read-only state:

- `yeubep.shop` vẫn alias project cũ.
- Apex A: `216.198.79.1`
- `www` CNAME: `db4901082264508b.vercel-dns-017.com`
- `www` vẫn HTTP 307 tới apex.
- `_vercel.yeubep.shop`: vẫn có 1 TXT verification record.
- Apex HTTP 200.
- Không chỉnh SPF/MX/DKIM/DMARC hoặc ownership.

## 12. Rollback và giới hạn còn lại

- Không rollback migration, deployment hoặc clone vì tất cả verification đạt.
- Rollback schema vẫn là file đã backup; chỉ dùng sau khi export delta và rollback code nếu thật sự cần.
- Rollback clone chỉ được xóa exact ID/slug khi dependency orders/enrollments/lessons vẫn bằng 0.

Giới hạn bắt buộc còn lại: shared-entitlement reference counting mới được chứng minh bằng automated/local test, chưa được chứng minh bằng hai order production thật. Vì vậy clone vẫn inactive/unpublished, checkout chưa mở.

Cổng tiếp theo phải được phê duyệt riêng cho hosted-persistence/order canary an toàn. Chưa được kích hoạt clone, tạo order/enrollment, chuyển domain hoặc mở bán.
