# Báo cáo Cổng 5A — Preflight clone commerce và LMS target

Ngày kiểm tra: **2026-07-25**

## 1. Kết luận

Cổng 5A dừng an toàn tại **Trường hợp B — hệ thống chưa hỗ trợ alias end-to-end**.

Không tạo course clone, mapping, LMS course, lesson, order hoặc enrollment. Slug `thitxiennuongchaungoc-yeubep` vẫn chưa tồn tại.

Nếu insert clone commerce vào bảng `courses` dùng chung hiện tại, đó đồng thời sẽ là một LMS course row mới nhưng không có lesson. Luồng duyệt order sẽ gửi nguyên slug mới tới LMS, tạo enrollment gắn slug mới; trang học viên sau đó lọc lessons theo chính slug mới và nhận danh sách rỗng. Đây chính xác là tình huống bị cấm trong yêu cầu.

## 2. Course nguồn

- Course ID: `b780c8f0-78d1-435d-a01c-731619b38af6`
- Slug: `thitxiennuongchaungoc`
- Active: `true`
- `sales_site`: `NULL`, effective `yeunauan`
- `sort_order`: `0`
- Course row hash trước/sau: `7426fab1c21be6ee0b8c740c10167920`
- Lesson rows: 4
- Section rows: 0
- Enrollment rows: 1
- Lessons tham chiếu một `course_id`.
- Title và `raw_data` hiện diện.

Course nguồn không bị sửa. URL cũ và public config vẫn HTTP 200.

## 3. Preflight slug mới

Slug kiểm tra: `thitxiennuongchaungoc-yeubep`

Kết quả production:

| Vị trí | Số bản ghi |
|---|---:|
| `courses.slug` | 0 |
| `orders.course_slug` | 0 |
| `lessons.course_slug` | 0 |
| `student_enrollments.course_slug` | 0 |
| `course_slug_mappings` | 0 |
| `portal_post_course_mappings` | 0 |

- `portal_post_course_mappings` toàn bảng: 0.
- Search exact slug trong commerce source: 0 hit.
- Search exact slug trong LMS runtime source: 0 hit; hit duy nhất trong LMS workspace là file tiến độ của Cổng 5A, không phải runtime/fixture.
- Search Portal repo source: 0 hit.
- Global `UNIQUE(courses.slug)` vẫn tồn tại: 1 constraint.

Không overwrite/upsert đối tượng nào.

## 4. Vai trò thực tế của `course_slug_mappings`

Schema:

- `course_id` FK tới `courses.id`;
- `slug`, `normalized_slug`;
- `source_system`;
- `status`;
- unique `(normalized_slug, source_system)`.

Migration `migration_v2_identity_mapping.sql` chỉ backfill mỗi course thành mapping `source_system='canonical'`.

Runtime readers duy nhất tìm thấy:

- `utils/v2-reconciliation.js`: kiểm tra read-only sự nhất quán canonical course/mapping;
- `utils/v2-diagnostics.js`: kiểm tra table tồn tại;
- các preflight/postflight/runbook SQL.

Không có runtime resolver dùng bảng này trong:

- `api/sync.js`;
- `syncCourse`;
- `syncEnrollment`;
- `revokeEnrollment`;
- Drive permission;
- course-data;
- lesson;
- verified entry token;
- exchange-code;
- commerce order approval;
- Portal post lookup/projection.

Đặc biệt, course nguồn hiện không có canonical mapping row dù toàn bảng có 6 mapping cho 7 course. Điều này tiếp tục chứng minh mapping không phải dependency của V1 runtime.

## 5. Trace ba luồng bắt buộc

### `syncCourse`

Commerce gửi nguyên `payload.slug`. LMS `/api/sync`:

1. tra `courses.slug = slug`;
2. nếu chưa có thì insert course mới;
3. không tra `course_slug_mappings`;
4. không clone lesson.

Với slug mới, kết quả sẽ là một LMS course row mới, không có nội dung.

### `syncEnrollment`

Commerce order approval lấy nguyên `orders.course_slug` và gửi `courseSlug`.

LMS `syncEnrollment()`:

1. tra `courses.slug = courseSlug`;
2. upsert `student_enrollments.course_slug = courseSlug`;
3. dùng unique `(email, course_slug)`;
4. Drive lookup cũng dùng trực tiếp `courseSlug`;
5. không resolve alias.

Với slug mới, enrollment không trỏ về slug nguồn.

### `revokeEnrollment`

LMS xóa enrollment bằng:

