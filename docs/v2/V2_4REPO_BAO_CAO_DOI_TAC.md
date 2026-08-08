# Báo cáo nâng cấp V2 toàn hệ thống

> Tài liệu dành cho đối tác / chủ hệ thống — viết dễ hiểu, **không đi sâu kỹ thuật**.
>
> **Ngày:** 17/07/2026
> **Phạm vi:** Toàn bộ 4 website của nền tảng học trực tuyến
> **Mục đích:** Giải thích V2 lần này cải tiến gì so với V1, vì sao an toàn, và bạn cần làm gì để trải nghiệm.

---

## 1. Tóm tắt trong 1 phút

Lần nâng cấp V2 này **không chỉ sửa một trang web**, mà đưa **cả 4 thành phần** của hệ thống lên cùng một chuẩn V2, và điều khiển bằng **một nút chuyển đổi chung**.

| | V1 (hiện tại người dùng đang dùng) | V2 (đã cài xong, chờ bật) |
|---|---|---|
| **Phạm vi** | 4 website hoạt động tách rời, mỗi nơi một kiểu | 4 website cùng nghe **một nút switch** |
| **Chống chia sẻ tài khoản** | Có ở một phần, chưa đồng bộ | Đồng bộ giữa trang đăng nhập và trang học |
| **An toàn khi nâng cấp** | Nâng cấp “một chiều”, khó lùi | **Bấm V1 là quay lại ngay**, không mất dữ liệu |
| **Bảo mật vận hành** | Còn vài điểm yếu (đã xử lý trong đợt này) | Siết chặt: đóng lỗ hổng, bỏ mật khẩu mặc định yếu |
| **Quan sát hệ thống** | Khó biết 4 website đang “cùng phiên bản” hay không | Có “bảng kiểm tra sức khỏe” cho từng website |

**Điểm quan trọng nhất với đối tác:**

> V1 **vẫn nguyên vẹn** và đang phục vụ người dùng. V2 đã cài sẵn. Việc bật V2 là **quyết định của bạn**, không tự động. Bất cứ lúc nào cũng bấm về V1 trong vài giây.

---

## 2. Hệ thống gồm 4 website — vì sao phải nâng cấp cả 4?

Nền tảng của bạn không phải một trang, mà là **4 website chuyên trách** cùng phục vụ một học viên:

| # | Website | Việc chính | Ví dụ địa chỉ |
|---|---|---|---|
| 1 | **Cửa hàng (Shop)** | Bán khóa học, nhận đơn, duyệt thanh toán | `yeubep.shop` |
| 2 | **Cổng học viên (Portal)** | Học viên đăng nhập Google, xem khóa đã mua | `www.yeunauan.live` |
| 3 | **Phòng học (LMS)** | Xem bài giảng, học bài | `www.daubepnho.store` |
| 4 | **Trang quản trị nội dung (Admin)** | Soạn bài, quản lý nội dung cho học viên | `admin.yeunauan.live` |

**Hành trình học viên điển hình:**

```
Mua khóa ở Shop  →  Admin/Shop duyệt  →  Portal đăng nhập  →  LMS học bài
```

**Vấn đề nếu chỉ nâng cấp 1 website:**
- Bật “một tài khoản — một thiết bị” ở LMS mà Portal vẫn cho đăng nhập nhiều máy → **lỗ hổng vẫn còn**.
- Bật V2 ở LMS nhưng Shop/Portal/Admin vẫn V1 → **không có một nút lùi chung** khi có sự cố.
- Mỗi website “tự quyết” → đối tác khó hiểu hệ thống đang ở phiên bản nào.

**Vì vậy đợt này** chúng tôi đưa **cả 4 website** vào cùng một cơ chế: **một nút switch V1 ↔ V2 cho toàn hệ thống**.

---

## 3. V1 đang yếu ở đâu? (nói bằng ngôn ngữ kinh doanh)

| Vấn đề thực tế | Ảnh hưởng đến doanh thu / vận hành |
|---|---|
| Một Gmail học được trên nhiều máy cùng lúc | Học viên **chia sẻ tài khoản** → thất thu |
| Chống chia sẻ chưa đồng bộ giữa “cửa đăng nhập” và “phòng học” | Có thể lách một bên vẫn vào học được |
| Nâng cấp từng website riêng lẻ | Rủi ro “nửa nạc nửa mỡ”, khó quay lại đồng bộ |
| Một lỗ hổng bảo mật nghiêm trọng ở Shop (đã đóng) | Có nguy cơ lộ thông tin cấu hình nhạy cảm ra ngoài |
| Mật khẩu mặc định yếu ở trang Admin | Ai đoán được mật khẩu mặc định có thể vào quản trị |
| Không có “bảng đồng hồ” chung cho 4 website | Khó biết 4 website đang cùng phiên bản hay không |

