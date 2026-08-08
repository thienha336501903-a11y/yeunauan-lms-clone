# HỒ SƠ CẤU TRÚC, CHỨC NĂNG VÀ HIỆN TRẠNG HỆ THỐNG

**Ngày chốt bằng chứng:** 2026-07-30, Asia/Ho_Chi_Minh  
**Mục đích:** cung cấp cho đơn vị thứ ba đủ thông tin để đánh giá hiện trạng và ra quyết định cho dự án tiếp theo  
**Phạm vi:** Commerce, hai website bán hàng, LMS, Supabase dùng chung, Portal boundary, media/Drive, session/risk, triển khai, sao lưu và vận hành  
**Mức bảo mật:** tài liệu đã loại bỏ secret, token, khóa dịch vụ, dữ liệu thanh toán chi tiết và dữ liệu cá nhân  

---

## 1. Tóm tắt dành cho người ra quyết định

Hệ thống hiện tại là một nền tảng bán và cung cấp khóa học được ghép từ:

1. Hai website bán hàng độc lập về domain và Vercel project nhưng dùng chung
   source Commerce và cùng một Supabase Production.
2. Một LMS duy nhất tại `www.daubepnho.store`, dùng chung dữ liệu khóa học,
   enrollment, bài học, tiến độ và cơ chế Google Drive.
3. Một Portal bên ngoài hai repository, giao tiếp qua server-to-server boundary.
4. Các lớp V2/outbox/reconciliation đã tồn tại nhưng phần lớn được thiết kế để
   rollout có kiểm soát, không nên mặc định xem là hệ thống event-driven hoàn chỉnh.

Trạng thái Production đã được phục hồi về snapshot đầy đủ trước domain swap:

| Domain đang chạy | Vercel project | Tenant nội bộ |
|---|---|---|
| `shop.yeunauan.live` | `web-ban-hang-chinh-thuc` | `yeunauan` |
| `yeubep.shop` | `web-ban-hang-yeubep-shop` | `yeubep` |
| `www.daubepnho.store` | `web-lms-chinh-thuc` | LMS dùng chung |

Hai storefront đã có tenant isolation ở Commerce backend. Tuy nhiên LMS
Production B05 chưa có logical owner `learning_site`, vì vậy LMS Admin hiện là
một không gian quản trị dùng chung. Một triển khai LMS Admin Multi-Site đã được
xây dựng và kiểm thử ở protected Preview nhưng chưa được phát hành Production;
Production hiện không có cột `courses.learning_site` và các feature flag
multisite đang absent/false.

### Nhận định ngắn

- Hệ thống phù hợp với quy mô nhỏ đến vừa và vận hành tập trung.
- Kiến trúc có nhiều invariant nghiệp vụ quan trọng nhưng documentation và
  kiểm thử đã tương đối tốt.
- Rủi ro chính cho dự án mới là shared database, coupling theo slug, service-role
  server functions, admin UI chung và ranh giới ownership giữa Commerce/LMS/Portal.
- Không nên “viết lại tất cả” trước khi lập contract dữ liệu, inventory side
  effect và chiến lược chuyển đổi.
- Hướng an toàn nhất thường là strangler/incremental modernization: giữ
  canonical identity hiện hữu, bổ sung boundary/API mới và di chuyển từng luồng.

---

## 2. Nguồn bằng chứng và độ tin cậy

Báo cáo dùng bốn lớp bằng chứng:

1. Snapshot read-only đầy đủ:
   `full-system-readonly-20260726-104151`.
2. Exact source archive và Git refs của Commerce/LMS.
3. Schema catalog, row counts, constraints, indexes, policies, functions và
   metadata Vercel trong snapshot.
4. Verification ngày 2026-07-30 sau restore: canonical checksum của toàn bộ 27
   bảng Production khớp snapshot 27/27; HTTP smoke cho hai storefront và LMS đạt.

### Exact source đang đại diện cho Production

| Thành phần | Repository | Exact commit/tag |
|---|---|---|
| Commerce | `web-ban-hang-chinh-thuc` | `e65262f3e8eca39d8224f5b010bd376f27e1f9e3`, tag `launch/yeubep-shop-2026-07-25` |
| LMS | `web-lms-chinh-thuc` | `fc12c3b21329158e13a4a027833afd2dec61e973`, tag `backup/B05-2026-07-25` |

### Exact Production deployments

