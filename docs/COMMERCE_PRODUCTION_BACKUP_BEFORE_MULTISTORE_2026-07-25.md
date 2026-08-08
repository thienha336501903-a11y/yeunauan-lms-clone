# Commerce production backup before multi-storefront

Ngày thực hiện: 2026-07-25  
Trạng thái: backup hoàn tất và đã đọc kiểm tra; chưa migration/deploy/domain/data mutation.

## 1. Thời gian và vị trí

- Backup start UTC: `2026-07-25T08:50:49.6617900Z`
- Backup complete UTC: `2026-07-25T08:50:55.5408163Z`
- Giờ Việt Nam: khoảng 15:50:49–15:50:55 ngày 2026-07-25
- Thư mục:

  `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_backups\supabase-before-multistore-20260725-154808`

ACL của thư mục đã tắt inheritance và chỉ cấp Full Control cho:

`DESKTOP-4INSA8O\gaomi`

Backup không nằm trong Git, Vercel hoặc nơi công khai.

## 2. Code và deployment rollback

- Repository: `thienha100022653824678-stack/web-ban-hang-chinh-thuc`
- Production branch: `feat/v2-shop-runtime-switch`
- Exact commit: `cafe21bbe55af86bfb8ac2ebe9155ded849452e8`
- Vercel project: `web-ban-hang-chinh-thuc`
- Project ID: `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D`
- Production deployment: `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`
- Deployment state: Ready
- Rollback strategy: promote exact artifact; không rebuild.

Aliases:

- `yeubep.shop`
- `shop.yeunauan.live`
- `web-ban-hang-chinh-thuc-alpha.vercel.app`
- `web-ban-hang-chinh-thuc-thienha100022653824678-stacks-projects.vercel.app`
- `web-ban-hang-git-29b6da-thienha100022653824678-stacks-projects.vercel.app`

Production environment variable names, không đọc/in value:

- `SYSTEM3_URL`
- `SYSTEM1_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTERNAL_SYNC_SECRET`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_API_KEY`
- `ADMIN_PASSWORD`
- `ADMIN_EMAILS`

## 3. Supabase production

- Project ref: `aqozjkfwzmyfunqvcyjv`
- Status lúc kiểm tra: `ACTIVE_HEALTHY`
- PostgreSQL: 17.6
- Region: `ap-southeast-1`

Actual row counts:

| Table | Rows |
|---|---:|
| `public.courses` | 7 |
| `public.orders` | 28 |
| `public.site_config` | 73 |

Counts khớp baseline điều tra trước đó.

FK audit phát hiện các bảng phụ thuộc trực tiếp cần backup thêm:

| Table | Rows |
|---|---:|
| `public.course_slug_mappings` | 6 |
| `public.lessons` | 39 |
| `public.portal_post_course_mappings` | 0 |
| `public.student_enrollments` | 20 |

Các quan hệ quan trọng:

- `orders.course_id → courses.id`
- `course_slug_mappings.course_id → courses.id`
- `lessons.course_id → courses.id`
- `portal_post_course_mappings.course_id → courses.id`
- `student_enrollments.course_id → courses.id`
- `student_enrollments.source_order_id → orders.id`

## 4. Schema snapshot

`schema-before.sql` được tạo read-only trực tiếp từ `pg_catalog`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_functiondef`, `pg_get_triggerdef`, `pg_get_viewdef` và `pg_policies` qua Supabase Management API.

Catalog và DDL snapshot đối chiếu:

| Object | Catalog | Dump |
|---|---:|---:|
| Tables | 27 | 27 |
| Constraints, gồm PK/FK/unique/check | 69 | 69 |
| Non-constraint indexes | 62 | 62 |
| User triggers | 0 | 0 |
| Functions | 3 | 3 |
| Sequences | 1 | 1 |
| RLS policies | 8 | 8 |
| Views/materialized views | 0 | 0 |

`schema-openapi.json` giữ thêm PostgREST schema snapshot gồm 27 definitions.

Dump không chứa database password, PAT, service-role, sync secret hoặc Cloudinary secret.

## 5. File, size và SHA-256

