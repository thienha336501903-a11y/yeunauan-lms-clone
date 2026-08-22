# V4 WORK HANDOVER — 2026-08-22

> Mục đích: bàn giao trạng thái hệ thống V4 hiện tại cho chế độ Work/đội kỹ thuật tiếp quản mà không phải suy đoán lại lịch sử. Tài liệu này ưu tiên trạng thái Production, điểm rollback, kiến trúc playback, dữ liệu thực tế, các tồn tại và thứ tự xử lý tiếp.

## 1. Trạng thái tổng quan

Hệ thống V4 đang **hoạt động Production và fully stabilized**. Playback đã PASS trên thiết bị thật cho cả bốn khóa V4, gồm Bot API, MTProto và video tới 487.6 MB. Lỗi Service Worker cắt Range thành block 2 MiB đã được xử lý ở LMS PR #62; cross-course E2E và khóa mới tạo hoàn toàn từ giao diện V4 đều xác nhận không tái xuất hiện. LMS PR #64 đã đồng bộ Service Worker bootstrap/fallback về cùng URL version. Cloner PR #30 đã sửa observability để job reconcile ghi `deleted_count=0` thay vì `null`; Reader Agent local Windows đã cập nhật và restart.

Luồng factory mới đã PASS Production: người vận hành chỉ cần nhập một Telegram post link trong Wizard, hệ thống tự chuẩn hóa channel ID, đăng ký source, queue Reader import và liên kết source với Draft. LMS PR #66 và Cloner PR #31 cung cấp luồng này; Cloner PR #32 loại bỏ Bot self-forward không cần thiết khi Reader đã gửi MTProto descriptor hợp lệ, nhờ đó import history không còn vượt timeout 60 giây.

Tại thời điểm bàn giao:
- LMS Production: READY.
- Cloner Production: READY.
- Reader Agent: đang heartbeat liên tục, `/api/reader/complete` trả 200 khoảng mỗi 15–16 giây.
- Không có PR code mở ở LMS/Cloner; PR tài liệu checkpoint cuối mới có thể đang chờ merge.
- Không còn dữ liệu test prefix `__clone_factory_test*` trong course/source/enrollment/media ticket.
- 4 khóa V4 đang active + published + mapping enabled.
- Video của 4 source hiện không thiếu metadata playback và không thiếu thumbnail metadata.

## 2. Repo, commit, deployment hiện tại

### LMS
- Repo: `thienha336501903-a11y/yeunauan-lms-clone`
- `main`: `aac2f7108aa63beee8dd27786dc92a128ed76669`
- Commit: `feat: create V4 source from one Telegram post link (#66)`
- Vercel project: `prj_0mFDJL5lV9q0NBjgBphs0Y6j1Xtc`
- Production deployment: `dpl_BwYEyXCxvTdfG8MnibcqQnv1ehwZ`
- Canonical: `https://yeunauan-lms-clone.vercel.app`
- Status: READY

### Telegram Cloner
- Repo: `thienha336501903-a11y/telegram-channel-cloner`
- `main`: `2b0a938482b592d4620855b2b88b785def5fd094`
- Commit: `fix: preserve Reader MTProto media during ingest (#32)`
- Vercel project: `prj_5cwOs0JpEUgC5PfpOdn0ffX4Ly0j`
- Production deployment: `dpl_epKxC7jemYqEamMoz2auQzxjPk5B`
- Canonical: `https://telegram-channel-cloner.vercel.app`
- `/api/health`: HTTP 200, database/configured checks OK.
- Cloner đang dùng đúng 12 Node functions — chạm giới hạn Hobby hiện tại, nên mọi route mới phải cân nhắc rất kỹ.
- Node `[DEP0169] url.parse()` là warning từ Vercel production launcher/`@vercel/node`, không phải call-site ứng dụng. Vercel issue: `vercel/vercel#16109`. Không dùng `NODE_OPTIONS=--no-deprecation` vì sẽ che toàn bộ deprecation warning.

### Supabase
- Project ID: `yyiavtiwtekkocqpephr`
- Dùng cho course/mapping/source messages/enrollment/playback tickets/settings.
- Không có schema migration mới trong đợt tối ưu playback cuối.

## 3. Stable rollback — KHÔNG ĐƯỢC DI CHUYỂN

Các stable cũ phải giữ nguyên. Hai stable mới đã tạo sau khi khóa thứ ba và playback ổn định:

- LMS: `stable/v4-third-source-playback-final-20260822` → `070c454f8563bb8e71c655b473c57cc72292dbd0`
- Cloner: `stable/v4-third-source-mtproto-final-20260822` → `8084121c97d79dfdb419add29ba61881a62822a8`

