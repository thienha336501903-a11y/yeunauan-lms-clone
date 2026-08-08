# BÁO CÁO CHUYÊN SÂU KIẾN TRÚC, VẬN HÀNH VÀ BÀN GIAO HỆ THỐNG

**Phiên bản:** Post-domain-swap 2026-07-26  
**Múi giờ áp dụng:** Asia/Saigon  
**Đối tượng đọc:** đơn vị phát triển, vận hành, kiểm toán hoặc tiếp quản hệ thống  
**Mức độ tài liệu:** kiến trúc + dữ liệu + vận hành + bảo mật + khôi phục  
**Trạng thái mô tả:** Production sau khi hoán đổi domain hai storefront  
**Tài liệu tiền nhiệm:** `FULL_SYSTEM_CURRENT_ARCHITECTURE_AND_HANDOVER_2026-07-26.md`

> Tài liệu này không chứa mật khẩu, token, private key, Supabase service-role key,
> internal sync secret, Cloudinary API secret, thông tin ngân hàng đầy đủ hoặc dữ
> liệu định danh khách hàng. Người tiếp nhận phải lấy secret từ đúng secret store
> của Vercel theo quy trình cấp quyền, không yêu cầu gửi secret qua chat/email.

---

## 1. Mục đích, phạm vi và cách đọc

Tài liệu là bản đồ tổng thể của hệ thống đang chạy. Mục tiêu là giúp một đơn vị
chưa từng làm việc với hệ thống có thể:

1. nhận diện đúng từng repository, Vercel project, domain và database;
2. hiểu vì sao hai website bán hàng dùng chung code nhưng vẫn tách tenant;
3. hiểu sự khác nhau giữa khóa bán hàng và khóa học LMS;
4. theo dõi toàn bộ vòng đời từ xem landing page đến cấp/thu hồi quyền học;
5. biết dữ liệu nào là nguồn sự thật, dữ liệu nào chỉ là snapshot lịch sử;
6. biết các invariant không được làm hỏng;
7. triển khai, kiểm thử, giám sát và rollback bằng exact artifact;
8. tránh lộ secret hoặc vô tình ghi dữ liệu Production.

Phạm vi bao gồm:

- hai storefront commerce;
- trang quản trị khóa học và đơn hàng;
- Vercel Functions của commerce;
- Supabase Production dùng chung;
- Cloudinary và các URL media;
- boundary đồng bộ Portal/LMS;
- LMS học viên và LMS admin;
- Git, deployment, domain, DNS snapshot, backup và rollback;
- các rủi ro, technical debt và checklist thay đổi.

Portal là hệ thống ngoài hai repository chính. Tài liệu mô tả contract và boundary
với Portal, không tuyên bố mô tả đầy đủ source code nội bộ của Portal.

### 1.1 Định nghĩa mức độ chắc chắn

- **Đã xác minh:** đối chiếu từ source, artifact, HTTP probe hoặc backup.
- **Contract hiện hành:** hành vi mà source/tests đang bảo vệ.
- **Invariant:** điều kiện bắt buộc phải giữ khi thay đổi.
- **Legacy fallback:** hành vi tương thích với dữ liệu cũ, không đồng nghĩa dữ
  liệu bị thiếu hoặc cần backfill.
- **Ngoài phạm vi:** không được suy đoán hoặc thay đổi nếu chưa có tài liệu/quyền.

---

## 2. Tóm tắt điều hành

Hệ thống có hai website bán khóa học độc lập về domain và Vercel project nhưng:

- dùng cùng một repository/codebase commerce;
- dùng cùng một Supabase Production;
- dùng chung Cloudinary;
- cấp quyền vào cùng một LMS Production;
- phân tách tenant ở backend bằng `SALES_SITE`;
- không phân tách tenant bằng domain do browser gửi lên.

Trạng thái Production hiện tại:

| Website | Vercel project | Tenant runtime | Khóa bán chính |
|---|---|---|---|
| `https://yeubep.shop` | `web-ban-hang-chinh-thuc` | `yeunauan` | `thitxiennuongchaungoc` và các course legacy |
| `https://shop.yeunauan.live` | `web-ban-hang-yeubep-shop` | `yeubep` | `thitxiennuongchaungoc-yeubep` |
| `https://www.daubepnho.store` | `web-lms-chinh-thuc` | không dùng sales tenant | LMS học viên/admin |

Việc đổi domain ngày 2026-07-26 chỉ là đổi “biển hiệu” giữa hai Vercel project.
Không hoán đổi:

- `SALES_SITE`;
- course ID/slug;
- `learning_course_slug`;
- order;
- enrollment;
- lesson;
- database;
- giao diện/codebase riêng của từng project;
- Cloudinary;
- LMS hoặc Portal.

Điểm dễ nhầm nhất:

```text
domain public != tenant
sales slug != luôn luôn bằng learning slug
Vercel project != database riêng
sales_host của order != domain runtime hiện tại
```

---

## 3. Source of truth và thứ tự ưu tiên

Khi các tài liệu cũ mâu thuẫn với nhau, dùng thứ tự:

1. exact Production deployment/artifact đang current;
2. exact Git commit/tag được ghi trong báo cáo này;
3. schema và dữ liệu Supabase live;
4. sanitized after-cutover backup;
5. full pre-cutover backup;
6. tài liệu lịch sử.

Các mốc chính:

| Hạng mục | Mốc |
|---|---|
| Commerce Production commit | `74c70268f0619d9d9a9be5e564ea60200038100c` |
| Commerce branch | `preview/domain-swap-20260726` |
| Commerce annotated tag | `launch/storefront-domain-swap-2026-07-26` |
| Commerce base trước đổi domain | `e65262f3e8eca39d8224f5b010bd376f27e1f9e3` |
| LMS Production commit | `fc12c3b21329158e13a4a027833afd2dec61e973` |
| LMS safe tag | `backup/B05-2026-07-25` |
| Supabase project ref | `aqozjkfwzmyfunqvcyjv` |

Commerce branch/tag đã push nhưng branch chưa merge. Production đang chạy exact commit
nêu trên; không được suy luận rằng default branch hoặc một worktree khác là Production.

---

## 4. Kiến trúc logic tổng thể

