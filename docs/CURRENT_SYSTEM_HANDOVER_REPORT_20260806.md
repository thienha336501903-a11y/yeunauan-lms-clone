# BÁO CÁO TỔNG THỂ HỆ THỐNG HIỆN TẠI

**Ngày chốt trạng thái:** 06/08/2026, múi giờ Asia/Ho_Chi_Minh  
**Mục đích:** Bàn giao cho đơn vị kỹ thuật thứ ba khảo sát, vận hành hoặc đề xuất nâng cấp  
**Trạng thái chuẩn:** Sau khi khôi phục Production về checkpoint `supabase-before-multistore-20260725-154808`

> Báo cáo này mô tả trạng thái thực tế sau restore ngày 06/08/2026. Các tài liệu
> multisite, dual-LMS và dual-Portal trước đây là thiết kế/Preview hoặc kế hoạch
> chưa cutover, không được coi là chức năng Production đang hoạt động.

> **CẢNH BÁO DIỄN GIẢI:** Việc một domain/project vẫn tồn tại hoặc trả HTTP 200
> không chứng minh rằng nó đang nằm trong routing Production. Kiến trúc hiện tại
> **không phải** “hai website bán hàng độc lập → hai Portal → hai LMS độc lập”.
> Chỉ các mũi tên trong mục 3.1 được coi là routing đã xác minh.

---

## 1. Tóm tắt điều hành

Hệ thống hiện tại gồm bốn nhóm chính:

1. Website bán hàng (Commerce) dạng static frontend kết hợp Vercel Serverless API.
2. LMS legacy gồm giao diện học viên, LMS Admin và API đồng bộ.
3. Portal học viên độc lập dùng Next.js.
4. Supabase Production dùng chung cho dữ liệu Commerce, LMS, session, đồng bộ,
   Drive và audit.

Sau restore, hai domain bán hàng `shop.yeunauan.live` và `yeubep.shop` cùng phục
vụ một artifact Commerce cũ, một project Vercel và một cấu hình Production.
Hệ thống không còn ranh giới `sales_site`, `learning_site` hoặc routing LMS riêng
theo từng storefront trong schema/config của checkpoint này.

LMS legacy tại `www.daubepnho.store` vẫn là LMS chính của topology được restore.
Một LMS Yeubep riêng tại `lms.yeubep.shop` vẫn tồn tại và trả HTTP 200, nhưng không
được Commerce checkpoint hiện tại route riêng tới theo contract multistore.

Hai Portal mới đã được tạo trên Vercel và được associate tên miền, nhưng tại thời
điểm kiểm tra DNS của `portal.yeubep.shop` và `portal.yeunauan.live` không phân
giải. Chúng chưa phải endpoint vận hành. Portal truy cập được là
`www.yeunauan.live`.

Không có dữ liệu được migrate, merge hoặc copy giữa hai LMS trong lần restore.
Drive và Cloudinary không bị xóa hoặc di chuyển.

---

## 2. Phạm vi và nguồn bằng chứng

Báo cáo được đối chiếu từ:

- checkpoint `supabase-before-multistore-20260725-154808`;
- checksum manifest của checkpoint;
- exact Commerce deployment và Git commit;
- Vercel project/deployment/domain metadata đọc ngày 06/08/2026;
- schema và dữ liệu backup Supabase;
- biên bản restore và smoke test sau restore;
- source hiện hữu của Commerce, LMS và Portal;
- HTTP/DNS smoke trên các domain công khai.

Các giá trị secret, token, email, số điện thoại, session ID và credential Drive
không được đưa vào báo cáo.

### Mức độ chắc chắn

| Nội dung | Mức xác minh |
|---|---|
| Commerce deployment/source | Exact deployment và exact Git SHA |
| Supabase checkpoint | Checksum 16/16 và đối chiếu dữ liệu sau restore |
| LMS deployment | Exact deployment; Vercel không cung cấp Git SHA trong metadata |
| LMS source family | Commit đã lưu cục bộ và evidence vận hành |
| Portal cũ | Project/deployment READY, domain và HTTP smoke |
| Hai Portal mới | Project/domain association có thật; DNS hiện chưa phân giải |
| Secret pairing | Chỉ xác minh tên biến/presence; không đọc raw value |

