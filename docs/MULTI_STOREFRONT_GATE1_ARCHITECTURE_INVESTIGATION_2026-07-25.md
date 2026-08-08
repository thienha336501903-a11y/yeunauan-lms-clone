# BÁO CÁO CỔNG 1 — ĐIỀU TRA KIẾN TRÚC ĐA WEBSITE BÁN KHÓA HỌC

Ngày kiểm tra: 2026-07-25  
Phạm vi: chỉ đọc, không sửa code, không migration, không deploy, không chỉnh DNS.  
Mục tiêu: bổ sung storefront `yeubep.shop`, dùng chung trang quản trị thương mại, giữ nguyên website cũ và LMS B05.

## 1. Kết luận điều hành

Đã xác định được source production, exact commit, Vercel project và database thật của website bán hàng. Chức năng mới có thể thực hiện hoàn toàn ở tầng commerce; **không cần sửa LMS** và không cần thay contract `/api/sync`.

Kiến trúc phù hợp nhất với hệ thống hiện tại là:

- dùng chung danh mục khóa học và trang quản trị trong Supabase B;
- bổ sung tenant isolation ở backend bằng `sales_site`;
- tạo storefront/Vercel project độc lập cho `yeubep.shop`;
- giữ slug unique toàn hệ thống;
- mọi truy vấn public, tạo đơn và đọc đơn phải được scope ở server;
- khóa học/đơn legacy có `sales_site IS NULL` được coi là `yeunauan`;
- LMS tiếp tục nhận `slug` và email như hiện tại, không nhận secret từ browser và không cần biết website bán hàng.

Hai xung đột thực tế phải được xử lý có chủ đích:

1. `yeubep.shop` hiện đã là alias của **Vercel project bán hàng cũ**, nên đang hiển thị cùng nội dung với `shop.yeunauan.live`.
2. Vercel project tên `yeubep-shop` đã tồn tại nhưng thuộc repository Portal khác. Không được ghi đè project này. Tên project mới được đề xuất là `web-ban-hang-yeubep-shop`.

## 2. Website bán hàng production hiện tại

| Hạng mục | Giá trị đã xác minh |
|---|---|
| Repository | `thienha100022653824678-stack/web-ban-hang-chinh-thuc` |
| Git remote | `https://github.com/thienha100022653824678-stack/web-ban-hang-chinh-thuc.git` |
| Local repository | `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\git-repo` |
| Production branch | `feat/v2-shop-runtime-switch` |
| Exact production commit | `cafe21bbe55af86bfb8ac2ebe9155ded849452e8` |
| Vercel project | `web-ban-hang-chinh-thuc` |
| Vercel project ID | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` |
| Production deployment | `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2` |
| Deployment URL | `web-ban-hang-chinh-thuc-7etvlx8t7.vercel.app` |
| Production domain | `shop.yeunauan.live` |
| Framework | Static HTML/CSS/JavaScript + Vercel Node Functions |
| Package manager | npm (`package-lock.json`) |
| Vercel Node version | 24.x |
| Root directory | repository root (`.`/không cấu hình riêng) |
| Build command | không cấu hình |
| Output directory | không cấu hình |
| Install command | Vercel mặc định |

Build log Vercel xác nhận deployment trên được clone từ đúng branch và SHA nêu trên. Hash của `index.html`, `admin.html` và `orders.html` trên production khớp blob ở commit này. Local branch `v2/platform-rebuild` hiện không phải source production và không được dùng làm baseline.

## 3. Cấu trúc và chức năng commerce hiện tại

### 3.1 Storefront

- `index.html` đọc query `?course=<slug>`, mặc định slug `donut`.
- Browser gọi `GET /api/config?course=<slug>`.
- API tra bảng `courses` bằng `slug` và `active`; hiện chưa scope hostname/website.
- Giao diện có poster, mô tả, giá, thông tin ngân hàng, QR, nội dung chuyển khoản, form Gmail và upload biên lai.
- File biên lai hỗ trợ JPG/PNG/WEBP, giới hạn phía client 5 MB.
- Sau khi đặt hàng, hệ thống chuyển người dùng tới `https://yeunauan.live/my-courses`.
- Có responsive/mobile payment layout; dùng Tailwind CDN và Google Fonts.
- Không phát hiện coupon/discount, payment gateway tự động, callback thanh toán, CAPTCHA, service worker, web manifest, sitemap, robots, canonical, Open Graph, Twitter metadata hoặc analytics pixel trong exact source.
- `robots.txt`, `sitemap.xml`, `manifest.json`, `service-worker.js`, `sw.js` và `favicon.ico` hiện trả 404.
- Khi course API lỗi, client chủ yếu ghi log; trạng thái “không tìm thấy” chưa phải một 404/UX rõ ràng.