```text
                           NGƯỜI DÙNG / ADMIN
                                  |
                +-----------------+-----------------+
                |                                   |
                v                                   v
       https://yeubep.shop              https://shop.yeunauan.live
       Vercel project cũ                Vercel project Yeubep
       SALES_SITE=yeunauan              SALES_SITE=yeubep
                |                                   |
                +--------------+--------------------+
                               |
                      Commerce Serverless APIs
               tenant filter / validation / snapshots
                               |
                               v
                     SUPABASE B PRODUCTION
                    aqozjkfwzmyfunqvcyjv
             courses / orders / LMS / sync / sessions
                  |                         |
                  |                         +------> Cloudinary URLs
                  |
                  v
       canonical learning-course resolver
                  |
          +-------+----------------+
          |                        |
          v                        v
     Portal boundary          LMS /api/sync
     SYSTEM1_URL              SYSTEM3_URL
                             www.daubepnho.store
```

### 4.1 Trust boundaries

1. Browser là nguồn không tin cậy.
2. Tenant được lấy từ environment của deployment.
3. Course, giá, title và learning target được đọc lại từ database.
4. Service-role và sync secret chỉ được dùng trong server functions.
5. Portal/LMS chỉ nhận request server-to-server đã canonical hóa.
6. Public API không được trả env/secret/diagnostics Production.

### 4.2 Failure domains

- Lỗi một storefront không mặc nhiên là lỗi database.
- Lỗi alias/domain Vercel có thể xảy ra dù deployment READY.
- Lỗi Portal không có nghĩa LMS course mapping sai.
- Lỗi LMS media không nên dẫn đến sửa commerce.
- Migration Supabase có blast radius lên cả commerce và LMS.

---

## 5. Inventory hệ thống hiện tại

### 5.1 Commerce repository

| Thuộc tính | Giá trị |
|---|---|
| Repository | `thienha100022653824678-stack/web-ban-hang-chinh-thuc` |
| Remote | `https://github.com/thienha100022653824678-stack/web-ban-hang-chinh-thuc.git` |
| Exact commit | `74c70268f0619d9d9a9be5e564ea60200038100c` |
| Branch | `preview/domain-swap-20260726` |
| Annotated tag | `launch/storefront-domain-swap-2026-07-26` |
| Production worktree | `_worktrees/domain-swap-preview-20260726` |
| Worktree lúc bàn giao | sạch |
| Base commit | `e65262f3e8eca39d8224f5b010bd376f27e1f9e3` |
| Module system | ESM |
| Frontend | HTML/CSS/Vanilla JavaScript |
| Backend | Vercel Serverless Functions |
| Test runner | Node built-in test runner |
| Package manager | npm |

Runtime dependencies:

- `@supabase/supabase-js`;
- `cloudinary`.

Dev/test dependency đáng chú ý:

- `@electric-sql/pglite`, dùng để kiểm tra migration/contract PostgreSQL cục bộ.

Không có framework frontend và không có build output riêng. Static files ở root;
Vercel Functions nằm dưới `api/`.

### 5.2 Vercel commerce

| Hệ thống | Project ID | Deployment current | Artifact URL | Trạng thái |
|---|---|---|---|---|
| `web-ban-hang-chinh-thuc` | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` | `dpl_CQw9cUnnXVhXVHToSFEwkYzRd1iJ` | `https://web-ban-hang-chinh-thuc-a0pc8k11f.vercel.app` | READY |
| `web-ban-hang-yeubep-shop` | `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8` | `dpl_6ATmLb9HdttVfTmgD7LBMHGmfMka` | `https://web-ban-hang-yeubep-shop-6z0icpz12.vercel.app` | READY |

Team/scope:

```text
thienha100022653824678-stacks-projects
```

### 5.3 LMS

| Thuộc tính | Giá trị |
|---|---|
| Repository | `thienha100022653824678-stack/web-lms-chinh-thuc` |
| Exact Production commit | `fc12c3b21329158e13a4a027833afd2dec61e973` |
| Safe tag | `backup/B05-2026-07-25` |
| Production deployment | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |
| Domain | `https://www.daubepnho.store` |
| Baseline test | 300/300 |

**Không deploy LMS từ `origin/main`.** Mọi thay đổi LMS phải base từ exact SHA hoặc
tag B05, trừ khi có một báo cáo launch mới thay thế rõ ràng.

---

## 6. Domain, alias, redirect và DNS

### 6.1 Assignment sau cutover

Project `web-ban-hang-chinh-thuc`:

- `yeubep.shop`;
- `www.yeubep.shop`;
- `web-ban-hang-chinh-thuc-alpha.vercel.app`.

Project `web-ban-hang-yeubep-shop`:

- `shop.yeunauan.live`;
- `web-ban-hang-yeubep-shop.vercel.app`.

Redirect:

```text
https://www.yeubep.shop
  -- HTTP 308 -->
https://yeubep.shop/
```

Tất cả assignment trên đã được xác minh `verified=true`.

### 6.2 Domain trước và sau

| Domain | Trước cutover | Sau cutover |
|---|---|---|
| `shop.yeunauan.live` | project `web-ban-hang-chinh-thuc` | project `web-ban-hang-yeubep-shop` |
| `yeubep.shop` | project `web-ban-hang-yeubep-shop` | project `web-ban-hang-chinh-thuc` |
| `www.yeubep.shop` | redirect ở project Yeubep | redirect ở project cũ |

### 6.3 DNS boundary

Cutover chỉ thay project-domain assignment trong Vercel. Không thay:

- A/AAAA/CNAME;
- TXT;
- MX;
- SPF;
- DKIM;
- DMARC;
- nameserver;
- registrar.

Nameserver quan sát được trong snapshot:

- `yeubep.shop`: registrar nameservers;
- `yeunauan.live`: Cloudflare nameservers.

DNS snapshot đầy đủ nằm trong backup, không nên sao chép tùy tiện sang provider khác.
Nếu Vercel yêu cầu thay TXT hoặc DNS trong một task ứng dụng, phải dừng và xin phê
duyệt riêng.

### 6.4 Chi tiết vận hành Vercel cần nhớ

`vercel deploy --prod --skip-domain` tạo Production artifact nhưng không nhất thiết
đặt artifact làm current deployment. Quy trình an toàn đã dùng:

1. deploy exact local Git archive với `--skip-domain`;
2. chờ READY;
3. probe artifact có authentication bypass hợp lệ;
4. `vercel promote <deployment-id>`;
5. mới force-assign domain;
6. smoke custom domains.

Khi chuyển `yeubep.shop`, Vercel không cho tháo apex nếu còn redirect
`www.yeubep.shop → yeubep.shop`. Phải:

1. tạm xóa project-domain redirect;
2. chuyển apex;
3. tạo lại redirect 308 trên project đích;
4. xác minh `verified=true`.

Đây là thao tác Vercel project-domain, không phải xóa domain ownership hoặc DNS.

