# BÁO CÁO TỔNG THỂ KIẾN TRÚC VÀ BÀN GIAO HỆ THỐNG HIỆN TẠI

**Ngày lập:** 2026-07-26 (Asia/Saigon)  
**Mục đích:** cung cấp cho đơn vị thứ ba một tài liệu đủ để hiểu cấu trúc, chức năng, ranh giới dữ liệu, quy trình vận hành và các điểm không được làm hỏng của toàn hệ thống.  
**Phạm vi:** hai website bán khóa học, trang quản trị commerce, cơ sở dữ liệu Supabase dùng chung, cổng đồng bộ server-to-server, LMS học viên và ranh giới Portal.

> Tài liệu không chứa mật khẩu, token, service-role key, sync secret, thông tin ngân hàng chi tiết hoặc dữ liệu cá nhân khách hàng.

---

## 1. Tóm tắt điều hành

Hệ thống hiện có hai storefront độc lập về domain và Vercel project nhưng dùng chung một codebase commerce và một Supabase production:

1. `https://shop.yeunauan.live`
   - tenant nội bộ: `yeunauan`;
   - phục vụ 7 khóa học legacy có `courses.sales_site IS NULL`;
   - quy tắc tương thích: `NULL` được hiểu là `yeunauan`.

2. `https://yeubep.shop`
   - tenant nội bộ: `yeubep`;
   - hiện phục vụ khóa bán hàng `thitxiennuongchaungoc-yeubep`;
   - khóa bán hàng này cấp quyền vào khóa học LMS canonical `thitxiennuongchaungoc`, không tạo một khóa LMS rỗng mới.

Hai storefront dùng chung:

- trang quản trị khóa học;
- trang quản trị đơn hàng;
- Supabase B;
- Cloudinary cho ảnh/biên lai;
- boundary đồng bộ Portal/LMS.

Tenant được xác định ở server từ biến môi trường deployment, không tin query/header/body từ trình duyệt. Truy vấn public được lọc tenant tại backend.

LMS production là hệ thống riêng tại `https://www.daubepnho.store`, chạy từ baseline B05 cố định, không chạy từ `origin/main`.

---

## 2. Sơ đồ kiến trúc

```text
                         ADMIN COMMERCE CHUNG
                    shop.yeunauan.live/admin.html
                                  |
                     tạo/sửa course + sales_site
                                  |
                                  v
                         SUPABASE B PRODUCTION
                    ref: aqozjkfwzmyfunqvcyjv
              courses / orders / lessons / enrollments
                         /                \
                        /                  \
             SALES_SITE=yeunauan       SALES_SITE=yeubep
                      |                       |
                      v                       v
          shop.yeunauan.live              yeubep.shop
          project commerce cũ       project storefront mới
                      \                       /
                       \                     /
                        +--- commerce APIs --+
                                  |
                    canonical learning slug resolver
                                  |
                 +----------------+----------------+
                 |                                 |
                 v                                 v
              Portal                        LMS /api/sync
        qua SYSTEM1_URL              www.daubepnho.store
                                         SYSTEM3_URL
```

Ranh giới quan trọng:

- “Khóa bán hàng” và “khóa học tập” có thể khác slug.
- Storefront/đơn hàng giữ sales slug.
- LMS/Portal luôn nhận canonical learning slug.
- Secret đồng bộ chỉ tồn tại server-side.

---

## 3. Trạng thái production được xác minh

Thời điểm kiểm tra database: `2026-07-26 00:04:52 +07:00`.

### 3.1 Commerce source

| Thuộc tính | Giá trị |
|---|---|
| GitHub repository | `thienha100022653824678-stack/web-ban-hang-chinh-thuc` |
| Remote | `https://github.com/thienha100022653824678-stack/web-ban-hang-chinh-thuc.git` |
| Branch hiện hành | `feature/yeubep-shop` |
| Exact commit | `e65262f3e8eca39d8224f5b010bd376f27e1f9e3` |
| Tag launch | `launch/yeubep-shop-2026-07-25` |
| Worktree | `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_worktrees\yeubep-storefront` |
| Worktree status | sạch tại thời điểm kiểm tra |
| Runtime | Node.js 24.x trên Vercel |
| Package manager | npm |
| Module system | ESM (`"type": "module"`) |
| Frontend | HTML/CSS/Vanilla JavaScript |
| Backend | Vercel Serverless Functions |
| Database client | `@supabase/supabase-js` |
| Media storage client | Cloudinary SDK |
| Build framework | không dùng framework; không có build output riêng |

