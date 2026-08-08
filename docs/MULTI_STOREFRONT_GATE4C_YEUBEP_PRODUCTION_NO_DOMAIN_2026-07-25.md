# Báo cáo Cổng 4C — Production storefront `yeubep` chưa gắn domain

Thời điểm hoàn tất kiểm tra: **2026-07-25 20:02:20 +07:00**

## 1. Kết luận

Production artifact của project mới đã deploy thành công và toàn bộ kiểm tra trực tiếp trên artifact đều đạt. Tenant `yeubep` không đọc được course legacy/`yeunauan`, không có secret bị lộ và database không phát sinh bất kỳ thay đổi nào.

Cổng 4C **chưa được kết luận đạt hoàn toàn** vì public API của project commerce cũ hiện trả HTTP 500 với lỗi `WEBSITE BÁN HÀNG không hợp lệ`. Trang tĩnh của shop cũ, course URL, admin và LMS vẫn HTTP 200; deployment/alias cũ không đổi. Không sửa project cũ trong Cổng 4C vì phạm vi chỉ cho phép probe read-only.

## 2. Source và artifact

- Repository: `thienha100022653824678-stack/web-ban-hang-chinh-thuc`
- Branch: `feature/yeubep-shop`
- Local HEAD: `965c9736eca5e4dcf7408602ec47c7539cb088d5`
- Remote HEAD: `origin/feature/yeubep-shop` = cùng exact SHA.
- Exact commit là ancestor của remote branch.
- Worktree sạch trước và sau kiểm thử.
- Artifact được tạo lại bằng `git archive` trực tiếp từ exact SHA.
- Artifact ZIP: `_local_artifacts/gate4c-yeubep-production-965c973.zip`
- SHA-256 artifact: `1DE9E37F1A4637C8D37F0E82EF0D06E0CE54513865082681B80F926EA19BA4FC`
- Artifact không chứa `.env.local`, `.env.production` hoặc secret thật.
- Deployment được tạo trực tiếp từ local exact artifact nên `gitSource=null`; metadata bất biến ghi:
  - `gitCommitSha=965c9736eca5e4dcf7408602ec47c7539cb088d5`
  - `gitBranch=feature/yeubep-shop`
  - `gate=4C`

## 3. Test trước deploy

- `npm ci`: đạt; 0 vulnerability.
- Full test: **50/50 pass**.
- Security/tenant/migration target: **16/16 pass**.
- `git diff --check`: đạt.
- Inline scripts:
  - `index.html`: 1 script hợp lệ.
  - `admin.html`: 1 script hợp lệ.
  - `orders.html`: 1 script hợp lệ.
- `node --check`: **19/19 file** hợp lệ.
- Secret scan tracked source: **0 secret thật**.
- `.env.local` chỉ chứa `VERCEL_OIDC_TOKEN`, bị Git ignore và không có trong artifact.
- Marker tấn công `extract_env_vars_now` chỉ tồn tại trong test bảo mật, không tồn tại trong code runtime.

## 4. Production environment

Project: `web-ban-hang-yeubep-shop`  
Project ID: `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8`

Các tên biến sau được cấu hình **chỉ trong Production scope**, dạng encrypted/sensitive:

- `SALES_SITE`
- `PUBLIC_SITE_URL`
- `COMMERCE_DATA_MODE`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSWORD`
- `ADMIN_EMAILS`
- `SYSTEM1_URL`
- `SYSTEM3_URL`
- `INTERNAL_SYNC_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Giá trị cấu hình không được in, log hoặc đưa vào source.

`EXTERNAL_SYNC_MODE` được để unset. Code chỉ dry-run khi giá trị bằng chính xác `dry-run`; giữ unset bảo toàn luồng sync production sau khi hệ thống được phép mở bán. Cổng 4C không gọi endpoint ghi nên không phát sinh sync mutation.

## 5. Deployment Production mới

- Project ID: `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8`
- Deployment ID: `dpl_DKkAsb3FttvGXzAnyt2AeUc128nm`
- Deployment URL: `https://web-ban-hang-yeubep-shop-ro4bj0v4i.vercel.app`
- Project `.vercel.app`: `https://web-ban-hang-yeubep-shop.vercel.app`
- State: `READY`
- Target: `production`
- Node.js: `24.x`
- Deploy dùng `--skip-domain`.
- Alias duy nhất của artifact là `.vercel.app` mặc định.
- Project domain duy nhất là `web-ban-hang-yeubep-shop.vercel.app`.
- Không có `yeubep.shop` hoặc `www.yeubep.shop` trên project mới.
- Deployment Protection vẫn hoạt động: request ẩn danh tới URL artifact trả 401; kiểm thử ứng dụng dùng Vercel protection bypass có xác thực.

## 6. Smoke test artifact

### Static

- `/`: 200.
- `/admin.html`: 200.
- `/orders.html`: 200.
- Actual production secret value hits trong HTML: 0.
- Mixed network request dùng HTTP: 0.
- Không gọi upload, register, approve, revoke hoặc resync.

