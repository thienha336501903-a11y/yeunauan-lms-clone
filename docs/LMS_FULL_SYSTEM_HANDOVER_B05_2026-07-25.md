# BÁO CÁO BÀN GIAO TOÀN BỘ HỆ THỐNG LMS — BACKUP B05

> **Ngày chốt:** 2026-07-25, múi giờ Asia/Saigon  
> **Mục đích:** Cung cấp cho bên thứ ba một snapshot kỹ thuật độc lập để hiểu hệ thống hiện tại và chuẩn bị nhiệm vụ mới  
> **Repository chính:** `thienha100022653824678-stack/web-lms-chinh-thuc`  
> **Production:** `https://www.daubepnho.store`  
> **Mức bảo mật:** Không chứa secret, token, cookie, private key, email quản trị hoặc dữ liệu học viên

---

## 1. Snapshot điều hành hiện tại

| Hạng mục | Trạng thái chốt |
|---|---|
| Mã backup ngắn | **B05** |
| Git tag backup | `backup/B05-2026-07-25` |
| Exact source commit | `fc12c3b21329158e13a4a027833afd2dec61e973` |
| Commit message | `fix(lms): harden main video one-tap playback` |
| Production deployment | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |
| Production deployment URL | `https://web-lms-chinh-thuc-llpu2nm5m.vercel.app` |
| Vercel state tại lúc chốt | **Ready** |
| Full automated suite cuối | **300/300 pass, 0 fail** |
| Production probes cuối | `/`, `/lms.html`, lesson mẫu, public-config đều HTTP 200 |

Các alias production đang gắn với deployment B05:

- `https://www.daubepnho.store`
- `https://daubepnho.store`
- `https://web-lms-chinh-thuc.vercel.app`

### Cảnh báo Git topology

Production **không chạy từ remote `main` hiện tại**.

- Worktree chốt đang ở detached `HEAD` tại `fc12c3b`.
- `origin/main` ở lineage cũ `f9220e8`.
- Integration/performance branches có lịch sử riêng.
- Không được checkout `main`, merge hoặc deploy từ `main` rồi giả định đó là production mới nhất.
- Khi làm nhiệm vụ mới, base an toàn phải là tag `backup/B05-2026-07-25` hoặc exact SHA `fc12c3b`.

---

## 2. Hệ thống làm gì

Đây là LMS cho nền tảng dạy nấu ăn Culinary Academy/Đầu Bếp Nhỏ. Hệ thống phục vụ ba nhóm chức năng:

1. **Học viên**
   - Đăng nhập/xác minh quyền học.
   - Xem khóa học, chương và bài học.
   - Xem video chính, ảnh chính, công thức, tài liệu và media phụ.
   - Chuyển bài trước/sau bằng SPA-lite trên trang bài học.
   - Khôi phục phiên, đăng xuất và tuân thủ chính sách thiết bị nếu feature flag được bật.

2. **Quản trị viên**
   - Quản lý khóa học, chương, bài học và thứ tự.
   - Quản lý học viên và quyền học.
   - Upload ảnh, video Google Drive, công thức và tài liệu.
   - Đồng bộ quyền Google Drive.
   - Theo dõi Drive health/retry, dấu hiệu chia sẻ tài khoản và runtime mode.

3. **Tích hợp hệ thống**
   - Nhận đồng bộ khóa học/quyền học từ hệ thống bán hàng.
   - Kết nối Supabase, Google Identity, Google Drive/Docs và Bunny Stream.
   - Có subsystem V2 cho outbox, worker, reconciliation, projection và runtime switch, tất cả được bảo vệ bằng secret/feature flag.

---

## 3. Kiến trúc tổng thể

```text
Browser học viên / admin
        |
        | HTTPS
        v
Static HTML + Vanilla JS trên Vercel
        |
        | /api/lms/portal
        | /api/lms/admin
        | /api/sync
        | /api/v2/*
        v
Vercel Serverless Functions
        |
        +--> Supabase B: LMS & Checkout, source of truth hiện tại
        +--> Google Identity: xác minh Google ID token
        +--> Google Drive/Docs: media, recipe, folder permission
        +--> Bunny Stream: embed/sign video khi được cấu hình
        +--> Supabase A / Portal legacy thông qua sync/projection boundary
```

