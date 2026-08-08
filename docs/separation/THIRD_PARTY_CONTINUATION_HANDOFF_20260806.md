# BÁO CÁO CHUYỂN GIAO TIẾP TỤC TÁCH HAI HỆ THỐNG

**Ngày lập:** 06/08/2026, Asia/Ho_Chi_Minh  
**Ngôn ngữ vận hành:** Tiếng Việt  
**Workspace chính:**
`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\web-lms-chinh-thuc`  
**Trạng thái bàn giao:** `STOPPED — DATA BOUNDARY NOT PROVEN`  
**Production mutation trong đợt chuẩn bị gần nhất:** Không có

---

## 1. Mục đích tài liệu

Tài liệu này là điểm vào duy nhất cho đơn vị tiếp nhận công việc tách kiến trúc
hiện tại thành hai hệ thống độc lập:

1. **Hệ thống 1 — Nội dung / Trả bài**, đang phục vụ học viên thật và phải được
   bảo vệ tuyệt đối.
2. **Hệ thống 2 — Commerce / LMS**, sẽ có một Portal Learning mới, database,
   session và secret độc lập.

Người tiếp nhận không cần suy luận từ lịch sử chat. Phải bắt đầu tại blocker và
runbook trong tài liệu này, đồng thời dùng các file evidence được dẫn link.

Tài liệu này **không phải approval cutover** và không cấp quyền thay đổi
Production.

---

## 2. Tóm tắt điều hành

### 2.1 Điều đã hoàn thành

- Audit read-only năm URL và bốn Vercel Production project.
- Xác minh exact current domain → project → deployment routing.
- Xác minh cả năm path trả HTTP 200 và bốn deployment đều READY.
- Lập baseline bảo vệ Hệ thống 1.
- Kiểm kê env **names/scopes** mà không đọc raw values.
- Xác minh Supabase Management account hiện tại chỉ nhìn thấy hai project
  `aqoz...` và `ssby...`.
- Phân loại hai Portal project cũ là tài sản cô lập, không thuộc routing live.
- Viết kiến trúc target, secret-purpose matrix, backup gate, rollback và owner
  checklist.
- Xóa các OIDC env file tạm; secret scan không phát hiện credential.

### 2.2 Điểm dừng hiện tại

Owner đã xác nhận exact Portal Supabase project trên Supabase Dashboard là:
`crphwjizolsgghapyjjv` (chứa các bảng `posts`, `post_views`, `student_enrollments`, `gated_posts_access`).

Đồng thời đã xác minh runtime System 1 live:
- `admin.yeunauan.live` (deployment `dpl_BEjH3DUJ1kHLLqevmGypXbmjyuSX` — READY / HTTP 200 tại `/login`);
- `www.yeunauan.live/post/8d4844be-b2f2-4c4e-b086-67dd5211abb2` (deployment `dpl_92XTh25gr74NznTbr6vJZDfMo5Mq` — READY / HTTP 200).

Tuy nhiên, trong môi trường CLI hiện tại, API key (service-role / anon key) của project `crphwjizolsgghapyjjv` chưa có sẵn để script tự động thực hiện query REST API (schema/table count) và trích xuất fresh encrypted backup.

Vì vậy:
- chưa thể tự động đọc schema, functions, policies và table row counts qua REST API;
- chưa thể tạo fresh encrypted backup và kiểm tra decrypt/readback cho DB `crphwjizolsgghapyjjv`;
- dữ liệu Hệ thống 1 được giữ an toàn tuyệt đối 100% (chỉ READ-ONLY, 0 mutation, 0 deploy, 0 env change).

### 2.3 Quyết định fail-closed

Không tiếp tục Phase tạo tài sản trước khi Portal DB identity + backup PASS.

---

## 3. Mục tiêu kiến trúc đã được owner duyệt

### 3.1 Hệ thống 1 — Nội dung / Trả bài

```text
admin.yeunauan.live
        |
        v
www.yeunauan.live/post/<id>
        |
        +--> Portal DB riêng Hệ thống 1
        +--> Auth/session riêng Hệ thống 1
```