### 3.2 Tạo đơn và thanh toán

Luồng hiện tại:

```text
course config
→ khách nhập Gmail
→ upload biên lai
→ POST /api/register
→ upload Cloudinary
→ insert order "Chờ duyệt"
→ admin duyệt
→ syncEnrollment tới LMS/Portal
```

- Thanh toán hiện là chuyển khoản thủ công.
- Bank account, bank name, owner, QR và transfer note được lưu theo khóa học trong `courses.raw_data`.
- Storage ảnh/biên lai là Cloudinary, folder `bill-chuyen-khoan/<slug>`.
- `api/register.js` hiện chưa lưu `sales_site`/`sales_host`, chưa có idempotency chống đơn trùng và chưa xác minh tenant của khóa học.
- API lấy course theo slug để bổ sung title/image nhưng hiện chưa bắt buộc `active=true`.
- Giá không được gửi/lưu như một amount đã được backend chốt; do đó yêu cầu “backend xác minh lại giá” cần được bổ sung ở giai đoạn triển khai.
- Không phát hiện email thực gửi sau duyệt; source còn TODO/log thay cho email provider.

### 3.3 Admin khóa học và đơn hàng

- `admin.html` quản lý slug, title, price, sort order, teacher, lịch khai giảng, active, poster, mô tả, ngân hàng, nội dung chuyển khoản và QR.
- `POST/PUT /api/courses` xác thực bằng `X-Admin-Password`, insert/update rồi trả `.select().single()`.
- Frontend reload danh sách sau lưu nhưng chưa có bước read-after-write độc lập và chưa xác minh chính xác một row ngoài kết quả update.
- `GET /api/courses` hiện trả toàn bộ courses.
- `GET /api/orders` hiện trả toàn bộ orders; PUT status gọi sync khi duyệt/thu hồi.
- `approve-all` scope theo `course_slug` và status, chưa có tenant.
- Mật khẩu admin được lưu ở `sessionStorage` dưới key `admin_password`; không dùng cookie/domain cookie.
- Một số API dùng CORS `Access-Control-Allow-Origin: *`.

## 4. Database production đã xác minh read-only

Commerce dùng Supabase project ref `aqozjkfwzmyfunqvcyjv` — chính là **Supabase B** trong kiến trúc hiện tại.

Số liệu lúc kiểm tra:

| Bảng | Số bản ghi |
|---|---:|
| `courses` | 7 |
| `orders` | 28 |
| `site_config` | 73 |

Không tồn tại các bảng độc lập `customers`, `coupons`, `discount_codes` hoặc `payment_config`.

Các field chính:

- `courses`: `id`, `slug`, `title`, `subtitle`, `description`, `price`, `teacher_name`, `expected_start_date`, `image_url`, `sort_order`, `active`, `is_published`, `raw_data`, các trạng thái sync và timestamps.
- `orders`: course id/slug/title, customer email/name/phone, proof image, note, status, `source_system`, correlation/sync fields, `raw_data`, timestamps.
- Chưa có `sales_site` trên `courses` hoặc `orders`; chưa có `sales_host`.
- Schema hiện đặt `courses.slug TEXT UNIQUE`.

Không có migration hoặc ghi dữ liệu nào được thực hiện trong Cổng 1.

## 5. Contract đồng bộ LMS thực tế

Boundary production:

```text
POST https://www.daubepnho.store/api/sync
X-Sync-Secret: server-only
```

LMS kiểm tra method, secret bằng so sánh timing-safe và chỉ nhận các action sau:

### `syncCourse`

Required:

```json
{
  "action": "syncCourse",
  "slug": "string",
  "title": "string"
}
```

Optional được dùng:

```json
{
  "subtitle": "string",
  "imageUrl": "string",
  "expected_start_date": "date/string",
  "active": true
}
```

LMS upsert theo global `courses.slug`. Các field commerce gửi thêm như price, teacher hoặc isPublished hiện không được LMS sử dụng.

### `syncEnrollment`

```json
{
  "action": "syncEnrollment",
  "email": "string",
  "courseSlug": "string"
}
```

### `revokeEnrollment`