### Công nghệ

- Frontend: HTML5, CSS, Vanilla ES6 JavaScript.
- Không dùng React/Vue/Next cho renderer.
- Backend: Node.js ES modules trên Vercel Serverless.
- Database client: `@supabase/supabase-js`.
- Google integrations: `google-auth-library`, `googleapis`.
- Media: Google Drive, Google Docs, Bunny Stream, YouTube và URL ngoài.
- Styling:
  - `lms.html` và `lesson.html`: compiled `/vendor/tailwind-static.css`.
  - `index.html`, `lms-admin.html`, `photo.html`: vẫn có Tailwind CDN/runtime.
- Vercel `vercel.json` hiện đặt `no-cache, no-store, must-revalidate` rộng cho response.

---

## 4. Cấu trúc repository

```text
/
├── index.html                     # Entry/catalog legacy-compatible
├── lms.html                       # Cổng học viên/course view
├── lesson.html                    # Trang bài học, SPA-lite, media/recipe
├── lms-admin.html                 # CMS quản trị
├── gdrive-player.html             # Trang phát video Google Drive
├── photo.html                     # Trang xem nội dung/media công khai phụ trợ
├── api/
│   ├── lms/
│   │   ├── portal.js              # Router API học viên
│   │   └── admin.js               # Router API quản trị
│   ├── sync.js                    # Đồng bộ server-to-server
│   └── v2/                        # Diagnostics/outbox/worker/readiness
├── utils/
│   ├── lms-handlers/              # Business handlers portal/admin
│   ├── lms.js                     # Session, Drive, Bunny, enrollment helpers
│   ├── lms-media.js               # Phân loại media backend
│   ├── lms-content-cache.js       # Shared recipe/content cache
│   ├── lms-session-guard.js       # Entry token, one-device, risk events
│   ├── lms-secrets.js             # Fail-closed secrets
│   ├── cors.js                    # Central CORS policy
│   └── v2-*.js                    # V2 switch/outbox/reconciliation
├── vendor/
│   ├── lms-media.js               # Parser media dùng trong browser
│   └── tailwind-static.css        # CSS build sẵn cho LMS/lesson
├── styles/                        # Tailwind source CSS
├── tests/                         # Node test suite
├── scripts/                       # Drive token helper và V2 operations
├── docs/                          # Báo cáo, runbook, điều tra
├── handover/                      # Handover lịch sử; có phần đã lỗi thời
├── migration_*.sql                # Migration theo capability
└── supabase_schema.sql            # Schema nền LMS
```

---

## 5. Các trang frontend

| Trang | Vai trò | Luồng chính |
|---|---|---|
| `/` (`index.html`) | Entry/course UI tương thích lịch sử | Tải public config/course data, điều hướng lesson |
| `/lms.html?course=<slug>` | Cổng học viên | Google GSI, session/token, danh sách chương/bài, mobile detail |
| `/lesson.html?id=<uuid>` | Bài học chi tiết | Auth/enrollment, video/ảnh chính, recipe, media phụ, materials, SPA navigation |
| `/lms-admin.html` | CMS quản trị | Google admin auth, CRUD, uploads, enrollment, Drive/risk/runtime controls |
| `/gdrive-player.html?id=<id>` | Player Drive chuyên dụng | Iframe Drive preview và quay lại lesson/course |
| `/photo.html` | Viewer phụ trợ | Dùng public-lesson API để hiển thị nội dung được phép |

### `lesson.html` — các khu vực quan trọng

- Header, lesson metadata, chapter name.
- Main media:
  - ảnh chính render tĩnh;
  - video Drive mở player chuyên dụng;
  - Bunny/YouTube/embed dùng iframe;
  - Cốc Cốc bị chặn;
  - video bài học chính bị giới hạn theo policy thiết bị hiện hữu.
- Recipe từ text hoặc Google Docs.
- Supplemental media và caption theo từng item.
- Tài liệu đính kèm.
- Sidebar/chapter tree.
- Nút Bài trước/Bài tiếp theo.
- SPA-lite:
  - fetch lesson tiếp theo;
  - cache/prefetch;
  - `history.pushState`;
  - cleanup iframe, watermark, timer và listener trước khi paint lesson mới.