Checkpoint mới sau khi factory/import/playback khóa thứ tư PASS:

- LMS: `stable/v4-new-course-production-20260822` → `aac2f7108aa63beee8dd27786dc92a128ed76669`
- Cloner: `stable/v4-new-course-production-20260822` → `2b0a938482b592d4620855b2b88b785def5fd094`

Không di chuyển hoặc ghi đè bất kỳ stable nào nêu trên.

Stable cũ quan trọng vẫn giữ nguyên, ví dụ:
- LMS `stable/v4-final-20260821`
- LMS `stable/v4-live-sync-final-20260822`
- Cloner `stable/v4-final-20260821`
- Cloner `stable/v4-live-sync-final-20260822`
- Cloner `stable/v4-reader-reconcile-final-20260822`

Không force-move/overwrite các nhánh stable.

## 4. Snapshot dữ liệu V4 lúc bàn giao

| Course slug | Published | Source MASTER | Indexed/Actual | Video | Photo | Missing video file_id | Missing video thumb | Active enrollment |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `banh-my-nhan-chay-chu-quyen` | yes | no | 88/88 | 13 | 71 | 0 | 0 | 1 |
| `cagiatay` | yes | yes | 14/14 | 13 | 0 | 0 | 0 | 2 |
| `nhan-trung-thu-cao-cap-chu-quyen` | yes | no | 18/18 | 13 | 0 | 0 | 0 | 1 |
| `combo-8-mon-banh-tet-chu-quyen` | yes | no | 125/125 | 8 | 116 | 8 (MTProto-only, expected) | 0 | 2 |

Source IDs:
- Bánh mỳ nhân chảy Chu Quyên: `b94fb89f-8e7f-42e9-8506-b0cd6d79d22f`, chat `-1002043800547`, source `active=false` có chủ ý vì không MASTER.
- Cá giã tay: `de2e9a07-631b-4e93-8140-24c3b8893ec3`, chat `-1004486574754`, source `active=true` (MASTER).
- Nhân Trung Thu: `1c40a544-4678-4188-8d02-c7a348e9e1f1`, chat `-1002168236470`, source `active=false` có chủ ý vì không MASTER.
- Combo 8 món bánh Tết Chu Quyên: `71f6b46b-0ac2-4e1f-b860-8a7aa64e537d`, chat `-1002045374878`, source `active=false` có chủ ý vì không MASTER.

Cleanup audit:
- test courses: 0
- test sources: 0
- test enrollments: 0
- test media tickets: 0
- Có thể có playback ticket thật còn TTL từ phiên xem hiện tại; không được xóa chỉ vì không mang prefix test.

## 5. Kiến trúc V4 hiện tại

### Feed / learner
1. Learner vào `/learning?course=<slug>`.
2. Course V4 đi qua `v4-sw-refresh.html` để đảm bảo playback Service Worker cập nhật.
3. V4 UI tải feed qua `/api/lms/portal?endpoint=v4-telegram-feed`.
4. Media metadata lấy từ Cloner/Supabase mapping.

### Protected video playback
1. UI xin lease qua `v4-telegram-play`.
2. LMS tạo EC P-256 key pair + token/ticket.
3. Public JWK/proof hash lưu server-side trong `lms_v4_media_tickets`; private JWK chỉ gửi cho Service Worker phiên hiện tại.
4. Service Worker ký request bằng ECDSA P-256.
5. Guard ở Cloner kiểm tra origin, bearer token, `X-V4-Playback`, timestamp, nonce anti-replay, signature, UA binding.
6. `bound_ip_hash` **cố ý để null**. Không reintroduce IP binding vì đã gây playback kém ổn định trước đây.
7. Gateway chọn transport:
   - video/media phù hợp dưới Bot API limit: Bot API.
   - video lớn / Reader historical media: MTProto.
8. MTProto stream theo chunk 512 KiB, có backpressure và abort support; không buffer toàn video vào RAM.
9. MP4 có virtual-faststart để hỗ trợ seek/khởi phát tốt hơn.

### Reader Agent
- Reader user session/OTP/2FA/API hash không upload lên server.
- Local Windows session được giữ cục bộ; secrets dùng DPAPI trong `.reader-windows-secrets.json`.
- Reader Agent poll queue và complete khoảng 15–16 giây.
- Bot access được verify trước khi đăng ký/import source.
- Historical media có thể được hydrate bằng Bot API file_id nếu bot có quyền; fallback MTProto server-side vẫn tồn tại.
- Khi Reader history đã có MTProto descriptor hợp lệ, ingest giữ nguyên descriptor và không self-forward lại qua Bot API. Batch mặc định của Reader CLI là 20 message như guard thứ hai chống timeout.