```json
{
  "action": "revokeEnrollment",
  "email": "string",
  "courseSlug": "string"
}
```

Commerce gọi sync từ server qua `utils/sync-helpers.js` bằng `SYSTEM3_URL`, `SYSTEM1_URL` và `INTERNAL_SYNC_SECRET`. Secret không nằm trong frontend. Course create/update gọi `syncCourse`; duyệt/thu hồi order gọi enrollment/revoke. Tạo order pending chỉ sync Portal, chưa cấp LMS.

**Kết luận:** LMS không cần biết `sales_site`. Vì giữ slug unique toàn hệ thống, course/enrollment vẫn được định danh đúng bằng slug và email. Không thay payload, không sửa LMS, không tác động Supabase A. Thay đổi dữ liệu dự kiến chỉ ở commerce/Supabase B và các query phía commerce.

## 6. Domain, Vercel project và DNS hiện tại

### 6.1 Trạng thái bất ngờ đã phát hiện

- `yeubep.shop` đang là alias trên deployment/project bán hàng cũ và trả cùng HTML với `shop.yeunauan.live`.
- `www.yeubep.shop` trả 307 về apex.
- Vercel project `yeubep-shop` đã tồn tại:
  - project ID `prj_jvEmhA9jIqzxWK0Fsg34jHZxBb8d`;
  - production deployment `dpl_2NGg5knW6NSxJ45RcxXHA16pxDwZ`;
  - source là repo Portal `thienha100022653824678-stack/tao-web-tra-bai-hoc-vien`, branch `main`, commit bắt đầu `6d3f6c3`;
  - không phải storefront mới.
- Local folder `...\web-ban-hang-chinh-thuc\yeubep-shop` cũng là repo Portal nói trên.
- Repository gợi ý `web-ban-hang-yeubep-shop` chưa thấy tồn tại/không truy cập được.
- Branch `feature/yeubep-shop` chưa tồn tại trong repo commerce.

### 6.2 DNS read-only

- Nameserver: `dns1.registrar-servers.com`, `dns2.registrar-servers.com` (phù hợp hạ tầng Namecheap; quyền quản trị chưa được xác nhận).
- Apex `yeubep.shop`: A `216.198.79.1`.
- `www.yeubep.shop`: CNAME `db4901082264508b.vercel-dns-017.com`.
- Có SPF TXT; tuyệt đối không thay MX/SPF/DKIM/DMARC.

Do domain đã hoạt động qua Vercel, có khả năng chỉ cần chuyển assignment giữa projects ở cổng Domain; tuy nhiên không được đoán DNS. Khi tới cổng đó phải dùng chính yêu cầu record do Vercel trả về và báo trước mọi thay đổi.

Canonical đề xuất: `https://yeubep.shop`; `www` 301 về apex.

## 7. Hard-code, cache, CORS, cookie, callback

Các điểm domain cần gom về cấu hình ở giai đoạn triển khai:

- `admin.html`: link course hard-code `https://shop.yeunauan.live`.
- `index.html`: redirect sau đăng ký hard-code `https://yeunauan.live/my-courses`.
- Một số ví dụ/comment về email trong sync helper.

Hiện không có payment callback/success/cancel URL hoặc webhook thanh toán. Không có cookie domain; admin dùng sessionStorage. Static pages có `Cache-Control: public, max-age=0, must-revalidate`, Vercel cache. Một số function có wildcard CORS và cần được đánh giá/thu hẹp theo allowlist khi tạo site thứ hai.

## 8. Biến môi trường — chỉ tên, không lộ giá trị