---

## 6. API học viên

Router: `api/lms/portal.js`  
URL chung: `/api/lms/portal?endpoint=<name>`

| Endpoint | Chức năng |
|---|---|
| `course-data` | Xác minh access rồi trả course, chapters, lessons, media/recipe đã xử lý |
| `lesson` | Trả một lesson, sibling list, media metadata, recipe và signed media |
| `public-config` | Trả cấu hình công khai như Google client/course metadata |
| `public-lesson` | Dữ liệu lesson công khai/phụ trợ theo contract handler |
| `verify-entry-token` | Xác minh entry token và tạo/kiểm tra LMS verified session |
| `logout` | Thu hồi server-side session khi policy bật và xóa cookie theo contract |

Router gọi `warmRuntimeConfig()` trước handler. Riêng lesson có Server-Timing instrumentation khi bật cấu hình.

### Access checks chính

- Google/session identity.
- Email chuẩn hóa lowercase.
- Enrollment tồn tại, đúng course và thuộc nhóm status được phép.
- Thời hạn enrollment nếu có.
- Entry token/verified session nếu course hoặc global flag yêu cầu.
- Device/session match nếu global one-device được bật.
- Fail-closed cho auth/session quan trọng; telemetry có thể degrade an toàn.

---

## 7. API quản trị

Router: `api/lms/admin.js`  
URL chung: `/api/lms/admin?endpoint=<name>`

| Nhóm | Endpoint |
|---|---|
| Xác thực | `auth`, `drive-auth`, `drive-status` |
| Nội dung | `courses`, `lessons` |
| Học viên | `students`, `enrollments`, `bulk-enroll` |
| Upload | `upload-image`, `upload-recipe`, `upload-gdrive-video`, `upload-material` |
| Drive operations | `sync-drive-permissions`, `repair-drive`, `drive-permission`, `drive-health`, `drive-retry` |
| Media | `verify-media` |
| Security/monitoring | `student-trace`, `account-sharing-alerts` |
| Runtime | `runtime-mode` |

Admin router giữ `bodyParser.sizeLimit = "500mb"` vì đang multiplex upload base64 lớn. Không được hạ giới hạn toàn router trong một task không chuyên về upload; việc đó sẽ chặn request trước khi handler chạy.

### Lesson model trong admin

- Chương và lesson cùng nằm trong bảng `lessons`.
- Chương dùng `is_section = true`.
- `lesson_no`/`sort_order` phải giữ unique/sequential theo course.
- Số “Bài 1, Bài 2…” hiển thị được tính lại theo section (`displayLesson`), không dùng raw DB number để hiển thị.
- `materials` là danh sách tài liệu có cấu trúc.
- `media_urls` lưu media phụ theo line protocol có type, URL, title và caption.

---

## 8. Đồng bộ Shop/LMS và API V2

### `/api/sync`

- Chỉ nhận `POST`/`OPTIONS`.
- Xác thực bằng `X-Sync-Secret`.
- So sánh secret timing-safe.
- Actions:
  - `syncCourse`
  - `syncEnrollment`
  - `revokeEnrollment`
- CORS internal mode cho phép server-to-server không có Origin; không dựa vào CORS thay cho secret.
- Khi V2 shadow được bật, handler có thể ghi thêm outbox event nhưng không làm hỏng response V1.

### `/api/v2/*`

| Endpoint | Vai trò |
|---|---|
| `/api/v2/diagnostics` | Kiểm tra schema/config/runtime |
| `/api/v2/readiness` | Tổng hợp gate trước rollout |
| `/api/v2/outbox` | Inspect event/delivery/dead letter |
| `/api/v2/sync-worker` | Chạy batch worker, hỗ trợ dry-run |
| `/api/v2/reconciliation` | Đối chiếu dữ liệu read-only theo flag |
| `/api/v2/portal-projection-preview` | Preview payload projection |

Các endpoint trên yêu cầu worker secret. Không gọi hoặc đưa secret vào client/browser.

### Runtime switch

- DB keys:
  - `v2_active_mode`
  - `v2_kill_switch`