| Thành phần | Project ID | Deployment |
|---|---|---|
| Commerce `shop.yeunauan.live` | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` | `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h` |
| Commerce `yeubep.shop` | `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8` | `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6` |
| LMS | `prj_TimQqrVhrOLW8y1KI464JBvajwlz` | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |

CLI deployments không luôn có Git metadata trên Vercel. Quan hệ artifact-source
được chứng minh bằng exact worktree, source archive, tag và backup manifest.

---

## 3. Sơ đồ hệ thống hiện tại

```text
                    +----------------------------------+
                    |       QUẢN TRỊ COMMERCE          |
                    | admin.html / orders.html         |
                    +----------------+-----------------+
                                     |
                       course/order CRUD + approval
                                     |
                                     v
        +------------------- SUPABASE PRODUCTION -------------------+
        | courses, orders, lessons, enrollments, sessions, config  |
        | Drive logs/queue, sync outbox, audit/risk                 |
        +------------+-----------------------+----------------------+
                     |                       |
       SALES_SITE=yeunauan                   | SALES_SITE=yeubep
                     |                       |
                     v                       v
       shop.yeunauan.live                  yeubep.shop
       Commerce project A                 Commerce project B
                     \                       /
                      \ canonical learning /
                       \      slug         /
                        v                 v
                 +-------------------------------+
                 | Server-to-server sync boundary|
                 | Portal + LMS /api/sync        |
                 +---------------+---------------+
                                 |
                                 v
                   www.daubepnho.store
                 LMS học viên + LMS Admin
                                 |
                     Google Identity / Drive