---

## 3. Topology Production hiện tại

### 3.1 Sơ đồ authoritative — routing đã xác minh

```text
 shop.yeunauan.live ---------+
                              +---> MỘT Commerce project duy nhất
 yeubep.shop ----------------+     web-ban-hang-chinh-thuc
                                    artifact cafe21b...
                                             |
                                             +--> MỘT Supabase chính
                                             |    aqozjkfwzmyfunqvcyjv
                                             |
                                             +--> Portal cũ
                                             |    www.yeunauan.live
                                             |
                                             +--> LMS legacy
                                                  www.daubepnho.store

 KHÔNG CÓ MŨI TÊN ROUTING PRODUCTION ĐÃ XÁC MINH TỚI:

   web-ban-hang-yeubep-shop   (project cô lập, không custom domain)
   portal.yeubep.shop         (DNS không phân giải)
   portal.yeunauan.live       (DNS không phân giải)
   lms.yeubep.shop            (LMS riêng vẫn online nhưng không được Commerce
                               checkpoint hiện tại route độc lập tới)
```

### 3.2 Những kết luận tuyệt đối không được suy ra

| Cách hiểu | Kết luận |
|---|---|
| `yeubep.shop` không hoạt động | **Sai** — domain trả HTTP 200 |
| `yeubep.shop` chạy project `web-ban-hang-yeubep-shop` | **Sai** — domain đang gắn vào `web-ban-hang-chinh-thuc` |
| Hai domain Commerce là hai storefront độc lập | **Sai** — cùng project, artifact và env contract |
| Dữ liệu Commerce đang phân tách theo `sales_site` | **Sai** — cột này đã bị rollback |
| `yeubep.shop` đang route qua Portal Yeubep tới LMS Yeubep | **Chưa được chứng minh và không phải topology restore** |
| `shop.yeunauan.live` và `yeubep.shop` mỗi bên dùng một LMS riêng | **Sai đối với Production đã restore** |
| `lms.yeubep.shop` không tồn tại | **Sai** — LMS này vẫn online, nhưng là tài sản song song |
| Hai Portal mới đã sẵn sàng Production | **Sai** — custom DNS hiện chưa phân giải |

### 3.3 Vì sao `yeubep.shop` vẫn hoạt động

Trong lần restore, domain `yeubep.shop` không bị xóa. Domain được chuyển về
project cũ `web-ban-hang-chinh-thuc`, cùng project đang phục vụ
`shop.yeunauan.live`. Vì vậy:

- cả hai domain đều mở được;
- response root và API course của hai domain có cùng hash;
- cả hai dùng cùng artifact `cafe21b...`;
- không có boundary dữ liệu theo domain trong schema checkpoint;
- project `web-ban-hang-yeubep-shop` mới vẫn tồn tại nhưng chỉ còn domain
  `.vercel.app`, không phục vụ `yeubep.shop`.

### 3.4 Tài sản tồn tại không đồng nghĩa routing đang hoạt động

`lms.yeubep.shop` trả HTTP 200 vì project LMS Yeubep vẫn còn được deploy và giữ
domain riêng. Điều này chỉ chứng minh LMS đó tồn tại độc lập; không chứng minh
Commerce hiện tại gửi `syncCourse`, `syncEnrollment`, `revokeEnrollment` hoặc
deep-link của `yeubep.shop` tới LMS đó.

Tương tự, Vercel project/domain association của hai Portal mới không đủ để coi
chúng là Production: DNS công khai hiện không phân giải và Commerce restore chưa
được cutover sang kiến trúc dual-Portal.

### Domain và project mapping