- Env override có thể force mode/kill.
- Master switch và per-feature flags là hai tầng khác nhau.
- Khi cached runtime là V1 hoặc kill switch bật, feature V2 phải bị vô hiệu hóa.
- Báo cáo này không công bố giá trị secret hay tự suy đoán runtime mode hiện hành từ source.
- Trước nhiệm vụ liên quan V2 phải đọc `docs/v2/V2_IMPLEMENTATION_STATUS.md`, nhưng coi ngày/SHA trong đó là snapshot lịch sử.

---

## 9. Database và quyền sở hữu dữ liệu

### Supabase B — source of truth của LMS hiện tại

Runtime repo dùng một Supabase client được cấu hình bởi:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Nhóm bảng chính:

| Nhóm | Bảng |
|---|---|
| Commerce/LMS | `courses`, `orders`, `lessons`, `students`, `student_enrollments`, `lesson_progress`, `site_config` |
| Session/device | `student_active_sessions`, `lms_entry_tokens`, `lms_verified_sessions`, `student_session_controls` |
| Risk/audit | `student_device_change_logs`, `student_account_risk_reviews`, `student_account_risk_summaries`, `student_account_admin_notes`, `admin_audit_logs`, `audit_logs` |
| Drive | `drive_admin_accounts`, `drive_permission_logs`, `drive_sync_queue` |
| V2 sync | `sync_outbox`, `sync_deliveries`, `sync_dead_letters`, `course_slug_mappings` |

### Supabase A — Portal legacy/projection

Theo operating architecture, một database khác phục vụ Portal/post-based content:

- `posts`
- `post_views`
- portal-side enrollment/projection

Quy tắc:

- Không coi Supabase A là source of truth cho LMS hiện tại.
- Không nhầm hai bảng `student_enrollments` ở hai hệ.
- Mọi task chạm `course_slug`, sync, order hoặc enrollment phải ghi rõ tác động Supabase A, Supabase B hay boundary.
- Không chạy migration chỉ vì file SQL tồn tại; phải kiểm tra migration đã áp dụng trên đúng project/database.

---

## 10. Authentication, session và bảo mật

### Học viên

- Google Identity Services cung cấp identity credential.
- Backend xác minh Google token/audience.
- Session được ký bằng HMAC, cookie `HttpOnly`, `SameSite=Lax`; production ép `Secure`.
- Không fallback session secret sang Google client ID.
- Entry token được hash; raw token không lưu/log.
- Device/IP/session telemetry dùng HMAC hash khi secret hợp lệ.

### Admin

- Admin Google credential được xác minh server-side.
- Email phải nằm trong allowlist `ADMIN_EMAILS`.
- Admin cookie/token dùng contract riêng.

### Fail-closed

- Thiếu secret auth trong production trả lỗi cấu hình an toàn.
- Error chỉ nêu tên biến env thiếu, không nêu giá trị.
- `/api/sync` thiếu secret trả service unavailable; secret sai trả unauthorized.
- Local bypass chỉ hợp lệ ngoài production và phải được bật rõ ràng.

### Account sharing/session guard

- Hỗ trợ one-device policy sau master runtime/feature flag.
- Trạng thái session: active, logged_out, expired, admin_reset, superseded.
- Admin có thể reset/revoke với reason/audit.
- Risk scoring và trace là telemetry/monitoring, không được tự động dùng để xóa enrollment nếu chưa có workflow duyệt.

---

## 11. Media, video, ảnh, recipe và tài liệu

### Media chính

Backend phân loại bằng:

1. type/marker đã lưu;
2. MIME;
3. filename/extension;
4. URL extension;
5. metadata Drive nếu lấy được.

URL Google Drive opaque không đủ để kết luận ảnh hay video. Không được dùng thumbnail làm bằng chứng duy nhất vì video cũng có thumbnail.

### Bản sửa production B05

#### Caption media phụ

- Parser đã giữ caption của từng item.
- Renderer `lesson.html` render đúng caption cạnh item tương ứng.
- Caption rỗng không tạo node/khoảng trắng thừa.
- Caption được HTML-escape.
- Áp dụng cho ảnh, Drive, YouTube, Bunny và nhánh generic phù hợp.

#### Video chính one-tap

