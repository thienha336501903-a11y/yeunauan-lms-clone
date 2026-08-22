# V4 WORK HANDOVER — 2026-08-22

> Mục đích: bàn giao trạng thái hệ thống V4 hiện tại cho chế độ Work/đội kỹ thuật tiếp quản mà không phải suy đoán lại lịch sử. Tài liệu này ưu tiên trạng thái Production, điểm rollback, kiến trúc playback, dữ liệu thực tế, các tồn tại và thứ tự xử lý tiếp.

## 1. Trạng thái tổng quan

Hệ thống V4 đang **hoạt động Production**. Khóa thứ ba `banh-my-nhan-chay-chu-quyen` đã import lịch sử Telegram, publish, có learner thật và đã test playback trên thiết bị thật. Lỗi playback chậm do Service Worker cắt Range thành từng block 2 MiB đã được xử lý ở LMS PR #62. Sau PR #62, log Production của video 47.5 MB đã đổi từ hơn 20 request 2 MiB sang 1 request chính cho toàn file và người dùng xác nhận tốc độ hiện tại ổn.

Tại thời điểm bàn giao:
- LMS Production: READY.
- Cloner Production: READY.
- Reader Agent: đang heartbeat liên tục, `/api/reader/complete` trả 200 khoảng mỗi 15–16 giây.
- Không có PR mở ở LMS/Cloner.
- Không còn dữ liệu test prefix `__clone_factory_test*` trong course/source/enrollment/media ticket.
- 3 khóa V4 đang active + published + mapping enabled.
- Video của 3 source hiện không thiếu `file_id` và không thiếu thumbnail metadata.

## 2. Repo, commit, deployment hiện tại

### LMS
- Repo: `thienha336501903-a11y/yeunauan-lms-clone`
- `main`: `070c454f8563bb8e71c655b473c57cc72292dbd0`
- Commit: `perf: preserve browser playback ranges end-to-end (#62)`
- Vercel project: `prj_0mFDJL5lV9q0NBjgBphs0Y6j1Xtc`
- Production deployment: `dpl_9fhQLbScGh29vWpfPTyLyHkhQ6uJ`
- Canonical: `https://yeunauan-lms-clone.vercel.app`
- Status: READY

### Telegram Cloner
- Repo: `thienha336501903-a11y/telegram-channel-cloner`
- `main`: `8084121c97d79dfdb419add29ba61881a62822a8`
- Commit: `fix: support Reader-imported history media over MTProto (#29)`
- Vercel project: `prj_5cwOs0JpEUgC5PfpOdn0ffX4Ly0j`
- Production deployment: `dpl_EwDCkKTv5Y5ZauR8H4PEULcCVs5R`
- Canonical: `https://telegram-channel-cloner.vercel.app`
- `/api/health`: HTTP 200, database/configured checks OK.
- Cloner đang dùng đúng 12 Node functions — chạm giới hạn Hobby hiện tại, nên mọi route mới phải cân nhắc rất kỹ.

### Supabase
- Project ID: `yyiavtiwtekkocqpephr`
- Dùng cho course/mapping/source messages/enrollment/playback tickets/settings.
- Không có schema migration mới trong đợt tối ưu playback cuối.

## 3. Stable rollback — KHÔNG ĐƯỢC DI CHUYỂN

Các stable cũ phải giữ nguyên. Hai stable mới đã tạo sau khi khóa thứ ba và playback ổn định:

- LMS: `stable/v4-third-source-playback-final-20260822` → `070c454f8563bb8e71c655b473c57cc72292dbd0`
- Cloner: `stable/v4-third-source-mtproto-final-20260822` → `8084121c97d79dfdb419add29ba61881a62822a8`

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

Source IDs:
- Bánh mỳ nhân chảy Chu Quyên: `b94fb89f-8e7f-42e9-8506-b0cd6d79d22f`, chat `-1002043800547`, source `active=false` có chủ ý vì không MASTER.
- Cá giã tay: `de2e9a07-631b-4e93-8140-24c3b8893ec3`, chat `-1004486574754`, source `active=true` (MASTER).
- Nhân Trung Thu: `1c40a544-4678-4188-8d02-c7a348e9e1f1`, chat `-1002168236470`, source `active=false` có chủ ý vì không MASTER.

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

## 6. Các PR quan trọng đã merge

### Cloner
- #24 exact live count
- #25 Reader Agent queue/history automation
- #26 non-admin startup fallback
- #27 `post_json` keyword fix
- #28 automatic deletion reconcile
- #29 Reader historical MTProto media support — current main

### LMS
- #55 media ticket retention
- #56 playback IP binding fix — IP binding tắt, UA + crypto proof giữ nguyên
- #57 startup performance / range cap trước đây
- #58 Reader MTProto media preflight/feed
- #59 preserve open-ended Range
- #60 force Service Worker update propagation
- #61 range-less playback → `bytes=0-`
- #62 preserve finite browser playback Range end-to-end — current main

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

### Production result sau #62
Video 47,508,364 bytes:
- probe `bytes=0-1`: ~315 ms
- request chính `bytes=0-47508363`: ~5.49 s để stream hoàn tất toàn file
- browser có thêm tail request `bytes=41877504-47508363`: ~1.17 s
- Không còn chuỗi 20+ request 2 MiB.
- Người dùng xác nhận video hiện phát ổn.

**Quy tắc quan trọng:** không reintroduce cap 2 MiB trong Service Worker nếu chưa có log thiết bị thật chứng minh cần thiết.

## 8. Việc Work nên làm tiếp — theo ưu tiên

