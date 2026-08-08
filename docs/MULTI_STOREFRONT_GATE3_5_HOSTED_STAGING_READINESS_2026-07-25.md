# Cổng 3.5 — Hosted Staging Readiness

Ngày: 2026-07-25  
Kết quả: **dừng trước hosted staging** vì chưa có Supabase/PostgreSQL hosted staging an toàn.  
Không chạy migration hosted/production, không tạo fixture hosted, không deploy thêm, không sửa commerce production/LMS/domain/DNS.

## 1. Exact Git lineage

Worktree:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_worktrees\yeubep-storefront`

`git rev-parse HEAD`:

`8c678f439650bfae198009c486f5eb4d7e22d1a6`

`git log --oneline -5`:

```text
8c678f4 docs: report multi-storefront local and preview gates
2a4960a fix: initialize preview fixture without database secrets
d7d4d81 feat: add tenant-isolated multi-storefront preview
cafe21b feat(v2-shop): port restrict-only runtime controller + diagnostics (switch-gated, V1 preserved)
a53d222 fix(security): remove unauthenticated env-var dump in check-auth (P0)
```

Giải thích:

- `d7d4d81684a7dbd18932a65d1ce41b1b3d0bb0dd`: commit tính năng chính; chứa tenant isolation, admin selector, migration/rollback, local/Preview fixture và test.
- `2a4960a71d2aa71431fd1bec004eb8db5e47f979`: thêm fix cần thiết để Preview fixture khởi tạo Supabase client mà không cần database secret.
- `8c678f439650bfae198009c486f5eb4d7e22d1a6`: chỉ thêm báo cáo `MULTI_STOREFRONT_GATE2_GATE3_PREVIEW_REPORT_2026-07-25.md`.

Vì vậy:

- Commit chứa toàn bộ application chạy được trên Preview fixture: `2a4960a...`.
- Worktree HEAD hiện tại: `8c678f4...`.
- Application tree giữa `2a4960a` và HEAD giống hệt; `git diff` loại file báo cáo trả exit 0.
- Worktree sạch.
- Branch: `feature/yeubep-shop`.
- Remote chưa có branch `feature/yeubep-shop`; `git ls-remote --heads` không trả ref.

## 2. Exact source của Preview cũ

Deployment được duyệt:

- ID: `dpl_2t5sidu6XZ59uK9MUZpBgKvZXirS`
- URL: `https://web-ban-hang-yeubep-shop-d5hj9pm17.vercel.app`
- Target: Preview
- State: Ready

Vercel deployment metadata:

```text
gitCommitSha     = 2a4960a71d2aa71431fd1bec004eb8db5e47f979
gitCommitRef     = feature/yeubep-shop
gitCommitMessage = fix: initialize preview fixture without database secrets
actor            = codex
```

Deployment được tạo lúc 15:11:14, sau commit `2a4960a` lúc 15:11:04 và trước commit báo cáo `8c678f4` lúc 15:15:07.

Kết luận:

- Exact application source của artifact là `2a4960a71d2aa71431fd1bec004eb8db5e47f979`.
- Deployment được upload trực tiếp từ local bằng Vercel CLI.
- Metadata phản ánh local Git HEAD nhưng không phải Git-integrated deployment; branch chưa được push và project chưa kết nối workflow Git tự động.
- Source application khớp HEAD hiện tại; full tree không byte-identical vì HEAD có thêm một file báo cáo không nằm trong artifact.

## 3. Audit Vercel project

Project:

- Name: `web-ban-hang-yeubep-shop`
- ID: `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8`
- Team: `thienha100022653824678-stacks-projects`
- Node: 24.x
- Root: `.`

Sau audit/cleanup:

- Chỉ còn một deployment: `dpl_2t5sidu6XZ59uK9MUZpBgKvZXirS`.
- Preview cũ không được duyệt `dpl_ESgod5DwmuaLCRVT9nrKA64hgw9h` đã bị xóa; có thể phục hồi bằng deploy commit `d7d4d81`.
- Artifact nhầm production `dpl_EgjL8uLNTGz1frZdDorRzFm1FLuU` trả `Can't find deployment`, xác nhận đã bị xóa.
- Production environment của project mới không có environment variable.
- Preview environment chỉ có các tên đã duyệt; không in value:
  - `SALES_SITE`
  - `PUBLIC_SITE_URL`
  - `COMMERCE_DATA_MODE`
  - `EXTERNAL_SYNC_MODE`
  - `ADMIN_PASSWORD`