---

## 7. Cấu hình Production của hai storefront

### 7.1 Project `web-ban-hang-chinh-thuc`

```text
SALES_SITE=yeunauan
PUBLIC_SITE_URL=https://yeubep.shop
COMMERCE_DATA_MODE=supabase
EXTERNAL_SYNC_MODE unset
```

### 7.2 Project `web-ban-hang-yeubep-shop`

```text
SALES_SITE=yeubep
PUBLIC_SITE_URL=https://shop.yeunauan.live
COMMERCE_DATA_MODE=supabase
EXTERNAL_SYNC_MODE unset
```

### 7.3 Ý nghĩa

- `SALES_SITE` xác định tenant; không phải URL.
- `PUBLIC_SITE_URL` dùng sinh link/canonical sales host mới.
- `COMMERCE_DATA_MODE=supabase` bắt buộc đọc dữ liệu thật.
- `EXTERNAL_SYNC_MODE` unset cho phép adapter Production thực hiện đồng bộ thật.
- `EXTERNAL_SYNC_MODE=dry-run` chỉ dành cho môi trường kiểm thử được phê duyệt.

Không copy toàn bộ env giữa hai project. Hai project chia sẻ nhiều tên biến tích
hợp nhưng có giá trị tenant/domain khác nhau.

### 7.4 Danh mục tên biến commerce

Các tên đang dùng hoặc thuộc contract:

- `SALES_SITE`;
- `PUBLIC_SITE_URL`;
- `COMMERCE_DATA_MODE`;
- `EXTERNAL_SYNC_MODE`;
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

Chỉ ba giá trị tenant/domain/mode không bí mật được ghi trong tài liệu. Tất cả
secret phải tiếp tục nằm trong Vercel encrypted environment.

---

## 8. Cấu trúc source commerce

```text
web-ban-hang-chinh-thuc/
├── index.html
├── admin.html
├── orders.html
├── api/
│   ├── approve-all.js
│   ├── check-auth.js
│   ├── config.js
│   ├── courses.js
│   ├── orders.js
│   ├── register.js
│   ├── upload.js
│   └── v2/
│       ├── diagnostics.js
│       └── readiness.js
├── utils/
│   ├── learning-course.js
│   ├── preview-fixture.js
│   ├── sales-site.js
│   ├── supabase.js
│   ├── sync-helpers.js
│   ├── v2-flags.js
│   ├── v2-outbox.js
│   ├── v2-runtime-cache.js
│   ├── v2-runtime-controller.js
│   └── v2-sync-worker.js
├── migrations/
├── scripts/local-stub-server.mjs
├── tests/
├── package.json
└── package-lock.json
```

### 8.1 Vai trò từng nhóm

- `index.html`: storefront và form đăng ký.
- `admin.html`: quản trị course, tenant, learning target và link bán.
- `orders.html`: quản trị/approve/revoke/resync order.
- `api/config.js`: public configuration theo tenant + sales slug.
- `api/register.js`: validate và tạo order.
- `api/courses.js`: CRUD course và validation.
- `api/orders.js`: truy vấn, update, approve, revoke, resync.
- `api/approve-all.js`: duyệt theo scope.
- `api/upload.js`: nhận biên lai và upload Cloudinary.
- `utils/sales-site.js`: allowlist tenant/domain, fallback legacy, URL mapping.
- `utils/learning-course.js`: sales slug → canonical LMS slug.
- `utils/sync-helpers.js`: boundary Portal/LMS, dry-run và shared behavior.
- `utils/preview-fixture.js`: fixture chỉ cho local/preview có cấu hình rõ.
- `utils/v2-*`: outbox, worker, flags, cache, diagnostics/readiness.

### 8.2 Thay đổi từ base đến Production hiện tại

Ba commit:

```text
8f1e68a feat: swap commerce storefront domains
013e78c test: expose fixture-only domain diagnostics
74c7026 test: expose fixture-only preview configuration
```

Tám file thay đổi:

- `admin.html`;
- `api/config.js`;
- `api/register.js`;
- `orders.html`;
- `scripts/local-stub-server.mjs`;
- `tests/learning-course-boundary.test.mjs`;
- `tests/multi-storefront-tenant.test.mjs`;
- `utils/sales-site.js`.

Diagnostics/dry-run response chỉ bật trong fixture/Preview/dry-run được cấu hình rõ.
Production Supabase không trả diagnostics Preview, không trả fixture và không chặn
external sync.

---

## 9. Tenant model

### 9.1 Tenant chính thức

| Mã | Domain hiện tại | Dữ liệu |
|---|---|---|
| `yeunauan` | `https://yeubep.shop` | 7 course legacy có `sales_site IS NULL` |
| `yeubep` | `https://shop.yeunauan.live` | course clone có `sales_site='yeubep'` |

### 9.2 Legacy fallback

```text
courses.sales_site IS NULL -> yeunauan
orders.sales_site IS NULL  -> yeunauan
```

`NULL` là trạng thái lịch sử có chủ đích. Không backfill chỉ để “làm đẹp dữ liệu”.
Application phải tiếp tục hiểu `NULL` là tenant `yeunauan`.

### 9.3 Tenant selection

Tenant runtime lấy từ `process.env.SALES_SITE`. Các nguồn sau không được phép
override tenant:

- query `sales_site`;
- body `sales_site`;
- `X-Sales-Site`;
- `X-Tenant`;
- `Host`;
- `X-Forwarded-Host`;
- giá trị do browser/local storage gửi.

Domain và tenant được map bằng allowlist. Không chấp nhận URL tùy ý.

### 9.4 Tenant isolation contract

Với project `SALES_SITE=yeunauan`:

- `thitxiennuongchaungoc` → 200;
- `thitxiennuongchaungoc-yeubep` → 404.

Với project `SALES_SITE=yeubep`:

- `thitxiennuongchaungoc-yeubep` → 200;
- `thitxiennuongchaungoc` → 404.

404 chéo tenant là hành vi bảo mật bắt buộc, không phải lỗi dữ liệu.

---

## 10. Course model: sales course và learning course

### 10.1 Hai khái niệm

- **Sales course:** đối tượng landing page/order, dùng sales slug.
- **Learning course:** khóa thật trong LMS, dùng canonical learning slug.

Hai field liên quan:

```text
courses.learning_course_slug
orders.learning_course_slug
```

Fallback:

```text
effective course learning slug =
COALESCE(NULLIF(TRIM(courses.learning_course_slug), ''), courses.slug)

effective order learning slug =
COALESCE(NULLIF(TRIM(orders.learning_course_slug), ''), orders.course_slug)
```