V2 lần này **nhắm đúng các điểm trên**, không phải “làm lại từ đầu” hay “đổi giao diện cho đẹp”.

---

## 4. Những nâng cấp chính của V2 so với V1

### 4.1. Một nút switch cho cả 4 website (quan trọng nhất)

**Trước (V1):** mỗi website “sống riêng”. Muốn lùi phiên bản phải can thiệp kỹ thuật từng nơi.

**Giờ (V2):** trong trang quản trị LMS (`admin.html` → tab **⚙️ Hệ Thống**) có:

- Nút **V1** — ép toàn hệ thống về cách hoạt động cũ.
- Nút **V2** — cho phép các tính năng mới hoạt động (vẫn cần bật từng tính năng cụ thể).
- **Nút dừng khẩn cấp (kill switch)** — trong tình huống bất ngờ, ép về V1 ngay, không cần chờ.

**Lợi ích với đối tác:**
- Thử V2 thoải mái, không sợ “đi không trở lại”.
- Sự cố → bấm V1 → **vài giây** là về như cũ.
- **Không mất dữ liệu** học viên, đơn hàng, bài giảng khi chuyển đổi.
- Mọi lần bấm đều **ghi nhật ký** (ai bấm, lúc nào) — minh bạch.

### 4.2. “Một tài khoản — một thiết bị” đồng bộ toàn hệ thống

**Trước:**
- Cổng học viên (Portal) chặn nhiều thiết bị theo cách riêng.
- Phòng học (LMS) chặn theo cách riêng.
- Hai nơi **không cùng một “công tắc”** → dễ lệch, khó giải thích cho học viên.

**Giờ (V2):**
- Cả Portal và LMS **cùng nghe một nút switch**.
- Khi switch = V1 → hành vi quen thuộc như trước (không đột ngột đổi trải nghiệm học viên).
- Khi switch = V2 **và** bật tính năng “một thiết bị” → chặn đồng bộ: máy thứ hai nhận thông báo lịch sự *“Tài khoản đang được sử dụng trên thiết bị khác.”*

**Lợi ích:**
- Bảo vệ doanh thu khóa học.
- Học viên thật chuyển máy bình thường: đăng xuất máy cũ → đăng nhập máy mới.
- Không “đá” người đang học giữa chừng.

### 4.3. Đăng xuất dứt điểm + hỗ trợ khi mất thiết bị

**Trước:** đóng trình duyệt chưa chắc đã thoát hẳn phía máy chủ.

**Giờ (V2):**
- Bấm đăng xuất → phiên **thu hồi ngay tại máy chủ**.
- Quản trị viên có thể **thu hồi phiên** khi học viên mất máy / quên đăng xuất (bắt buộc ghi lý do, có nhật ký).

**Lợi ích:** kiểm soát phiên học rõ ràng, hỗ trợ học viên thật nhanh chóng.

### 4.4. Đồng bộ dữ liệu có “lưới an toàn”

**Trước:** khi Shop duyệt đơn và cấp quyền học, dữ liệu được đẩy sang các hệ thống khác. Nếu mạng trục trặc, khó biết đã thành công hay chưa, khó sửa.

**Giờ (V2):**
- Mỗi sự kiện quan trọng (mở khóa, cấp quyền, thu hồi quyền) được **ghi vào “hộp thư đi”**.
- Hệ thống **tự thử lại** khi lỗi tạm thời.
- Có **đối soát** để phát hiện lệch dữ liệu giữa các bên.

**Lợi ích:** học viên đã mua **không bị “mất quyền học”** vì sự cố kỹ thuật âm thầm.

### 4.5. Siết chặt bảo mật vận hành (đã xử lý trong đợt này)

Đây là phần **đối tác cần biết**, dù không cần hiểu kỹ thuật:

