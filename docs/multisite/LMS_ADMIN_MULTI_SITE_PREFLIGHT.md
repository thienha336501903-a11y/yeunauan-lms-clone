# LMS Admin Multi-Site Isolation — Preflight

Ngày audit: 2026-07-29 (Asia/Saigon)  
Trạng thái: hoàn tất preflight, chưa sửa product code, chưa ghi Production

## 1. Kết luận điều hành

Kiến trúc hiện tại có thể mở rộng bằng field nullable `courses.learning_site` và resolver server-side mà không đổi identity hiện hữu. Tên field phù hợp là `learning_site`, allowed values là `yeunauan` và `yeubep`.

Điểm quan trọng nhất là mapping domain hiện tại không trùng trực giác tên domain:

| Domain hiện tại | Vercel project | Production deployment | `SALES_SITE` / logical site |
|---|---|---|---|
| `yeubep.shop` | `web-ban-hang-chinh-thuc` | `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ` | `yeunauan` |
| `shop.yeunauan.live` | `web-ban-hang-yeubep-shop` | `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka` | `yeubep` |
| `www.daubepnho.store` | `web-lms-chinh-thuc` | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` | LMS dùng chung |

Bằng chứng gồm Vercel domain/deployment inspection hiện tại, after-cutover sanitized env snapshot, exact cutover commit/tag/worktree và tenant probes/source tests. Không suy luận tenant từ tên project/domain.

LMS Production vẫn đúng baseline bắt buộc:

- repository `web-lms-chinh-thuc`;
- commit `fc12c3b21329158e13a4a027833afd2dec61e973`;
- tag `backup/B05-2026-07-25`;
- deployment `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`;
- baseline 300/300.

Commerce Production current source:

- repository `web-ban-hang-chinh-thuc`;
- commit `74c70268f0619d9d9a9be5e564ea60200038100c`;
- branch `preview/domain-swap-20260726`;
- tag `launch/storefront-domain-swap-2026-07-26`;
- existing exact worktree `_worktrees/domain-swap-preview-20260726`.

Không dùng primary Commerce/LMS worktree HEAD làm implementation baseline.

## 2. Nguồn đã audit

- `FULL_SYSTEM_CURRENT_ARCHITECTURE_AND_HANDOVER_2026-07-26.md`;
- LMS B05 handover và B05 read-only audits;
- toàn bộ chuỗi multi-storefront Gate 1–5C và final launch/cutover evidence;
- Learning Course Boundary migrations, resolver, tests và reports;
- exact Commerce source `74c70268...`;
- exact LMS source `fc12c3b...`;
- current Vercel metadata read-only;
- current Supabase rows/counts/mappings bằng query read-only, chỉ chọn dữ liệu không PII.

Tài liệu cũ được dùng làm lịch sử; khi khác current source/metadata thì current evidence được ưu tiên.

## 3. Commerce tạo course ở đâu

Trang `admin.html`, form “+ Thêm khóa học mới”, gửi `POST /api/courses`.

Backend `api/courses.js`:

1. xác thực admin;
2. nhận nội dung course;
3. validate `sales_site` bằng allowlist;
4. chuẩn hóa `learning_course_slug`;
5. resolve/validate canonical target;
6. insert `courses`;
7. read-after-write;
8. gọi sync boundary theo contract hiện tại.

Fixture/Preview dùng `utils/preview-fixture.js`; Production dùng Supabase service client server-side.

## 4. Field ghi khi chọn “WEBSITE BÁN HÀNG”

UI gửi `sales_site` với allowlist:

- `yeunauan`;
- `yeubep`.

Backend dùng `requireSalesSite`, không chấp nhận URL tự do. Legacy NULL được hiển thị/effective như `yeunauan`.

Sau domain cutover, URL hiển thị là:

- `sales_site=yeunauan` → `https://yeubep.shop`;
- `sales_site=yeubep` → `https://shop.yeunauan.live`.

Mapping này phải được giữ đúng theo current deployment, dù tên gây nhầm.

## 5. “Dùng chính khóa học này”

UI dùng option value rỗng. Backend `storedLearningSlug` lưu target self theo contract hiện tại dưới dạng nullable/empty-normalized:

- `courses.learning_course_slug` để NULL/empty-normalized;
- effective canonical slug fallback về `courses.slug`.