- Root cause cũ: click đầu gọi helper dựng thêm poster/nút Play cho Drive; click thứ hai mới mở player.
- Luồng hiện tại:
  - Drive dùng cùng one-click navigation với video phụ.
  - Iframe provider khác được stage phía sau thumbnail.
  - `src` được gán trong user gesture đầu.
  - Thumbnail/nút Play chỉ ẩn sau iframe `load`.
  - Error/timeout phục hồi thumbnail và cho retry.
  - State `loading/ready` chặn double click tạo nhiều iframe.
  - SPA cleanup dọn timer/player cũ.
  - Có `allow=autoplay`, `playsinline`, `webkit-playsinline`.

### Recipe

- Có thể lấy từ text đã lưu hoặc Google Docs/Drive.
- Có Google API path và public-download fallback.
- Shared cache dùng TTL/ngưỡng giới hạn và inflight deduplication.
- Không cache identity, enrollment hoặc session.

### Materials

- Tài liệu bài học tách khỏi `media_urls`.
- Admin upload/ghi metadata.
- Student render nút xem/tải.
- Không đổi cấu trúc `materials` nếu không cập nhật cả admin, handler và frontend.

---

## 12. Hiệu suất và điều hướng

Các tối ưu đã có trong lineage production:

- Parallel/deferred session touch có contract fail-closed.
- Shared recipe/content cache.
- Compiled Tailwind CSS cho `lms.html` và `lesson.html`.
- SPA-lite navigation trong `lesson.html`.
- Prefetch/cache lesson lân cận.
- Server-Timing tùy chọn cho lesson.

Điểm cần nhớ:

- Direct load/reload vẫn phải hoạt động độc lập với SPA.
- `paintLesson()` phải cleanup iframe, watermark, timer và handler cũ.
- Chapter records không được đưa vào prev/next targets.
- Không làm cache signed media/session lâu hơn thời hạn hợp lệ.
- `vercel.json` no-store rộng nghĩa là static asset caching chưa tối ưu triệt để.

---

## 13. Biến môi trường

Chỉ liệt kê tên; giá trị phải lưu trong Vercel/secret manager.

### Core

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET`
- `ACCOUNT_EVENT_HASH_SECRET`
- `SESSION_GUARD_HASH_SECRET` (alias/fallback tương thích)
- `ADMIN_EMAILS`

### Google identity/Drive/Docs

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SERVICE_ACCOUNT`
- `GOOGLE_DRIVE_IMAGE_FOLDER_ID`
- `GOOGLE_DRIVE_RECIPE_FOLDER_ID`
- `DRIVE_CLIENT_ID`
- `DRIVE_CLIENT_SECRET`
- Drive admin pool refresh-token variables theo slot vận hành

### Bunny/media

- `BUNNY_STREAM_TOKEN_KEY`

### Session/policy

- `SESSION_DAYS`
- `STUDENT_SESSION_IDLE_HOURS`
- `LMS_SESSION_IDLE_HOURS`
- `LMS_ENTRY_TOKEN_TTL_MINUTES`
- `LMS_ENTRY_TOKEN_REQUIRED_COURSES`
- `V2_GLOBAL_ONE_DEVICE_ENABLED`
- `V2_CORS_ALLOWLIST_ENABLED`

### Internal/V2

- `INTERNAL_SYNC_SECRET`
- `V2_WORKER_SECRET`
- `V2_RUNTIME_FORCE_MODE`
- `V2_RUNTIME_FORCE_KILL`
- `V2_RUNTIME_CACHE_TTL_MS`
- `V2_OUTBOX_SHADOW_MODE`
- `V2_OUTBOX_WORKER_ENABLED`
- `V2_OUTBOX_WORKER_DRY_RUN`
- `V2_DELIVERY_HANDLERS_ENABLED`
- `V2_PORTAL_PROJECTION_ENABLED`
- `V2_PORTAL_PROJECTION_DRY_RUN`
- `V2_PORTAL_PROJECTION_URL`
- `V2_PORTAL_PROJECTION_SECRET`
- `V2_DRIVE_WORKER_DRY_RUN`
- `V2_RECONCILIATION_READONLY`
- `SYSTEM1_URL`

### Local/test/observability

