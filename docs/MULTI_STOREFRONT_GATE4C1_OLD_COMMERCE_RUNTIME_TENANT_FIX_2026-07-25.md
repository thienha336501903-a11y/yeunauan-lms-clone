# Báo cáo Cổng 4C.1 — Sửa Production runtime tenant commerce cũ

Thời điểm hoàn tất: **2026-07-25 20:14:23 +07:00**

## 1. Kết luận

Cổng 4C.1 đạt toàn bộ điều kiện.

`GET https://shop.yeunauan.live/api/config?course=thitxiennuongchaungoc` đã được khôi phục từ HTTP 500 về HTTP 200. Không sửa application code, schema hoặc dữ liệu.

## 2. Nguyên nhân chính xác

Trước thao tác, project `web-ban-hang-chinh-thuc` không có ba biến sau trong bất kỳ scope Production, Preview hoặc Development:

- `SALES_SITE`
- `PUBLIC_SITE_URL`
- `COMMERCE_DATA_MODE`

Exact application commit `965c9736...` dùng `SALES_SITE` server-side và fail-closed nếu giá trị thiếu hoặc ngoài allowlist. Deployment cũ vì vậy trả:

```json
{"error":"WEBSITE BÁN HÀNG không hợp lệ"}
```

Không phát hiện biến trùng scope, giá trị sai chính tả hoặc biến chỉ tồn tại ở Preview; nguyên nhân là ba biến chưa tồn tại hoàn toàn. Các secret production cũ vẫn tồn tại dạng encrypted và không bị thay đổi.

## 3. Environment đã cấu hình

Chỉ thêm ba tên biến sau vào **Production scope** của project cũ:

- `SALES_SITE`
- `PUBLIC_SITE_URL`
- `COMMERCE_DATA_MODE`

Giá trị runtime mục tiêu đã được đặt đúng theo phê duyệt:

- tenant nội bộ: `yeunauan`;
- public base URL: `https://shop.yeunauan.live`;
- data mode: `supabase`.

Không thay:

- Supabase URL/service role;
- admin password/email allowlist;
- internal sync secret;
- Cloudinary;
- Google;
- system URLs.

Không thêm `EXTERNAL_SYNC_MODE`.

## 4. Source và deployment

- Repository: `thienha100022653824678-stack/web-ban-hang-chinh-thuc`
- Branch: `feature/yeubep-shop`
- Local worktree HEAD: `965c9736eca5e4dcf7408602ec47c7539cb088d5`
- Remote branch HEAD: cùng exact SHA.
- Worktree: sạch.
- Artifact: tạo bằng `git archive` từ exact commit.
- Artifact SHA-256: `1DE9E37F1A4637C8D37F0E82EF0D06E0CE54513865082681B80F926EA19BA4FC`
- Artifact không có `.env.local`/`.env.production`.

Deployment:

- Project: `web-ban-hang-chinh-thuc`
- Project ID: `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D`
- Deployment ID mới: `dpl_63ApSdKzoVYBH2GxFgagcjYx2Ant`
- Artifact URL: `https://web-ban-hang-chinh-thuc-ajoe52bk6.vercel.app`
- Target: `production`
- State: `READY`
- Source metadata:
  - `gitCommitSha=965c9736eca5e4dcf7408602ec47c7539cb088d5`
  - `gitBranch=feature/yeubep-shop`
  - `gate=4C.1`
- `gitSource=null` vì deploy trực tiếp exact local archive, không phải Git integration build.

Alias sau deploy:

- `shop.yeunauan.live`
- `yeubep.shop`
- `web-ban-hang-chinh-thuc-alpha.vercel.app`
- `web-ban-hang-chinh-thuc-thienha100022653824678-stacks-projects.vercel.app`

Không attach hoặc detach domain.

## 5. Public API trước/sau

| Probe | Trước | Sau |
|---|---:|---:|
| `thitxiennuongchaungoc` | 500 | 200 |
| `banhmi4k` | chưa đạt do lỗi tenant chung | 200 |
| `puddingnama` | chưa đạt do lỗi tenant chung | 200 |
| slug không tồn tại | lỗi tenant 500 | 404 |

Đã kiểm tra toàn bộ 7 course legacy `sales_site IS NULL`; cả 7 đều HTTP 200 và contract `course` khớp slug:

- `banhmi4k`
- `bonglancuonnhatban`
- `puddingnama`
- `banhmicamsicula`
- `thitxiennuongchaungoc`
- `heomoixaolan`
- `nguyencammongtimHT`

Course mẫu trả đủ poster, tên/mô tả cấu hình, giá, thông tin ngân hàng và QR. Response không chứa secret.

## 6. Tenant isolation ngược

Course mẫu vẫn trả đúng tenant `yeunauan` khi client thử:

- `?sales_site=yeubep`;
- malformed `%D7%A1ales_site=yeubep`;
- `X-Sales-Site: yeubep`;
- `X-Tenant: yeubep`;
- `X-Forwarded-Host: yeubep.shop`.

Backend không tin tenant/host từ query hoặc header.

## 7. Static và bảo mật

- `/`: 200.
- `/?course=thitxiennuongchaungoc`: 200.
- `/admin.html`: 200.
- `/orders.html`: 200.
- Actual secret value hits trong HTML: 0.
- Mixed HTTP network request: 0.
- Không thực hiện authenticated write.

`check-auth`:

- GET: 405, exact `{"authenticated":false}`.
- GET `?debug=true`: 405, minimal body.
- GET leak marker kèm debug header/cookie: 405, minimal body.
- PUT: 405, minimal body.
- POST sai mật khẩu: 401, minimal body.
- Secret value hits: 0.

## 8. Database trước/sau

Supabase production: `aqozjkfwzmyfunqvcyjv`.

| Kiểm tra | Trước | Sau |
|---|---:|---:|
| courses | 7 | 7 |
| orders | 28 | 28 |
| site_config | 73 | 73 |
| student_enrollments | 20 | 20 |
| course legacy NULL | 7 | 7 |
| order legacy NULL | 28 | 28 |
| course yeubep | 0 | 0 |
| order yeubep | 0 | 0 |
| idempotency key non-NULL | 0 | 0 |
| price snapshot non-NULL | 0 | 0 |
| Cloudinary URL references | 28 | 28 |

Fingerprint trước/sau khớp:

- courses: `e8d7a448a3872945e3e40b2d6d0886e7`
- orders: `264493a639cd89dd232b657e42bb0bb8`
- site_config: `9ea2529ac72e2916eafad236cf2011f5`
- enrollments: `2a2e9078cb26eeccd46b477a3749face`

Kết luận: không có database write; Cloudinary linkage nguyên vẹn.

## 9. Project mới, LMS và domain

Project mới không thay đổi:

- Project: `web-ban-hang-yeubep-shop`
- Project ID: `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8`
- Deployment: `dpl_DKkAsb3FttvGXzAnyt2AeUc128nm`
- State: `READY`
- Custom domain: không có; chỉ `web-ban-hang-yeubep-shop.vercel.app`.
- Production env metadata/timestamps không thay đổi trong Cổng 4C.1.
- Tenant `yeubep` không bị sao chép thành `yeunauan`.

LMS:

- `https://www.daubepnho.store`: 200.
- Không sửa deployment, `/api/sync` hoặc enrollment.

Domain/DNS:

- `shop.yeunauan.live` trỏ deployment mới project cũ.
- `yeubep.shop` vẫn tạm trỏ cùng project cũ.
- `www.yeubep.shop`: 307 về apex.
- Apex A: `216.198.79.1`.
- `www` CNAME: `db4901082264508b.vercel-dns-017.com`.
- `_vercel` TXT: vẫn tồn tại, 1 record.
- SPF: vẫn tồn tại.
- MX và DMARC hiện không có record trả về, giống baseline kiểm tra.
- Không thực hiện DNS/domain/TXT write.
- Domain-level ownership giữ nguyên theo baseline Dashboard owner; credential CLI hiện tại vẫn không có quyền team nguồn để đọc trực tiếp ownership record.

## 10. Rollback

Không rollback.

Deployment mới READY, public API và toàn bộ regression probe đạt; database không thay đổi. Rollback artifact `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2` vẫn được giữ nguyên nhưng không cần promote.

## 11. Vấn đề còn lại

Không còn lỗi runtime tenant ở website commerce cũ.

Các việc sau vẫn chưa thực hiện và cần phê duyệt riêng:

- chuyển domain/ownership;
- đổi assignment `yeubep.shop`;
- tạo course/order `yeubep`;
- mở checkout;
- merge branch;
- sửa LMS/Portal.