| Vai trò | Domain | Vercel project | Project ID | Trạng thái |
|---|---|---|---|---|
| Commerce | `shop.yeunauan.live` | `web-ban-hang-chinh-thuc` | `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D` | HTTP 200 |
| Commerce alias | `yeubep.shop` | `web-ban-hang-chinh-thuc` | như trên | HTTP 200, cùng artifact |
| Commerce redirect | `www.yeubep.shop` | `web-ban-hang-chinh-thuc` | như trên | 308 về apex |
| LMS legacy | `www.daubepnho.store` | `web-lms-chinh-thuc` | `prj_TimQqrVhrOLW8y1KI464JBvajwlz` | HTTP 200 |
| Portal hiện hành | `www.yeunauan.live` | `student-web` | `prj_paRRXhaTAqF6NnqbZBK6HsZP4zm3` | HTTP 200 |
| LMS Yeubep độc lập | `lms.yeubep.shop` | `web-lms-yeubep` | `prj_Eo8U6GRZby44lncj4tg2CGgRo9C0` | HTTP 200, không được Commerce restore route riêng |
| Portal Yeubep mới | `portal.yeubep.shop` | `student-portal-yeubep` | `prj_MHZCOD60wqFgyUS44yoO7krqzb9r` | DNS chưa phân giải |
| Portal Yeunauan mới | `portal.yeunauan.live` | `student-portal-yeunauan` | `prj_tzL3Hn1KBlkFuLbaGbm7YCiEdPMd` | DNS chưa phân giải |
| Commerce Yeubep mới | chỉ `.vercel.app` | `web-ban-hang-yeubep-shop` | `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8` | Bị cô lập, không có custom domain |

---

## 4. Danh tính source và deployment

### Commerce đang phục vụ Production

| Thuộc tính | Giá trị |
|---|---|
| Repository | `web-ban-hang-chinh-thuc` |
| Production branch tại checkpoint | `feat/v2-shop-runtime-switch` |
| Exact commit | `cafe21bbe55af86bfb8ac2ebe9155ded849452e8` |
| Deployment | `dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2` |
| Deployment state | `READY`, đã promote |
| Vercel URL | `web-ban-hang-chinh-thuc-7etvlx8t7.vercel.app` |

### LMS legacy

| Thuộc tính | Giá trị |
|---|---|
| Repository/source family | `web-lms-chinh-thuc` |
| Source evidence | `044519300131745bf0e99a98ff152dd2c8afcc92` |
| Deployment | `dpl_HVQvwrveFjxE81cpsoXRraDB34wR` |
| Deployment state | `READY` |
| Lưu ý | Vercel metadata của deployment không trả Git SHA |

### Portal cũ

| Thuộc tính | Giá trị |
|---|---|
| Project | `student-web` |
| Source commit | `6ea837fadf85e7e94f410e38163d58077a9fd895` |
| Rollback/verified deployment | `dpl_92XTh25gr74NznTbr6vJZDfMo5Mq` |
| Framework | Next.js |

---

## 5. Stack công nghệ

### Commerce

- HTML/CSS/JavaScript frontend.
- Vercel Serverless Functions bằng JavaScript ES module.
- Supabase JavaScript client `@supabase/supabase-js`.
- Cloudinary Node SDK cho upload media/biên lai.
- Node built-in test runner.

### LMS legacy

- HTML/CSS/JavaScript frontend, gồm landing/login, danh sách course, lesson và
  LMS Admin.
- Vercel Serverless API.
- Supabase JavaScript client.
- Google Identity/OAuth và Google APIs.
- Google Drive làm nguồn media/quyền truy cập.
- Cloudinary vẫn có thể được dùng cho media ảnh ở các flow liên quan.

### Portal

- Next.js.
- Google login/session.
- Kết nối Portal database và LMS boundary ở phía server.

### Hạ tầng

- Vercel: hosting, serverless, project/domain/environment management.
- Supabase: PostgreSQL, REST API, RLS và database functions.
- Google Drive: file/folder video và permission.
- Cloudinary: ảnh/biên lai tùy luồng.
- Google Identity Services/OAuth: xác thực người dùng và Drive authorization.