- `LMS_RP1_ALLOW_INSECURE_LOCAL`
- `LMS_ALLOW_INSECURE_COOKIE`
- `LMS_RP2B1_SUPABASE_STUB`
- `LMS_SERVER_TIMING`

Không copy `.env`, Vercel env pull output hoặc token terminal vào tài liệu bàn giao.

---

## 14. Migrations

Các file migration hiện diện:

- Base LMS schema: `supabase_schema.sql`.
- Session/device:
  - `migration_student_session_guard.sql`
  - `migration_atomic_session_guard.sql`
  - `migration_handle_student_session_login_grants_hardening.sql`
- Account-sharing/risk:
  - `migration_account_sharing_alerts.sql`
  - `migration_account_sharing_p0_hardening.sql`
  - `migration_account_sharing_p1.sql`
- Drive:
  - `migration_drive_admin_pool.sql`
  - `migration_drive_sync.sql`
- V2:
  - `migration_v2_identity_mapping.sql`
  - `migration_v2_sync_outbox.sql`

Migration files mô tả capability, không chứng minh production DB đã áp dụng toàn bộ. Trước migration mới:

1. xác định đúng Supabase;
2. chụp schema actual;
3. chạy preflight;
4. chuẩn bị rollback SQL;
5. không chỉnh dữ liệu thật khi chưa được owner duyệt.

---

## 15. Kiểm thử

Lệnh chuẩn:

```powershell
npm ci
npm run build:lms-css
$env:LMS_RP2B1_SUPABASE_STUB='1'
node --test tests/*.test.mjs
git diff --check
```

Baseline B05:

```text
tests 300
pass  300
fail  0
```

Các nhóm test:

- admin handlers boot;
- main-video one-tap/load/error/double-click;
- supplemental caption;
- shared content cache;
- Server-Timing;
- static Tailwind;
- RP1 auth hardening;
- CORS;
- one-device/session;
- logout/revoke;
- V2 runtime/outbox/readiness/reconciliation/4-repo contract.

Giới hạn:

- Automated tests không thay thế authenticated E2E trên Safari iPhone thật.
- Google Drive/Bunny cross-origin behavior cần canary account và media fixture được owner cấp.
- Không dùng profile/token cá nhân làm test fixture.

---

## 16. Production, backup và rollback

### Backup hiện hành

```text
Name:       B05
Git tag:    backup/B05-2026-07-25
Commit:     fc12c3b21329158e13a4a027833afd2dec61e973
Deployment: dpl_HVQvwrveFjxE81cpsoXRraDB34wR
```

Tag annotated đã được push lên `origin`.

### Rollback nhanh về B05

Ưu tiên promote exact artifact, không rebuild:

```powershell
vercel inspect dpl_HVQvwrveFjxE81cpsoXRraDB34wR
vercel promote dpl_HVQvwrveFjxE81cpsoXRraDB34wR --yes
```

Sau promote:

1. chờ `Ready`;
2. xác minh alias;
3. probe `/`, `/lms.html`, lesson mẫu và public-config;
4. kiểm tra source marker của chức năng cần khôi phục.

Nếu cần source:

```powershell
git fetch origin --tags
git switch --detach backup/B05-2026-07-25
```

Không dùng `git reset --hard`, force-push hoặc rebuild worktree bẩn làm rollback mặc định.

---

## 17. Những phần không được làm hỏng

1. Google GSI, session signing và cookie restore.
2. Admin allowlist/auth.
3. Enrollment/course access fail-closed.
4. `displayLesson` đồng nhất giữa course-data, lesson và admin.
5. `is_section` và thứ tự lesson.
6. Prev/next bỏ qua section.
7. Supabase A/B ownership boundary.
8. `/api/sync` secret và timing-safe compare.
9. Drive folder permission/admin pool/queue.
10. `materials` và `media_urls` là hai contract khác nhau.
11. Caption suffix trong `media_urls`.
12. Main image/video classification.
13. One-tap main video state machine.
14. SPA hard-load/reload/back-forward parity.
15. Watermark cleanup và timer cleanup.
16. V2 master switch, kill switch và dry-run defaults.
17. Body parser 500 MB của multiplexed admin upload route.

---

## 18. Rủi ro và nợ kỹ thuật hiện tại

