# CLONE THREE-MODE FINAL HANDOVER — 2026-08-23

> Phạm vi: toàn bộ hệ thống Clone gồm Commerce, LMS và Telegram Cloner/Reader. Tài liệu này nối tiếp `V4_WORK_HANDOVER_20260822.md`; không áp dụng cho legacy Production.

## 1. Kết luận checkpoint

Hệ thống Clone hiện hỗ trợ ba phương thức bán và giao bài độc lập:

| `delivery_mode` | Dữ liệu checkout | Sau duyệt | Nơi học |
|---|---|---|---|
| `lms` | Gmail, bill | LMS enrollment; không Telegram invite | LMS cũ |
| `telegram` | Telegram username, bill | Telegram invite/join; không LMS enrollment | Kênh Telegram |
| `v4` | Gmail, bill | LMS enrollment V4 idempotent; không Telegram invite | LMS V4 |

Commerce PR #18 hoàn thiện Admin/API/Storefront/order cho ba mode. LMS PR #68 bảo toàn `delivery_mode=v4`, gắn `source_order_id`, chặn Telegram-direct đi vào LMS enrollment và cho Wizard dùng lại course Commerce đã tồn tại. LMS PR #69 thêm health check. LMS PR #70 chỉ hiển thị hướng dẫn mở trình duyệt cho Zalo mobile. Commerce PR #19 bổ sung cleanup fail-closed cho dữ liệu factory test.

Full Commerce → V4 Production E2E đã PASS: tạo course, nhận source từ một Telegram post link, Reader import, Draft/preflight/Publish, checkout Gmail + bill, pending gate, duyệt, enrollment idempotent, Google login, My Courses, `/learning` route V4, revoke và expiry. Cleanup đã hoàn tất.

## 2. Deployment manifest

| Service | Repository `main` | Vercel deployment | Canonical | Status |
|---|---|---|---|---|
| Commerce | `8a71e94be7f2cf88b7455d3ed900cf07729be140` | `dpl_5NPkLTiKqmJ3KjsrTjjJyiLrjh3J` | `https://yeunauan-commerce-clone.vercel.app` | READY; health/database 200 |
| LMS | `892f7ad125ca0bf4bc49354d4a1d021a1adb1a30` | `dpl_HMe2Ne1J3BDjhyBuF7xbwBCSAUSa` | `https://yeunauan-lms-clone.vercel.app` | READY; health/database 200 |
| Cloner | `2b0a938482b592d4620855b2b88b785def5fd094` | `dpl_epKxC7jemYqEamMoz2auQzxjPk5B` | `https://telegram-channel-cloner.vercel.app` | READY; database/configured checks 200 |
| Supabase Clone | project `yyiavtiwtekkocqpephr` | n/a | clone only | reachable |

Không có PR mở ở ba repo tại thời điểm audit. Các stable branch cũ giữ nguyên, không force-update.

## 3. Production Clone data audit sau E2E cleanup

Baseline đã trở lại đúng snapshot trước test:

- courses: 11 (`lms=7`, `v4=4`), tất cả active;
- orders: 39;
- students: 9;
- student enrollments: 26;
- Telegram sources: 4;
- V4 course-source mappings: 4;
- course/order/enrollment/mapping/media ticket mang prefix factory test: 0.

Source MASTER `cagiatay` giữ nguyên: source tồn tại, mapping thật tồn tại và 14 source messages còn nguyên. Học viên có sẵn không bị xóa.

## 4. Regression evidence cho ba mode

### LMS cũ

- 23 approved orders lịch sử còn nguyên.
- 20 approved order/course/email combinations hiện có enrollment active tương ứng; ba order lịch sử còn lại không được suy diễn là lỗi vì predate correlation/enrollment snapshot hiện hành.
- Commerce regression test khóa checkout Gmail, pending gate và LMS enrollment behavior.
- Không thay Drive/Bunny/media cũ trong các PR tích hợp V4.

### Telegram-direct

- Một approved Telegram order thật còn nguyên invite record và join decision.
- Không có LMS enrollment khớp order Telegram đó.
- Commerce policy/test bắt buộc Telegram dùng username/invite và chặn LMS enrollment.

### V4

- Production factory E2E đã chứng minh pending chưa có enrollment; duyệt tạo đúng một enrollment có `source_order_id`; re-sync không tạo trùng.
- Từ chối thu hồi quyền; duyệt lại tạo đúng một enrollment; expiry chặn My Courses và `/learning`.
- Không tạo Telegram invite cho order V4.
- Playback Bot API, MTProto, video >100 MB và video rất lớn vẫn PASS theo `V4_WORK_HANDOVER_20260822.md`.

## 5. Ownership — không ghi đè lẫn nhau

- Commerce sở hữu giá, poster, mô tả, thứ tự hiển thị và trạng thái bán.
- V4 sở hữu Telegram source, mapping, import, preflight và Publish nội dung.
- LMS sở hữu student, enrollment, expiry, session và learner routing.
- Cloner/Reader sở hữu Telegram message/media ingest, webhook và reconcile.

