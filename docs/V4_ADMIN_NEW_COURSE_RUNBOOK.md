# Runbook: Admin mở khóa học V4 mới từ Telegram

Mục tiêu: mở một khóa học V4 mới an toàn, không làm thay đổi MASTER hiện tại và không cần test kỹ thuật lại toàn hệ thống.

## Link vận hành

- Cloner Admin: https://telegram-channel-cloner.vercel.app/?mode=v4-source
- LMS V4 Wizard: https://yeunauan-lms-clone.vercel.app/v4-course-wizard.html
- Trang học viên: https://yeunauan-lms-clone.vercel.app/my-courses.html

## A. Chuẩn bị kênh Telegram

1. Tạo kênh Telegram riêng cho khóa học.
2. Thêm bot `@yeunauan_channel_cloner_bot` làm Administrator của kênh.
3. Đăng ít nhất một bài trong kênh và sao chép link của bài đó.
4. Không cần tự đổi link private thành Chat ID; Wizard và Cloner tự chuẩn hóa link.
5. Không chọn kênh mới làm MASTER. Nguồn khóa học V4 mới phải giữ vai trò `Nguồn V4`, tức `active=false`.

## B. Đăng ký nguồn V4

1. Mở **LMS V4 Wizard**.
2. Dán link một bài dạng `https://t.me/tenkenh/123` hoặc `https://t.me/c/4234133962/4`.
3. Bấm **Tự nhận kênh & đăng ký**; xác nhận ở Cloner nếu được yêu cầu đăng nhập.
4. Hệ thống quay lại Wizard và chọn sẵn nguồn vừa đăng ký. Vai trò phải là **Nguồn V4**, không phải MASTER.

`@username` và Chat ID số vẫn được Cloner hỗ trợ như phương án tương thích cũ.

## C. Import các bài đã đăng trước khi đăng ký nguồn

Khi nguồn chưa được index, Cloner tự tạo job import. Reader Agent trên máy Windows tự nhận job; admin không cần chạy lệnh cho từng kênh.

Trong Wizard, số bài có thể tạm thời là `0` trong lúc Reader xử lý. Có thể tiếp tục tạo Draft, nhưng Preflight sẽ chặn Publish cho tới khi nguồn đã có nội dung.

Reader hiện tự:
- bỏ service message rỗng;
- hydrate ảnh/video lịch sử bằng Bot API;
- lấy `file_id` và thumbnail;
- xóa ngay message self-forward tạm;
- không đổi vai trò MASTER.

Không gửi API hash, OTP, 2FA hoặc `READER_INGEST_SECRET` qua chat.

## D. Tạo khóa học trong LMS V4 Wizard

1. Tiếp tục ngay trong LMS V4 Wizard.
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
- Reader Agent phải tiếp tục chạy trên máy Windows; Telegram user session không được đưa lên cloud.
- Nếu link bài báo `chat not found`, kiểm tra bot đã được thêm làm Admin của đúng kênh.

## Checklist siêu ngắn

`Tạo kênh → thêm bot Admin → đăng 1 bài → dán link vào Wizard → tạo khóa Draft → cấp học viên → Preflight → Publish → test text/ảnh/video → vận hành.`