### 3.2 Vercel commerce

| Hệ thống | Project | Project ID | Production deployment | Trạng thái |
|---|---|---|---|---|
| Storefront cũ | `web-ban-hang-chinh-thuc` | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` | `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h` | READY |
| Storefront Yeubep | `web-ban-hang-yeubep-shop` | `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8` | `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6` | READY |

Hai deployment production trên được tạo từ source state của exact commit `e65262f3...`. Vì deployment được đẩy trực tiếp bằng CLI, trường Git commit metadata của API Vercel hiện để trống; exact source được quản lý bằng worktree sạch, commit đã push và annotated tag.

### 3.3 Domain assignment hiện tại

Project cũ:

- `shop.yeunauan.live`;
- `web-ban-hang-chinh-thuc-alpha.vercel.app`.

Project Yeubep:

- `yeubep.shop`;
- `www.yeubep.shop` → redirect HTTP 308 tới `https://yeubep.shop`;
- `web-ban-hang-yeubep-shop.vercel.app`.

Domain-level ownership của `yeubep.shop` đã nằm tại team:

`thienha100022653824678-stacks-projects`

### 3.4 LMS production

| Thuộc tính | Giá trị |
|---|---|
| Repository | `thienha100022653824678-stack/web-lms-chinh-thuc` |
| Remote | `https://github.com/thienha100022653824678-stack/web-lms-chinh-thuc.git` |
| Safe production tag | `backup/B05-2026-07-25` |
| Exact production commit | `fc12c3b21329158e13a4a027833afd2dec61e973` |
| Production deployment | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |
| Production domain | `https://www.daubepnho.store` |
| Test baseline | 300/300 pass |

**Cảnh báo:** production LMS không được base từ `origin/main`. Mọi task LMS phải tạo worktree sạch từ tag B05 hoặc exact SHA trên.

---

## 4. Cấu trúc repository commerce

```text
web-ban-hang-chinh-thuc/
├── index.html                 # storefront bán khóa học
├── admin.html                 # quản trị khóa học dùng chung
├── orders.html                # quản trị đơn hàng dùng chung
├── api/
│   ├── config.js              # public course/config theo tenant + slug
│   ├── courses.js             # CRUD course, validation, read-after-write
│   ├── register.js            # tạo đơn hàng
│   ├── orders.js              # đọc/cập nhật/resync/revoke order
│   ├── approve-all.js         # duyệt hàng loạt có scope
│   ├── upload.js              # upload biên lai lên Cloudinary
│   ├── check-auth.js          # xác thực admin tối thiểu
│   └── v2/
│       ├── diagnostics.js
│       └── readiness.js
├── utils/
│   ├── sales-site.js          # allowlist tenant/domain và filter backend
│   ├── learning-course.js     # resolver sales slug → canonical LMS slug
│   ├── sync-helpers.js        # boundary Portal/LMS + dry-run guard
│   ├── supabase.js            # Supabase service client server-side
│   ├── preview-fixture.js     # fixture/local/preview
│   ├── v2-outbox.js
│   ├── v2-sync-worker.js
│   ├── v2-runtime-controller.js
│   ├── v2-runtime-cache.js
│   └── v2-flags.js
├── migrations/
│   ├── 20260725_multi_storefront_tenant.sql
│   ├── 20260725_multi_storefront_tenant_rollback.sql
│   ├── 20260725_learning_course_boundary.sql
│   └── 20260725_learning_course_boundary_rollback.sql
├── scripts/
├── tests/
├── package.json
└── package-lock.json
```

Không có `vercel.json` trong codebase hiện tại. Vercel dùng cấu trúc mặc định: file HTML ở root và functions trong `api/`.

---

## 5. Chức năng storefront

### 5.1 Tải khóa học

URL:

```text
/?course=<sales-slug>
```

Luồng:

1. frontend đọc `course` từ query;
2. gọi `GET /api/config?course=<slug>`;
3. API lấy tenant từ `SALES_SITE` của deployment;
4. API truy vấn đúng course active/published thuộc tenant;
5. API trả cấu hình hiển thị;
6. frontend render landing page.

Nếu slug thuộc tenant khác, API trả 404. Browser không được tải toàn bộ courses rồi tự lọc.

### 5.2 Nội dung hiển thị