### Tenant isolation

Các slug legacy sau đều trả 404:

- `thitxiennuongchaungoc`
- `banhmi4k`
- `puddingnama`

Các nỗ lực override sau vẫn trả 404:

- query `sales_site=yeunauan`;
- header `X-Sales-Site`;
- header `X-Tenant`;
- giả `X-Forwarded-Host`.

### `check-auth`

- GET thường: 405, exact body `{"authenticated":false}`.
- `?debug=true`: 405, exact minimal body.
- `?leak=extract_env_vars_now` kèm debug header/cookie: 405, exact minimal body.
- PUT: 405, exact minimal body.
- POST sai mật khẩu: 401, exact minimal body.
- Secret value hits trong mọi response: 0.
- `/api/courses` không auth: 401.
- `/api/orders` không auth: 401.
- Không đọc hoặc sử dụng đúng `ADMIN_PASSWORD` để test.

## 7. Database trước/sau

Supabase production: `aqozjkfwzmyfunqvcyjv`, trạng thái `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.127`.

| Kiểm tra | Trước | Sau |
|---|---:|---:|
| courses | 7 | 7 |
| orders | 28 | 28 |
| site_config | 73 | 73 |
| course legacy NULL | 7 | 7 |
| order legacy NULL | 28 | 28 |
| course yeubep | 0 | 0 |
| order yeubep | 0 | 0 |
| idempotency_key non-NULL | 0 | 0 |
| price_snapshot non-NULL | 0 | 0 |
| student_enrollments | 20 | 20 |
| lessons | 39 | 39 |
| Cloudinary URL references | 28 | 28 |

Fingerprint trước/sau khớp tuyệt đối:

- courses: `e8d7a448a3872945e3e40b2d6d0886e7`
- orders: `264493a639cd89dd232b657e42bb0bb8`
- site_config: `9ea2529ac72e2916eafad236cf2011f5`
- student_enrollments: `2a2e9078cb26eeccd46b477a3749face`

Kết luận: không tạo/sửa/xóa course, order, enrollment hoặc cấu hình; không upload Cloudinary; không có sync mutation.

## 8. Project cũ và LMS

Project cũ vẫn resolve tới:

- Deployment: `dpl_6dpjgWJoyMukoTWxK5fVDXccWbRQ`
- State: `READY`
- Alias giữ nguyên:
  - `shop.yeunauan.live`
  - `yeubep.shop`
  - các alias `.vercel.app` cũ.

Probe:

- `https://shop.yeunauan.live`: 200.
- Course URL mẫu: 200.
- `/admin.html`: 200.
- `https://www.daubepnho.store`: 200.
- `https://yeubep.shop`: 200 và vẫn resolve tới deployment cũ.
- `https://www.yeubep.shop`: 307 về apex.

Vấn đề phát hiện:

- `GET https://shop.yeunauan.live/api/config?course=thitxiennuongchaungoc`: 500.
- Response an toàn: `{"error":"WEBSITE BÁN HÀNG không hợp lệ"}`.
- Cùng lỗi xuất hiện khi thử các tên query thay thế.
- Dấu hiệu phù hợp với Production project cũ thiếu/không nhận `SALES_SITE=yeunauan`; cần một cổng sửa riêng được owner phê duyệt. Không thay env/deployment project cũ trong Cổng 4C.

## 9. Domain và DNS read-only

- New project không có custom domain.
- Apex `yeubep.shop` vẫn assigned vào project cũ.
- Domain-level ownership vẫn theo baseline Dashboard của owner tại team `thienha336501903-a11ys-projects`; credential CLI hiện tại không có quyền team nguồn để tái đọc record này.
- Apex A: `216.198.79.1`.
- `www` CNAME: `db4901082264508b.vercel-dns-017.com`.
- `_vercel` TXT: vẫn tồn tại, 1 record.
- SPF: vẫn tồn tại.
- `www`: vẫn 307 về `https://yeubep.shop/`.
- Không Move/remove/claim domain.
- Không thêm/xóa TXT.
- Không chỉnh DNS, MX, SPF, DKIM hoặc DMARC.

## 10. Rollback và việc chưa thực hiện

- Không rollback deployment mới: artifact mới READY và các kiểm tra riêng của project mới đều đạt.
- Không tác động project cũ hoặc rollback Supabase schema.
- Không deploy/promote project cũ.
- Không gắn/chuyển domain.
- Không merge branch.
- Không tạo course/order `yeubep`.
- Không mở checkout.
- Không sửa LMS hoặc Portal.

## 11. Việc còn lại

1. Phê duyệt một thao tác riêng để kiểm tra/cấu hình `SALES_SITE=yeunauan` cho Production project cũ, rồi probe lại public API.
2. Chỉ sau khi public API project cũ trở lại 200 mới kết luận đầy đủ điều kiện regression của Cổng 4C.
3. Domain, tạo course `yeubep`, checkout thật và branch merge vẫn phải chờ phê duyệt riêng.