---

## 6. Chức năng Commerce

### 6.1 Storefront

- Hiển thị landing page khóa học theo slug/query.
- Hiển thị nội dung khóa học, giảng viên, giá, hình ảnh và ngày dự kiến.
- Hiển thị QR/thông tin chuyển khoản.
- Thu nhận thông tin đăng ký và biên lai.
- Tạo đơn hàng qua API server-side.
- Responsive cho desktop/mobile.

### 6.2 Quản trị khóa học

- Danh sách, tạo và cập nhật course.
- Quản lý trạng thái active/public, nội dung, giá, hình ảnh và cấu hình bán hàng.
- API chính: `/api/courses` và `/api/config`.
- Dữ liệu course được lưu trong Supabase.

### 6.3 Đơn hàng

- Đăng ký: `/api/register`.
- Upload biên lai/media: `/api/upload`.
- Đọc/cập nhật đơn: `/api/orders`.
- Duyệt hàng loạt: `/api/approve-all`.
- Trang vận hành: `orders.html`.
- Sau duyệt có thể gọi Portal/LMS để cấp enrollment.

### 6.4 Xác thực Admin

- `/api/check-auth` kiểm tra quyền Admin.
- Cấu hình dùng `ADMIN_EMAILS` và `ADMIN_PASSWORD` ở server environment.
- Bên thứ ba không được đưa các giá trị này xuống client hoặc commit vào Git.

### 6.5 Đồng bộ ngoài hệ thống

Commerce checkpoint sử dụng contract:

- `SYSTEM1_URL`: target Portal.
- `SYSTEM3_URL`: target LMS.
- `INTERNAL_SYNC_SECRET`: xác thực server-to-server.

Các action phía LMS gồm:

- `syncCourse`;
- `syncEnrollment`;
- `revokeEnrollment`.

Nếu sửa target hoặc secret pairing, phải deploy/test theo cặp Commerce–LMS;
không được thay một phía riêng lẻ.

---

## 7. Chức năng LMS học viên

### 7.1 Đăng nhập và session

- Google sign-in.
- Entry-token dùng một lần/có thời hạn và được lưu dạng hash.
- Verified LMS session và cookie/session signing.
- Session guard theo học viên/thiết bị.
- Khả năng block, supersede hoặc reset session.
- Audit thay đổi thiết bị và cảnh báo chia sẻ tài khoản.

### 7.2 Enrollment và phân quyền

- Enrollment gắn email học viên với `course_slug`.
- Chỉ enrollment active mới được truy cập course tương ứng.
- Sync từ Commerce có thể tạo hoặc revoke enrollment.
- Duplicate enrollment phải được xử lý idempotent.

### 7.3 Nội dung học

- Course, section/chapter và lesson.
- Section được lưu cùng bảng `lessons` với cờ phân loại.
- Thứ tự bài, parent section, previous/next lesson.
- Lesson text, video, tài liệu, công thức, ảnh và supplemental media.
- Theo dõi tiến độ theo học viên và lesson.

### 7.4 Media và video

- Video Google Drive và các provider/URL khác tùy record.
- Main video và supplemental video.
- Poster/thumbnail có fallback theo course cover ở source mới hơn; dữ liệu thực
  tế vẫn phụ thuộc URL ảnh đã được persist.
- File Drive private không được coi là thumbnail ảnh công khai.
- Quyền Drive là external side effect, không tự rollback cùng database.

---

## 8. Chức năng LMS Admin

LMS Admin dùng router server-side tại:

```text
/api/lms/admin?endpoint=<handler>
```

Nhóm chức năng:

- xác thực Admin/allowlist;
- quản lý course và site configuration;
- quản lý section/lesson;
- upload ảnh, recipe, material và video Drive;
- xác minh media;
- enrollment đơn lẻ và bulk enrollment;
- danh sách học viên và trace;
- session reset/account-sharing alert;
- Google Drive OAuth/status/health;
- cấp/thu hồi permission;
- Drive sync, repair, queue và retry;
- readiness/diagnostics/runtime mode.