Hệ thống 1 không được phụ thuộc Commerce/LMS Hệ thống 2 sau khi tách, trừ một
integration contract mới được owner duyệt riêng.

### 3.2 Hệ thống 2 — Commerce / LMS

```text
shop.yeunauan.live/admin.html
shop.yeunauan.live/orders.html
        |
        v
portal-learning.yeunauan.live
        |
        +--> Portal DB riêng Hệ thống 2
        +--> Auth/session riêng Hệ thống 2
        |
        v
www.daubepnho.store
        |
        +--> LMS DB hiện tại
        +--> LMS Admin
        +--> Google Drive modules
```

Mermaid target:
[FULL_SYSTEM_SEPARATION_TARGET_20260806.mmd](FULL_SYSTEM_SEPARATION_TARGET_20260806.mmd).

---

## 4. Quy tắc phân loại bằng chứng

Mọi kết luận tiếp theo phải dùng đúng bốn nhãn:

| Nhãn | Ý nghĩa |
|---|---|
| `ACTIVE PRODUCTION` | Domain và deployment live đã được control-plane/runtime xác minh |
| `STAGING/PREVIEW` | Asset có deployment thử nghiệm nhưng không nhận Production traffic |
| `ISOLATED ASSET` | Asset tồn tại nhưng chưa chứng minh nằm trong luồng chính |
| `UNKNOWN/UNPROVEN` | Thiếu bằng chứng runtime; không được dùng làm đầu vào mutation |

Không được nối hai thành phần chỉ vì source có biến env hoặc tài liệu lịch sử nói
rằng chúng từng kết nối.

---

## 5. BASELINE INVENTORY AUTHORITATIVE

### 5.1 Vercel team

| Thuộc tính | Giá trị |
|---|---|
| Team ID | `team_cAthcmyw4079BDgelX0YjG9i` |
| CLI account tại thời điểm audit | `thienha100022653824678-stack` |
| Vercel CLI | `54.18.2` |

### 5.2 Active Production mapping

| Chức năng | URL | Project | Project ID | Deployment | Trạng thái |
|---|---|---|---|---|---|
| Admin nội dung | `https://admin.yeunauan.live/` | `admin-web-tra-bai` | `prj_dWBdKxCAiXmNHBS8oKDmzWatymKs` | `dpl_BEjH3DUJ1kHLLqevmGypXbmjyuSX` | READY / HTTP 200 |
| Student Portal | `https://www.yeunauan.live/post/<id>` | `student-web` | `prj_paRRXhaTAqF6NnqbZBK6HsZP4zm3` | `dpl_92XTh25gr74NznTbr6vJZDfMo5Mq` | READY / post mẫu 200 |
| Commerce Admin/Orders | `https://shop.yeunauan.live` | `web-ban-hang-chinh-thuc` | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` | `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2` | READY / hai path 200 |
| LMS legacy | `https://www.daubepnho.store` | `web-lms-chinh-thuc` | `prj_TimQqrVhrOLW8y1KI464JBvajwlz` | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` | READY / LMS Admin 200 |

Post canary chỉ đọc:

`https://www.yeunauan.live/post/8d4844be-b2f2-4c4e-b086-67dd5211abb2`

Không mở post bằng automation có thể kích hoạt `post_views`; chỉ dùng HEAD/SSR
read-only khi chạy regression.

### 5.3 Source identities

| Thành phần | Source identity | Ghi chú |
|---|---|---|
| Admin | `041a6dd404f8f5543f2893ced943b236890429ee` | Evidence từ deployed-source audit trước; deployment hiện không đổi |
| Student | `6ea837fadf85e7e94f410e38163d58077a9fd895` | Evidence từ deployed-source audit trước; deployment hiện không đổi |
| Commerce | `cafe21bbe55af86bfb8ac2ebe9155ded849452e8` | Exact restored Production source |
| LMS | source family `044519300131745bf0e99a98ff152dd2c8afcc92` | Exact Git SHA chưa được Vercel metadata chứng minh |

Không tự nâng `source family` của LMS thành exact deployed Git SHA.

### 5.4 Vercel project settings

