# Báo cáo Cổng 4B — triển khai multi-storefront cho commerce cũ

Ngày: 2026-07-25  
Múi giờ: Asia/Saigon (UTC+7)

## Kết luận

Cổng 4B đạt.

- Commerce cũ đã chạy code multi-storefront với tenant deployment `yeunauan`.
- Legacy `sales_site IS NULL` tiếp tục được hiểu là `yeunauan`.
- P0 `check-auth` đã được harden và test.
- Exact feature commit đã push remote.
- Canary Preview đạt trước khi promote.
- Exact canary artifact đã được promote sang Production project cũ.
- Không rollback.
- Không deploy Production project yeubep mới.
- Không thay DNS/TXT, ownership hoặc project assignment của domain.
- Không sửa LMS, Portal hoặc schema.
- Không backfill và không tạo course/order production.

## Source

- Repository: `thienha100022653824678-stack/web-ban-hang-chinh-thuc`
- Worktree:
  `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_worktrees\yeubep-storefront`
- Branch: `feature/yeubep-shop`
- Baseline đầu Cổng 4B:
  `8c678f439650bfae198009c486f5eb4d7e22d1a6`
- Exact commit Production mới:
  `965c9736eca5e4dcf7408602ec47c7539cb088d5`
- Remote branch:
  `origin/feature/yeubep-shop`
- Local HEAD và remote HEAD khớp.
- Worktree sạch.

Rollback giữ nguyên:

- Commit: `cafe21bbe55af86bfb8ac2ebe9155ded849452e8`
- Deployment: `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`

## P0 check-auth

Rà soát exact lineage cho thấy nhánh GET leak đã bị loại từ trước trong commit `cafe21b`. Cổng 4B harden thêm:

- Chỉ POST mới kiểm tra mật khẩu.
- GET/PUT và mọi query/header/cookie debug trả 405.
- Response thành công chỉ là:
  `{"authenticated":true}`
- Response thất bại/không đúng method chỉ là:
  `{"authenticated":false}`
- Không trả message cấu hình, tên secret, prefix/suffix/length hay env value.
- Không có request-controlled debug mode.
- `admin.html` và `orders.html` đã chuyển sang contract mới.

File thay đổi riêng cho hardening:

- `api/check-auth.js`
- `admin.html`
- `orders.html`
- `tests/check-auth.test.mjs`

Security scan production source:

- Private key pattern: 0.
- Supabase PAT/JWT pattern: 0.
- Legacy `extract_env_vars_now` ngoài test/docs: 0.
- Không có `.env.local` hoặc `.env.production` trong artifact.
- Artifact chỉ có tracked `.env.example`.

## Kiểm thử local

- `npm ci`: thành công.
- Audit: 0 vulnerability.
- Security + tenant + migration target: 16/16 pass.
- Full suite: 50/50 pass.
- JS `node --check`: pass.
- Inline scripts của `index.html`, `admin.html`, `orders.html`: pass.
- `git diff --check`: pass.
- Migration PGlite chạy hai lần và rollback: pass.
- Tenant isolation/legacy default/idempotency/admin selector/approve-all/LMS payload: pass.

## Exact artifact

Source package được tạo bằng `git archive` từ exact commit `965c973`.

- Package local:
  `C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_artifacts\gate4b-yeunauan-canary-965c973`
- 39 tracked files.
- Không đóng gói local secret/env.
- Runtime tenant: `SALES_SITE=yeunauan`.
- `COMMERCE_DATA_MODE=supabase`.
- `PUBLIC_SITE_URL=https://shop.yeunauan.live`.
- Các secret production được truyền server-side từ local env hiện hữu, không in ra log/report.

## Canary Preview

Auto Preview từ Git không có branch-scoped Supabase env nên `/api/config` trả 500; artifact này không được promote:

- Deployment: `dpl_Dd5zL8H6C5YrYynCwBRNuKQUGUjX`

Canary hợp lệ:

- Project: `web-ban-hang-chinh-thuc`
- Project ID: `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D`
- Deployment ID: `dpl_6riKJfp16Fk4C6hqencfEjpHdPRE`
- URL: `https://web-ban-hang-chinh-thuc-pu4sfh7ss.vercel.app`
- Target: Preview
- Status: READY
- Deployment Protection: hoạt động; smoke dùng Vercel protection bypass.

Canary read-only:

- `/`: 200
- Course mẫu: 200
- `/admin.html`: 200
- `/api/config?course=thitxiennuongchaungoc`: 200
- `check-auth` GET debug: 405, exact minimal, không secret.
- `check-auth` POST đúng mật khẩu: 200, một field `authenticated`.
- Courses admin API: 7 row.
- 7/7 course effective tenant `yeunauan`.
- Orders admin API: 28 row.
- Không gọi register/upload/approve/update.
- Không tạo order/course.
- Không gọi LMS sync.

## Production

Promote exact canary tạo:

- Production deployment:
  `dpl_6dpjgWJoyMukoTWxK5fVDXccWbRQ`
- URL:
  `https://web-ban-hang-chinh-thuc-edow5x466.vercel.app`
- Status: READY
- Source: exact canary artifact của commit `965c973`.

Alias `shop.yeunauan.live` đang phục vụ deployment mới.

Production smoke:

- `https://shop.yeunauan.live`: 200
- Course `thitxiennuongchaungoc`: 200
- `/admin.html`: 200
- Public config: 200
- Tenant override qua query/header: bị bỏ qua; response hash giữ nguyên.
- Check-auth GET/debug: 405 + exact `authenticated:false`.
- Check-auth POST đúng password: 200 + exact `authenticated:true`.
- Courses API: 7, effective `yeunauan` 7/7.
- Orders API: 28.
- `https://www.daubepnho.store`: 200.

## Database sau Production

Supabase:

- Ref: `aqozjkfwzmyfunqvcyjv`
- Status: `ACTIVE_HEALTHY`
- Version: `17.6.1.127`

Read-only verification lúc 19:36:05 UTC+7:

- Courses: 7.
- Orders: 28.
- Site config: 73.
- Legacy course NULL: 7.
- Legacy order NULL: 28.
- Order có source/new fields non-NULL: 0.
- Cloudinary proof URLs: 28.
- Multi-store columns: 5.
- Constraints: 2.
- Indexes: 3.

Không có production data write trong Cổng 4B.

## Domain

Không thực hiện domain/DNS/TXT operation.

Records vẫn là:

- Apex A: `216.198.79.1`
- `www` CNAME: `db4901082264508b.vercel-dns-017.com`
- `_vercel` TXT:
  `vc-domain-verify=yeubep.shop,a18915f107c394a7536d`
- `www.yeubep.shop`: HTTP 307 về apex.

`yeubep.shop` vẫn thuộc project commerce cũ như trước Cổng 4B. Khi promote Production project cũ, alias hiện hữu của project tự theo deployment Production mới; không có thao tác add/remove/move domain, không đổi ownership và không gắn vào project `web-ban-hang-yeubep-shop`.

## Rollback

Không kích hoạt rollback vì:

- Production READY.
- Shop/course/admin/API đều hoạt động.
- Row counts không đổi.
- Không mutation legacy data.
- LMS 200.
- Check-auth security đạt.

Nếu cần rollback code:

Promote exact artifact:

`dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2`

Không cần rollback schema hoặc restore JSON.

## Việc chưa thực hiện

- Không deploy/promote Production `web-ban-hang-yeubep-shop`.
- Không tạo course/order yeubep production.
- Không Move ownership.
- Không chỉnh DNS/TXT.
- Không gắn yeubep vào project mới.
- Không sửa LMS/Portal.
- Không backfill legacy.
- Không đổi schema ngoài Cổng 4A.

Hệ thống dừng tại Cổng 4B và chờ phê duyệt bước tiếp theo.