Storefront hỗ trợ các dữ liệu commerce thực tế:

- title/subtitle;
- poster/image;
- description;
- giá;
- giáo viên;
- lịch khai giảng dự kiến;
- trạng thái active/published;
- thông tin ngân hàng;
- mã QR;
- nội dung chuyển khoản;
- form thông tin khách hàng;
- upload biên lai;
- trạng thái loading/lỗi;
- responsive desktop/mobile.

### 5.3 Quy tắc tenant

Allowlist:

| Mã nội bộ | Base URL |
|---|---|
| `yeunauan` | `https://shop.yeunauan.live` |
| `yeubep` | `https://yeubep.shop` |

Legacy:

```text
courses.sales_site IS NULL → yeunauan
orders.sales_site IS NULL  → yeunauan
```

Project cũ:

```text
SALES_SITE=yeunauan
```

Project mới:

```text
SALES_SITE=yeubep
```

Query, body hoặc header như `sales_site`, `X-Sales-Site`, `X-Tenant`, `X-Forwarded-Host` không được dùng để đổi tenant runtime.

---

## 6. Quản trị khóa học

Trang: `https://shop.yeunauan.live/admin.html`

Chức năng:

- xem danh sách khóa học;
- tạo khóa học;
- chỉnh sửa khóa học;
- xóa theo contract hiện hữu;
- bật/tắt trạng thái;
- thay đổi thứ tự;
- quản lý nội dung, poster, giá, giáo viên, ngày dự kiến;
- quản lý ngân hàng, QR và nội dung chuyển khoản;
- chọn “WEBSITE BÁN HÀNG”:
  - `yeunauan.live` → `yeunauan`;
  - `yeubep.shop` → `yeubep`;
- chọn “KHÓA HỌC HỌC TẬP / LMS ĐÍCH”;
- hiển thị URL bán hàng đúng domain;
- read-after-write để tránh báo lưu thành công giả.

Quy tắc quan trọng:

- course legacy không có `sales_site` hiển thị mặc định `yeunauan.live`;
- quick toggle không được làm mất `sales_site`;
- thay đổi LMS target chỉ tác động đơn mới;
- không tự sửa snapshot learning target của order cũ;
- không cho nhập URL tùy ý làm tenant;
- không cho alias chain/cycle trong learning target.

---

## 7. Đơn hàng và thanh toán

### 7.1 Phương thức hiện tại

Hệ thống dùng chuyển khoản thủ công:

1. khách chọn course trên storefront;
2. nhập thông tin;
3. nhận thông tin chuyển khoản/QR;
4. upload biên lai;
5. backend tạo order trạng thái phù hợp;
6. admin kiểm tra và duyệt;
7. khi duyệt, commerce gọi Portal/LMS server-to-server.

Không coi việc build trang hoặc upload biên lai là đã cấp quyền học.

### 7.2 Bảo vệ khi tạo order

`POST /api/register` phải:

- xác định tenant từ deployment;
- tìm course active đúng tenant;
- lấy course ID/title/giá từ database;
- bỏ qua giá/title/tenant giả từ browser;
- snapshot `price_snapshot`;
- snapshot `learning_course_slug`;
- ghi `sales_site` và `sales_host`;
- dùng idempotency để chống double submit/retry;
- không tạo order cho course tenant khác.

### 7.3 Quản trị order

Trang: `https://shop.yeunauan.live/orders.html`

Chức năng:

- xem order của cả hai nguồn sau xác thực;
- hiển thị website phát sinh;
- tìm kiếm/lọc theo course/status/site;
- cập nhật thông tin và trạng thái;
- approve;
- revoke;
- manual resync;
- approve-all.

`approve-all` phải scope tối thiểu theo:

```text
sales_site + course_slug + status
```

Không được duyệt chéo tenant.

### 7.4 Shared entitlement

Một email có thể mua hai sales course khác nhau cùng trỏ tới một LMS course.

Trước khi revoke LMS, backend kiểm tra còn order khác có trạng thái cấp quyền hay không theo:

```text
normalized email
+ effective learning_course_slug
+ granting status ("Đã duyệt")
```

Nếu còn order hợp lệ, kết quả là giữ quyền (`SHARED_ENTITLEMENT_RETAINED`). Chỉ order cuối cùng bị thu hồi mới gọi `revokeEnrollment`.

---

## 8. Learning Course Boundary

Hai field:

```text
courses.learning_course_slug
orders.learning_course_slug
```

Fallback tương thích:

```text
effective course learning slug =
COALESCE(NULLIF(TRIM(courses.learning_course_slug), ''), courses.slug)

effective order learning slug =
COALESCE(NULLIF(TRIM(orders.learning_course_slug), ''), orders.course_slug)
```

### 8.1 Course Yeubep hiện tại

| Thuộc tính | Giá trị |
|---|---|
| Clone ID | `fb2dd9ac-3353-48c9-85c2-9be634bd121d` |
| Sales slug | `thitxiennuongchaungoc-yeubep` |
| Sales site | `yeubep` |
| Learning slug | `thitxiennuongchaungoc` |
| Active | `true` |
| Published | `true` |
| Order của clone | 0 tại thời điểm báo cáo |

Canonical LMS course:

| Thuộc tính | Giá trị |
|---|---|
| Course ID | `b780c8f0-78d1-435d-a01c-731619b38af6` |
| Slug | `thitxiennuongchaungoc` |
| Lesson | 4 |

### 8.2 Quy tắc resolver

Resolver server-side:

- target phải tồn tại;
- target phải active;
- target phải có lesson;
- chỉ cho phép alias một cấp;
- không cho alias → alias;
- không cho vòng lặp;
- browser không được gửi/override learning slug.

### 8.3 Sync course alias

Không gửi:

```json
{
  "action": "syncCourse",
  "slug": "thitxiennuongchaungoc-yeubep"
}
```

Alias trả trạng thái `MAPPED_NOT_REQUIRED` hoặc tương đương. Không tạo LMS course alias và không clone lesson.

### 8.4 Enrollment/revoke

Approve alias gửi:

```json
{
  "action": "syncEnrollment",
  "email": "<normalized-email>",
  "courseSlug": "thitxiennuongchaungoc"
}
```

Revoke alias gửi:

```json
{
  "action": "revokeEnrollment",
  "email": "<normalized-email>",
  "courseSlug": "thitxiennuongchaungoc"
}
```

Sales slug không được lọt vào LMS/Portal runtime.

---

## 9. Đồng bộ Portal và LMS

Commerce dùng server-side:

- `SYSTEM1_URL`: Portal boundary;
- `SYSTEM3_URL`: LMS boundary;
- `INTERNAL_SYNC_SECRET`: secret nội bộ;
- `POST <SYSTEM3_URL>/api/sync`;
- header `X-Sync-Secret`.

Contract LMS giữ nguyên:

- `syncCourse`;
- `syncEnrollment`;
- `revokeEnrollment`.

`sales_site` không được thêm vào payload LMS vì LMS không cần biết website bán hàng. Phân tách tenant thuộc trách nhiệm commerce.

### 9.1 Dry-run boundary

Khi:

```text
EXTERNAL_SYNC_MODE=dry-run
```

helper chung chặn:

- fetch tới LMS;
- fetch tới Portal;
- enqueue outbox/delivery thật;
- email/side effect liên quan.

Kết quả dry-run deterministic chứa:

- `dryRun=true`;
- action;
- canonical courseSlug;
- payload dự kiến;
- không chứa secret.

Khi biến không đặt hoặc khác `dry-run`, hành vi production hiện hữu được giữ nguyên.

### 9.2 Portal

Portal là hệ thống riêng, nằm ngoài repository commerce/LMS. Commerce chỉ giao tiếp qua boundary server-side. `course_slug_mappings` trong Supabase B phục vụ diagnostics/reconciliation, không phải resolver runtime cho sales alias. Resolver chính thức hiện nằm tại commerce qua `learning_course_slug`.

Đơn vị thứ ba không được sửa Portal chỉ vì thấy sales slug khác LMS slug; trước tiên phải truy vết payload commerce đã canonical hóa.

---

## 10. LMS: cấu trúc và chức năng

### 10.1 Công nghệ

- static HTML/CSS/Vanilla JS;
- Vercel Functions Node.js/ESM;
- Supabase B;
- Google GSI;
- Google Drive/Google APIs;
- Bunny/iframe/video HTML5 tùy loại media;
- node built-in test runner.

### 10.2 Trang chính

```text
index.html
lms.html
lesson.html
lms-admin.html
gdrive-player.html
photo.html
```

### 10.3 API chính

```text
api/sync.js
api/lms/portal.js
api/lms/admin.js
api/v2/*
utils/lms-handlers/*
```