| Project | Root | Framework | Node |
|---|---|---|---|
| `admin-web-tra-bai` | `admin-web` | Next.js | 24.x |
| `student-web` | `student-web` | Next.js | 24.x |
| `web-ban-hang-chinh-thuc` | `.` | Other/static + serverless APIs | 24.x |
| `web-lms-chinh-thuc` | `.` | Other/static + serverless APIs | 24.x |

### 5.5 Database evidence

| Boundary | Ref | Trạng thái |
|---|---|---|
| Commerce/LMS baseline | `aqozjkfwzmyfunqvcyjv` | MATCH từ restore/current evidence; ACTIVE_HEALTHY |
| LMS Yeubep asset | `ssbyfpigrozumzatyqhf` | ACTIVE_HEALTHY nhưng ngoài target Hệ thống 2 hiện tại |
| Portal DB Hệ thống 1 | candidate lịch sử `crphwjizolsgghapyjjv` | `UNPROVEN`; không visible trong Management account hiện tại |
| Portal DB Hệ thống 2 | chưa tạo | NOT CREATED |

### 5.6 Environment-name inventory

Raw values không được đọc hoặc lưu.

| Project | Names quan trọng đã PRESENT |
|---|---|
| Admin | `NEXT_PUBLIC_SUPABASE_URL`, anon/service-role, `NEXT_PUBLIC_STUDENT_APP_URL`, `INTERNAL_SYNC_SECRET`, LMS Supabase URL/service-role |
| Student | Portal Supabase URL/anon/service-role, LMS Supabase URL/service-role, `SESSION_SECRET`, `INTERNAL_SYNC_SECRET`, `ACCOUNT_EVENT_HASH_SECRET`, `GOOGLE_CLIENT_ID` |
| Commerce | `SYSTEM1_URL`, `SYSTEM3_URL`, Commerce Supabase URL/service-role, `INTERNAL_SYNC_SECRET`, Google/Cloudinary/Admin variables |
| LMS | Supabase URL/service-role, `SESSION_SECRET`, `INTERNAL_SYNC_SECRET`, Google client ID/secret, V2 flags, `SYSTEM1_URL` |

Kết luận pairing của secret/URL vẫn `UNREADABLE_BY_PLATFORM` hoặc `UNPROVEN`.

---

## 6. Tài sản tồn tại nhưng không thuộc live flow đã xác minh

| Project | Project ID | Production URL | Phân loại |
|---|---|---|---|
| `student-portal-yeubep` | `prj_MHZCOD60wqFgyUS44yoO7krqzb9r` | Không có | ISOLATED ASSET |
| `student-portal-yeunauan` | `prj_tzL3Hn1KBlkFuLbaGbm7YCiEdPMd` | Không có | ISOLATED ASSET |

Không được tái sử dụng tự động. Trước khi cân nhắc reuse phải audit:

- exact source commit/artifact;
- env names và runtime identity;
- Supabase ref/service-role boundary;
- session/internal secret isolation;
- alias/domain history;
- cross-LMS routing tests;
- absence of Production data.

Khuyến nghị kiến trúc vẫn là project mới:
`student-portal-learning-yeunauan`.

---

## 7. Backup inventory và gate hiện tại

### 7.1 Backup Commerce/LMS gần nhất