| Việc đã làm | Ý nghĩa đơn giản |
|---|---|
| **Đóng lỗ hổng nghiêm trọng ở Shop** (đã xác nhận trên hệ thống thật: không còn lộ thông tin cấu hình) | Không ai từ ngoài có thể “hỏi” ra mật khẩu / khóa nội bộ qua một đường dẫn đặc biệt nữa |
| **Bỏ mật khẩu mặc định yếu** ở trang Admin | Nếu quên cấu hình mật khẩu thật, hệ thống **từ chối an toàn** thay vì dùng mật khẩu dễ đoán |
| **Siết khóa bí mật phiên đăng nhập** ở Portal | Không còn “khóa dự phòng” yếu khi cấu hình thiếu |
| **Không để lộ bí mật** trong các trang chẩn đoán | Trang theo dõi chỉ báo “có cấu hình / chưa”, **không in ra** giá trị mật khẩu hay khóa |

> **Lưu ý quan trọng cho chủ hệ thống:** vì lỗ hổng Shop từng tồn tại trên hệ thống thật, **các mật khẩu / khóa liên quan cần được đổi mới (rotate)** — đây là việc chỉ chủ hệ thống làm được trên bảng điều khiển Vercel / nhà cung cấp. Đội kỹ thuật **không thể** (và không nên) tự đổi giúp.

### 4.6. Bảng kiểm tra sức khỏe cho từng website

**Giờ (V2):** mỗi website có một “cửa sổ chẩn đoán” nội bộ (chỉ đội vận hành truy cập được bằng khóa riêng) để xem:

- Website đang ở **V1 hay V2**?
- Nút dừng khẩn cấp đang bật hay tắt?
- Các tính năng phụ (một thiết bị, đồng bộ nâng cao…) đang bật hay tắt?

**Lợi ích:** sau khi bấm switch, có thể **xác nhận cả 4 website cùng nghe** — không phải “tin lời” mà có bằng chứng.

---

## 5. So sánh nhanh V1 ↔ V2 (bảng một trang)

| Hạng mục | V1 | V2 |
|---|---|---|
| Phạm vi điều khiển | Từng website riêng | **1 nút cho cả 4 website** |
| Quay lại phiên bản cũ | Khó, cần kỹ thuật | **Bấm V1 / kill switch — vài giây** |
| Mất dữ liệu khi chuyển phiên bản? | Rủi ro nếu làm sai | **Không** — chỉ đổi thiết lập, không xóa dữ liệu |
| Chống chia sẻ tài khoản | Có một phần, chưa đồng bộ | **Đồng bộ Portal + LMS** qua cùng switch |
| Đăng xuất | Chưa dứt điểm phía máy chủ | **Thu hồi phiên ngay** |
| Đồng bộ Shop → Portal/LMS | Đẩy thẳng, khó theo dõi khi lỗi | **Có hộp thư đi + tự thử lại + đối soát** |
| Lỗ hổng lộ cấu hình Shop | Từng tồn tại | **Đã đóng trên hệ thống thật** |
| Mật khẩu mặc định Admin | Từng có mặc định yếu | **Đã bỏ — thiếu cấu hình thì từ chối an toàn** |
| Theo dõi 4 website cùng phiên bản? | Không có | **Có bảng chẩn đoán từng website** |
| Trải nghiệm học viên khi chưa bật V2 | Như hiện tại | **Giữ nguyên** (V2 chỉ “cho phép”, chưa ép bật tính năng) |

---

## 6. V2 đã sẵn sàng đến đâu? (cập nhật 17/07/2026)

| Hạng mục | Trạng thái |
|---|---|
| Nâng cấp LMS (phòng học) — switch, một thiết bị, đăng xuất, thu hồi, đồng bộ | ✅ Hoàn thành, đã lên hệ thống thật |
| Nâng cấp Shop (cửa hàng) — đóng lỗ hổng + switch + chẩn đoán | ✅ Hoàn thành, đã lên hệ thống thật |
| Nâng cấp Portal (cổng học viên) — switch + điều phối một thiết bị | ✅ Hoàn thành, đã lên hệ thống thật |
| Nâng cấp Admin (quản trị nội dung) — switch + bỏ mật khẩu mặc định yếu | ✅ Hoàn thành, đã lên hệ thống thật |
| Kiểm thử tự động từng website | ✅ Toàn bộ vượt qua (hơn 360 kịch bản cộng dồn) |
| Kiểm tra chéo “4 website cùng nghe 1 switch” | ✅ Đạt (3/4 đồng ý ngay; Admin cần thêm 2 cấu hình — xem mục 8) |
| Nút switch V1 ↔ V2 trên trang quản trị | ✅ Sẵn sàng dùng |
| **Bật V2 cho toàn bộ học viên** | ⏳ **Chờ quyết định của bạn** — không tự động |