Khi tạo order, `api/register.js` resolve canonical server-side và snapshot canonical slug vào `orders.learning_course_slug`. Browser override bị bỏ qua.

Với feature mới, self-target phải đồng thời ghi explicit `courses.learning_site` bằng logical site đã chọn. Không tìm hoặc dùng course cùng tên ở site khác.

## 6. Dropdown LMS đích

`admin.html` gọi authenticated `GET /api/courses`, nhận `learning_lesson_count`, sau đó hiện các row:

- canonical/self-target (`learning_course_slug` trống hoặc bằng chính slug);
- có ít nhất một lesson.

Hiện chưa có `learning_site`, nên dropdown liệt kê canonical target của cả hệ thống. Đây là lỗ hổng tạo cross-site mapping mới cần sửa cả frontend và backend.

Legacy alias không nên xuất hiện như LMS target canonical.

## 7. Lưu `learning_course_slug`

- Course: `courses.learning_course_slug`, nullable.
- Order: `orders.learning_course_slug`, immutable snapshot khi đăng ký.
- Effective course slug: trimmed target hoặc `courses.slug`.
- Effective order slug: trimmed snapshot hoặc `orders.course_slug`.

Update unrelated field hiện có logic giữ target nếu request không mang field đó. Quick toggle gửi/preserve `sales_site`; test hiện hữu bảo vệ không làm mất boundary fields. Feature mới phải thêm `learning_site` vào cùng invariant/read-after-write.

## 8. Sync course/enrollment/revoke

`utils/sync-helpers.js` canonicalize trước boundary:

- canonical `syncCourse`: gửi `syncCourse` với canonical slug;
- alias `syncCourse`: trả `MAPPED_NOT_REQUIRED`, không tạo LMS alias rỗng;
- approve/resync: `syncEnrollment` với order snapshot/effective canonical slug;
- revoke: kiểm tra shared entitlement theo normalized email + effective canonical slug + granting status trước khi gửi `revokeEnrollment`;
- dry-run: không fetch, enqueue, email hoặc side effect thật.

Portal và LMS nhận canonical slug. `sales_site` không nằm trong payload legacy. Feature mới không được tin site từ payload Commerce; LMS phải resolve owner từ canonical course row.

## 9. LMS Admin hiện tải course bằng endpoint nào

`lms-admin.html` gọi:

```text
GET /api/lms/admin?endpoint=courses
```

Router là `api/lms/admin.js`, handler `utils/lms-handlers/admin-courses.js`.

Handler hiện đọc:

- toàn bộ `courses`;
- toàn bộ `site_config`;
- ghép title/subtitle/image/poster/QR/student display title theo prefix slug.

Không có site filter hoặc ownership validation.

## 10. Endpoint quản lý dữ liệu

Tất cả đi qua `/api/lms/admin?endpoint=<name>`.

| Phạm vi | Endpoint/handler | Bảng/tác động chính | Scope yêu cầu |
|---|---|---|---|
| Course/config | `courses` | `courses`, `site_config` | theo `learning_site` |
| Section/lesson | `lessons` | `lessons`; section là `is_section=true` | theo canonical course/site |
| Lesson media check | `verify-media` | course folder + Drive file metadata | theo course/site |
| Image | `upload-image` | Drive upload + course folder | theo course/site |
| Recipe | `upload-recipe` | Drive Docs + lesson `recipe_url` | theo course/site |
| Video | `upload-gdrive-video` | Drive folder/file + `courses.drive_folder_id` | theo course/site |
| Material | `upload-material` | Drive file metadata returned to lesson | theo course/site |
| Enrollment | `enrollments` | `student_enrollments`, Drive permission | theo canonical course/site |
| Bulk enrollment | `bulk-enroll` | batch `student_enrollments`, Drive | bắt buộc một site |
| Drive sync | `sync-drive-permissions` | enrollments/Drive queue/log | theo course/site |
| Drive repair | `repair-drive` | Drive/course/enrollment repair | theo course/site |
| Drive permission | `drive-permission` | enrollment by ID + Drive | resolve ID → course → site |
| Drive retry | `drive-retry` | course/email batch + queue | theo course/site |
| Drive health | `drive-health` | global logs/queue summary | global badge; filters phải rõ |
| Students | `students` | student identity | toàn hệ thống |
| Student trace | `student-trace` | student/order/enrollment/Drive history | global email-centric; course actions scoped |
| Account sharing | `account-sharing-alerts` | risk/session/audit/retention | toàn hệ thống |
| Runtime flags | `runtime-mode` | V2 runtime global config | toàn hệ thống |
| Auth/Drive auth | `auth`, `drive-auth`, `drive-status` | admin session/credential pool | toàn hệ thống |