### 10.4 Chức năng học viên

- Google sign-in;
- xác minh enrollment;
- session signing/cookie restore;
- entry token/exchange code;
- danh sách khóa được cấp;
- hiển thị chương/section/bài học;
- bài trước/bài tiếp theo;
- hard load và SPA navigation;
- ghi nhận progress;
- tài liệu bài học;
- media chính;
- media phụ;
- caption media phụ;
- video chính one-tap;
- Google Drive permission/player;
- responsive desktop/mobile.

### 10.5 Chức năng quản trị LMS

- quản lý course;
- quản lý section/lesson;
- nội dung lesson;
- media/thumbnail/materials;
- phân quyền;
- enrollment;
- Drive sync/permission;
- cấu hình hệ thống;
- diagnostics/readiness V2;
- audit/session-risk controls.

### 10.6 Các invariant LMS không được regression

- Google GSI;
- session signing;
- cookie restore;
- admin allowlist/auth;
- enrollment access;
- `displayLesson`;
- `is_section`;
- prev/next;
- main media classification;
- supplemental media caption;
- one-tap main video;
- SPA navigation;
- materials;
- Drive permission;
- V2 flags;
- body parser 500 MB.

---

## 11. Supabase production và data model

Project:

```text
aqozjkfwzmyfunqvcyjv
```

Đây là Supabase production dùng chung cho commerce và LMS runtime.

### 11.1 Số liệu hiện tại

| Bảng/nhóm | Số bản ghi |
|---|---:|
| `courses` | 8 |
| `orders` | 28 |
| `site_config` | 73 |
| `student_enrollments` | 20 |
| `lessons` | 39 |
| `course_slug_mappings` | 6 |

Phân bố:

- courses: 7 row `sales_site IS NULL`, 1 row `sales_site='yeubep'`;
- orders: 28 row `sales_site IS NULL`;
- chưa có order của clone Yeubep tại thời điểm báo cáo.

### 11.2 Nhóm bảng nghiệp vụ

Commerce:

- `courses`;
- `orders`;
- `site_config`.

LMS:

- `students`;
- `student_enrollments`;
- `lessons`;
- `lesson_progress`;
- `drive_permission_logs`;
- `drive_sync_queue`;
- `drive_admin_accounts`.

Sync/V2:

- `sync_outbox`;
- `sync_deliveries`;
- `sync_dead_letters`;
- `course_slug_mappings`;
- `portal_post_course_mappings`;
- `platform_runtime_config`;
- `platform_runtime_config_audit`.

Session/risk/audit:

- `student_active_sessions`;
- `lms_entry_tokens`;
- `lms_verified_sessions`;
- `student_session_controls`;
- `student_device_change_logs`;
- `student_account_risk_reviews`;
- `student_account_risk_summaries`;
- `student_account_admin_notes`;
- `admin_audit_logs`.

### 11.3 Field tenant/boundary quan trọng

`courses`:

- `sales_site`;
- `learning_course_slug`;
- `slug` vẫn unique toàn hệ thống;
- active/published/sort/content/bank/QR/raw_data.

`orders`:

- `sales_site`;
- `sales_host`;
- `idempotency_key`;
- `price_snapshot`;
- `learning_course_slug`;
- `course_id`;
- `course_slug`;
- customer/payment/sync status/raw_data.

### 11.4 Constraint/index chính

- `courses.slug` global UNIQUE;
- `courses_sales_site_check`: NULL, `yeunauan`, `yeubep`;
- `orders_sales_site_check`: NULL, `yeunauan`, `yeubep`;
- index course tenant/active/sort;
- partial index learning course slug;
- index order tenant/course/status;
- partial unique idempotency theo contract;
- index order learning entitlement;
- unique enrollment `(email, course_slug)`;
- unique lesson `(course_slug, lesson_no)`.

Không backfill 7 course và 28 order legacy. Fallback được xử lý ở application.

### 11.5 RLS

Schema có RLS/policies cho một số luồng LMS, gồm:

- học viên authenticated đọc enrollment của chính email;
- đọc/cập nhật progress của chính email;
- đọc lesson thuộc course đã enrollment;
- anon chỉ đọc lesson free;
- authenticated/anon đọc course active theo policy hiện hữu;
- session của chính người dùng.

Commerce server functions dùng service-role ở server-side; service-role không được xuất hiện trong browser.

---