```

### Ranh giới danh tính

Ba khái niệm cần luôn được tách:

- `sales_site`: website phát sinh đơn hàng.
- Sales course slug: khóa được bán trên storefront.
- Canonical learning slug: khóa LMS thật sự được cấp quyền.

Production hiện có `sales_site` và `learning_course_slug`, nhưng chưa có
`learning_site`.

---

## 4. Stack công nghệ

### 4.1 Commerce

- Frontend: HTML, CSS, Vanilla JavaScript.
- Backend: Vercel Serverless Functions, Node.js ESM.
- Database: Supabase PostgreSQL qua `@supabase/supabase-js`.
- Upload ảnh/biên lai: Cloudinary.
- Hosting/domain: Vercel.
- Không dùng frontend framework và không có build output phức tạp.

Các trang chính:

- `index.html`: storefront khóa học.
- `admin.html`: quản trị khóa học.
- `orders.html`: quản trị đơn hàng.

Các API chính:

- `/api/config`: cấu hình/course public theo tenant.
- `/api/courses`: danh sách và CRUD khóa học.
- `/api/register`: tạo đơn hàng.
- `/api/orders`: quản trị, approve, revoke, resync.
- `/api/approve-all`: duyệt hàng loạt có scope.
- `/api/upload`: upload biên lai.
- `/api/check-auth`: kiểm tra admin.
- `/api/v2/diagnostics`, `/api/v2/readiness`: diagnostics.

### 4.2 LMS

- Frontend: HTML, CSS/Tailwind output, Vanilla JavaScript.
- Backend: Vercel Functions, Node.js ESM.
- Database: cùng Supabase PostgreSQL với Commerce.
- Identity: Google GSI và session/cookie do LMS quản lý.
- Media: Google Drive, URL/iframe/video provider và tài liệu.
- Kiểm thử: Node built-in test runner.

Các trang chính:

- `index.html`: entry.
- `lms.html`: danh sách khóa học học viên.
- `lesson.html`: trình học bài.
- `lms-admin.html`: quản trị LMS.
- `gdrive-player.html`: phát nội dung Drive theo contract.
- `photo.html`: hiển thị ảnh/tài nguyên.

Các API chính:

- `/api/sync`: sync course/enrollment/revoke từ hệ thống nội bộ.
- `/api/lms/portal`: entry/session/enrollment boundary cho học viên.
- `/api/lms/admin?endpoint=...`: router LMS Admin.
- `/api/v2/*`: readiness, diagnostics, outbox, worker, reconciliation và
  projection preview.

### 4.3 Hạ tầng

- Vercel Node runtime 24.x.
- Supabase project ref `aqozjkfwzmyfunqvcyjv`.
- PostgreSQL 17, region `ap-southeast-1`.
- Một Production database dùng chung cho Commerce và LMS.
- Không có message broker độc lập; outbox được lưu trong PostgreSQL.

---

## 5. Chức năng nghiệp vụ Commerce

### 5.1 Storefront

Luồng tải:

1. Browser mở `/?course=<sales-slug>`.
2. Frontend gọi `/api/config`.
3. Backend lấy tenant từ `SALES_SITE` của deployment.
4. Backend chỉ tìm course active/published thuộc tenant tương ứng.
5. Frontend render landing page.

Nội dung hỗ trợ:

- title, subtitle, mô tả, poster;
- giá và giáo viên;
- ngày dự kiến;
- thông tin ngân hàng, QR, nội dung chuyển khoản;
- form khách hàng và upload biên lai;
- responsive desktop/mobile;
- trạng thái loading và lỗi.

### 5.2 Quản trị khóa học

Chức năng:

- xem, tạo, sửa và thao tác trạng thái khóa học;
- active/published và thứ tự;
- nội dung, giá, hình, giáo viên, ngày dự kiến;
- ngân hàng/QR/nội dung chuyển khoản;
- chọn website bán hàng;
- chọn canonical LMS target;
- read-after-write để xác nhận dữ liệu persisted.

Điểm cần giữ:

- `courses.slug` unique toàn hệ thống;
- quick toggle không được làm mất `sales_site`;
- chỉnh field không liên quan không được đổi learning target;
- thay target không rewrite snapshot của order cũ;
- alias chain/cycle không được chấp nhận.

### 5.3 Đơn hàng và thanh toán

Thanh toán hiện là chuyển khoản thủ công:

1. Học viên nhập thông tin.
2. Nhận QR/thông tin chuyển khoản.
3. Upload biên lai.
4. Backend tạo order.
5. Admin xác minh và approve.
6. Commerce gọi Portal/LMS để cấp quyền.

Backend tạo order lấy course/title/giá/tenant từ database, không tin các giá trị
nhạy cảm do browser gửi. Order lưu snapshot giá và canonical learning slug,
đồng thời dùng idempotency để giảm double submit.

### 5.4 Quản trị đơn hàng

- danh sách và filter theo course/status/site;
- cập nhật/approve/revoke/resync;
- approve-all có scope;
- hiển thị nguồn website;
- theo dõi trạng thái sync LMS và Portal.

### 5.5 Shared entitlement

Hai sales course có thể cùng trỏ một canonical LMS course. Trước revoke, backend
kiểm tra email đó còn order approved nào khác cấp cùng canonical learning slug
hay không. Nếu còn, entitlement được giữ; chỉ order cấp quyền cuối cùng mới làm
phát sinh revoke LMS.

---

## 6. Learning Course Boundary

Các field hiện hữu:

```text
courses.learning_course_slug
orders.learning_course_slug
```

Fallback:

```text
effective course target =
  non-empty courses.learning_course_slug
  hoặc courses.slug

effective order target =
  non-empty orders.learning_course_slug
  hoặc orders.course_slug
```

Alias legacy:

```text
thitxiennuongchaungoc-yeubep
    → thitxiennuongchaungoc
```

Alias là khóa bán hàng; canonical target mới có lesson. Hệ thống không clone
lesson và không tạo một LMS course rỗng cho alias.

Contract sync giữ ba action:

- `syncCourse`;
- `syncEnrollment`;
- `revokeEnrollment`.

Commerce canonicalize slug trước khi gọi LMS/Portal. `sales_site` không phải là
tham số authorization của LMS baseline.

---

## 7. Chức năng LMS học viên

### 7.1 Xác thực và session

- Google sign-in.
- Entry token được hash và có thời hạn/trạng thái.
- Exchange/verify tạo LMS verified session.
- Cookie/session signing và restore.
- Session guard theo email/device.
- Chính sách block hoặc supersede thiết bị khác.
- Admin reset có thể revoke active session/token.

Không nên thay session identity hoặc token lifecycle mà không kiểm tra toàn bộ
Portal → LMS entry flow.

### 7.2 Enrollment và truy cập

- Enrollment identity hiện hữu: `(email, course_slug)`.
- Chỉ enrollment `active` cho phép truy cập course.
- Học viên nhìn thấy danh sách course được cấp.
- Alias sales được resolve về canonical learning slug trước khi enrollment.

### 7.3 Lesson và progress

- Course có chapter/section và lesson.
- Section cũng là row trong bảng `lessons`, đánh dấu bằng `is_section`.
- Quan hệ section dùng `parent_section_id` và `position`.
- Lesson có prev/next, hard load và SPA navigation.
- Tiến độ unique theo `(email, lesson_id)`.
- Có main media, supplemental media, caption, materials và recipe/document/photo.

### 7.4 Media

Lesson hỗ trợ:

- video URL/provider;
- Bunny identifiers;
- Google Drive media;
- ảnh/thumbnail;
- recipe/document;
- supplemental media;
- materials dạng cấu hình.

Các invariant đã từng có regression và cần test bắt buộc:

- phân loại main video;
- one-tap main video;
- supplemental caption/thumbnail;
- SPA navigation;
- prev/next;
- Drive permission/player.

---

## 8. Chức năng LMS Admin

LMS Admin là một trang duy nhất, gọi router:

```text
/api/lms/admin?endpoint=<handler>
```

Nhóm chức năng:

- admin authentication/allowlist;
- course và course config;
- section/lesson;
- upload image, recipe, material và Drive video;
- media verification;
- enrollment và bulk enrollment;
- student list/trace;
- Google Drive OAuth/status/health;
- Drive permission, sync, repair và retry;
- runtime mode và diagnostics;
- account-sharing/risk alerts.

### Phạm vi hiện tại

Production B05 tải course LMS trong một danh sách chung. Server chưa có
`learning_site` để bắt buộc course ownership theo hai website.

### Năng lực multisite chưa phát hành

Protected Preview đã chứng minh:

- selector hai website;
- server-side course/site scope;
- IDOR rejection;
- lesson/enrollment/progress độc lập;
- Drive dry-run;
- Commerce same-site target;
- legacy alias compatibility.

Nhưng sau các lần Production gate bị dừng và quyết định restore, Production hiện:

- không có `courses.learning_site`;
- không bật `LMS_ADMIN_MULTI_SITE_ENABLED`;
- không bật `COMMERCE_LMS_SITE_ISOLATION_ENABLED`;
- vẫn chạy exact LMS B05 và Commerce pre-swap.

Bên thứ ba không được coi feature multisite là chức năng Production hiện hành.

---

## 9. Google Drive và media operation

Drive có:

- pool 3 admin account metadata;
- OAuth/refresh-token configuration server-side;
- folder/course linkage;
- permission grant/revoke;
- log và retry queue;
- health/status/repair;
- retry count và error metadata.

Các bảng:

- `drive_admin_accounts`;
- `drive_permission_logs`;
- `drive_sync_queue`;
- enrollment cũng lưu permission state/ID/admin/folder/error.

Rủi ro:

- Drive là external side effect, database rollback không tự rollback permission.
- Không được copy credential sang môi trường thứ ba.
- Mọi rehearsal mới phải dùng adapter/dry-run hoặc tài khoản test riêng.
- Restore vừa qua đã đưa Drive token và account/session rows về snapshot 26/07;
  cần xác nhận vận hành OAuth/refresh trước một dự án có mutation Drive.

---

## 10. Portal và đồng bộ liên hệ thống

Portal là boundary bên ngoài repository Commerce/LMS. Commerce dùng:

- `SYSTEM1_URL`: Portal;
- `SYSTEM3_URL`: LMS;
- `INTERNAL_SYNC_SECRET`: xác thực server-to-server.

Secret chỉ tồn tại phía server. CORS không thay thế authentication.

### Outbox/V2

Schema có:

- `sync_outbox`;
- `sync_deliveries`;
- `sync_dead_letters`;
- `course_slug_mappings`;
- `portal_post_course_mappings`;
- `platform_runtime_config` và audit.

Runtime có diagnostics/readiness/worker/reconciliation/projection modules và
feature flags. Đây là nền tảng cho controlled rollout, không phải bằng chứng rằng
mọi write hiện đã chuyển sang asynchronous outbox.

### Dry-run

`EXTERNAL_SYNC_MODE=dry-run` được thiết kế để chặn:

- fetch thật đến LMS/Portal;
- enqueue/delivery thật;
- entitlement/email side effect liên quan.

Dự án mới cần duy trì dry-run contract để test end-to-end an toàn.

---

## 11. Data model hiện tại

### 11.1 Quy mô snapshot/Production đã phục hồi

| Bảng | Rows |
|---|---:|
| `courses` | 8 |
| `orders` | 28 |
| `site_config` | 73 |
| `students` | 13 |
| `student_enrollments` | 20 |
| `lessons` | 39 |
| `lesson_progress` | 0 |
| `drive_permission_logs` | 59 |
| `drive_sync_queue` | 9 |
| `drive_admin_accounts` | 3 |
| `sync_outbox` | 5 |
| `sync_deliveries` | 3 |
| `student_active_sessions` | 16 |
| `lms_entry_tokens` | 38 |
| `lms_verified_sessions` | 38 |
| `student_device_change_logs` | 64 |
| `admin_audit_logs` | 5 |

Toàn bộ 27 bảng khớp canonical checksum với snapshot ngày 26/07.

### 11.2 Nhóm bảng

| Nhóm | Bảng chính |
|---|---|
| Commerce | `courses`, `orders`, `site_config` |
| LMS core | `students`, `student_enrollments`, `lessons`, `lesson_progress` |
| Drive | `drive_admin_accounts`, `drive_permission_logs`, `drive_sync_queue` |
| Sync/V2 | `sync_outbox`, `sync_deliveries`, `sync_dead_letters`, mapping/runtime tables |
| Session | `student_active_sessions`, `lms_entry_tokens`, `lms_verified_sessions`, `student_session_controls` |
| Risk/audit | device logs, risk summary/review/note, `admin_audit_logs` |
| Portal/content | `posts`, `portal_post_course_mappings` |

### 11.3 Invariant và khóa quan trọng

- `courses.slug` global unique.
- `student_enrollments (email, course_slug)` unique.
- `lessons (course_slug, lesson_no)` unique.
- `lesson_progress (email, lesson_id)` unique.
- `students.email` unique.
- `lms_entry_tokens.token_hash` unique.
- `lms_verified_sessions.lms_session_id` unique.
- `student_active_sessions.student_session_id` unique.
- Order liên kết course bằng FK `ON DELETE SET NULL`.
- Enrollment liên kết course/student; course delete có thể cascade enrollment.
- Lesson delete/cascade ảnh hưởng progress.

Các hành động delete course/lesson vì vậy phải được coi là dữ liệu phá hủy,
không chỉ là thay đổi UI.

### 11.4 RLS

Catalog có 8 policy đáng chú ý:

- anon/authenticated đọc active courses;
- anon đọc free lessons;
- authenticated đọc lesson nếu có enrollment active;
- authenticated đọc enrollment/session/progress của chính email;
- authenticated update progress của chính email.

Server functions vẫn dùng service-role cho nhiều thao tác. RLS không tự bảo vệ
khỏi lỗi authorization trong code service-role.

### 11.5 Database functions

Ba function chính:

- `handle_student_session_login`: khóa theo email, reuse/block/supersede session.
- `reset_student_session_guard`: admin revoke session/token và ghi audit.
- `cleanup_student_account_risk_events`: retention cho risk/audit data.

Không có trigger trong snapshot. Nhiều invariant được thực thi ở application
hoặc gọi function có chủ đích.

---

## 12. Tenant model hiện hành

Allowed values:

- `yeunauan`;
- `yeubep`.

Mapping Production hiện tại:

| Domain | `SALES_SITE` |
|---|---|
| `shop.yeunauan.live` | `yeunauan` |
| `yeubep.shop` | `yeubep` |

Legacy fallback:

```text
courses.sales_site IS NULL → yeunauan
orders.sales_site IS NULL  → yeunauan
```

Backend phải lấy tenant từ environment của Vercel project, không tin:

- query;
- request body;
- tenant header;
- forwarded host do client kiểm soát.

`www.yeubep.shop` redirect HTTP 308 tới `yeubep.shop`.

---

## 13. Bảo mật

### Kiểm soát đang có

- service-role chỉ phía server;
- internal sync secret;
- admin allowlist/auth;
- signed LMS session/cookie;
- token hash thay vì raw token identity;
- device/session guard;
- account-sharing/risk log;
- RLS cho các read/update học viên quan trọng;
- tenant validation phía Commerce server;
- canonical target validation;
- idempotency cho order/sync;
- audit và diagnostics.

### Điểm cần rà soát cho dự án mới

1. Admin authentication là boundary đặc quyền cao vì server dùng service-role.
2. Shared database làm tăng blast radius của lỗi handler.
3. Email đang là identity xuyên nhiều bảng; normalization cần một contract duy nhất.
4. Session/device data chứa PII/security data, cần retention và access policy.
5. Google Drive credential và permission là external state.
6. CORS chỉ là browser policy, không phải authentication.
7. Không đưa Production env/secrets vào Preview hoặc vendor environment.
8. Phải có IDOR tests cho course, lesson, enrollment, media và Drive ID.

---

## 14. Triển khai và cấu hình

### Vercel projects

Ba project Production:

1. Commerce main.
2. Commerce Yeubep.
3. LMS.

Hai Commerce project dùng cùng source nhưng khác:

- `SALES_SITE`;
- `PUBLIC_SITE_URL`;
- domain/alias;
- deployment artifact.

Các nhóm env name, không có value:

- Supabase URL/service-role;
- admin authentication;
- Cloudinary;
- system sync URLs/secret;
- sales site/public URL/data mode;
- Google client/session;
- Drive admin pool;
- V2 runtime/dry-run/worker flags.

### Feature flags

Flags V2 và dry-run tồn tại để rollout từng phần. Hai multisite flags đã được
xây dựng ở feature branch nhưng đang absent/false trong Production.

Không nên thay đồng thời schema, code, flags và external integration trong một
deployment duy nhất. Runbook tốt nên tách additive migration → deploy flags off
→ read-only canary → controlled write → observation.

---

## 15. Sao lưu, phục hồi và hiện trạng vận hành

Snapshot chuẩn hiện hành:

```text
full-system-readonly-20260726-104151
```

Phạm vi:

- source archives và Git refs;
- Vercel deployment/domain/env-name metadata;
- DNS public;
- Supabase schema và data 27 bảng;
- media URL linkage;
- checksums và restore runbook.

Ngày 2026-07-30 hệ thống đã được phục hồi về snapshot này:

- dữ liệu post-snapshot được loại bỏ theo phê duyệt owner;
- domain/env/deployment được đưa về pre-swap;
- schema multisite additive được rollback;
- audit/sync/Drive token và bốn bảng session/Drive Admin được restore;
- toàn bộ 27 bảng đạt checksum;
- có các safety backup mã hóa ngoài Git trước mutation.

### Lưu ý

- “Khớp 27/27” là checksum canonical của row data, không phải physical block
  image của PostgreSQL.
- Database restore không tự phục hồi DNS, Vercel alias hoặc external Drive state.
- Backup chứa PII phải được mã hóa, hạn chế quyền và không gửi cho vendor nếu
  chưa sanitize.

---

## 16. Kiểm thử và chất lượng

Baseline LMS B05: 300/300.

Feature multisite Preview từng đạt:

- LMS 317/317 ở gate Preview ban đầu, sau corrective suite tăng đến 329/329;
- Commerce 73/73;
- browser matrix 12/12;
- IDOR, enrollment/progress và Drive dry-run đạt.

Những con số Preview không thay đổi baseline Production B05. Chúng cho biết
feature branch có evidence tốt, nhưng cần rebase/revalidation nếu dự án mới sửa
kiến trúc hoặc dùng source khác.

Các lớp test hiện hữu:

- source/unit;
- API/handler;
- migration bằng PGlite/PostgreSQL rehearsal;
- tenant isolation;
- learning-course boundary;
- auth/session/device;
- media regressions;
- V2 diagnostics/readiness/outbox;
- browser/E2E cho protected Preview.

---

## 17. Điểm mạnh

- Cấu trúc nhỏ, dễ đọc, ít abstraction.
- Chi phí vận hành thấp nhờ Vercel/Supabase.
- Có exact source/deployment/backup evidence.
- Tenant Commerce được scope phía server.
- Có canonical learning boundary và shared-entitlement logic.
- Nhiều regression quan trọng đã được codify thành tests.
- Có dry-run, readiness, diagnostics và rollback discipline.
- Không nhân đôi LMS hay database cho hai storefront.

---

## 18. Nợ kỹ thuật và rủi ro

| Rủi ro | Tác động | Mức ưu tiên |
|---|---|---|
| Một Supabase dùng chung cho Commerce/LMS | Lỗi schema/service-role có blast radius rộng | Cao |
| Identity phụ thuộc email + slug | Đổi email/slug hoặc duplicate normalization dễ gây lệch quyền | Cao |
| LMS Admin Production chưa có site ownership | Admin có thể thao tác nhầm course của storefront khác khi mở rộng | Cao |
| Commerce/LMS/Portal contract phân tán | Dễ sửa một phía và gây sync regression | Cao |
| External Drive side effect | DB rollback không hoàn tác permission | Cao |
| Vanilla JS/HTML page lớn | Khó modularize, test UI và quản lý state khi tính năng tăng | Trung bình |
| Service-role handlers | RLS không bảo vệ nếu authorization code sai | Cao |
| Legacy NULL fallback | Dễ hiểu sai ownership khi migration/backfill | Trung bình |
| Global unique slug | Hạn chế namespace nhưng đang là invariant xuyên hệ thống | Trung bình |
| Deployment CLI thiếu Git metadata | Khó trace artifact nếu không giữ manifest | Trung bình |
| V2 và baseline cùng tồn tại | Operator có thể hiểu nhầm runtime mode | Trung bình |
| Drive/session token vừa rollback lịch sử | Cần operational health check trước mutation mới | Cao |

### Dependency

LMS audit gần nhất ghi nhận bốn advisory mức moderate, không có high/critical.
Automatic fix yêu cầu breaking upgrade; không nên trộn nâng cấp Google APIs/uuid
với thay đổi kiến trúc nghiệp vụ. Commerce không có advisory đáng kể ở lần audit
gần nhất.

---

## 19. Những điều không nên thay đổi thiếu kế hoạch

- `courses.slug` global unique.
- Enrollment identity `(email, course_slug)`.
- Lesson identity `(course_slug, lesson_no)`.
- Canonical `learning_course_slug` snapshot trên order.
- Legacy NULL fallback.
- Shared-entitlement revoke contract.
- Google GSI/session/cookie restore.
- Section representation trong `lessons`.
- Drive permission lifecycle.
- Portal/LMS sync action contract.
- Production LMS B05 source identity.

Bất kỳ dự án nào muốn thay các invariant trên phải có migration, dual-read/write,
reconciliation, rollback và test historical data.

---

## 20. Các phương án dự án mới

### Phương án A — Mở rộng trên nền hiện tại

Phù hợp khi mục tiêu:

- thêm chức năng nghiệp vụ vừa phải;
- ngân sách/thời gian hạn chế;
- tiếp tục Vercel/Supabase;
- chưa cần scale tổ chức lớn.

Điều kiện:

- chuẩn hóa module/API;
- tăng server-side authorization tests;
- giữ exact boundary;
- hoàn thiện monitoring và deployment manifest.

Ưu điểm: nhanh, ít migration.  
Nhược điểm: giữ shared-database coupling và page-level monolith.

### Phương án B — Hoàn thiện LMS Admin Multi-Site

Phù hợp khi ưu tiên trước mắt là quản trị độc lập hai hệ thống bán hàng.

Nên tái sử dụng feature branch/evidence đã có nhưng phải:

- audit lại từ restored Production baseline;
- xác minh legacy alias;
- chạy lại Preview substrate;
- migration additive, không backfill mặc định;
- deploy flags off trước;
- controlled canary và rollback ngay khi cross-site mismatch.

Ưu điểm: giải quyết rủi ro vận hành cụ thể, thay đổi hẹp.  
Nhược điểm: không giải quyết toàn bộ coupling Commerce/LMS/Portal.

### Phương án C — Modular modernization/strangler

Phù hợp khi dự án mới cần:

- nhiều storefront/brand;
- nhiều nhóm vận hành;
- API/partner/mobile;
- observability và audit cao;
- scale enrollment/media lớn.

Gợi ý boundary:

- Catalog/Commerce;
- Order/Payment;
- Entitlement;
- Learning Content;
- Identity/Session;
- Media/Drive;
- Integration/Outbox.

Không cần lập tức tạo nhiều database. Có thể bắt đầu bằng schema/service boundary,
contract tests và outbox rồi di chuyển dần.

Ưu điểm: giảm coupling dài hạn.  
Nhược điểm: chi phí cao hơn, cần dual-run/reconciliation.

### Phương án D — Viết lại toàn bộ

Chỉ nên chọn khi:

- yêu cầu sản phẩm mới khác căn bản;
- có ngân sách migration và parallel run;
- chấp nhận kiểm chứng lại toàn bộ media/session/entitlement;
- có đội sở hữu dài hạn.

Không khuyến nghị nếu lý do duy nhất là code hiện tại dùng Vanilla JS.

---

## 21. Khuyến nghị của báo cáo

Khuyến nghị mặc định:

1. Chọn Phương án B nếu nhu cầu cấp bách là tách quản trị hai website.
2. Đồng thời thiết kế roadmap Phương án C theo strangler, không rewrite một lần.
3. Giữ một canonical entitlement contract trước khi thay UI/framework.
4. Tạo sanitized non-Production environment riêng, không clone PII.
5. Tách monitoring theo component và side effect.
6. Bắt buộc contract/E2E tests xuyên Commerce → LMS → Portal.

### Trình tự discovery đề xuất

1. Chốt business capability và SLA.
2. Chốt system-of-record cho catalog, order, entitlement, content và identity.
3. Inventory tất cả external side effects.
4. Chốt tenant/namespace model.
5. Chốt canonical identifiers và policy đổi slug/email.
6. Chọn migration pattern.
7. Lập non-Production fixture và observability.
8. Chỉ sau đó ước lượng timeline/chi phí chính thức.

---

## 22. Câu hỏi bên thứ ba phải trả lời

### Sản phẩm

- Dự án mới giải quyết vấn đề nào: multisite, checkout, LMS UX, mobile, CRM hay scale?
- Có bao nhiêu brand/site trong 12–24 tháng?
- Có cần course giống tên nhưng độc lập hoàn toàn không?
- Có marketplace, subscription, coupon, refund hay automated payment không?

### Dữ liệu

- System-of-record cho order và entitlement là gì?
- Có giữ global slug hay tạo immutable course ID public?
- Có cần thay email identity bằng user/account ID?
- Retention cho order, session, risk và audit là bao lâu?

### Tích hợp

- Portal tiếp tục tồn tại hay được hợp nhất?
- Google Drive còn là media/permission provider chính không?
- Có cần payment gateway, CRM, email automation hoặc analytics?
- Side effect nào phải exactly-once, at-least-once hoặc có compensation?

### Bảo mật/vận hành

- Ai là admin theo từng tenant?
- Cần SSO/MFA/RBAC/audit mức nào?
- SLA/RTO/RPO?
- Ai trực monitoring và có quyền rollback?
- Vendor được truy cập môi trường nào và dữ liệu nào?

### Chuyển đổi

- Có chấp nhận dual-run?
- Có maintenance window?
- Có cần giữ URL/slug cũ tuyệt đối?
- Tiêu chí cutover và rollback là gì?

---

## 23. Tiêu chí đánh giá đề xuất của bên thứ ba

Yêu cầu vendor nộp:

| Hạng mục | Bằng chứng cần có |
|---|---|
| Hiểu hiện trạng | Sơ đồ component/data flow và invariant list |
| Kiến trúc mới | ADR, ownership và trust boundary |
| Migration | Data mapping, dual-run, reconciliation, rollback |
| Security | Threat model, RBAC/IDOR/session/secret handling |
| Reliability | Idempotency, retries, external side-effect compensation |
| Testing | Unit, contract, integration, E2E, migration rehearsal |
| Operations | Monitoring, alert, backup, RTO/RPO, runbook |
| Cost | Build + recurring cloud/operations |
| Delivery | Milestones có exit criteria và demo evidence |
| Handover | Source, docs, IaC/env-name manifest, training |

Không chấp nhận proposal chỉ mô tả framework/UI mà thiếu entitlement, session,
Drive, Portal, data migration và rollback.

---

## 24. Phạm vi bàn giao an toàn

Có thể cung cấp cho bên thứ ba:

- tài liệu này;
- source archive đã loại `.env`;
- schema-only snapshot;
- sanitized fixtures;
- API/contract docs;
- test suites và non-secret deployment manifest;
- diagrams và ADR.

Không cung cấp trực tiếp:

- Production service-role;
- database password;
- sync secret;
- session signing secret;
- Google OAuth/Drive refresh/access token;
- raw order/enrollment/session JSON;
- backup chứa PII;
- Vercel token.

Nếu vendor cần truy cập, dùng least privilege, môi trường riêng, credential có
thời hạn và audit.

---

## 25. Kết luận

Hệ thống hiện tại có đủ nền tảng để tiếp tục phát triển nhưng không nên mở rộng
tenant hoặc entitlement bằng thay đổi frontend đơn thuần. Các contract quan
trọng nằm ở database, server-side tenant resolution, canonical learning slug,
shared entitlement, session guard và external Drive/Portal side effects.

Quyết định hợp lý nhất phụ thuộc mục tiêu dự án:

- cần giải quyết nhanh quản trị hai site: hoàn thiện multisite isolation;
- cần mở rộng nền tảng dài hạn: strangler theo capability;
- chỉ nên rewrite toàn bộ khi sản phẩm mới khác căn bản và có ngân sách
  parallel-run/migration đầy đủ.

Trước khi ký scope, bên thứ ba phải xác nhận system-of-record, tenant model,
identity, entitlement, external side effects, SLA và rollback strategy.

---

## Phụ lục A — Inventory 27 bảng

1. `courses`
2. `orders`
3. `site_config`
4. `students`
5. `student_enrollments`
6. `lessons`
7. `lesson_progress`
8. `drive_permission_logs`
9. `drive_sync_queue`
10. `drive_admin_accounts`
11. `sync_outbox`
12. `sync_deliveries`
13. `sync_dead_letters`
14. `course_slug_mappings`
15. `portal_post_course_mappings`
16. `platform_runtime_config`
17. `platform_runtime_config_audit`
18. `student_active_sessions`
19. `lms_entry_tokens`
20. `lms_verified_sessions`
21. `student_session_controls`
22. `student_device_change_logs`
23. `student_account_risk_reviews`
24. `student_account_risk_summaries`
25. `student_account_admin_notes`
26. `admin_audit_logs`
27. `posts`

## Phụ lục B — Các endpoint LMS Admin

- authentication;
- courses;
- lessons/sections;
- enrollments;
- bulk enroll;
- students;
- student trace;
- account-sharing alerts;
- upload image;
- upload recipe;
- upload material;
- upload Google Drive video;
- verify media;
- Drive auth/health/permission/sync/repair/retry;
- runtime mode.

## Phụ lục C — Trạng thái sau restore

- Snapshot: `full-system-readonly-20260726-104151`.
- Database canonical checksum: 27/27.
- Commerce domains: pre-swap mapping.
- LMS: B05.
- Production multisite migration: không tồn tại.
- Production multisite flags: absent/false.
- Post-snapshot business rows: đã loại bỏ theo phê duyệt owner.
- Safety backups trước restore: mã hóa ngoài Git, không ghi secret trong hồ sơ.