Đường dẫn ngoài Git:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_private_backups\pre-multistore-restore-20260806-095716`

| File | SHA-256 |
|---|---|
| `current-public-data-schema.json.aesgcm` | `38456e5a113a11cddffc5a48a558ca2b288ad9172aa2f07447356fdca014c18f` |
| `current-public-data-schema.key.dpapi` | `15b36f4865a54807db4b467ac8c3f3460bbe94ccfcdd4d76cc0c6928ffbdb83b` |
| `manifest-sanitized.json` | `dc33e120c30e768b7278e23623c7f16b05a6073ead99924cc29672a594cca802` |

Manifest xác nhận:

- ref `aqozjkfwzmyfunqvcyjv`;
- 27 public tables;
- AES-256-GCM;
- key được bảo vệ bằng Windows DPAPI CurrentUser;
- decrypt/readback PASS;
- plaintext retained `false`;
- manifest không chứa PII.

Backup này là evidence và rollback safety cho Commerce/LMS tại thời điểm chụp;
nó không phải fresh pre-mutation backup cho một cutover tương lai.

### 7.2 Backup còn thiếu

Fresh backup Portal DB Hệ thống 1 chưa được tạo vì:

1. Exact current Portal ref chưa proven.
2. Supabase Management account hiện không có project candidate lịch sử.
3. Vercel chỉ trả encrypted env values.
4. Không có credential current/authoritative khác.

### 7.3 Gate tiếp tục

Chỉ chuyển sang tạo asset khi toàn bộ điều kiện sau PASS:

- exact Admin Portal Supabase ref được chứng minh;
- exact Student Portal Supabase ref được chứng minh;
- hai ref được so sánh MATCH/MISMATCH rõ ràng;
- credential có read/backup access đúng project;
- fresh encrypted backup chứa schema, functions, triggers, policies, grants và
  dữ liệu yêu cầu;
- decrypt/readback PASS;
- sanitized counts/checksum manifest PASS;
- plaintext bị xóa;
- Git/secret scan PASS.

Nếu Admin và Student dùng hai DB khác nhau, phải backup cả hai và cập nhật target
architecture; không tiếp tục dựa trên giả định “cùng DB”.

---

## 8. Hệ thống 1 — bảo vệ bắt buộc

### 8.1 Không được thay đổi

- Domain `admin.yeunauan.live`, `www.yeunauan.live`.
- Project/deployment Admin và Student hiện tại.
- Portal schema/data: posts, views, students, enrollments, mappings,
  sessions/tokens, audit/config.
- `NEXT_PUBLIC_STUDENT_APP_URL`.
- Session/internal/hash secrets.
- Google OAuth client/origins đang phục vụ hai domain.
- Source/env/domain của Hệ thống 1 trong giai đoạn xây Hệ thống 2.

### 8.2 Regression read-only sau mỗi mutation asset mới

1. `vercel inspect` hai domain vẫn trả exact known-good deployment IDs.
2. Admin root HTTP 200.
3. Post canary HTTP/SSR 200 và không có not-found marker.
4. Database source counts không giảm ngoài biến động traffic tự nhiên.
5. Schema fingerprint không đổi.
6. Environment-name inventory và salted fingerprint không đổi.
7. OAuth origins cũ không bị xóa.
8. Không bulk invalidate session/token.
9. Không Drive permission mutation.

Nếu một kiểm tra thay đổi ngoài kế hoạch:

`STOPPED — SYSTEM 1 PROTECTION VIOLATION`

Không tự sửa tiếp trước khi xác định nguyên nhân và owner duyệt.

---

## 9. Thiết kế Hệ thống 2 phải triển khai

### 9.1 Portal project mới

Đề xuất:

- Project: `student-portal-learning-yeunauan`.
- Production domain dự kiến: `portal-learning.yeunauan.live`.
- Trước cutover chỉ dùng Vercel Preview URL hoặc staging subdomain.
- Next.js, deployment riêng, project env riêng.
- Fixed server-side identity, ví dụ `PORTAL_SITE=learning-yeunauan`.
- LMS allowlist duy nhất: `www.daubepnho.store`.
- Không fallback `www.yeunauan.live` hoặc LMS khác.
- Không nhận LMS URL/DB ref từ browser, query, body, referrer, Host,
  X-Forwarded-Host, slug, post ID hoặc email.

### 9.2 Portal DB mới

Ưu tiên Supabase project riêng. Không sử dụng:

- Portal DB Hệ thống 1;
- `aqoz...` làm Portal DB;
- `ssby...` làm Portal DB;
- service-role key từ project khác.

DB mới chỉ chứa dữ liệu Portal System 2 tối thiểu:

- identity/profile cần thiết;
- session/handoff state;
- entry-token metadata;
- audit;
- mapping/config đã được owner duyệt.

Không copy mặc định:

- posts/post_views System 1;
- notes/audit lịch sử;
- session/token;
- secrets;
- PII không cần thiết;
- LMS course/enrollment/progress rows.

### 9.3 Required runtime assertions

Portal phải fail closed nếu:

- thiếu fixed identity;
- Portal public origin sai allowlist;
- Portal DB ref không đúng ref của System 2;
- LMS hostname khác `www.daubepnho.store`;
- secret bắt buộc thiếu;
- pairing sai;
- course không tồn tại.

Một deployment chỉ tạo một Portal Supabase admin client và không kết nối Portal
DB Hệ thống 1.

### 9.4 Secret-purpose matrix

| Secret | Purpose | Boundary |
|---|---|---|
| Portal `SESSION_SECRET` mới | Ký session Portal Learning | Chỉ Portal System 2 |
| Commerce → Portal secret mới | Handoff/sync contract | Commerce ↔ Portal Learning |
| Portal → LMS secret mới nếu cần | LMS internal request | Portal Learning ↔ LMS legacy |
| `ACCOUNT_EVENT_HASH_SECRET` mới | Hash event/account | Chỉ Portal System 2 |
| Portal service-role | DB admin server-side | Chỉ Portal DB System 2 |
| OAuth credential/config | Login origin mới | Không thay/xóa origins System 1 |

Không mặc định dùng một secret cho nhiều purpose. Không dùng lại bất kỳ secret
Hệ thống 1 nào.

---

## 10. Trình tự tiếp tục chính xác

### Step 0 — Khôi phục context

Đọc theo thứ tự:

1. File chuyển giao này.
2. [FULL_SYSTEM_SEPARATION_PREPARATION_20260806.md](FULL_SYSTEM_SEPARATION_PREPARATION_20260806.md).
3. [FULL_SYSTEM_SEPARATION_TARGET_20260806.mmd](FULL_SYSTEM_SEPARATION_TARGET_20260806.mmd).
4. [../diagram-current-architecture.md](../diagram-current-architecture.md).
5. [../CURRENT_SYSTEM_HANDOVER_REPORT_20260806.md](../CURRENT_SYSTEM_HANDOVER_REPORT_20260806.md).
6. `task_plan.md`, `findings.md`, `progress.md` tại workspace root.

Không sử dụng report cũ làm nguồn sự thật nếu mâu thuẫn với runtime mới.

### Step 1 — Fresh read-only baseline

- Reinspect bốn Production domains/projects/deployments.
- HEAD/SSR năm URL.
- Verify project/team identity.
- Verify System 1 exact deployments unchanged.
- List env names/scopes, không values.
- List Supabase projects bằng đúng owner account.

Nếu Production state đổi sau 06/08/2026, tạo delta inventory trước khi tiếp tục.

### Step 2 — Giải blocker Portal DB

Owner phải thực hiện một trong:

1. Cấp Management API access cho account đang dùng tới exact Portal project;
   hoặc
2. đăng nhập đúng Supabase organization/account chứa Portal DB;
   hoặc
3. xác nhận ref trong Dashboard và cài credential backup vào Windows Credential
   Manager/local secure store, không gửi qua chat.

Chỉ báo sanitized project ref/name/region/health. Không in key/password.

### Step 3 — Fresh encrypted backup

Tạo ngoài Git/worktree, đề xuất:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_private_backups\full-separation-<timestamp>\`

Cấu trúc:

```text
system1-admin-student/
system2-commerce-lms/
vercel/
oauth-drive/
manifests/
```

System 1 backup tối thiểu:

- schema/columns/constraints/indexes;
- functions/triggers;
- RLS/policies/grants;
- migrations/markers;
- posts/post_views;
- students/enrollments;
- mappings;
- sessions/tokens;
- audit/config liên quan.

System 2 baseline backup:

- fresh schema/data export của Commerce/LMS;
- Drive inventory sanitized;
- Vercel config inventory;
- current deployment/domain/alias rollback identities.

Mã hóa AES-256-GCM hoặc tương đương; key bảo vệ bằng DPAPI/secure keystore;
decrypt/readback bắt buộc; plaintext phải xóa sau verify.

### Step 4 — Create isolated assets

Chỉ sau backup gate PASS:

1. Tạo Supabase Portal DB mới System 2.
2. Tạo Vercel project `student-portal-learning-yeunauan`.
3. Không attach Production domain.
4. Chỉ cấu hình non-sensitive Preview values trước.
5. Owner nhập sensitive values trực tiếp trong Dashboard.
6. Tạo sanitized source archive/branch từ verified baseline.
7. Implement fixed runtime resolver và assertions.

### Step 5 — Staging tests

Dùng synthetic namespace rõ ràng, không PII:

- Portal config positive/negative;
- browser cannot override target;
- wrong secret 401/403;
- cross-secret isolation;
- one DB client only;
- no request to `www.yeunauan.live`;
- course not found fails closed;
- login/logout/session expiry;
- entry-token and handoff;
- IDOR/authorization;
- duplicate/revoke dry-run;
- mobile Safari/WebKit;
- no Drive permission mutation;
- no Production DB mutation.

### Step 6 — System 1 regression

Sau mỗi asset mutation/deployment, chạy checklist mục 8.2. Ghi deployment ID,
timestamp, sanitized counts/checksums và results vào mutation journal.

### Step 7 — Rehearsal và owner checkpoint

Chỉ khi backup, isolation, OAuth staging, fixture integration, System 1
regression và rollback rehearsal đều PASS mới trả:

`READY FOR OWNER REVIEW — SYSTEM 1 PROTECTED, SYSTEM 2 STAGED`

Không cutover. Cutover cần approval riêng.

---

## 11. Test matrix bắt buộc trước owner review

| Nhóm | Điều kiện PASS |
|---|---|
| Build | TypeScript/Next.js Production build PASS |
| Unit/API | Resolver, allowlist, secret purpose, missing env, wrong pairing PASS |
| Integration | Commerce Preview → Portal Preview → LMS safe boundary đúng hostname |
| Isolation | Không read/write Portal DB Hệ thống 1; không fallback/cross-LMS call |
| Security | 401/403 wrong secret; IDOR denied; no browser override; no secret/PII logs |
| Session | Login/logout/expiry/one-device contract theo thiết kế mới |
| Data | Fixture-only; no Production order/student/post/enrollment mutation |
| Drive | Dry-run/mock; no permission/upload/revoke Production |
| Browser | Chromium + WebKit/mobile viewport; login/handoff/navigation |
| Regression | System 1 HTTP/deployment/schema/env fingerprint unchanged |
| Quality | secret scan, `git diff --check`, dependency audit, no new regression |
| Rollback | Exact old deployments exist/READY; restore order documented |

---

## 12. Domain, DNS và OAuth plan

### 12.1 Staging

- Ưu tiên Vercel deployment URL.
- Nếu OAuth yêu cầu stable origin, chuẩn bị
  `staging-portal-learning.yeunauan.live` sau owner DNS action.
- Không dùng `www.yeunauan.live` cho staging.

### 12.2 Production dự kiến

`portal-learning.yeunauan.live` → project Portal Learning mới.

Không attach/alias trong preparation.

### 12.3 OAuth

- Thêm staging origin trước.
- Thêm Production origin chỉ tại cutover checkpoint.
- Không xóa/sửa origins của Admin/Student hiện tại.
- Không thêm redirect URI nếu source dùng Google Identity Services callback
  không redirect; audit source trước.

---

## 13. Rollback anchors và runbook

### 13.1 Known-good artifacts

| Component | Deployment |
|---|---|
| Admin System 1 | `dpl_BEjH3DUJ1kHLLqevmGypXbmjyuSX` |
| Student System 1 | `dpl_92XTh25gr74NznTbr6vJZDfMo5Mq` |
| Commerce | `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2` |
| LMS legacy | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |

### 13.2 Rollback sequence tương lai

1. Freeze approve/revoke.
2. Dừng Portal Learning traffic mới.
3. Promote exact Commerce known-good artifact.
4. Khôi phục prior Commerce Portal/LMS targets bằng exact prior deployment.
5. Không thay Admin/Student System 1 trừ khi chính chúng bị đổi ngoài kế hoạch.
6. Giữ LMS legacy deployment nếu không bị redeploy.
7. Không restore DB nếu chưa chứng minh corruption.
8. Không xóa project/DB mới trong incident.
9. Smoke topology cũ và đối chiếu mutation journal.
10. Owner quyết định cleanup bằng approval riêng.

---

## 14. Approval boundaries

### 14.1 Được làm sau khi owner cấp đúng quyền DB

- read-only inventory;
- encrypted backup/readback;
- local source branch/worktree;
- isolated Preview project/database sau backup PASS;
- fixture-only tests;
- staged deployment không alias;
- documentation và rollback rehearsal.

### 14.2 Cần approval Production riêng

- đổi Commerce Production target;
- attach/promote Production domain;
- DNS mutation;
- OAuth Production mutation;
- Production env mutation;
- secret rotation/pair replacement;
- schema/data migration;
- enrollment/order/Drive permission mutation;
- Production cutover hoặc rollback mutation.

### 14.3 Luôn bị cấm nếu không có phạm vi rõ ràng

- gửi/in raw secret;
- copy/merge toàn Portal DB;
- copy session/token/secret;
- dùng người học/order/post thật làm mutation fixture;
- xóa project/domain/database/course/media;
- suy luận target từ browser/user-controlled input.

---

## 15. Owner action checklist hiện tại

Owner chỉ cần giải quyết blocker đầu tiên:

1. Xác định Supabase organization/project hiện phục vụ
   `admin-web-tra-bai` và `student-web`.
2. Cấp read/backup access cho tài khoản kỹ thuật hoặc đăng nhập CLI/Management
   API bằng account đúng.
3. Không gửi key/password/secret qua chat.
4. Chỉ xác nhận project ref và quyền đã sẵn sàng.

Sau khi backup PASS, owner sẽ có checkpoint riêng cho:

- tạo/duyệt Supabase project System 2;
- nhập secrets mới vào Vercel Dashboard;
- OAuth staging origin;
- staging DNS nếu cần;
- Production cutover sau rehearsal.

---

## 16. Các điểm còn UNPROVEN

1. Exact current Supabase ref của Admin.
2. Exact current Portal Supabase ref của Student.
3. Admin và Student có cùng exact Portal DB hay không.
4. Current `NEXT_PUBLIC_STUDENT_APP_URL` value.
5. Current Commerce `SYSTEM1_URL` và `SYSTEM3_URL` values.
6. Secret pairing giữa Commerce/Admin/Student/LMS.
7. Student exact `LMS_SUPABASE_URL`.
8. LMS Google Drive credential/root health.
9. Post canary có Drive/media/course mapping riêng hay không.
10. Exact Git SHA của live LMS deployment.

Các mục này không nhất thiết đều chặn backup. Mục 1–3 là blocker tuyệt đối cho
data boundary và System 1 protection.

---

## 17. Rủi ro kỹ thuật chính

| Rủi ro | Mức | Kiểm soát |
|---|---|---|
| Backup nhầm DB vì tin ref lịch sử | Critical | Chứng minh runtime ref + current access trước query |
| Copy env từ Student cũ sang Portal mới | Critical | Allowlist env; tạo secrets/DB mới; không bulk copy env |
| Cross-database service-role | Critical | Startup assertion ref/site; one client/deployment |
| Fallback về `www.yeunauan.live` | High | Xóa fallback; network-spy negative test |
| Shared secret blast radius | High | Secret riêng theo system và purpose |
| OAuth làm hỏng login System 1 | High | Add-only staging origin; không xóa origin cũ |
| Fixture chạm dữ liệu thật | High | Non-Production DB/namespace + no-write proof |
| Drive permission mutation | High | Mock/dry-run; credential không cấp vào Preview nếu không cần |
| Domain attach sớm | High | Preview URL trước; owner cutover approval riêng |
| Reuse isolated Portal cũ thiếu audit | Medium/High | Mặc định không reuse; audit đầy đủ nếu cân nhắc |

---

## 18. File và thư mục quan trọng

### 18.1 Evidence/report

- [FULL_SYSTEM_SEPARATION_PREPARATION_20260806.md](FULL_SYSTEM_SEPARATION_PREPARATION_20260806.md)
- [FULL_SYSTEM_SEPARATION_TARGET_20260806.mmd](FULL_SYSTEM_SEPARATION_TARGET_20260806.mmd)
- [../diagram-current-architecture.md](../diagram-current-architecture.md)
- [../diagram-current-architecture.mmd](../diagram-current-architecture.mmd)
- [../diagram-current-architecture.html](../diagram-current-architecture.html)
- [../CURRENT_SYSTEM_HANDOVER_REPORT_20260806.md](../CURRENT_SYSTEM_HANDOVER_REPORT_20260806.md)

### 18.2 Planning/evidence ledger

- `task_plan.md`
- `findings.md`
- `progress.md`

### 18.3 Local sanitized audit helpers

- `_local_artifacts/separation-supabase-inventory.ps1`
- `_local_artifacts/sanitize-env-inventory.ps1`

Các helper không chứa raw secret. Chúng đọc credential vào memory và chỉ xuất
sanitized project metadata/presence. Trước khi dùng lại phải review source và
không redirect raw process environment ra file.

### 18.4 Backup root

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_private_backups`