- Không có custom domain.
- Không có alias project mới trong alias inventory.
- `yeubep.shop` vẫn alias project commerce cũ.
- Deployment Protection hoạt động: truy cập không có bypass trả 302 tới Vercel SSO.
- Không có deployment mới tự động sau báo cáo.

Project gần tên nhưng không bị dùng nhầm:

- `web-ban-hang-yeubep-shop`: storefront mới.
- `yeubep-shop`: Portal project cũ, độc lập.
- `web-ban-hang-chinh-thuc`: commerce production cũ.

## 4. Tìm hosted staging — read-only

Đã kiểm tra:

- toàn bộ `.env*` và `supabase/config.toml` trong workspace;
- Vercel Preview/Production env metadata;
- biến môi trường process liên quan Supabase/Postgres/database;
- Supabase CLI config/telemetry/traces dưới `C:\Users\gaomi\.supabase`;
- project refs xuất hiện trong source/handover.

Project ref duy nhất tìm thấy:

`aqozjkfwzmyfunqvcyjv`

Đây là Supabase commerce production bị owner cấm ghi.

Không tìm thấy bằng chứng về:

- Supabase staging project hiện hữu;
- Supabase database branch;
- hosted PostgreSQL test;
- database test do owner tạo;
- credential Supabase Management API/CLI cho project staging khác.

Không thể xác nhận tên, ref, cost, loại dữ liệu hoặc quyền cleanup cho bất kỳ hosted staging nào vì không có môi trường đó trong phạm vi truy cập hiện tại.

## 5. Quyết định dừng

Theo điều kiện Cổng 3.5:

- Không tự tạo Supabase project/branch có thể phát sinh phí.
- Không dùng production `aqozjkfwzmyfunqvcyjv` tạm thời.
- Không chạy migration hosted.
- Không tạo course/order hosted.
- Không đổi Preview hiện tại sang production database.
- Không tạo hosted-staging Preview mới.

Các phần chưa thể thực hiện cho tới khi có staging:

- schema/count snapshot hosted;
- migration chạy hai lần trên hosted PostgreSQL;
- hosted rollback cycle;
- hosted course/order fixtures;
- hosted read-after-write;
- concurrent idempotency trên hosted database;
- hosted admin/order integration;
- CORS/security/UI test với hosted data;
- exact hosted-staging deployment ID/URL.

## 6. Production/domain evidence

Read-only probes sau audit:

| Endpoint | Kết quả |
|---|---|
| `https://shop.yeunauan.live/` | 200 |
| course `thitxiennuongchaungoc` | 200 |
| `https://shop.yeunauan.live/admin.html` | 200 |
| `https://yeubep.shop/` | 200, project cũ |
| `https://www.yeubep.shop/` | redirect về apex |
| `https://www.daubepnho.store/` | 200 |

DNS read-only:

- apex A vẫn `216.198.79.1`;
- `www` vẫn theo Vercel CNAME đã ghi trong baseline;
- `_vercel.yeubep.shop` TXT vẫn hiện diện;
- không thao tác TXT, SPF, MX, nameserver hoặc domain ownership/assignment.

Không có production database write, commerce deployment, LMS change hoặc enrollment thật.

## 7. Thông tin owner cần cung cấp/phê duyệt

Để tiếp tục Cổng 3.5, cần một Supabase hosted staging/test:

- project ref khác `aqozjkfwzmyfunqvcyjv`;
- xác nhận là staging/test và được phép tạo/xóa fixture;
- Supabase URL;
- server-side service-role key hoặc database migration credential;
- xác nhận chi phí/plan đã được owner chấp thuận;
- xác nhận có thể cleanup toàn bộ dữ liệu test;
- không chứa dữ liệu khách hàng/production.

Secret phải được cung cấp qua Vercel Preview environment hoặc kênh secret phù hợp, không gửi trong chat/report/source.

Sau khi có staging, bước tiếp theo mới là schema snapshot → migration twice → constraints/indexes → fixtures → hosted Preview riêng → integration/security/UI tests → rollback clone/cycle → báo cáo, rồi tiếp tục dừng trước Production/domain.