### Giới hạn hiện tại

- Schema sau restore không còn `courses.sales_site` hoặc
  `courses.learning_course_slug`.
- Không có `courses.learning_site`.
- LMS Admin Production không có boundary hai LMS tenant được đảm bảo bằng schema.
- Các chức năng dual-LMS/multisite từng test trong Preview không phải chức năng
  Production hiện hành.

---

## 9. Portal

Portal cũ tại `www.yeunauan.live` là thành phần trung gian cho:

- Google login;
- hiển thị post/nội dung Portal;
- course handoff;
- tạo LMS entry-token/internal request;
- chuyển người dùng sang LMS.

Portal phải giữ bí mật service-role/internal secret ở server. Browser không được
quyết định LMS URL, Supabase ref hoặc secret pairing.

Hai Portal deployment mới được thiết kế với fixed identity riêng, nhưng DNS chưa
hoạt động. Không được cấu hình Commerce Production trỏ tới chúng cho tới khi:

1. DNS và HTTPS đã PASS;
2. sensitive environment đã đủ;
3. OAuth origins đã được owner cấu hình;
4. authenticated rehearsal đã PASS;
5. có owner approval cutover riêng.

---

## 10. Supabase và mô hình dữ liệu

### Project Production chính

| Thuộc tính | Giá trị |
|---|---|
| Project ref | `aqozjkfwzmyfunqvcyjv` |
| Vai trò | Commerce + LMS legacy + session/sync/Drive metadata |
| Public tables | 27 |
| Restore checkpoint | `supabase-before-multistore-20260725-154808` |

### Row counts đã xác minh sau restore

| Bảng | Rows |
|---|---:|
| `courses` | 7 |
| `orders` | 28 |
| `site_config` | 73 |
| `course_slug_mappings` | 6 |
| `lessons` | 39 |
| `portal_post_course_mappings` | 0 |
| `student_enrollments` | 20 |

Các bảng còn lại không bị mutation trong transaction restore và giữ count từ
safety snapshot ngay trước restore:

| Bảng | Rows |
|---|---:|
| `students` | 13 |
| `lesson_progress` | 0 |
| `drive_admin_accounts` | 3 |
| `drive_permission_logs` | 59 |
| `drive_sync_queue` | 9 |
| `sync_outbox` | 5 |
| `sync_deliveries` | 3 |
| `sync_dead_letters` | 0 |
| `student_active_sessions` | 16 |
| `lms_entry_tokens` | 38 |
| `lms_verified_sessions` | 38 |
| `student_device_change_logs` | 64 |
| `admin_audit_logs` | 5 |
| `posts` | 1 |

### Inventory 27 bảng

1. `admin_audit_logs`
2. `course_slug_mappings`
3. `courses`
4. `drive_admin_accounts`
5. `drive_permission_logs`
6. `drive_sync_queue`
7. `lesson_progress`
8. `lessons`
9. `lms_entry_tokens`
10. `lms_verified_sessions`
11. `orders`
12. `platform_runtime_config`
13. `platform_runtime_config_audit`
14. `portal_post_course_mappings`
15. `posts`
16. `site_config`
17. `student_account_admin_notes`
18. `student_account_risk_reviews`
19. `student_account_risk_summaries`
20. `student_active_sessions`
21. `student_device_change_logs`
22. `student_enrollments`
23. `student_session_controls`
24. `students`
25. `sync_dead_letters`
26. `sync_deliveries`
27. `sync_outbox`

### Ranh giới dữ liệu quan trọng

- `courses.slug` là định danh nghiệp vụ quan trọng.
- Enrollment dựa trên email và course slug.
- Lesson liên kết course bằng slug và section hierarchy.
- Progress liên kết email/lesson.
- Session/token/audit chứa dữ liệu bảo mật và PII.
- Service-role bypass RLS; API authorization vẫn phải kiểm tra ở code.
- Delete course/lesson có thể kéo theo enrollment/progress tùy constraint.