Student-facing progress is in `lesson_progress`. LMS Admin baseline does not expose a dedicated progress CRUD tab; any trace/diagnostic path that returns progress must filter/validate canonical course site when the feature is on.

## 11. Chức năng toàn hệ thống

Không tách:

- admin authentication/allowlist/session signing;
- students/account identity;
- account-sharing/risk theo email;
- V2/runtime flags;
- Drive admin credential/OAuth pool;
- global audit;
- diagnostics/readiness;
- retention/cleanup;
- global Drive health summary.

UI phải gắn badge “TOÀN HỆ THỐNG”. Course-specific actions phát sinh từ tab global vẫn phải resolve và enforce site.

## 12. Current rows và legacy mappings

Read-only capture 2026-07-29 13:33 Asia/Saigon:

| Metric | Current |
|---|---:|
| Courses | 9 |
| Orders | 30 |
| Enrollments | 22 |
| Lessons/sections | 39 |
| `course_slug_mappings` | 6 |

| Course | Sales site | Learning target | Lessons | Orders | Enrollments | Phân loại đề xuất |
|---|---|---|---:|---:|---:|---|
| 7 legacy canonical rows | NULL → `yeunauan` | NULL → self | 39 tổng | 28 legacy order tổng | phần lớn enrollment | owner `yeunauan` fallback |
| `thitxiennuongchaungoc-yeubep` | `yeubep` | `thitxiennuongchaungoc` | 0 | 0 | 0 | legacy cross-site alias, read-only |
| `thitxiennuongchaungoc` | NULL → `yeunauan` | self | 4 | 4 | 1 | canonical owner `yeunauan` |
| `thitkhomamtep` | `yeubep` | NULL → self | 0 | 2 | 2 | self-target owner `yeubep`, post-handover |

`course_slug_mappings` chỉ có 6 canonical rows cũ và không phải runtime sales-alias resolver.

Legacy shared alias phải tiếp tục cấp/revoke canonical target theo snapshot/reference-count contract, nhưng:

- badge “LIÊN KẾT DÙNG CHUNG CŨ”;
- không hiện alias như LMS course rỗng;
- chỉ canonical course hiện trong LMS Admin tại owner `yeunauan`;
- không cho đổi target hoặc tạo mapping tương tự khi flag on.

## 13. Global unique slug

`courses.slug` đang global UNIQUE và phải giữ nguyên. Hai course cùng title được phép, nhưng slug phải khác. Vì course/enrollment/lesson/progress/Drive/Portal đều dùng global slug, đổi unique theo site trong task này là không an toàn.

UI nên đề xuất suffix theo logical site khi collision:

- `<slug>-yeubep`;
- `<slug>-yeunauan`.

Backend vẫn là nguồn sự thật và trả lỗi duplicate slug rõ ràng.

## 14. Resolver đề xuất

```text
effective_learning_site(course):
  1. learning_site explicit và hợp lệ → dùng giá trị đó
  2. self/canonical legacy:
       sales_site hợp lệ → sales_site
       sales_site NULL → yeunauan (fallback hiện hữu)
  3. sales alias:
       load canonical target một cấp
       target explicit/fallback owner → dùng owner của target
  4. còn lại → UNRESOLVED_LEARNING_SITE
```

Hệ quả:

- legacy alias Yeubep → canonical `thitxiennuongchaungoc` owner `yeunauan`;
- `thitkhomamtep` self-target owner `yeubep`;
- không cần backfill Production để resolver hoạt động;
- không đoán từ domain/project/title.

Resolver phải fail-closed với target thiếu, chain/cycle, invalid value hoặc ownership không resolve được.

## 15. Query/write có nguy cơ chạm nhầm site

### LMS