### 10.2 Course clone Yeubep

| Thuộc tính | Giá trị |
|---|---|
| Course ID | `fb2dd9ac-3353-48c9-85c2-9be634bd121d` |
| Sales slug | `thitxiennuongchaungoc-yeubep` |
| `sales_site` | `yeubep` |
| `learning_course_slug` | `thitxiennuongchaungoc` |
| Active | true |
| Published | true |

Canonical LMS course:

| Thuộc tính | Giá trị |
|---|---|
| Course ID | `b780c8f0-78d1-435d-a01c-731619b38af6` |
| Slug | `thitxiennuongchaungoc` |
| Lesson count | 4 |

Clone Yeubep chỉ khác bề mặt bán hàng. Nó không tạo LMS course alias và không clone
lesson.

### 10.3 Resolver invariant

- target phải tồn tại;
- target phải active;
- target phải có lesson;
- chỉ alias một cấp;
- không alias → alias;
- không cycle;
- browser không override learning slug;
- order phải snapshot learning slug tại lúc tạo.

Thay learning target của course chỉ ảnh hưởng order mới. Không sửa snapshot order cũ.

---

## 11. Luồng storefront

URL:

```text
/?course=<sales-slug>
```

Luồng chi tiết:

1. Browser đọc query `course`.
2. Browser gọi `GET /api/config?course=<sales-slug>`.
3. Function đọc `SALES_SITE`.
4. Backend validate sales slug.
5. Backend lọc course theo effective tenant.
6. Chỉ course active/published hợp lệ được trả.
7. Backend trả cấu hình hiển thị đã giới hạn.
8. Frontend render title, poster, giá, bank/QR và form.
9. Cross-tenant/không tồn tại trả 404.

Không được tải toàn bộ course xuống browser rồi lọc bằng JavaScript.

Nội dung storefront hỗ trợ:

- title/subtitle;
- description;
- poster;
- giá;
- giáo viên;
- ngày/lịch dự kiến;
- trạng thái active/published;
- tên ngân hàng/chủ tài khoản/số tài khoản;
- QR;
- transfer note;
- form khách hàng;
- biên lai;
- loading/error states;
- responsive desktop/mobile.

Thông tin nhạy cảm trong course config phải được xem như business data. Báo cáo và
log không được in đầy đủ thông tin ngân hàng nếu không cần thiết.

---

## 12. Luồng tạo order

### 12.1 Happy path

1. Khách mở đúng sales course.
2. Frontend lấy config từ backend.
3. Khách nhập dữ liệu và tải biên lai.
4. `POST /api/register`.
5. Backend xác định tenant từ deployment.
6. Backend đọc course thật theo tenant + slug.
7. Backend lấy price/title/course ID từ database.
8. Backend resolve canonical learning slug.
9. Backend ghi order với snapshot.
10. Admin duyệt thủ công.
11. Commerce đồng bộ Portal/LMS.

### 12.2 Fields cần snapshot

- `course_id`;
- `course_slug`;
- `learning_course_slug`;
- `price_snapshot`;
- `sales_site`;
- `sales_host`;
- idempotency data;
- customer/payment/sync state theo schema.

### 12.3 Điều không tin từ browser

- tenant;
- price;
- course title;
- course ID;
- learning slug;
- sales host tùy ý;
- trạng thái approve/sync.

### 12.4 `sales_host`

Order mới sau cutover phải snapshot domain mới của tenant:

```text
yeunauan -> yeubep.shop
yeubep   -> shop.yeunauan.live
```

Order cũ giữ `sales_host` tại thời điểm phát sinh. Không backfill order cũ sau đổi
domain. Khi đọc lịch sử, ưu tiên persisted snapshot; fallback legacy chỉ dành cho
row cũ không có giá trị.

### 12.5 Idempotency

Idempotency chống:

- double click;
- browser retry;
- network retry;
- serverless retry.

Không được bỏ constraint/index hoặc tạo logic “retry bằng insert mới”.

---

## 13. Quản trị commerce

### 13.1 Course admin

Chức năng:

- list/create/update/delete theo contract;
- active/published/sort;
- content/poster/price/teacher/date;
- bank/QR/transfer note;
- chọn sales site;
- chọn LMS target;
- sinh sales link theo domain hiện tại;
- read-after-write để tránh success giả.

Quy tắc UI:

- course legacy `sales_site=NULL` hiển thị tenant `yeunauan`;
- label/link `yeunauan` hiện trỏ `yeubep.shop`;
- label/link `yeubep` hiện trỏ `shop.yeunauan.live`;
- quick toggle không làm mất `sales_site`;
- không cho URL tùy ý làm tenant;
- không cho learning alias cycle.

### 13.2 Order admin

Chức năng:

- list/search/filter;
- hiển thị website phát sinh;
- filter tenant/course/status;
- update;
- approve;
- revoke;
- manual resync;
- approve-all.

`approve-all` phải scope ít nhất:

```text
sales_site + course_slug + status
```

Admin/orders hiện có thể được phục vụ từ cả hai project static deployment, nhưng
mọi mutation vẫn phải qua auth và backend contract.

### 13.3 Authentication caveat

Commerce admin auth đơn giản hơn LMS. Không coi:

- CORS;
- URL khó đoán;
- trang HTML ẩn;
- query flag;
- frontend check

là authentication. `api/check-auth` không được trả `process.env` hoặc debug secret.

---

## 14. Approve, enrollment, revoke và shared entitlement

### 14.1 Approve

Approve sales alias phải gửi canonical learning slug:

```json
{
  "action": "syncEnrollment",
  "email": "<normalized-email>",
  "courseSlug": "thitxiennuongchaungoc"
}
```

Không gửi `thitxiennuongchaungoc-yeubep` tới LMS.

### 14.2 Revoke

Revoke dùng cùng canonical slug:

```json
{
  "action": "revokeEnrollment",
  "email": "<normalized-email>",
  "courseSlug": "thitxiennuongchaungoc"
}
```

### 14.3 Shared entitlement

Một email có thể có nhiều order cấp cùng một canonical LMS course. Trước revoke:

```text
normalized email
+ effective learning_course_slug
+ granting status
```

Nếu còn order approved khác, giữ enrollment và trả trạng thái tương đương
`SHARED_ENTITLEMENT_RETAINED`. Chỉ order cấp quyền cuối cùng bị revoke mới gọi LMS.

### 14.4 Sync course alias