### Schema đã rollback

Sau restore không còn bảy cột multistore:

- `courses.sales_site`;
- `courses.learning_course_slug`;
- `orders.sales_site`;
- `orders.sales_host`;
- `orders.idempotency_key`;
- `orders.price_snapshot`;
- `orders.learning_course_slug`.

Bên thứ ba không được viết code giả định các cột này đang tồn tại.

---

## 11. Google Drive và Cloudinary

### Google Drive

- Lưu/stream video và tài liệu theo course/lesson.
- Có pool metadata của Drive Admin.
- Có permission log và sync queue.
- Có retry/repair/health flow.
- Credential phải chỉ tồn tại server-side.
- Cấp/thu hồi permission là mutation ngoài database.

### Cloudinary

- Commerce dùng SDK Cloudinary cho upload.
- Checkpoint có linkage metadata nhưng restore không xóa asset Cloudinary.
- Dọn asset phải có manifest và approval riêng; không suy luận orphan chỉ từ DB.

---

## 12. Cấu hình environment

Commerce Production hiện khớp đúng 12 tên biến của checkpoint:

| Nhóm | Biến |
|---|---|
| Admin | `ADMIN_EMAILS`, `ADMIN_PASSWORD` |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Portal/LMS sync | `SYSTEM1_URL`, `SYSTEM3_URL`, `INTERNAL_SYNC_SECRET` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |

Các biến multistore/routing mới đã được loại khỏi project Commerce restore,
bao gồm `SALES_SITE`, `PUBLIC_SITE_URL`, `LMS_SYNC_URL` và các feature flag
isolation. Điều này là chủ đích của checkpoint.

Quy tắc bàn giao:

- không gửi raw value qua chat/email/tài liệu;
- không commit `.env`;
- owner nhập secret trực tiếp trong Vercel/Supabase/Google Console;
- chỉ đối chiếu presence/scope/fingerprint;
- thay sync secret phải thay đồng bộ hai đầu.

---

## 13. Bảo mật và phân quyền

Kiểm soát hiện hữu:

- Vercel environment cho server secret;
- Supabase service-role chỉ ở server;
- internal sync secret cho service-to-service;
- Google login/session verification;
- entry token dạng hash;
- device/session guard;
- RLS cho một số luồng học viên;
- Admin allowlist/auth;
- audit và risk/device logs;
- CORS cho browser boundary.

Rủi ro cần lưu ý:

1. Service-role có quyền cao, nên lỗi IDOR trong API có blast radius lớn.
2. Email đang là identity xuyên nhiều bảng; phải normalize thống nhất.
3. CORS không thay thế authentication.
4. Session, token và device log là dữ liệu nhạy cảm.
5. Drive credential/permission là external state.
6. Hai domain Commerce cùng artifact/config nên hiện không có tenant isolation.
7. Các project cô lập vẫn tồn tại và cần inventory/access control rõ ràng.
8. File `.env` cục bộ không phải nguồn sự thật Production và không được bàn giao
   nguyên trạng cho vendor.

---

## 14. Backup, restore và rollback

### Checkpoint đã restore

```text
C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\
_local_backups\supabase-before-multistore-20260725-154808
```

- Checksum manifest SHA-256:
  `04180c3315b0136cf9c57445b6aefe3e56f56a3772d712a9e3742f265b4d7e6a`
- 16/16 file checksum PASS.

### Safety backup trước restore

```text
C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\
_private_backups\pre-multistore-restore-20260806-095716
```

- AES-256-GCM.
- Key được bảo vệ bằng Windows DPAPI CurrentUser.
- Decrypt/readback PASS.
- Không giữ plaintext.
- Payload SHA-256:
  `38456e5a113a11cddffc5a48a558ca2b288ad9172aa2f07447356fdca014c18f`.