| File | Bytes | SHA-256 |
|---|---:|---|
| `backup-validation.txt` | 777 | `5c4e5ea64c38a811f0205a51a3291cbaa2894fbb0a235dcdc6068fea283bd8df` |
| `cloudinary-linkage.txt` | 433 | `4dda756e59eab354933e51701cb50e6575603557cbd0168b54b30adf0272e184` |
| `course-slug-mappings-data.json` | 2,861 | `60138e46f7d13a6cc261562f89f960804b30a050cf6a3c796de13b5f88a4459f` |
| `courses-data.json` | 8,657 | `68a74be7cc28c4bab04fee06ff307439f6f02fa9a36db85a247fc24bbf5f80aa` |
| `lessons-data.json` | 70,570 | `52307c4e780e83020637af8bed259b1fcc8fbea8de3144a7d801bee3a4d2c2a9` |
| `migration.sql` | 1,618 | `f1ae3cf4f7e65f0a4162104dde87359ed32046edfbe1b3d653a164ae8f4bb7f7` |
| `orders-data.json` | 27,750 | `2647cc64b956783c4329613f580424c3443897a00a06f7c6e45871eec4b083e9` |
| `portal-post-course-mappings-data.json` | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `production-metadata.json` | 1,240 | `7d670dc4f6181d4971bf8cb561a030e5207406df2d80c391f67f309450946c7a` |
| `restore-runbook.md` | 4,313 | `d3536cb4fb18ccc546b6dab8e7cb92896d10bf8a039a797f056bc699a8b8428e` |
| `rollback.sql` | 560 | `aac9ad177cb0008b52924bea255f2531904050d4529df3ae50801bb3a2d2fa6b` |
| `row-counts.txt` | 263 | `c3b018375a89f8190907e666bf9a25bb8d1af479ab4a9816b21d57d7ea05f2ec` |
| `schema-before.sql` | 44,144 | `a3cce4908c8157bcfba895a05e81c0a7989c4a007ac8d76a0e7373f539b40b6e` |
| `schema-openapi.json` | 284,986 | `45c2a16e0ed07ea4d5883e0da12c7c52edfa52eba2f05ea7c29970bdb6fd5dee` |
| `site-config-data.json` | 12,907 | `11971a8fcb46a30f5155622064f4ea2ea28e277caab91233e6c674a3150c26d2` |
| `student-enrollments-data.json` | 18,796 | `a9fc5334bef71b32be67b30bc8531c2d962a54a9cf0e3bdfc039cc331c4303b7` |

`checksums.sha256` chứa 16 entries nói trên:

- Size: 1,415 bytes
- SHA-256 của chính file checksum: `04180c3315b0136cf9c57445b6aefe3e56f56a3772d712a9e3742f265b4d7e6a`
- Verification result: 0 mismatch.

## 6. Xác minh khả năng đọc

- Tất cả 7 data JSON mở và parse UTF-8 thành công.
- Arrays giữ nguyên row count.
- Empty table được lưu đúng JSON `[]`, không phải file rỗng.
- Counts đọc lại từ JSON khớp counts production tại thời điểm xác minh.
- DDL object counts khớp catalog.
- OpenAPI JSON parse thành công.
- Không phát hiện secret trong các file schema/metadata/runbook/migration/rollback/validation.
- Không in dữ liệu order/customer ra terminal hoặc báo cáo.

## 7. Cloudinary

- Pattern bill: `bill-chuyen-khoan/{courseSlug}`.
- URL bill: `public.orders.proof_image_url`.
- Poster: `public.courses.image_url`.
- Bank/QR/config: `public.courses.raw_data`.
- 28/28 order có proof URL Cloudinary và URL được giữ nguyên trong JSON.
- 7 course giữ nguyên `image_url`.
- Không xóa, move, tải lại hoặc overwrite asset Cloudinary.

Database rollback không làm mất asset; chỉ cần giữ nguyên URL hoặc restore đúng field URL.

## 8. Rollback hai cấp

Chi tiết đầy đủ nằm trong `restore-runbook.md`.

### Cấp A — code

1. Dừng code/migration mới.
2. Promote exact `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`.
3. Không rebuild.
4. Smoke test storefront/course/admin/API.

Ước tính: 2–5 phút cộng smoke test.

### Cấp B — schema/data

1. Promote code cũ trước.
2. Export delta mới.
3. Chạy `rollback.sql`.
4. Xác minh column/index/constraint/count.
5. Chỉ restore row/field bị thiếu hoặc hỏng bằng immutable key.
6. Không restore mù toàn project.

Ước tính: 5–15 phút nếu chỉ rollback schema; lâu hơn nếu cần merge delta.

## 9. Rủi ro dữ liệu phát sinh

Snapshot cũ không được dùng để overwrite database sau khi đã có đơn mới.

Nếu rollback sau migration:

1. Export delta theo `created_at`/`updated_at` sau mốc backup/migration.
2. Giữ riêng order mới và thay đổi status/sync.
3. Promote code cũ.
4. Rollback schema.
5. Merge delta theo `courses.id`, `orders.id`, `site_config.key`.
6. Không xóa row không tồn tại trong snapshot cũ.

Đề xuất cửa sổ migration ngắn có owner duyệt tạm dừng admin/checkout. Chưa bật maintenance.

## 10. Xác nhận không thay đổi production

- Không chạy migration.
- Không chạy rollback.
- Không deploy/promote Production.
- Không chuyển domain/alias.
- Không sửa DNS/TXT.
- Không insert/update/delete database.
- Không sửa 7 courses, 28 orders hoặc 73 site_config.
- Không sửa LMS/enrollment.
- Không sửa Cloudinary.

Read-only smoke cuối:

- Shop: HTTP 200
- Admin: HTTP 200
- LMS: HTTP 200

Backup phải được owner duyệt trước mọi migration production.