Sales alias không cần `syncCourse`; kết quả phải là `MAPPED_NOT_REQUIRED` hoặc
tương đương. Không tạo LMS course rỗng và không clone lesson.

---

## 15. Portal/LMS synchronization boundary

Commerce sử dụng:

- `SYSTEM1_URL`: Portal;
- `SYSTEM3_URL`: LMS;
- `INTERNAL_SYNC_SECRET`: xác thực nội bộ;
- header `X-Sync-Secret`;
- `POST <SYSTEM3_URL>/api/sync`.

Contract LMS:

- `syncCourse`;
- `syncEnrollment`;
- `revokeEnrollment`.

`sales_site` không cần xuất hiện trong payload LMS. Tenant separation kết thúc tại
commerce; LMS nhận canonical learning identity.

### 15.1 Dry-run

Khi `EXTERNAL_SYNC_MODE=dry-run`, helper phải chặn:

- fetch LMS;
- fetch Portal;
- enqueue outbox/delivery thật;
- email hoặc side effect thật.

Dry-run response được phép chứa action/payload dự kiến nhưng không chứa secret.
Production hiện tại có `EXTERNAL_SYNC_MODE` unset, vì vậy approve/revoke thật không
bị dry-run chặn.

### 15.2 `course_slug_mappings`

Bảng này phục vụ diagnostics/reconciliation. Nó không phải resolver runtime chính
cho sales alias. Runtime source of truth là `learning_course_slug` trong commerce.

---

## 16. LMS chuyên sâu

### 16.1 Stack

- static HTML/CSS/Vanilla JavaScript;
- Vercel Functions Node.js/ESM;
- Supabase Production dùng chung;
- Google GSI;
- Google Drive/Google APIs;
- Bunny/iframe/HTML5 video tùy media;
- Node built-in tests.

### 16.2 Entry points

```text
index.html
lms.html
lesson.html
lms-admin.html
gdrive-player.html
photo.html
```

API/source chính:

```text
api/sync.js
api/lms/portal.js
api/lms/admin.js
api/v2/*
utils/lms-handlers/*
```

### 16.3 Student capabilities

- Google sign-in;
- enrollment verification;
- signed session/cookie restore;
- entry token/exchange code;
- danh sách course được cấp;
- section/lesson navigation;
- prev/next;
- hard-load và SPA navigation;
- progress;
- materials;
- main/supplemental media;
- supplemental captions;
- one-tap main video;
- Drive permission/player;
- responsive layouts.

### 16.4 LMS admin

- course;
- section/lesson;
- lesson content;
- media/thumbnail/materials;
- permissions;
- enrollment;
- Drive sync;
- system config;
- V2 diagnostics/readiness;
- audit/session/risk controls.

### 16.5 LMS invariants

Không regression:

- Google GSI;
- signed session;
- cookie restore;
- admin allowlist/auth;
- enrollment access;
- `displayLesson`;
- `is_section`;
- prev/next;
- media classification;
- supplemental captions;
- one-tap main video;
- SPA navigation;
- materials;
- Drive permission;
- V2 flags;
- body parser 500 MB.

### 16.6 Media fixes trong baseline B05

- caption gắn đúng supplemental item;
- item không caption không tạo khoảng trống;
- main video one-tap;
- thumbnail chỉ ẩn sau khi player ready;
- player error phục hồi UI;
- listener không nhân bản khi SPA đổi lesson.

---

## 17. Supabase Production

Project:

```text
aqozjkfwzmyfunqvcyjv
```

Đây là database dùng chung cho commerce và LMS. Không có “database Yeubep riêng”.

Snapshot đầy đủ ghi nhận:

- 27 public tables;
- 372 columns;
- 71 constraints;
- 108 indexes;
- 8 policies;
- 3 functions;
- 1 sequence.

### 17.1 Row counts snapshot

| Table | Rows |
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
| `sync_dead_letters` | 0 |
| `course_slug_mappings` | 6 |
| `portal_post_course_mappings` | 0 |
| `platform_runtime_config` | 1 |
| `platform_runtime_config_audit` | 0 |
| `student_active_sessions` | 16 |
| `lms_entry_tokens` | 38 |
| `lms_verified_sessions` | 38 |
| `student_session_controls` | 0 |
| `student_device_change_logs` | 64 |
| `student_account_risk_reviews` | 0 |
| `student_account_risk_summaries` | 1 |
| `student_account_admin_notes` | 0 |
| `admin_audit_logs` | 5 |
| `posts` | 1 |

Counts trọng yếu sau cutover vẫn:

```text
courses=8
orders=28
student_enrollments=20
lessons=39
```

### 17.2 Phân nhóm

Commerce:

- `courses`;
- `orders`;
- `site_config`.

Learning:

- `students`;
- `student_enrollments`;
- `lessons`;
- `lesson_progress`.

Drive:

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

Khác:

- `posts`.

### 17.3 Field quan trọng

`courses`:

- `id`;
- `slug`;
- `sales_site`;
- `learning_course_slug`;
- active/published/sort;
- content/media;
- bank/QR;
- `raw_data`.

`orders`:

- `id`;
- `course_id`;
- `course_slug`;
- `learning_course_slug`;
- `sales_site`;
- `sales_host`;
- `idempotency_key`;
- `price_snapshot`;
- customer/payment/status/sync fields;
- `raw_data`.

### 17.4 Constraint/index invariant

- `courses.slug` unique toàn hệ thống;
- tenant check chỉ cho NULL/`yeunauan`/`yeubep`;
- tenant/active/sort indexes;
- partial index learning slug;
- order tenant/course/status indexes;
- idempotency uniqueness theo contract;
- entitlement lookup index;
- enrollment unique `(email, course_slug)`;
- lesson unique `(course_slug, lesson_no)`.

Không thay unique slug thành “unique theo tenant” nếu chưa thiết kế lại toàn bộ API,
admin, mapping và LMS boundary.

### 17.5 RLS và service-role

RLS hiện bảo vệ một số luồng LMS:

- user đọc enrollment theo email của mình;
- user đọc/cập nhật progress của mình;
- lesson theo enrollment;
- anon lesson free;
- active course theo policy;
- user session của chính mình.

Commerce functions dùng service-role server-side. Service-role bypass RLS và vì vậy:

- không được xuất hiện trong HTML/JS;
- không log;
- không trả qua diagnostics;
- mọi tenant filter phải được thực thi trong server application.

---

## 18. Tính toàn vẹn dữ liệu sau domain cutover

Domain cutover không ghi Supabase. Bốn tập dữ liệu trọng yếu được canonical hóa và
đối chiếu SHA-256 trước/sau:

| Table | SHA-256 | Match |
|---|---|---|
| `courses` | `3250a5a9a40198ee18df4e076ce20ac9e94e7cd22e7c2fc55b16442e56d65746` | yes |
| `orders` | `f9aa184c62b2ed7e53761ea4662b88edb032b5d4edaab07af917a7a0366437a0` | yes |
| `student_enrollments` | `a6e9864d75923e9d98c25c612cc859a88259292cd13a0e5211d70cd119ad10e3` | yes |
| `lessons` | `ed46bd4794247b00d8508f44a0e18bd149d0155b638f3f255a1dac0a9cfa7129` | yes |

Không có:

- order mới từ smoke;
- enrollment mới;
- course mới;
- lesson mới;
- backfill `sales_host`;
- cross-tenant data;
- LMS alias course mới.

Course legacy `thitxiennuongchaungoc` có `sales_site=NULL` trong database và được
resolver hiểu là `yeunauan`. Đây khớp snapshot trước cutover.

---

## 19. Cloudinary, media và biên lai

Commerce:

- poster/QR là URL lưu trong course/database;
- biên lai được upload qua server endpoint;
- backend gọi Cloudinary bằng credential server-side;
- order/database giữ URL kết quả;
- domain swap không di chuyển asset.

LMS:

- main image/video;
- supplemental media;
- caption;
- materials;
- Drive URLs/permission;
- iframe/Bunny/HTML5 video.

Invariant:

- không xóa Cloudinary asset khi rollback code/schema;
- không đổi URL media hàng loạt nếu chưa kiểm tra reference;
- không tải toàn bộ receipt/PII vào báo cáo;
- backup media linkage chỉ lưu URL/reference cần thiết;
- nếu restore database, giữ nguyên referential linkage tới media.

---

## 20. API contract commerce

| Endpoint | Method | Auth/phạm vi |
|---|---|---|
| `/api/config?course=<slug>` | GET | public, tenant-filtered |
| `/api/check-auth` | POST/OPTIONS | admin auth check |
| `/api/courses` | GET | admin/list contract |
| `/api/courses` | POST | admin create |
| `/api/courses` | PUT | admin update + read-after-write |
| `/api/courses` | DELETE | admin delete contract |
| `/api/register` | POST | public order creation, strict validation |
| `/api/orders` | GET | admin order list |
| `/api/orders` | PUT | update/approve/revoke/resync |
| `/api/approve-all` | POST | scoped bulk approval |
| `/api/upload` | POST | receipt upload |
| `/api/v2/diagnostics` | GET/POST | V2 diagnostics |
| `/api/v2/readiness` | GET/POST | V2 readiness |

Public API requirements:

- correct slug 200;
- cross-tenant slug 404;
- malformed/not found errors không thành 500;
- không trả env;
- không trả fixture Production;
- không trả Preview diagnostics Production.

Mutation requirements:

- auth nơi cần;
- server-derived tenant/course/price;
- idempotency;
- canonical learning slug;
- shared-entitlement-safe revoke;
- no secret in response.

---

## 21. Security model và threat checklist

### 21.1 Assets cần bảo vệ

- customer PII;
- order/payment receipt;
- Supabase service role;
- sync secret;
- admin credential/allowlist;
- Google OAuth/Drive credentials;
- Cloudinary secret;
- session signing keys;
- Vercel/team access;
- backups chứa Production data.

### 21.2 Threats chính

- tenant spoofing từ client;
- price/title tampering;
- learning slug injection;
- double order;
- cross-tenant approve-all;
- over-revoke shared entitlement;
- diagnostics làm lộ env;
- service-role trong frontend;
- secret trong Git/log/report;
- deploy sai commit/worktree;
- domain gắn sai project;
- restore snapshot đè order mới;
- LMS deploy từ nhánh không an toàn.

### 21.3 Controls hiện có

- deployment-scoped tenant;
- allowlist mapping;
- server lookup;
- tenant-filtered public queries;
- idempotency;
- order snapshots;
- canonical resolver;
- shared entitlement check;
- server-to-server secret;
- dry-run guard;
- RLS cho LMS flows;
- exact artifacts/tags;
- backups/checksums;
- smoke 200/404/308.

### 21.4 Technical debt/risk

1. Commerce admin auth đơn giản hơn LMS.
2. Một số CORS legacy rộng; CORS không phải auth.
3. Shared database làm tăng blast radius migration.
4. Direct CLI deploy có thể thiếu Git metadata chuẩn của Vercel.
5. Production branch chưa merge, nên người mới dễ chọn sai source.
6. Legacy NULL fallback phải được hiểu trong mọi query/report.
7. Domain assignment và redirect dependency của Vercel có thể gây cutover một phần.
8. `course_slug_mappings` dễ bị hiểu nhầm là runtime resolver.

---

## 22. Test baseline

Commerce current commit:

- full suite: 66/66;
- syntax checks: pass;
- `git diff --check`: pass;
- tracked-file secret scan: 0 hit;
- tenant isolation: pass;
- learning boundary: pass;
- dry-run/no-mutation: pass;
- Production adapter contract: pass.

LMS B05:

- 300/300;
- auth/session/navigation/media/materials/sync baseline.

Commerce commands:

```powershell
npm ci
npm test
git diff --check
```

LMS commands:

```powershell
npm ci
npm run build:lms-css
$env:LMS_RP2B1_SUPABASE_STUB='1'
node --test tests/*.test.mjs
git diff --check
```

Không chạy test mutation trực tiếp vào Production.

---

## 23. Production smoke baseline sau cutover

| URL/check | Expected/current |
|---|---:|
| `https://yeubep.shop` | 200 |
| `https://yeubep.shop/?course=thitxiennuongchaungoc` | 200 |
| `https://yeubep.shop/api/config?course=thitxiennuongchaungoc` | 200 |
| `https://yeubep.shop/api/config?course=thitxiennuongchaungoc-yeubep` | 404 |
| `https://shop.yeunauan.live` | 200 |
| `https://shop.yeunauan.live/?course=thitxiennuongchaungoc-yeubep` | 200 |
| `https://shop.yeunauan.live/api/config?course=thitxiennuongchaungoc-yeubep` | 200 |
| `https://shop.yeunauan.live/api/config?course=thitxiennuongchaungoc` | 404 |
| `https://www.yeubep.shop` | 308 → `https://yeubep.shop/` |
| admin hai project | 200 |
| orders hai project | 200 |
| `https://www.daubepnho.store` | 200 |