**Hiện tại:** người dùng vẫn đang được phục vụ theo **V1** (ổn định). V2 đã cài xong và **chỉ chờ bạn bật khi sẵn sàng**.

---

## 7. Bạn (chủ hệ thống / đối tác) test V1 ↔ V2 như thế nào?

Không cần biết kỹ thuật. Làm theo 6 bước:

1. Mở trang quản trị LMS: `https://www.daubepnho.store/admin.html`
2. Vào tab **⚙️ Hệ Thống**
3. Nhập mật khẩu quản trị → bấm **Load state** (tải trạng thái hiện tại)
4. Bấm **V2** (có hộp thoại xác nhận) — chờ khoảng 5 giây
5. Thử vài tình huống thực tế:
   - Đăng nhập học viên trên 2 máy (khi đã bật tính năng “một thiết bị”)
   - Đăng xuất rồi đăng nhập lại
   - Duyệt một đơn Shop → kiểm tra quyền học xuất hiện ở Portal/LMS
6. Muốn về như cũ → bấm **V1** (hoặc bật **kill switch** nếu cần dừng khẩn cấp)

> **Lưu ý:** bật switch sang V2 chỉ **cho phép** các tính năng mới. Một số tính năng (ví dụ “một thiết bị”) còn cần bật thêm cờ riêng trên từng website — đội kỹ thuật sẽ hướng dẫn khi bạn muốn bật thật cho học viên.

Hướng dẫn thao tác chi tiết hơn: tài liệu *“Hướng dẫn sử dụng V2 — Chuyển V1 ↔ V2 để test”* (`V2_USER_GUIDE_SWITCH`).

---

## 8. Việc chỉ chủ hệ thống làm được (3 việc, không thể tự động)

Đội kỹ thuật đã xong phần code, kiểm thử và đưa lên hệ thống. Còn **3 việc bắt buộc do chủ hệ thống thực hiện** vì liên quan mật khẩu / quyền truy cập bảng điều khiển:

### Việc 1 — Đổi (rotate) các mật khẩu / khóa từng bị lộ qua lỗ hổng Shop ⚠️ Ưu tiên cao

Lỗ hổng đã **đóng**, nhưng các giá trị từng lộ ra ngoài cần được coi là **không còn an toàn**. Cần đổi trên Vercel và các nhà cung cấp liên quan:

- Mật khẩu quản trị Shop
- Khóa kết nối cơ sở dữ liệu (service role)
- Khóa đồng bộ nội bộ giữa 4 website
- Khóa Google / Cloudinary (nếu đang dùng)

**Vì sao đội kỹ thuật không làm giúp?** Vì đây là thao tác trên tài khoản chủ sở hữu, và đổi khóa ảnh hưởng vận hành — chỉ chủ hệ thống nên thực hiện.

### Việc 2 — Cấp 2 cấu hình cho trang Admin để nó “nghe” cùng switch

Trang Admin hiện **an toàn** (tự về V1 khi chưa cấu hình), nhưng **chưa đọc được nút switch chung** cho đến khi được cấp 2 thông tin kết nối tới cơ sở dữ liệu dùng chung với LMS/Shop. Sau khi cấp xong và triển khai lại, cả 4 website sẽ báo cùng một phiên bản.

### Việc 3 — Quyết định: giữ V1 hay đi V2 (và bật tính năng nào)

Đây là **quyết định kinh doanh**, không phải kỹ thuật:

- **Giữ V1:** bấm V1 trên tab Hệ Thống — mọi thứ như hiện tại.
- **Thử V2:** bấm V2, quan sát, so sánh.
- **Bật tính năng cụ thể** (một thiết bị, đồng bộ nâng cao…): làm từng bước, có thể tắt bất cứ lúc nào.

Không có áp lực thời gian. V1 tiếp tục phục vụ bình thường cho đến khi bạn quyết định.

---

## 9. Cam kết an toàn với đối tác