- Production source nằm trên detached lineage, chưa được hợp nhất sạch vào `main`.
- Một số handover/doc cũ ghi snapshot khác nhau; phải ưu tiên file này + exact code B05.
- Frontend có logic lặp giữa `index.html`, `lms.html` và `lesson.html`.
- Admin router multiplex nhiều capability và có body limit lớn.
- Static asset caching chưa tối ưu do global no-store.
- Một số trang vẫn dùng Tailwind CDN.
- Authenticated physical-device E2E chưa tự động hóa.
- Google/Bunny behavior phụ thuộc credential, sharing permission và provider.
- Runtime V1/V2 có nhiều lớp flag; đổi nhiều flag cùng lúc làm rollback/attribution khó.
- Migration presence không đồng nghĩa migration đã apply.
- Worktree hiện có các báo cáo/planning untracked; không dùng `git add .`.

---

## 19. Quy trình nhận nhiệm vụ mới

Bên thứ ba nên trả lời các câu sau trước khi sửa:

1. Nhiệm vụ thuộc frontend, portal API, admin API, data, auth, media, Drive hay V2?
2. Base có đúng `backup/B05-2026-07-25` không?
3. Tác động Supabase A, Supabase B hay sync boundary?
4. Có đổi API/schema/data không?
5. Có cần canary account/media fixture không?
6. Test hồi quy tối thiểu là gì?
7. Rollback artifact/commit nào?
8. Có được phép deploy production không, hay chỉ sửa local?

Release gate đề xuất:

1. Worktree sạch từ B05.
2. Một task/một chủ đề.
3. Target tests.
4. Full suite 300 baseline hoặc giải thích test-count thay đổi.
5. `git diff --check`.
6. Preview exact commit.
7. Smoke-test Preview.
8. Owner duyệt.
9. Promote exact artifact.
10. Post-production probes và tạo backup mới.

---

## 20. Tài liệu nên đọc tiếp theo theo loại nhiệm vụ

| Loại nhiệm vụ | Tài liệu |
|---|---|
| Media chính/Drive failure | `docs/MAIN_VIDEO_NOT_RECOGNIZED_ROOT_CAUSE_2026-07-24.md` |
| Caption/media phụ | `docs/SUPPLEMENTARY_MEDIA_CAPTION_IMAGE_BUG_INVESTIGATION.md` |
| SPA/media regression | `docs/MEDIA_REGRESSION.md` |
| Navigation/performance | `docs/LESSON_NAVIGATION_PERFORMANCE_INVESTIGATION.md` |
| V2 architecture | `docs/v2/V2_SYSTEM_OVERVIEW_4REPOS.md` |
| Data ownership | `docs/v2/V2_DATA_OWNERSHIP_CONTRACT.md` |
| V2 operations | `docs/v2/V2_OPERATIONS_RUNBOOK.md` |
| V2 rollback | `docs/v2/V2_ROLLBACK_RUNBOOK.md` |
| Session/device | `docs/v2-new/RP2_B1_IMPLEMENTATION_RESULT.md` |

Không dùng trạng thái “chưa deploy/đang ở preview” trong tài liệu lịch sử để kết luận trạng thái hiện tại.

---

## 21. Kết luận bàn giao

Hệ thống B05 hiện là một LMS production dựa trên frontend tĩnh và Vercel Serverless, dùng Supabase B làm source of truth cho LMS, tích hợp Google/Bunny cho identity và media, có admin CMS, session/device guard, SPA-lite lesson navigation và subsystem V2 có guard.

Trạng thái đã xác minh:

- production Ready;
- exact source và immutable deployment đã biết;
- remote backup tag đã tồn tại;
- full suite 300/300;
- caption media phụ hoạt động;
- video chính dùng one-click flow, giữ thumbnail đến ready, retry khi lỗi và chống duplicate player;
- các endpoint production quan trọng trả HTTP 200.

Điểm khởi đầu an toàn cho nhiệm vụ mới là:

```text
backup/B05-2026-07-25
fc12c3b21329158e13a4a027833afd2dec61e973
```

Bên tiếp nhận không nên bắt đầu bằng remote `main`, migration hoặc runtime flag flip. Hãy xác định phạm vi, test và rollback trước, sau đó thay đổi tối thiểu trên exact B05.