## 6. Các PR quan trọng đã merge

### Cloner
- #24 exact live count
- #25 Reader Agent queue/history automation
- #26 non-admin startup fallback
- #27 `post_json` keyword fix
- #28 automatic deletion reconcile
- #29 Reader historical MTProto media support
- #30 report Reader reconcile `deleted_count`
- #31 register source from one Telegram post link
- #32 preserve Reader MTProto media during ingest — current main

### LMS
- #55 media ticket retention
- #56 playback IP binding fix — IP binding tắt, UA + crypto proof giữ nguyên
- #57 startup performance / range cap trước đây
- #58 Reader MTProto media preflight/feed
- #59 preserve open-ended Range
- #60 force Service Worker update propagation
- #61 range-less playback → `bytes=0-`
- #62 preserve finite browser playback Range end-to-end
- #64 keep Service Worker bootstrap/fallback version consistent
- #66 create/select V4 source from one Telegram post link — current main

## 7. Sự cố playback chậm và kết luận kỹ thuật

### Triệu chứng
Trên thiết bị thật, bấm Play video 47.5 MB mất rất lâu. Log ban đầu cho thấy browser bị ép tải liên tiếp theo block 2 MiB:
`0–2 MiB → 2–4 MiB → 4–6 MiB ...`
Mỗi block lại phát sinh media gateway 307 + warmup 206.

### Vì sao phải qua nhiều PR
- #59 xử lý open-ended Range.
- #60 xử lý Service Worker cũ còn điều khiển tab.
- #61 xử lý request không có Range.
- Log thiết bị thật sau đó mới xác nhận Chrome mobile thực tế gửi **finite Range rất lớn**, ví dụ `bytes=0-47508363`; rule cap 2 MiB vẫn cắt loại này.
- #62 bỏ cap finite Range và giữ nguyên Range browser yêu cầu.

### Production result sau #62/#64
Video 47,508,364 bytes:
- probe `bytes=0-1`: ~315 ms
- request chính `bytes=0-47508363`: ~5.49 s để stream hoàn tất toàn file
- browser có thêm tail request `bytes=41877504-47508363`: ~1.17 s
- Không còn chuỗi 20+ request 2 MiB.
- Người dùng xác nhận video hiện phát ổn.

Cross-course real-device result:

| Course | Transport/size | Production result |
|---|---|---|
| `cagiatay` | Bot API · 19,691,500 bytes | PASS; probe `0-1`, main `0-19691499` |
| `cagiatay` | MTProto · 25,101,613 bytes | PASS; probe `0-1`, main `0-25101612` |
| `nhan-trung-thu-cao-cap-chu-quyen` | MTProto · 126,600,630 bytes | PASS; main `0-126600629`, follow-up ranges lớn/open-ended |
| `nhan-trung-thu-cao-cap-chu-quyen` | MTProto · 487,629,464 bytes | PASS; main `0-487629463`; người dùng ghi nhận chậm hơn một chút nhưng phát hoàn tất |
| `combo-8-mon-banh-tet-chu-quyen` | MTProto · 408,535,230 bytes | PASS trên thiết bị thật; probe `0-1`, các request chính/tua giữ Range lớn, không có chuỗi 2 MiB |

Không bài nào tái xuất hiện chuỗi request cố định 2 MiB. Video 487.6 MB có request chính khoảng 57 giây; gateway redirect chỉ khoảng 0.25–0.30 giây, nên chưa có bằng chứng cho lỗi autoplay/user-gesture và không sửa theo phỏng đoán.

**Quy tắc quan trọng:** không reintroduce cap 2 MiB trong Service Worker nếu chưa có log thiết bị thật chứng minh cần thiết.

## 8. Trạng thái đóng checkpoint

Factory khóa mới, Reader import, publish và playback thiết bị thật đã PASS. Khóa mới có 125 message phân biệt, 124 media (8 video, 116 ảnh), không thiếu video thumbnail/metadata, không có Reader job treo và không còn artifact test. Import job Production `86cd9b15-2464-44ad-a79d-46ad86d668a3` hoàn tất một lần, không lỗi; source reconcile hoàn tất sau import.

Stable rollback mới đã tạo trên cả LMS và Cloner. Việc còn lại duy nhất của tài liệu này là merge PR docs sau xác nhận rõ của owner; merge docs không thay đổi runtime application.