- Restore evidence SHA-256:
  `5c9d2da65de944dc7afaa454807653fdd0c1ba9a7558d625d79179bd4eef79c1`.

### Rollback nguyên tắc

1. Freeze approve/revoke/sync.
2. Chụp fresh encrypted safety backup.
3. Promote exact known-good Vercel deployment.
4. Chỉ restore schema/data sau impact diff và owner approval.
5. Không blind-restore toàn DB.
6. Không tự rollback Drive/Cloudinary theo DB.
7. Smoke Commerce, Portal, LMS, sync và session sau restore.

---

## 15. Kết quả xác minh sau restore

| Kiểm tra | Kết quả |
|---|---|
| Checkpoint checksum | 16/16 PASS |
| Safety backup decrypt/readback | PASS |
| Commerce deployment | READY, promoted |
| 7 bảng backed scope | 0 added, 0 removed, 0 changed |
| Multistore columns còn lại | 0 |
| Commerce env names | 12/12, không thiếu/thừa |
| `shop.yeunauan.live` | 200 |
| `yeubep.shop` | 200, cùng response hash với storefront cũ |
| `www.yeubep.shop` | 308 về apex |
| Canonical course API trên hai domain | 200, cùng response hash |
| Yeubep clone course | 404/không còn tồn tại |
| `www.daubepnho.store` | 200 |
| `lms.yeubep.shop` | 200, tài sản độc lập |
| Raw secret/PII trong evidence | Không |

---

## 16. Thành phần không thuộc Production chính

Không được nhầm các thành phần sau với topology restore:

- `web-ban-hang-yeubep-shop`: project còn tồn tại nhưng không có custom domain.
- `web-lms-yeubep`: LMS riêng vẫn online và giữ Supabase riêng
  `ssbyfpigrozumzatyqhf`, nhưng Commerce checkpoint không route riêng tới nó.
- `student-portal-yeubep` và `student-portal-yeunauan`: project/domain association
  tồn tại nhưng DNS custom domain chưa hoạt động.
- Các branch/Preview multisite, dual-LMS, dual-Portal: chưa merge/cutover theo
  topology hiện hành.
- Các feature flag isolation: không có trong Commerce checkpoint.

Không được xóa các tài sản này chỉ vì không nằm trong topology chính. Việc xóa
cần approval, backup và target manifest riêng.

---

## 17. Nợ kỹ thuật và rủi ro

### Ưu tiên cao

1. Hai storefront cùng một artifact/config, không có isolation theo domain.
2. Nhiều module dùng chung một Supabase/service-role boundary.
3. Portal/LMS routing dựa trên environment pairing; sai pairing có thể cấp quyền
   nhầm hệ thống.
4. Drive permission không transactional với database.
5. Production artifact LMS không có Git SHA trực tiếp trong Vercel metadata.
6. Nhiều dự án song song đã được tạo nhưng chưa hoàn tất DNS/cutover lifecycle.

### Ưu tiên trung bình

- Frontend lớn dạng HTML/JavaScript nguyên khối khó bảo trì.
- Logic authorization phân tán giữa API, RLS và database function.
- Email là cross-system identity.
- Outbox/reconciliation tồn tại nhưng phải xác minh mode đang thực sự active.
- Cần retention policy cho token/session/audit/Drive logs.
- Cần asset inventory trước khi dọn Cloudinary/Drive.

---

## 18. Hướng dẫn cho bên thứ ba khi tiếp nhận

### Không được làm ngay

- Không chạy migration multisite cũ.
- Không coi `yeubep.shop` là storefront độc lập về dữ liệu.
- Không trỏ Commerce sang LMS Yeubep/Portal mới nếu chưa rehearsal.
- Không copy/merge hai Supabase.
- Không rotate secret từng phía.
- Không tải hoặc gửi file `.env` cho vendor.
- Không xóa project/Drive/Cloudinary/test data nếu chưa có manifest.

### Discovery bắt buộc