`raw_data` phải merge theo field. Commerce không được đổi source/mapping/Publish khi chỉnh giá. V4 Publish không được đổi giá hoặc tự bật bán. Không tự xóa source khi tháo mapping course.

## 6. Quy trình tạo khóa mới

1. Tạo course ở Commerce Admin, chọn một trong ba mode.
2. Với V4, dán một Telegram post link; không nhập Chat ID thủ công.
3. Wizard chuẩn hóa channel, đăng ký source và queue Reader import.
4. Chờ import xong; kiểm tra Draft và preflight 0 blocker.
5. Publish nội dung V4.
6. Quay lại Commerce, điền dữ liệu thương mại và bật bán.
7. Học viên checkout bằng Gmail; order ở Chờ duyệt.
8. Admin duyệt; enrollment được tạo idempotent.
9. Học viên đăng nhập đúng Gmail, mở Khóa học của tôi và Vào học.

Không bật bán V4 chưa sẵn sàng nội dung nếu không có xác nhận chủ đích.

## 7. Reader Windows sau reboot

- Installer ưu tiên Task Scheduler; nếu Windows từ chối quyền, dùng HKCU Run của user hiện tại.
- Telegram user session, API hash, OTP/2FA và Reader secrets chỉ ở máy Windows local.
- Sau đăng nhập Windows, kiểm tra process `reader_agent.py` đang chạy.
- Reader tắt không làm mất playback nội dung đã import; import mới chờ trong queue.
- Khi Reader chạy lại, job được claim idempotent, heartbeat và reconcile tiếp tục.

Audit 2026-08-23: queue `running=0`, `queued=0`; reconcile gần nhất `done`, `deleted_count=0`, `last_error=null`. Một import failure lịch sử `import_exit_1` của khóa Combo được giữ làm audit; retry import và các reconcile sau đó đều `done`.

## 8. Security invariants

- Giữ signed playback lease, ECDSA P-256 proof, nonce anti-replay và UA binding.
- `bound_ip_hash` tiếp tục null; không đưa IP binding trở lại.
- Không lộ raw Telegram playback URL.
- Không đưa Reader user session, bot token, service-role key, Telegram API hash, OTP/2FA hoặc private JWK lên client/tài liệu/backup không mã hóa.
- `X-Sync-Secret` phải fail-closed.
- Telegram order tuyệt đối không tạo LMS enrollment.
- V4 learner phải có enrollment hợp lệ và course đã Publish.

## 9. Health và warning

Commerce, LMS và Cloner đều trả health 200 sau cleanup. `[DEP0169] url.parse()` vẫn xuất hiện ở Vercel launcher/dependency trên cả ba service; không có call-site trong code ứng dụng. Không suppress toàn bộ deprecation warning và không nâng dependency không liên quan chỉ để làm log sạch.

Preview Google OAuth `origin_mismatch` không phải lỗi canonical Production. Không thêm random Preview origins hoặc phá cấu hình Production.

## 10. Restore guide

1. Không restore đè hệ thống đang chạy để thử nghiệm.
2. Tạo môi trường Supabase/Vercel tạm và dùng backup đã redaction/encryption.
3. Restore schema trước, sau đó dữ liệu theo thứ tự dependency.
4. Deploy đúng SHA trong manifest hoặc stable checkpoint tương ứng.
5. Cấu hình secret qua environment; không commit secret.
6. Reader Telegram user session chỉ phục hồi trên Windows local bằng backup local đã mã hóa/DPAPI phù hợp.
7. Chạy health, login, My Courses, ba-mode policy tests và playback probe trước khi promote.

## 11. Incident routing

| Triệu chứng | Kiểm tra đầu tiên |
|---|---|
| Không thấy course/giá/poster | Commerce config/courses và trạng thái bán |
| Order duyệt nhưng chưa có quyền LMS/V4 | Commerce sync status → LMS `/api/sync` → `source_order_id` |
| Telegram không nhận invite/join | Commerce Telegram fields → bot webhook/join decision |
| Source chưa import | Cloner source/job → Reader heartbeat/process |
| Thiếu/xóa bài không đồng bộ | Reader reconcile job/event |
| V4 không vào học | Publish gate → enrollment/expiry → session |
| Video chậm/lỗi | Browser Range → LMS lease/SW → Cloner gateway/transport logs |

Với playback performance, phải instrument và lấy log thiết bị thật trước khi đổi Range/autoplay.

## 12. Việc đóng release còn lại

1. Merge PR tài liệu này sau xác nhận owner.
2. Tạo stable rollback mới, tên mới, cho Commerce/LMS/Cloner; không di chuyển stable cũ.
3. Tạo backup cuối gồm ba repo, deployment manifest và Supabase Clone đã redaction/encryption; kiểm tra checksum.
4. Restore verification chỉ trên môi trường tạm.

Sau bốn bước trên, checkpoint tích hợp Commerce + LMS cũ + Telegram-direct + LMS V4 có thể đóng là fully stabilized.