Không nằm trong Git/worktree. Không di chuyển encrypted payload tách khỏi DPAPI
key/manifest nếu chưa lập custody record.

---

## 19. Workspace caution

Worktree hiện có nhiều file untracked từ các đợt điều tra trước. Chúng thuộc về
owner và không được xóa/reset hàng loạt.

Không dùng:

- `git reset --hard`;
- `git clean -fd`;
- recursive delete ở workspace root;
- checkout phủ lên thay đổi chưa phân loại.

Khi tạo implementation mới, dùng worktree/branch riêng từ exact verified
baseline. Không dùng current root HEAD làm deployed source nếu chưa chứng minh
ancestry/artifact identity.

---

## 20. Hình thức evidence cần ghi trong lượt tiếp theo

Mỗi phase phải ghi:

- timestamp/timezone;
- actor/account/team/project;
- exact source SHA hoặc artifact hash;
- deployment ID/URL/status;
- sanitized env-name/fingerprint matrix;
- database ref/schema/count/checksum;
- no-write proof;
- System 1 before/after regression;
- rollback anchor;
- mutation journal nếu có;
- raw secret/PII retained = false.

Mỗi kết luận phải là `MATCH`, `MISMATCH`, `UNPROVEN`, `NOT_CONFIGURED` hoặc
`UNREADABLE_BY_PLATFORM`.