1. Chụp fresh Vercel project/domain/deployment/env-name inventory.
2. Chụp fresh Supabase schema/count/policy/function inventory.
3. Trace chính xác `SYSTEM1_URL`, `SYSTEM3_URL` và sync secret pairing.
4. Trace luồng register → approve → Portal → LMS enrollment.
5. Trace login → entry-token → verified session.
6. Trace Drive upload/permission/retry/revoke.
7. Xác minh source-to-deployment identity cho từng project.
8. Dùng fixture/dry-run cho E2E; không dùng học viên/order thật.

### Test matrix tối thiểu

- storefront/config/course;
- register/upload/order;
- approve/duplicate/revoke;
- wrong secret;
- course not found;
- Portal login/handoff;
- LMS entry token/session;
- enrollment authorization và IDOR;
- lesson/progress;
- main/supplemental video và poster;
- Drive permission/retry;
- mobile Safari;
- rollback deployment và database readback.

---

## 19. Các lựa chọn kiến trúc tiếp theo

### A. Duy trì topology hiện tại

Phù hợp nếu hai domain chỉ là alias marketing cho cùng catalog/hệ thống.
Chi phí thấp nhưng không có isolation.

### B. Hoàn thiện dual storefront/dual LMS

Cần fixed server-side identity, database boundary rõ ràng, hai secret pair độc
lập, Portal riêng, DNS/OAuth hoàn chỉnh và staged rehearsal. Không nên tiếp tục
từ deployment dở dang mà không fresh audit.

### C. Tách service dần theo strangler pattern

Giữ hệ thống cũ chạy, đưa auth, entitlement, media và sync thành các boundary có
contract rõ ràng. Đây thường là hướng ít rủi ro hơn viết lại toàn bộ.

### D. Viết lại

Chỉ phù hợp khi có đặc tả nghiệp vụ, data migration plan, parallel run và rollback
đầy đủ. Không được thay hệ thống hiện hữu bằng big-bang cutover.

---

## 20. Checklist bàn giao

Bên thứ ba nên nhận:

- quyền Git read-only đúng repository;
- Vercel project/deployment/domain inventory đã che;
- Supabase schema-only dump và sanitized counts;
- API contract và sequence diagram;
- danh sách env name/scope, không kèm raw value;
- Google OAuth origins/redirect inventory;
- Drive root/course-folder inventory đã che;
- backup/checksum/runbook;
- test baseline và known failures;
- owner-approved mutation/cutover process.

Secret phải được owner cấp qua secret manager hoặc Dashboard phù hợp, theo
least-privilege và có thời hạn; không đưa vào bộ tài liệu này.

---

## 21. Kết luận

Production chính hiện đã được đưa về checkpoint pre-multistore ngày 25/07/2026.
Hai domain Commerce cùng chạy một artifact và một Supabase boundary; LMS legacy
vẫn hoạt động tại `www.daubepnho.store`; Portal cũ hoạt động tại
`www.yeunauan.live`.

Các hệ thống Yeubep riêng và hai Portal mới vẫn tồn tại như tài sản song song,
nhưng chưa phải routing Production của Commerce sau restore. Mọi dự án tiếp theo
phải bắt đầu bằng fresh audit, phân loại active/isolated asset và rehearsal
fail-closed. Không được dựa vào tài liệu swap cũ để suy luận trạng thái hiện hành.

Đây là baseline kỹ thuật nên dùng để bên thứ ba đánh giá hiện trạng và đề xuất
phương án tiếp theo.

### Câu mô tả ngắn bắt buộc khi vẽ sơ đồ

> Hai domain `shop.yeunauan.live` và `yeubep.shop` hiện cùng trỏ vào một Commerce
> project/artifact và một Supabase chính. Portal cũ và LMS legacy là luồng
> Production của baseline restore. LMS Yeubep và các project Portal/Commerce mới
> là tài sản song song/cô lập; không được nối mũi tên từ storefront tới các tài
> sản này nếu chưa có bằng chứng network/runtime và cutover approval.
