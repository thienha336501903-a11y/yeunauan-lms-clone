# Runbook: Admin mở khóa học V4 mới từ Telegram

Mục tiêu: mở một khóa học V4 mới an toàn, không làm thay đổi MASTER hiện tại và không cần test kỹ thuật lại toàn hệ thống.

## Link vận hành

- Cloner Admin: https://telegram-channel-cloner.vercel.app/?mode=v4-source
- LMS V4 Admin: https://yeunauan-lms-clone.vercel.app/v4-admin.html
- Trang học viên: https://yeunauan-lms-clone.vercel.app/my-courses.html

## A. Chuẩn bị kênh Telegram

1. Tạo kênh Telegram riêng cho khóa học.
2. Thêm bot `@yeunauan_channel_cloner_bot` làm Administrator của kênh.
3. Nếu kênh public, đặt `@username` dễ nhận biết.
4. Nếu đăng ký bằng username báo `chat not found`, dùng Chat ID số. Với link private dạng `https://t.me/c/4234133962/4` thì Chat ID là `-1004234133962`.
5. Không chọn kênh mới làm MASTER. Nguồn khóa học V4 mới phải giữ vai trò `Nguồn V4`, tức `active=false`.

## B. Đăng ký nguồn V4

1. Mở Cloner Admin → phần **Nguồn Telegram V4**.
2. Nhập `@username` hoặc Chat ID số → **Đăng ký nguồn V4**.
3. Bấm **Làm mới** và kiểm tra kênh xuất hiện trong danh sách.
4. Vai trò phải là **Nguồn V4**, không phải MASTER.

Nếu khóa chỉ dùng các bài đăng từ thời điểm đăng ký trở đi, chuyển thẳng sang mục D.

## C. Import các bài đã đăng trước khi đăng ký nguồn

Chỉ cần làm khi kênh đã có bài cũ.

Trên máy đã cài reader, đứng trong repo `telegram-channel-cloner` và cập nhật bản mới:

```powershell
git pull
```

Đảm bảo phiên PowerShell có đủ ba biến môi trường, nhưng không in secret ra màn hình:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `READER_INGEST_SECRET`

Chạy:

```powershell
python reader-cli/export_history.py --channel "@username_kenh" --cloner-url "https://telegram-channel-cloner.vercel.app"
```

Có thể dùng username public thay cho Chat ID nếu Telethon không resolve được ID số.

Kết quả chuẩn:

```text
Done. Indexed N messages. MASTER mirror role was not changed.
```

Reader hiện tự:
- bỏ service message rỗng;
- hydrate ảnh/video lịch sử bằng Bot API;
- lấy `file_id` và thumbnail;
- xóa ngay message self-forward tạm;
- không đổi vai trò MASTER.

Không gửi API hash, OTP, 2FA hoặc `READER_INGEST_SECRET` qua chat.

## D. Tạo khóa học trong LMS V4 Admin

1. Mở LMS V4 Admin.
2. Tạo khóa mới:
   - Tên khóa: tên hiển thị cho học viên.
   - Slug: chỉ chữ thường, số và dấu `-`; không dùng `_`.
   - Nguồn Telegram: chọn đúng nguồn vừa đăng ký.
3. Sau khi tạo, giữ khóa ở trạng thái **Draft / chưa Sẵn sàng**.
4. Không publish ngay nếu chưa cấp học viên.

Trạng thái kỹ thuật chuẩn sau khi tạo:
- `delivery_mode = v4`
- `is_published = false`
- mapping `enabled = true`
- `media_mode = telegram_bot_poc`

## E. Cấp quyền học viên

1. Trong V4 Admin, nhập email học viên.
2. Chọn ngày hết hạn nếu khóa có thời hạn; nếu không thì để trống.
3. Bấm cấp quyền.
4. Trước khi publish, học viên phải thấy khóa ở trạng thái **Đã duyệt – Chờ lên bài** và chưa thể vào học.

Đây là kiểm tra Draft gate bắt buộc trước khi phát hành.

## F. Publish khóa

1. Khi nội dung và quyền học viên đã đúng, bấm **Sẵn sàng / Publish**.
2. Học viên bấm **Làm mới** ở trang khóa học.
3. Khóa phải chuyển sang **Sẵn sàng vào học** và xuất hiện nút **Vào học**.

## G. Kiểm tra nhanh trước khi bàn giao

Chỉ cần kiểm tra một lần cho khóa mới:

- bài text hiển thị đúng;
- ảnh hiển thị đúng;
- video có thumbnail;
- bấm Play video phát được;
- bài Telegram mới sau khi đăng ký tự xuất hiện qua webhook;
- sửa bài Telegram thì nội dung LMS cập nhật theo.

Nếu các mục trên ổn thì không cần chạy lại full E2E.

## H. Thu hồi hoặc hết hạn học viên

- Thu hồi: dùng nút **Thu hồi** trong V4 Admin.
- Hết hạn: đặt `expired_at` khi cấp/quản lý quyền.
- Sau khi thu hồi/hết hạn, học viên không còn được truy cập khóa.

## I. Quy tắc an toàn

- Không đổi MASTER khi chỉ thêm nguồn cho khóa V4.
- Không xóa hoặc chỉnh source MASTER đang dùng.
- Không publish trước khi kiểm tra Draft gate.
- Không để secret/OTP/API hash xuất hiện trong ảnh chụp hoặc chat.
- Nếu import lịch sử có media, luôn dùng reader phiên bản mới nhất (`git pull` trước khi chạy).
- Nếu Cloner Admin đăng ký bằng `@username` báo `chat not found`, chuyển sang Chat ID số thay vì sửa quyền bot khi bot đã là Admin.

## Checklist siêu ngắn

`Tạo kênh → thêm bot Admin → đăng ký Nguồn V4 → import lịch sử nếu có → tạo khóa Draft → cấp học viên → kiểm tra Chờ lên bài → Publish → test text/ảnh/video → vận hành.`