HTTP 500 log trong cửa sổ cutover: 0. Vercel có warning Node `url.parse()`
deprecation; đó là warning kỹ thuật, không phải HTTP 500.

Smoke không gửi order form và không tạo enrollment.

---

## 24. Backup inventory

### 24.1 Full pre-cutover backup

```text
_local_backups/full-system-readonly-20260726-104151
```

Bao gồm:

- commerce/LMS source archives;
- full Git bundles;
- Git exact metadata;
- Vercel deployments/domains/env names+scopes;
- public DNS/email records;
- Supabase 27-table export;
- schema SQL/OpenAPI/catalog;
- media URL linkage;
- row counts;
- restore runbook;
- 203 SHA-256 entries;
- verification reports.

Checksum mismatch: 0. Secret scan known-pattern: 0.

Backup có PII được giữ local, ACL hạn chế. Bản sao thứ hai:

- mã hóa AES-256-GCM;
- key được bảo vệ bằng Windows DPAPI CurrentUser;
- decrypt authentication và ZIP parse đã pass;
- ACL chỉ SYSTEM và Windows user được chỉ định.

### 24.2 After-cutover backup

```text
_local_backups/after-domain-swap-20260726-114306
```

Bao gồm:

- exact Git/tag;
- new deployment IDs;
- domain before/after;
- sanitized env config;
- Supabase counts + semantic hashes;
- smoke results;
- DNS snapshot;
- rollback references/runbook;
- checksum verification.

10 payload checksum entries, 0 mismatch, JSON parse failure 0.

Không commit hai backup này vào Git và không upload công khai.

---

## 25. Rollback hiện hành

### 25.1 Rollback storefront/domain swap

Rollback deployments:

| Project | Deployment |
|---|---|
| `web-ban-hang-chinh-thuc` | `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h` |
| `web-ban-hang-yeubep-shop` | `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6` |
| LMS | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |

Domain rollback:

```text
shop.yeunauan.live -> web-ban-hang-chinh-thuc
yeubep.shop         -> web-ban-hang-yeubep-shop
www.yeubep.shop     -> 308 https://yeubep.shop
```

Env rollback:

Project cũ:

```text
SALES_SITE=yeunauan
PUBLIC_SITE_URL=https://shop.yeunauan.live
COMMERCE_DATA_MODE=supabase
EXTERNAL_SYNC_MODE unset
```

Project Yeubep:

```text
SALES_SITE=yeubep
PUBLIC_SITE_URL=https://yeubep.shop
COMMERCE_DATA_MODE=supabase
EXTERNAL_SYNC_MODE unset
```

### 25.2 Delta-first rule

Trước rollback:

1. kiểm tra có order/enrollment mới từ thời điểm cutover không;
2. nếu có, lập delta report;
3. không xóa hoặc sửa các row đó;
4. rollback code/domain/env;
5. không rollback Supabase vì domain swap không thay database.

### 25.3 Schema rollback

Files:

- `20260725_multi_storefront_tenant_rollback.sql`;
- `20260725_learning_course_boundary_rollback.sql`.

Chỉ rollback schema khi có phê duyệt riêng. Không restore toàn database để xử lý
lỗi application/domain.

### 25.4 Historical code rollback

Mốc trước multi-storefront:

- commit `cafe21bbe55af86bfb8ac2ebe9155ded849452e8`;
- artifact `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`.

Artifact này không hiểu đầy đủ tenant/learning boundary mới; không dùng như rollback
mặc định của domain swap.

---

## 26. Runbook triển khai thay đổi

### 26.1 Mọi thay đổi

1. xác định đúng repository/project/database;
2. chụp exact current commit/deployment/domain;
3. xác minh worktree sạch;
4. tạo branch/worktree riêng;
5. backup tương xứng blast radius;
6. thay đổi tối thiểu;
7. chạy full tests/syntax/secret scan;
8. tạo Preview;
9. probe no-mutation;
10. owner duyệt;
11. deploy exact local artifact;
12. smoke tất cả hệ thống bị ảnh hưởng;
13. kiểm tra DB delta;
14. backup/tag/report sau triển khai.

### 26.2 Nếu sửa commerce

Phải test:

- cả hai `SALES_SITE`;
- correct slug 200;
- cross slug 404;
- course active/published;
- price/title server-derived;
- idempotency;
- `sales_host`;
- canonical learning slug;
- shared entitlement;
- approve/revoke;
- dry-run không external mutation;
- Production không fixture.

### 26.3 Nếu sửa LMS

- base từ B05/exact SHA;
- giữ ≥300 baseline tests;
- smoke auth/session/enrollment;
- hard-load + SPA;
- prev/next;
- main/supplemental media;
- materials/Drive;
- sync endpoint.

### 26.4 Nếu sửa Supabase

- full backup;
- transaction;
- lock/statement timeout;
- forward + rollback SQL;
- no blind backfill;
- smoke hai storefront + LMS;
- compare counts/checksums/delta;
- giữ order mới.

### 26.5 Nếu sửa domain

- deploy/probe artifacts trước;
- snapshot assignments;
- kiểm tra redirect dependencies;
- không sửa DNS/email records nếu chưa duyệt;
- cutover liên tục;
- rollback khi cross-tenant hoặc SSL/redirect sai.

---

## 27. Monitoring và chẩn đoán

Thứ tự kiểm tra khi có sự cố:

1. HTTP status và redirect chain.
2. Domain đang gắn project nào.
3. Project current deployment ID.
4. `SALES_SITE`/`PUBLIC_SITE_URL`/data mode theo scope.
5. `/api/config` correct/cross slug.
6. Vercel Functions HTTP 500.
7. Supabase availability/count/delta.
8. Canonical learning slug.
9. Portal/LMS sync response.
10. LMS enrollment/session/media.

Không bật diagnostics có thể trả env trên Production. Dùng Vercel authenticated
logs và sanitized metadata.

Các tín hiệu rollback:

- correct slug không 200;
- cross slug không 404;
- domain sai project;
- SSL/redirect loop;
- Production fixture/dry-run;
- admin/orders/LMS lỗi;
- canonical slug sai;
- DB count/delta ngoài dự kiến;
- HTTP 500 liên quan change.

---

## 28. Những điều tuyệt đối không được làm