- ✅ **Dữ liệu học viên / đơn hàng / bài giảng được bảo toàn** — chuyển V1 ↔ V2 không xóa, không sửa dữ liệu.
- ✅ **Luôn có đường lùi** — một nút bấm, vài giây.
- ✅ **Không tự động ép học viên sang V2** — mọi thứ chờ quyết định của bạn.
- ✅ **Không làm phiền học viên hợp lệ** — biện pháp chống chia sẻ hướng vào lạm dụng, không cản trở người dùng thật.
- ✅ **Minh bạch** — mọi lần chuyển phiên bản đều có nhật ký.
- ✅ **Bật dần, có kiểm soát** — switch cho phép; từng tính năng bật riêng.
- ✅ **Đã kiểm thử kỹ** — hơn 360 kịch bản tự động vượt qua trước khi đưa lên hệ thống thật.
- ✅ **Lỗ hổng nghiêm trọng đã đóng** trên hệ thống thật (đã xác nhận bằng kiểm tra trực tiếp).

---

## 10. Kết luận

Lần nâng cấp V2 này khác với “đổi giao diện” hay “sửa một lỗi nhỏ”. Đây là lần **đưa cả 4 website lên cùng một chuẩn**, với **một nút điều khiển chung**, tập trung vào:

1. **Bảo vệ doanh thu** — chống chia sẻ tài khoản đồng bộ toàn hệ thống.
2. **Vận hành tin cậy** — đồng bộ dữ liệu có lưới an toàn, có đối soát.
3. **Nâng cấp không sợ** — thử được, lùi được, không mất dữ liệu.
4. **Bảo mật vận hành** — đóng lỗ hổng, bỏ mật khẩu mặc định yếu, không lộ bí mật qua trang chẩn đoán.

Hệ thống **đã sẵn sàng** để bạn trải nghiệm V1 ↔ V2. Ba việc còn lại (đổi khóa, cấp cấu hình Admin, quyết định bật V2) thuộc về chủ hệ thống — đội kỹ thuật sẵn sàng hỗ trợ từng bước khi bạn yêu cầu.

---

## Phụ lục A — Thuật ngữ đơn giản

| Thuật ngữ trong tài liệu | Ý nghĩa đời thường |
|---|---|
| **V1** | Cách hệ thống đang phục vụ người dùng hiện tại |
| **V2** | Bản nâng cấp đã cài sẵn, chờ bật |
| **Switch / nút chuyển** | Nút bấm V1 hoặc V2 trên trang quản trị |
| **Kill switch / nút dừng khẩn cấp** | Nút “dừng tất cả tính năng mới, về V1 ngay” |
| **Một tài khoản — một thiết bị** | Một Gmail chỉ học trên một máy tại một thời điểm |
| **Outbox / hộp thư đi** | Chỗ ghi lại các sự kiện quan trọng để không bị thất lạc khi mạng lỗi |
| **Đối soát** | So sánh dữ liệu hai bên xem có khớp không |
| **Chẩn đoán / diagnostics** | “Bảng kiểm tra sức khỏe” nội bộ của từng website |
| **Rotate mật khẩu / khóa** | Đổi sang giá trị mới vì cái cũ có thể đã bị lộ |
| **Preview** | Bản xem trước, chưa phải bản phục vụ học viên thật |
| **Production / hệ thống thật** | Bản đang phục vụ học viên và khách hàng |

## Phụ lục B — Tài liệu liên quan (nếu cần đọc thêm)

| Tài liệu | Dành cho ai | Nội dung |
|---|---|---|
| `V2_USER_GUIDE_SWITCH` (md/html) | Chủ hệ thống / người test | Hướng dẫn bấm nút V1 ↔ V2 từng bước |
| `V2_BAO_CAO_CAI_TIEN` (md/html) | Đối tác (phiên bản trước) | Cải tiến V2 tập trung vào LMS |
| **Tài liệu này** (`V2_4REPO_BAO_CAO_DOI_TAC`) | Đối tác | Nâng cấp V2 **toàn 4 website** + switch chung |
| `V2_4REPO_FINAL_REPORT` | Đội kỹ thuật | Báo cáo kỹ thuật đầy đủ (commit, test, deploy) |
| `V2_4REPO_ROLLBACK_RUNBOOK` | Đội vận hành | Quy trình khẩn cấp quay về V1 |

---

*Tài liệu này không chứa mật khẩu, khóa API, hay thông tin nhạy cảm nào. An toàn để gửi cho đối tác.*