## 12. API contract commerce

| Endpoint | Method | Vai trò |
|---|---|---|
| `/api/config?course=<slug>` | GET | public course/config đã lọc tenant |
| `/api/check-auth` | POST/OPTIONS | kiểm tra admin tối thiểu |
| `/api/courses` | GET | danh sách/admin course |
| `/api/courses` | POST | tạo course |
| `/api/courses` | PUT | cập nhật course/read-after-write |
| `/api/courses` | DELETE | xóa theo contract hiện hữu |
| `/api/register` | POST | tạo order, validate tenant/price/idempotency |
| `/api/orders` | GET | đọc order admin |
| `/api/orders` | PUT | update/resync/approve/revoke |
| `/api/approve-all` | POST | duyệt hàng loạt có tenant scope |
| `/api/upload` | POST | upload biên lai Cloudinary |
| `/api/v2/diagnostics` | GET/POST | diagnostics V2 |
| `/api/v2/readiness` | GET/POST | readiness V2 |

`check-auth` đã loại bỏ nhánh debug có thể lộ `process.env`; response chỉ chứa trạng thái xác thực cần thiết.

---

## 13. Biến môi trường

### 13.1 Commerce production

Tên biến đang dùng/được cấu hình, không liệt kê value:

- `SALES_SITE`;
- `PUBLIC_SITE_URL`;
- `COMMERCE_DATA_MODE`;
- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `ADMIN_PASSWORD`;
- `ADMIN_EMAILS`;
- `SYSTEM1_URL`;
- `SYSTEM3_URL`;
- `INTERNAL_SYNC_SECRET`;
- `CLOUDINARY_CLOUD_NAME`;
- `CLOUDINARY_API_KEY`;
- `CLOUDINARY_API_SECRET`;
- `GOOGLE_CLIENT_ID`;
- `GOOGLE_CLIENT_SECRET`.

Preview project Yeubep có thể có:

- `EXTERNAL_SYNC_MODE`.

Production không được vô tình đặt `EXTERNAL_SYNC_MODE=dry-run` nếu muốn approve/revoke thực tế.

### 13.2 LMS

Nhóm tên biến chính:

- Supabase URL/service-role;
- Google client/auth/Drive credentials;
- internal sync secret;
- admin allowlist/auth;
- session signing/cookie;
- V2 flags/runtime config;
- Drive/media integration.

Tên/value chi tiết phải đọc trong Vercel project hoặc file handover B05; không sao chép secret sang code, chat hoặc frontend.

### 13.3 Quy tắc bảo mật env

- không commit `.env`;
- không log value;
- không đưa service-role vào HTML/JS;
- không đưa sync secret vào browser;
- không copy toàn bộ env giữa hai project;
- `SALES_SITE` phải là mã allowlist, không phải URL.

---

## 14. Media và storage

### 14.1 Commerce

- Poster/QR dùng URL lưu trong course/database.
- Biên lai order upload qua server endpoint tới Cloudinary.
- Database giữ URL Cloudinary; rollback database phải giữ nguyên liên kết.
- Không xóa/di chuyển asset Cloudinary khi chỉ migration schema.

### 14.2 LMS

Hỗ trợ:

- ảnh chính;
- video chính;
- media phụ;
- caption media phụ;
- materials;
- Google Drive;
- iframe/Bunny/video HTML5 tùy nguồn.

Các sửa lỗi production B05 quan trọng:

- media phụ hiển thị đúng caption theo từng item;
- media không caption không tạo khoảng trống;
- video chính chỉ cần một lần nhấn;
- thumbnail chỉ ẩn sau khi player sẵn sàng;
- lỗi player khôi phục UI, không để màn hình đen;
- listener không nhân lên khi SPA đổi bài.

---

## 15. Xác thực, session và bảo mật

Commerce admin hiện dùng endpoint password/auth riêng và frontend admin. Đây là khu vực cần bảo vệ chặt:

- không mở debug endpoint;
- không trả env;
- không dùng query/header làm bypass;
- không in password;
- không dùng service-role từ browser.

LMS có:

- Google GSI;
- session signing;
- cookie restore;
- entry token;
- verified session;
- session generation/revoke;
- device-change/risk logs;
- admin audit.

Rủi ro kỹ thuật cần lưu ý:

1. Commerce admin authentication vẫn là cơ chế đơn giản hơn LMS; cần review định kỳ cookie/session/storage.
2. Một số endpoint có CORS legacy rộng; không được coi CORS là authentication.
3. Supabase B dùng chung commerce và LMS, nên migration phải có backup, transaction, timeout và smoke cả hai hệ thống.
4. Direct CLI deployment có thể không ghi Git metadata trên Vercel; phải quản lý exact commit/tag/worktree sạch.
5. Không được tin `course_slug_mappings` là runtime alias resolver.

---

## 16. Test baseline

Commerce tại exact commit `e65262f3...`:

- full suite: 65/65 pass;
- Learning Course Boundary: 15/15 pass;
- dry-run guard:
  - approve alias không fetch;
  - revoke không fetch;
  - không enqueue outbox thật;
  - không email/side effect;
  - canonical slug;
  - shared entitlement;
  - production mode giữ adapter cũ;
- secret scan: 0 secret thật;
- node/HTML syntax và `git diff --check`: đạt tại launch.

LMS B05:

- 300/300 test pass;
- baseline bao gồm auth/session/navigation/media/materials/sync.

Lệnh commerce:

```powershell
npm ci
npm test
git diff --check
```

Lệnh LMS:

```powershell
npm ci
npm run build:lms-css
$env:LMS_RP2B1_SUPABASE_STUB='1'
node --test tests/*.test.mjs
git diff --check
```

---

## 17. Probe production ngày 2026-07-26

| Probe | Kết quả |
|---|---:|
| `https://shop.yeunauan.live` | 200 |
| shop cũ + `thitxiennuongchaungoc` | 200 |
| shop cũ API + alias Yeubep | 404 |
| `https://yeubep.shop` | 200 |
| Yeubep + `thitxiennuongchaungoc-yeubep` | 200 |
| Yeubep API + source slug | 404 |
| `https://www.yeubep.shop` | 308 → apex |
| `https://www.daubepnho.store` | 200 |

Các kết quả chứng minh tenant isolation public đang đúng ở thời điểm lập báo cáo.

---

## 18. Backup và rollback

### 18.1 Backup trước multi-storefront

```text
C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\
_local_backups\supabase-before-multistore-20260725-154808
```

### 18.2 Backup sau launch

```text
C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\
_local_backups\after-yeubep-launch-20260725-235050
```

Backup sau launch gồm:

- schema snapshot;
- courses;
- orders;
- site_config;
- student_enrollments;
- lessons;
- course_slug_mappings;
- row counts;
- checksums SHA-256;
- invariants;
- deployment/domain/DNS snapshot.

Backup chứa dữ liệu production/PII phải giữ local, không commit, không upload công khai.

### 18.3 Rollback commerce code

Rollback lịch sử an toàn trước multi-storefront:

- commit: `cafe21bbe55af86bfb8ac2ebe9155ded849452e8`;
- Vercel artifact: `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`.

Khi rollback code, ưu tiên promote exact artifact đã xác minh, không rebuild nếu không cần.

Lưu ý: artifact cũ không hiểu đầy đủ tenant/learning boundary. Chỉ dùng theo runbook và đánh giá schema nullable tương thích.

### 18.4 Rollback schema

Các rollback SQL:

- `20260725_multi_storefront_tenant_rollback.sql`;
- `20260725_learning_course_boundary_rollback.sql`.

Nguyên tắc:

1. rollback code trước nếu code mới gây lỗi;
2. export delta phát sinh;
3. chỉ rollback schema khi thật sự cần;
4. không restore mù snapshot cũ;
5. không ghi đè order mới;
6. restore dữ liệu chỉ khi có mất/hỏng thực tế.

### 18.5 Rollback LMS

Promote exact artifact:

```text
dpl_HVQvwrveFjxE81cpsoXRraDB34wR
```

Không deploy LMS từ `origin/main`.

---

## 19. Quy trình thay đổi an toàn

Mọi nhiệm vụ mới nên đi qua:

1. xác định đúng repository/project/database;
2. ghi exact commit production;
3. tạo worktree riêng;
4. backup schema/data nếu có DB change;
5. test local;
6. Preview/staging;
7. tenant/security/secret scan;
8. owner duyệt;
9. production exact artifact;
10. smoke hai storefront + LMS;
11. backup/tag sau triển khai.

Nếu sửa commerce:

- test cả `yeunauan` và `yeubep`;
- test slug chéo tenant trả 404;
- test order price/idempotency;
- test canonical learning slug;
- test shared entitlement;
- test dry-run không external mutation.