- Không đưa service-role/sync secret vào frontend.
- Không gửi secret qua chat, report hoặc Git.
- Không tin tenant/price/title/learning slug từ browser.
- Không dùng client-only filtering cho tenant.
- Không tạo LMS course từ sales alias.
- Không backfill legacy NULL nếu chưa duyệt.
- Không sửa order snapshot cũ theo domain/course hiện tại.
- Không đổi unique slug tùy tiện.
- Không cascade-delete order/enrollment/lesson để rollback.
- Không restore mù toàn database.
- Không dùng Production database làm fixture.
- Không tạo order thật trong smoke.
- Không sửa DNS/MX/SPF/DKIM/DMARC trong task application.
- Không đổi project Portal thành storefront.
- Không deploy LMS từ `origin/main`.
- Không refactor diện rộng trong hotfix.
- Không xóa old deployments, backup hoặc rollback artifacts.
- Không merge branch Production khi chưa có quy trình review riêng.

---

## 29. Ma trận tác động thay đổi

| Thay đổi | Phải kiểm tra |
|---|---|
| `utils/sales-site.js` | cả domain, tenant 200/404, admin link, `sales_host` |
| `learning-course.js` | approve/revoke, alias/cycle, shared entitlement, LMS |
| `api/register.js` | price, idempotency, snapshots, no cross-tenant order |
| `api/orders.js` | history snapshots, approve/revoke/resync |
| `api/courses.js` | validation, quick toggle, read-after-write |
| Supabase `courses` | cả storefront + LMS course list |
| Supabase `orders` | admin, entitlement, history |
| Supabase lessons/enrollment | LMS access/navigation |
| Cloudinary upload | receipts, permissions, URL persistence |
| Vercel env | rebuild/redeploy scope, fixture/sync mode |
| Domain/redirect | SSL, 308, tenant mapping, canonical links |
| LMS media code | hard load + SPA + mobile + player failure |

---

## 30. Checklist tiếp nhận cho bên thứ ba

### 30.1 Access

- [ ] Có read access GitHub hai repository.
- [ ] Có Vercel team/project access đúng scope.
- [ ] Có Supabase access phù hợp, service-role chỉ khi thật sự cần.
- [ ] Có Cloudinary/Google access theo least privilege.
- [ ] Không yêu cầu gửi secret qua kênh không bảo mật.

### 30.2 Reproducibility

- [ ] Checkout exact commerce commit/tag.
- [ ] Checkout exact LMS commit/tag.
- [ ] `npm ci` thành công.
- [ ] Commerce 66/66.
- [ ] LMS 300/300.
- [ ] Worktree sạch.

### 30.3 Production understanding

- [ ] Hiểu `yeubep.shop` đang là tenant `yeunauan`.
- [ ] Hiểu `shop.yeunauan.live` đang là tenant `yeubep`.
- [ ] Hiểu legacy `sales_site=NULL`.
- [ ] Hiểu sales slug/learning slug.
- [ ] Hiểu shared Supabase.
- [ ] Hiểu order snapshots không backfill.
- [ ] Biết exact deployments và rollback artifacts.

### 30.4 Before first change

- [ ] Lập impact matrix.
- [ ] Xác định data write/migration.
- [ ] Tạo backup.
- [ ] Tạo Preview/no-mutation plan.
- [ ] Lập rollback.
- [ ] Owner duyệt.

---

## 31. Câu hỏi chẩn đoán nhanh

**Tại sao `yeubep.shop` lại chạy tenant `yeunauan`?**  
Vì domain vừa được hoán đổi giữa hai project; tenant được giữ theo project/env.

**Tại sao course legacy có `sales_site=NULL`?**  
Đó là dữ liệu trước multi-storefront; backend quy ước NULL là `yeunauan`.

**Tại sao Yeubep sales slug không xuất hiện trong LMS?**  
Vì `learning_course_slug` map về canonical `thitxiennuongchaungoc`.

**Có database riêng cho mỗi storefront không?**  
Không. Cả hai storefront và LMS dùng Supabase B chung.

**Đổi domain có sửa order cũ không?**  
Không. `sales_host` cũ là snapshot lịch sử.

**Có thể test approve trên Production không?**  
Không dùng order thật cho smoke. Dùng fixture/Preview/dry-run được cấu hình rõ.

**Có thể rollback bằng restore database không?**  
Không đối với domain/code. Ưu tiên promote artifact và đổi assignment/env.

**Có thể deploy LMS từ main không?**  
Không. Base từ B05/exact Production SHA.

---

## 32. Tài liệu và artifact liên quan

Tài liệu gốc:

- `FULL_SYSTEM_CURRENT_ARCHITECTURE_AND_HANDOVER_2026-07-26.md`;
- `LMS_FULL_SYSTEM_HANDOVER_B05_2026-07-25.md`;
- `YEUBEP_SHOP_FINAL_PRODUCTION_LAUNCH_REPORT_2026-07-25.md`;
- `MULTI_STOREFRONT_GATE1_ARCHITECTURE_INVESTIGATION_2026-07-25.md`;
- `MULTI_STOREFRONT_GATE4A_PRODUCTION_SCHEMA_MIGRATION_2026-07-25.md`;
- `MULTI_STOREFRONT_GATE4B_OLD_COMMERCE_PRODUCTION_DEPLOYMENT_2026-07-25.md`;
- `MULTI_STOREFRONT_GATE5C_PRODUCTION_BOUNDARY_INACTIVE_CLONE_2026-07-25.md`;
- `COMMERCE_PRODUCTION_BACKUP_BEFORE_MULTISTORE_2026-07-25.md`;
- `docs/v2/V2_SYSTEM_OVERVIEW_4REPOS.md`;
- `docs/v2/V2_4REPO_ROLLBACK_RUNBOOK.md`.

Backup:

- `_local_backups/full-system-readonly-20260726-104151`;
- `_local_backups/after-domain-swap-20260726-114306`.

---

## 33. Kết luận trạng thái hiện tại

Tại thời điểm bàn giao:

- hai storefront online;
- domains đã hoán đổi đúng project;
- tenant không hoán đổi;
- correct/cross slug đạt 200/404;
- redirect `www` đạt 308;
- two commerce deployments READY/current;
- LMS B05 online;
- database giữ nguyên;
- semantic checksums trọng yếu khớp trước/sau;
- không có order/enrollment do cutover;
- Cloudinary, Portal, LMS, DNS và email records không thay đổi;
- commerce Production chạy exact commit/tag đã ghi;
- branch đã push nhưng chưa merge;
- backups và rollback artifacts được giữ nguyên.

Đơn vị thứ ba nên xem tài liệu này là bản đồ Production hiện hành, nhưng vẫn phải
thực hiện read-only preflight và xác minh live state trước mọi thay đổi vì deployment,
domain, DNS, dữ liệu và quyền truy cập là các trạng thái có thể thay đổi theo thời gian.