Owner quyết định không chờ chu kỳ reconcile 6 giờ chỉ để xác nhận metric. Cloner PR #30 đã PASS CI/Preview/Production health; Reader Agent đã cập nhật, restart và heartbeat 200 liên tục. Correctness của reconcile đã được xác nhận trước đó qua audit event `deleted_count=0`; phần còn lại chỉ là quan sát giá trị được copy vào queue job ở chu kỳ tự động tiếp theo và không chặn checkpoint.

First-frame/autoplay không cần sửa ở checkpoint này: cross-course playback đã PASS và video rất lớn chỉ chậm tương ứng với luồng dữ liệu lớn. Nếu có regression mới, phải instrument `click → lease response → SW lease ack → loadedmetadata → playing/first frame` trước khi đổi code.

`[DEP0169]` hiện là external platform issue. Không tạo cleanup PR ứng dụng chỉ để suppress warning.

### P2 — Preview Google OAuth
Random Vercel Preview có thể gặp Google `origin_mismatch`. Canonical Production login hoạt động. Không thêm mọi preview origin vào Google OAuth và không tắt protection toàn cục chỉ để né lỗi này.

## 9. Quy tắc vận hành bắt buộc khi Work tiếp quản

1. Chỉ làm trên clone/current authorized resources; không đụng legacy Production.
2. Không commit trực tiếp vào `main`.
3. Mọi code change: feature branch → PR → CI/Preview → test → xin xác nhận merge.
4. Không merge khi chưa có xác nhận rõ của user.
5. Không mutate dữ liệu thật để test nếu không cần thiết.
6. Test data phải dùng prefix `__clone_factory_test*` và cleanup sau test.
7. Không thay/di chuyển stable rollback branches.
8. Không sửa `cagiatay` làm dữ liệu test; chỉ đọc/test playback learner hợp lệ.
9. Không reintroduce playback IP binding.
10. Không expose Telegram bot token, MTProto session, Reader secrets, OTP/2FA, private JWK hoặc service-role keys.
11. Reader user session phải ở local Windows; server chỉ giữ bot-side MTProto session đã mã hóa.
12. Với performance issue, phải lấy log đúng request thiết bị thật trước khi sửa.
13. Không coi FIXED chỉ vì CI/Preview PASS; playback phải có Production + real device + gateway log cùng PASS.

## 10. Checklist tiếp quản đề xuất cho Work

- [x] Đọc handover và xác minh GitHub/Vercel/Supabase.
- [x] Verify Production deployments READY và health 200.
- [x] Verify Reader heartbeat 200 mỗi 15–16 giây.
- [x] Test cross-course mobile: `cagiatay` Bot API + MTProto.
- [x] Test Nhân Trung Thu video >100 MB và 487.6 MB.
- [x] Xác nhận global playback Range regression PASS.
- [x] Merge LMS PR #64 đồng bộ worker fallback/bootstrap v4.
- [x] Merge Cloner PR #30 sửa Reader reconcile metric và restart Agent local.
- [x] Xác định DEP0169 là external Vercel runtime issue; không suppress.
- [x] Audit `deleted_count`: root cause đã sửa ở PR #30; owner quyết định không chờ chu kỳ 6 giờ chỉ để quan sát metric.
- [x] Tạo và publish khóa V4 mới hoàn toàn từ giao diện bằng một Telegram post link.
- [x] Reader import 125/125 message, không còn timeout 60 giây.
- [x] Playback video 408.5 MB của khóa mới PASS trên thiết bị thật và gateway log.
- [x] Tạo stable rollback mới; không di chuyển stable hiện tại.
- [ ] Merge PR tài liệu checkpoint cuối theo xác nhận user.

## 11. Định nghĩa “V4 hoàn thiện” cho checkpoint tiếp theo

V4 có thể coi là fully stabilized khi:
- 4 khóa V4 đều playback PASS trên mobile thật.
- Bot API (<20 MB) và MTProto (>20 MB) đều PASS.
- Ít nhất một video >100 MB PASS.
- Không có chuỗi Range 2 MiB regression.
- Service Worker bootstrap/fallback cùng version.
- Không có test artifacts.
- Reader heartbeat/reconcile hoạt động.
- Security invariants giữ nguyên: signed lease/proof, anti-replay, UA binding, IP unbound, no raw Telegram playback URL.
- Có stable rollback mới sau checkpoint cuối.

---

**Current handover status:** V4 **fully stabilized**. Bốn khóa V4, Bot API, MTProto, video >100 MB, factory one-post-link, Reader import/reconcile, Service Worker, security invariants, Production health, cleanup audit và rollback checkpoint mới đều PASS. Chỉ còn merge PR tài liệu này theo xác nhận owner; không còn thay đổi runtime cần thiết cho checkpoint.