Nếu sửa LMS:

- base từ B05;
- giữ 300 test cũ;
- không regression media/auth/session/navigation.

Nếu sửa schema Supabase B:

- smoke commerce cũ;
- smoke Yeubep;
- smoke LMS;
- không backfill/mutate dữ liệu ngoài phê duyệt.

---

## 20. Những điều tuyệt đối không được làm

- Không đưa `SUPABASE_SERVICE_ROLE_KEY` vào frontend.
- Không đưa `INTERNAL_SYNC_SECRET` vào browser.
- Không tin tenant/price/title/learning slug từ client.
- Không lọc tenant chỉ ở JavaScript.
- Không dùng sales alias để tạo LMS course mới.
- Không backfill legacy nếu chưa phê duyệt.
- Không đổi unique constraint slug tùy tiện.
- Không xóa order/enrollment/lesson bằng cascade để rollback clone.
- Không restore toàn database khi chỉ cần rollback schema.
- Không dùng production DB làm fixture tùy tiện.
- Không sửa DNS/MX/SPF/DKIM/DMARC trong task ứng dụng.
- Không dùng Portal project làm project Yeubep.
- Không deploy LMS từ `origin/main`.
- Không refactor diện rộng trong một bugfix media hoặc auth.

---

## 21. Các điểm cần đơn vị thứ ba xác minh trước nhiệm vụ mới

Checklist bắt buộc:

- [ ] Đã đọc exact commit/tag/deployment trong tài liệu.
- [ ] Đã xác định task thuộc commerce, LMS hay Portal.
- [ ] Đã xác định Supabase A hay Supabase B.
- [ ] Đã xác định có data write/migration hay không.
- [ ] Đã lập rollback exact artifact.
- [ ] Đã bảo vệ tenant isolation.
- [ ] Đã bảo vệ Learning Course Boundary.
- [ ] Đã bảo vệ idempotency và shared entitlement.
- [ ] Đã loại secret khỏi client/log/report.
- [ ] Đã chạy regression cả hai storefront.
- [ ] Nếu sửa LMS, baseline ≥ 300 test cũ.
- [ ] Đã smoke `shop.yeunauan.live`, `yeubep.shop` và `www.daubepnho.store`.

---

## 22. Tài liệu liên quan

Trong repository LMS:

- `docs/LMS_FULL_SYSTEM_HANDOVER_B05_2026-07-25.md`;
- `docs/YEUBEP_SHOP_FINAL_PRODUCTION_LAUNCH_REPORT_2026-07-25.md`;
- `docs/MULTI_STOREFRONT_GATE1_ARCHITECTURE_INVESTIGATION_2026-07-25.md`;
- `docs/MULTI_STOREFRONT_GATE4A_PRODUCTION_SCHEMA_MIGRATION_2026-07-25.md`;
- `docs/MULTI_STOREFRONT_GATE4B_OLD_COMMERCE_PRODUCTION_DEPLOYMENT_2026-07-25.md`;
- `docs/MULTI_STOREFRONT_GATE5C_PRODUCTION_BOUNDARY_INACTIVE_CLONE_2026-07-25.md`;
- `docs/COMMERCE_PRODUCTION_BACKUP_BEFORE_MULTISTORE_2026-07-25.md`;
- `docs/v2/V2_SYSTEM_OVERVIEW_4REPOS.md`;
- `docs/v2/V2_4REPO_ROLLBACK_RUNBOOK.md`.

---

## 23. Kết luận trạng thái hiện tại

Tại thời điểm lập báo cáo:

- hai storefront đang online và phân tách tenant đúng;
- `yeubep.shop` đã ở đúng Vercel project mới;
- `www` redirect đúng apex;
- clone Yeubep active/published và hiển thị;
- clone trỏ canonical tới LMS course gốc có 4 lesson;
- không có order clone tại thời điểm kiểm tra;
- database giữ 8 courses, 28 orders, 20 enrollments, 39 lessons;
- LMS B05 online;
- source commerce/tag/worktree sạch và khớp exact commit launch;
- không có thay đổi production nào được thực hiện trong quá trình lập báo cáo này.

Đơn vị thứ ba nên dùng tài liệu này làm bản đồ tổng thể, sau đó đọc source và các báo cáo chuyên sâu tương ứng trước khi đề xuất hoặc triển khai nhiệm vụ mới.