### P0 — Cross-course real-device E2E sau #62
Chưa được coi là PASS toàn hệ thống cho tới khi test thiết bị thật trên ít nhất 2 khóa khác.

Khuyến nghị:
1. `cagiatay`
   - test 1 video <20 MB để đi Bot API.
   - test 1 video >20 MB để đi MTProto.
   - dữ liệu hiện có cả hai loại; ví dụ source_message_id 3 khoảng 19.7 MB và source_message_id 14 khoảng 35.5 MB.
2. `nhan-trung-thu-cao-cap-chu-quyen`
   - test một video lớn >100 MB; source có video tới khoảng 487.6 MB.

Acceptance log:
- tiny probe có thể xuất hiện.
- request playback chính phải là 1 Range lớn/open-ended hợp lý.
- Không được quay lại chuỗi finite Range cố định 2 MiB.
- UX mobile phải bắt đầu phát trong thời gian chấp nhận được.

Không sửa code trước khi lấy log đúng lần bấm của thiết bị thật.

### P1 — Đồng bộ Service Worker version fallback
Audit cuối phát hiện:
- `v4-sw-refresh.html` Production đang force `/v4-media-sw.js?v=4`.
- Trong `v4.html`, fallback của `ensureMediaWorker()` vẫn hard-code `/v4-media-sw.js?v=1`.

Trong flow bình thường, controller v4 đã tồn tại nên fallback v1 không chạy; phiên test Production vừa PASS không bị ảnh hưởng. Tuy nhiên trên thiết bị mới/controllerchange timeout, đây là rủi ro có thể đăng ký lại worker URL cũ.

Cách xử lý đề xuất:
- feature branch riêng.
- đổi fallback `?v=1` → `?v=4` hoặc tốt hơn dùng một hằng `PLAYBACK_WORKER_PATH` duy nhất được chia sẻ/đồng bộ với bootstrap.
- thêm regression test bắt buộc bootstrap và fallback cùng version.
- Preview + CI + explicit merge confirmation.
- Sau deploy test lại một thiết bị thật; không thay Range logic.

Hai scratch branch được tạo trong quá trình audit nhưng chưa có commit thay đổi, Work có thể bỏ qua/xóa nếu muốn:
- `perf/v4-first-frame-20260822`
- `fix/v4-worker-version-consistency-20260822`

### P1 — First-frame/autoplay chỉ xử lý nếu cross-course test còn chậm
`v4.html` hiện await cấp lease + gửi lease vào Service Worker rồi mới gọi `video.play()`, và `video.play().catch(()=>{})` đang nuốt lỗi. Đây là điểm có thể ảnh hưởng user-gesture/autoplay trên một số mobile browser.

Không nên sửa chủ động khi UX hiện đã ổn. Nếu cross-course test vẫn chậm:
- instrument click → lease response → SW lease ack → `loadedmetadata` → `playing`/first frame.
- log/reveal `play()` rejection thay vì nuốt lỗi.
- chỉ sau khi có bằng chứng mới cân nhắc pre-prepare lease cho video gần viewport.

### P1 — DEP0169 warning
Cả LMS và Cloner runtime hiện có Node `[DEP0169] url.parse()` warning. Đây đang bị Vercel phân loại như error log nhưng request thực tế vẫn 2xx/3xx.

Nên xử lý sau khi playback cross-course PASS:
- truy vết dependency/call-site.
- chuyển sang WHATWG `URL` nếu code nội bộ sở hữu call-site.
- không trộn cleanup này vào PR playback.

### P2 — Audit-only reconcile metric
Ở deletion reconcile từng có trường hợp `deleted_count` null khi thực tế deleted=0. Không ảnh hưởng correctness, chỉ là observability/audit quality.

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

- [ ] Đọc tài liệu này và `docs/V4_ADMIN_NEW_COURSE_RUNBOOK.md`.
- [ ] Verify LMS main = `070c454...` và Cloner main = `8084121...` trước khi thay đổi.
- [ ] Verify Production deployments vẫn READY.
- [ ] Verify Reader heartbeat 200.
- [ ] Test cross-course mobile: cagiatay Bot API + MTProto.
- [ ] Test Nhân Trung Thu video lớn.
- [ ] Nếu tất cả nhanh: đánh dấu global playback regression PASS.
- [ ] Làm PR nhỏ đồng bộ worker fallback v1 → v4.
- [ ] Sau PR đó test mobile lại.
- [ ] Chỉ nếu first-frame vẫn chậm mới instrument/autoplay flow.
- [ ] Xử lý DEP0169 ở PR cleanup riêng.
- [ ] Khi hoàn tất, tạo stable rollback mới; không di chuyển stable hiện tại.

## 11. Định nghĩa “V4 hoàn thiện” cho checkpoint tiếp theo

V4 có thể coi là fully stabilized khi:
- 3 khóa V4 đều playback PASS trên mobile thật.
- Bot API (<20 MB) và MTProto (>20 MB) đều PASS.
- Ít nhất một video >100 MB PASS.
- Không có chuỗi Range 2 MiB regression.
- Service Worker bootstrap/fallback cùng version.
- Không có test artifacts.
- Reader heartbeat/reconcile hoạt động.
- Security invariants giữ nguyên: signed lease/proof, anti-replay, UA binding, IP unbound, no raw Telegram playback URL.
- Có stable rollback mới sau checkpoint cuối.

---

**Current handover status:** hệ thống đang usable/Production, khóa Bánh mỳ đã PASS UX playback trên thiết bị thật sau PR #62. Phần quan trọng nhất còn lại là cross-course real-device validation và một PR nhỏ đồng bộ worker fallback version trước khi tuyên bố V4 fully stabilized toàn hệ thống.