- courses GET đọc tất cả course và config;
- config POST update theo slug, không site check/read-after-write đầy đủ;
- lesson GET/insert/update/delete theo client slug/lesson number;
- update có thể chuyển `originalCourse` sang course khác;
- recipe sync/Drive uploads nhận course/lesson từ body;
- media verification nhận course slug + arbitrary lesson data;
- enrollment GET/POST/PUT/DELETE theo course hoặc enrollment ID;
- bulk enroll batch theo client course slug;
- Drive permission/retry/repair/sync nhận enrollment ID/course/email;
- student trace và Drive health có thể lộ dữ liệu chéo site;
- client `?course=`/selected state hiện không có trusted backend scope;
- `site_config` global scan có thể trả config course khác.

### Commerce

- dropdown target hiện global;
- POST/PUT cho phép same-schema target bất kỳ canonical course;
- browser gửi `sales_site` trong shared admin context; backend hiện validate allowlist nhưng chưa enforce learning-site relationship;
- quick toggle/edit phải preserve future `learning_site`;
- existing alias must not be changed by unrelated edit;
- self-target creation currently can generate course/order/enrollment before lesson exists (`thitkhomamtep` evidence);
- approve-all is scoped by `sales_site + course + status`, but future learning owner validation is still required.

## 16. Security/IDOR test inventory

Phải thêm negative tests:

- forged/missing/invalid `learning_site`;
- course slug/ID Site A trong Site B;
- lesson/media ID Site A trong Site B;
- enrollment ID/course Site A trong Site B;
- Drive action Site A trong Site B;
- alias ID thay canonical ID;
- batch mixed sites;
- query `site` hoặc header không bypass;
- cross-site target on Commerce POST/PUT;
- unrelated edit/quick toggle không đổi target/site.

Error codes:

- `INVALID_LEARNING_SITE`;
- `COURSE_SITE_MISMATCH`;
- `CROSS_SITE_LMS_TARGET_FORBIDDEN`;
- `UNRESOLVED_LEARNING_SITE`;
- `LEGACY_SHARED_MAPPING_READ_ONLY`;
- `COURSE_NOT_FOUND_IN_SITE`.

## 17. Data model/index assessment

Forward migration phù hợp:

- nullable `courses.learning_site TEXT`;
- CHECK NULL hoặc `IN ('yeunauan','yeubep')`;
- index `learning_site`;
- composite/partial indexes hỗ trợ site + active/status + canonical target;
- giữ `idx_courses_learning_course_slug`;
- không đổi unique slug/enrollment/lesson identities.

Không cần backfill bắt buộc. Có thể cung cấp dry-run mapper để xuất proposed rows; không ghi Production.

Rollback:

1. tắt flags;
2. export delta nếu field đã có dữ liệu Preview;
3. bỏ index/constraint/column mới khi an toàn;
4. không xóa business rows.

## 18. Feature flags

- `LMS_ADMIN_MULTI_SITE_ENABLED=false` mặc định;
- `COMMERCE_LMS_SITE_ISOLATION_ENABLED=false` mặc định.

Flag off phải giữ behavior B05/current Commerce. Flag on mới yêu cầu site parameter + backend enforcement.

## 19. Stop-condition assessment

Không có stop condition bắt buộc ở thời điểm preflight:

- domain → project → `SALES_SITE` đã resolve bằng current/historical cutover evidence;
- resolver legacy deterministic, không cần Production backfill;
- không cần sửa Portal;
- không cần đổi enrollment identity;
- không cần Production migration/env/deployment;
- chưa phát hiện regression B05/Commerce.

Việc triển khai chỉ được tiếp tục trên worktree/branch riêng, Preview fixture/database, flags off by default. Không apply/deploy Production.

## 20. Quyết định kiến trúc

Chọn `learning_site` làm logical LMS owner trên canonical course. Sales alias kế thừa owner từ canonical target. LMS Admin chỉ liệt kê canonical/self-target course tại effective owner; alias cross-site legacy chỉ hiện cảnh báo/context ở Commerce, không trở thành LMS course rỗng.

Mọi course-dependent backend operation phải:

1. validate requested site;
2. load row/ID canonical từ database;
3. resolve effective owner;
4. compare request/effective site;
5. reject mismatch;
6. perform write;
7. read-after-write xác minh slug/site và preservation fields.