---

## 21. Definition of done cho preparation

Preparation chỉ hoàn thành khi:

1. Fresh dual-system backup PASS và readback PASS.
2. Portal DB mới có verified independent boundary.
3. Portal project mới READY trên Preview, không alias Production.
4. New session/internal/hash/service-role secrets độc lập.
5. Fixed routing + allowlist + fail-closed tests PASS.
6. Commerce staged target đúng Portal mới.
7. Portal staged target đúng LMS legacy.
8. Không read/write System 1 hoặc LMS khác.
9. OAuth staging PASS.
10. Full fixture rehearsal PASS.
11. System 1 regression PASS sau mọi mutation.
12. Rollback rehearsal PASS.
13. Cutover manifest hoàn chỉnh.

Khi đạt, dừng tại:

`READY FOR OWNER REVIEW — SYSTEM 1 PROTECTED, SYSTEM 2 STAGED`

Production cutover vẫn cần exact approval riêng.

---

## 22. Safety attestation tại thời điểm chuyển giao

- Hệ thống 1 không bị đổi domain/deployment/env/schema.
- Không mất hoặc overwrite dữ liệu học viên.
- Không migrate/merge Portal DB Hệ thống 1.
- Không dùng học viên/post/order thật để test mutation.
- Không deploy/cutover Production.
- Không đổi DNS/OAuth/Drive permission.
- Không đọc, in hoặc lưu raw secret.
- Temporary OIDC env files đã xóa.
- Báo cáo và evidence chỉ chứa sanitized IDs/refs/counts/checksums.

## Trạng thái cuối

`STOPPED — DATA BOUNDARY NOT PROVEN`

**Việc đầu tiên của bên tiếp nhận:** lấy đúng Supabase Management access cho
Portal DB Hệ thống 1, chứng minh exact ref của Admin và Student, sau đó tạo fresh
encrypted/readback-verified backup. Không tạo System 2 asset trước khi gate này
PASS.