Project cũ hiện có các tên biến:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `ADMIN_PASSWORD`
- `ADMIN_EMAILS`
- `SYSTEM1_URL`
- `SYSTEM3_URL`
- `INTERNAL_SYNC_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Đề xuất phân loại cho project mới:

| Nhóm | Biến |
|---|---|
| Bắt buộc tạo/cấu hình riêng | `SALES_SITE=yeubep`, `PUBLIC_SITE_URL`, project Vercel/domain config |
| Có thể dùng chung nếu owner phê duyệt kiến trúc shared DB | Supabase URL/service-role; chỉ server-side |
| Có thể dùng chung server-to-server nếu chính sách secret cho phép | LMS/Portal URL; sync secret nên được cấp/quản lý riêng nếu endpoint hỗ trợ rotation/multiple secrets |
| Phải rà soát trước khi dùng lại | Cloudinary account/folder policy, admin password, Google OAuth redirect/origins |
| Chưa tồn tại nhưng cần nếu tính năng được bổ sung | email provider/template, idempotency key strategy |
| Không áp dụng ở source hiện tại | payment gateway/webhook/callback/success/cancel, CAPTCHA, cookie domain |

Không sao chép nguyên `.env.production`; không commit `.env`; không đưa service-role hoặc sync secret vào browser.

## 9. Kiến trúc dữ liệu đề xuất

### Chọn Phương án B — chung Supabase B, tenant-isolated

Lý do:

- admin chung và catalog course đã nằm ở Supabase B;
- LMS đã đồng bộ theo catalog/slug ở Supabase B;
- database riêng sẽ buộc xây lớp hợp nhất admin/catalog và tăng rủi ro sync lệch;
- số bảng commerce hiện nhỏ, nên backend scoping và constraint có thể kiểm soát rõ.

Field đề xuất:

```text
courses.sales_site  nullable text
orders.sales_site   nullable text
orders.sales_host   nullable text
```

Allowlist duy nhất:

```text
yeunauan
yeubep
```

Quy tắc tương thích:

- course/order legacy `sales_site IS NULL` được coi là `yeunauan`;
- không backfill hàng loạt ở bước đầu;
- form sửa legacy hiển thị `yeunauan`;
- chỉ ghi field khi tạo/lưu hoặc migration đã duyệt;
- không di chuyển/sửa nguồn đơn cũ khi đổi website của khóa học.

Giữ nguyên `courses.slug UNIQUE` toàn hệ thống. Không hỗ trợ cùng slug ở hai website trong phạm vi này; nhờ đó contract LMS không đổi và giảm rủi ro `approve-all`/sync nhầm.

### Server-side site resolution

Tạo một cấu hình dùng chung, không rải domain:

```text
yeunauan → https://shop.yeunauan.live
yeubep   → https://yeubep.shop
```

Helper dự kiến:

- `getSalesSiteConfig(salesSite)`
- `getSalesBaseUrl(salesSite)`
- `buildCourseSalesUrl(course)`

Public deployment xác định tenant bằng `SALES_SITE` server-side:

- project cũ: `yeunauan`;
- project mới: `yeubep`.

Không tin `sales_site`, hostname, giá hoặc domain do browser tự gửi. Admin API có quyền quản lý chung vẫn phải validate allowlist.

Query public:

- old site: `sales_site = 'yeunauan' OR sales_site IS NULL`;
- new site: `sales_site = 'yeubep'`;
- slug sai tenant trả 404/“Không tìm thấy khóa học”.

Tạo order:

- backend tìm course active đúng tenant;
- backend lấy giá/course identity từ DB;
- backend gắn `sales_site` và canonical `sales_host`;
- có idempotency/chống submit trùng;
- không cho coupon/config/order đọc chéo tenant nếu sau này bổ sung.

## 10. Migration dự kiến — chưa chạy

Trước migration production phải snapshot schema, export/backup dữ liệu và đếm lại records.

Migration phải idempotent, về nguyên tắc gồm:

1. Add nullable `sales_site` vào `courses`.
2. Add nullable `sales_site`, `sales_host` vào `orders`.
3. Check constraint cho `sales_site IS NULL OR sales_site IN ('yeunauan','yeubep')`.
4. Check `sales_host` theo allowlist/null nếu lưu dạng host.
5. Index phục vụ course public theo tenant/active/sort và orders theo tenant/time.
6. Không thay unique constraint slug.
7. Không backfill legacy mặc định.

Rollback dự kiến:

1. dừng code mới hoặc quay lại deployment cũ;
2. drop các index/constraint mới;
3. drop `sales_host`, `orders.sales_site`, `courses.sales_site`.

Rollback SQL chi tiết chỉ nên tạo cùng migration sau khi chụp schema thật ở môi trường test. Không chạy migration production nếu chưa có phê duyệt riêng.

## 11. Repository/worktree/project đề xuất cho Cổng 2–3

Không tạo trong Cổng 1. Sau khi được duyệt:

- baseline: exact production SHA `cafe21bbe55af86bfb8ac2ebe9155ded849452e8`;
- branch: `feature/yeubep-shop`;
- worktree đề xuất: `_worktrees/yeubep-storefront` để tránh đụng folder Portal hiện có;
- repository có thể tiếp tục dùng commerce repo chung nếu admin và hai deployments cùng codebase;
- Vercel project mới đề xuất: `web-ban-hang-yeubep-shop`, không dùng `yeubep-shop`;
- Preview dùng dữ liệu test/tenant test, không nhận thanh toán production;
- không đổi branch/deployment production cũ.

Đây là lựa chọn ít rủi ro hơn việc fork repository ngay lập tức: hai storefront dùng cùng code, khác `SALES_SITE` và branding/domain server config; admin selector được triển khai một lần. Nếu owner bắt buộc repository độc lập, có thể tạo repo mới từ exact production SHA nhưng phải duy trì hai codebase.

## 12. Rủi ro và biện pháp kiểm soát

| Rủi ro | Mức độ | Kiểm soát |
|---|---|---|
| Domain mới đang nằm trên project cũ | Cao | Chỉ detach/attach ở Cổng 5 sau Preview được duyệt; rollback bằng reattach deployment cũ |
| Tên project `yeubep-shop` đã bị dùng | Cao | Dùng `web-ban-hang-yeubep-shop`; không sửa Portal |
| Query hiện không tenant-scope | Cao | Scope mọi public/order API ở backend và có test cross-tenant |
| Legacy NULL | Trung bình | Quy ước NULL = yeunauan ở mọi read path |
| Admin quick toggle làm mất field mới | Trung bình | PUT phải preserve/read-after-write `sales_site` |
| Tạo đơn hiện thiếu price/idempotency | Cao | Server resolve course/price/site; thêm idempotency |
| Wildcard CORS/admin password sessionStorage | Trung bình | Giữ tương thích nhưng thu hẹp origin ở các endpoint có thể thu hẹp; không mở rộng exposure |
| Shared service-role/database | Cao | Chỉ ở function server; query bắt buộc tenant; tests chống đọc/ghi chéo |
| Sync trùng hoặc trạng thái giả | Cao | Dùng correlation/outbox hiện hữu, trạng thái pending/success/failed/retrying và retry idempotent |
| Hai storefront lệch source | Trung bình | Chung exact baseline và automated parity tests |

## 13. Rollback tổng thể

- Website cũ: giữ nguyên deployment `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`; không promote project cũ trong Cổng 2–3.
- Website mới Preview: xóa/không promote deployment Preview nếu lỗi; không tác động domain.
- Domain: nếu bước gắn domain sau này lỗi, reassign `yeubep.shop` và `www` về project/deployment cũ; không sửa `shop.yeunauan.live`.
- Database: rollback code trước, rồi rollback migration theo SQL đã duyệt; legacy NULL giúp deployment cũ tiếp tục đọc được.
- LMS: không sửa. Baseline rollback vẫn là `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`.

## 14. Bằng chứng production trước thay đổi

Kết quả smoke read-only ngày 2026-07-25:

| URL | Kết quả |
|---|---|
| `https://shop.yeunauan.live/` | HTTP 200 |
| course `thitxiennuongchaungoc` | HTTP 200 |
| `https://shop.yeunauan.live/admin.html` | HTTP 200 |
| `https://yeubep.shop/` | HTTP 200, hiện cùng storefront cũ |
| `https://www.yeubep.shop/` | HTTP 307 về apex |
| `https://www.daubepnho.store/` | HTTP 200 |
| `https://www.daubepnho.store/lms.html` | HTTP 200 |

Không có thay đổi production nên trạng thái “sau Cổng 1” bằng trạng thái trước điều tra.

LMS baseline bảo vệ:

- tag `backup/B05-2026-07-25`;
- commit `fc12c3b21329158e13a4a027833afd2dec61e973`;
- deployment `dpl_HVQvwrveFjxE81cpsoXRraDB34wR`;
- baseline `300/300 pass`.

## 15. Các quyết định cần owner phê duyệt trước Cổng 2

Đề nghị duyệt đồng thời bốn quyết định:

1. Chọn shared Supabase B với tenant isolation, không tạo database commerce riêng.
2. Giữ global unique slug và không sửa LMS contract.
3. Dùng project mới `web-ban-hang-yeubep-shop`, không đụng project Portal `yeubep-shop`.
4. Base nhánh/worktree mới từ exact production commit `cafe21b...`; chỉ tạo Local/Preview, chưa migration production, chưa Production, chưa chuyển domain.

Sau khi duyệt, Cổng 2 mới được phép tạo worktree/branch, code local và test. Migration production, Production deployment, domain và thanh toán thật vẫn là các phê duyệt riêng.