- `email`;
- exact `course_slug = courseSlug`.

Không resolve alias. Một enrollment alias giả sẽ không thu hồi enrollment canonical cũ và ngược lại.

## 6. Luồng mở khóa học

`course-data.js`:

- lấy danh sách `student_enrollments.course_slug`;
- so sánh exact slug;
- tra `courses.slug = activeCourseSlug`;
- tra `lessons.course_slug = activeCourseSlug`.

`lesson.js`:

- lesson phải có `lesson.course_slug` khớp verified session;
- enrollment phải có exact cùng `course_slug`.

`verify-entry-token.js` và `exchange-code.js` cũng kiểm tra enrollment/course/lesson bằng exact slug.

Vì vậy sales slug mới không thể tự động mở nội dung của `thitxiennuongchaungoc`.

## 7. Portal projection

`portal_post_course_mappings` hiện có 0 row và chỉ được diagnostics/reconciliation đọc trong LMS repo.

Portal code tìm post, enrollment và order bằng exact `course_slug`. Không có server-side alias resolver. Vì thế cả đường mở nội dung từ Portal cũng không chứng minh được alias mới.

## 8. Quyết định clone

Không tạo clone.

| Thuộc tính dự kiến | Kết quả Cổng 5A |
|---|---|
| Clone ID | Không có |
| Slug mới | Chưa tạo |
| `sales_site=yeubep` | Chưa tạo |
| Active/published | Không áp dụng |
| Sort order | Không chọn |
| Field đã copy | Không có |
| Field không copy | Tất cả, vì không insert |
| LMS course mới | Không tạo |
| LMS target an toàn | Chưa có |
| Rollback | Không cần |

Không gọi `syncCourse`, `syncEnrollment`, `revokeEnrollment`, approve, revoke hoặc resync.

## 9. Database trước/sau

| Kiểm tra | Trước | Sau |
|---|---:|---:|
| courses | 7 | 7 |
| orders | 28 | 28 |
| site_config | 73 | 73 |
| student_enrollments | 20 | 20 |
| lessons | 39 | 39 |
| target courses | 0 | 0 |
| target orders | 0 | 0 |
| target enrollments | 0 | 0 |
| target lessons | 0 | 0 |
| Cloudinary URL references | 28 | 28 |

Fingerprint không đổi:

- courses: `e8d7a448a3872945e3e40b2d6d0886e7`
- orders: `264493a639cd89dd232b657e42bb0bb8`
- enrollments: `2a2e9078cb26eeccd46b477a3749face`

Không có write ngoài ý muốn.

## 10. Storefront probes

Website cũ:

- source slug: 200;
- target slug: 404.

Website mới `.vercel.app` sau Deployment Protection bypass:

- source legacy slug: 404;
- target slug chưa tạo: 404.

Không gửi form, không tạo order, không upload biên lai.

Admin chưa có clone nên chưa có sales URL mới. URL dự kiến sau khi có giải pháp alias an toàn vẫn là:

`https://yeubep.shop/?course=thitxiennuongchaungoc-yeubep`

## 11. Domain và hệ thống khác

- LMS home: 200.
- Không sửa LMS hoặc Portal.
- Apex A: `216.198.79.1`.
- `www` CNAME: `db4901082264508b.vercel-dns-017.com`.
- `_vercel` TXT: vẫn tồn tại, 1 record.
- Không Move/attach/detach domain.
- Không chỉnh DNS/TXT/email records.
- Không mở checkout.
- Không merge branch.

## 12. Hai hướng cần owner chọn riêng

### Hướng 1 — Bổ sung commerce-to-LMS slug mapping an toàn

Cần thiết kế server-side mapping:

`thitxiennuongchaungoc-yeubep` → `thitxiennuongchaungoc`

Mapping phải được áp dụng đồng nhất cho:

- `syncCourse`;
- `syncEnrollment`;
- `revokeEnrollment`;
- order approval/resync;
- Portal projection và entry token;
- course-data/lesson access;
- Drive permission.

Cần test tương thích client cũ và không tin learning slug từ browser.

### Hướng 2 — Clone đầy đủ LMS course

Tạo course ID mới, clone toàn bộ section/lesson và cấu hình/Drive cần thiết sang slug mới. Hướng này có phạm vi và rủi ro lớn hơn, cần phê duyệt LMS riêng.

Cho đến khi một hướng được triển khai và kiểm chứng end-to-end, không được tạo clone commerce active hoặc mở bán.

