# BÁO CÁO READ-ONLY — OWNERSHIP VÀ PROJECT ASSIGNMENT CỦA `yeubep.shop`

Ngày kiểm tra: 2026-07-25  
Phạm vi: Vercel/DNS/HTTP chỉ đọc. Không move, claim, remove domain, thêm TXT, đổi DNS, gắn project mới hoặc deploy.

## 1. Kết luận

`yeubep.shop` không phải hai domain riêng biệt. Hiện có hai lớp quản lý:

```text
Team-level domain inventory / verification
                    khác
Project-level production alias / assignment
```

Kết quả xác minh:

- Team `thienha336501903-a11ys-projects` đang giữ record domain cấp team theo bằng chứng Dashboard do owner cung cấp. Record có trạng thái `Third Party`.
- `Third Party` có nghĩa domain được đăng ký/DNS bên ngoài Vercel; nó không có nghĩa đây là một project assignment thứ hai.
- Team đích `thienha100022653824678-stacks-projects` hiện **không liệt kê** `yeubep.shop` trong `vercel domains ls`.
- Tuy vậy project cũ `web-ban-hang-chinh-thuc` trong team đích đang có production alias `yeubep.shop` và đang phục vụ traffic.
- Mô hình phù hợp với toàn bộ bằng chứng là: team thứ hai giữ domain-level record/verification; team đích có delegated/project assignment dùng apex cho project cũ.

Credential CLI hiện tại không có quyền vào team `thienha336501903-a11ys-projects`, nên không thể dùng chính credential này để đọc ID nội bộ hoặc nút Move của domain record. Kết luận owner cấp team dựa trên Dashboard owner cung cấp và được CLI team đích corroborate bằng việc domain không nằm trong inventory owner nhưng vẫn dùng được như alias.

## 2. Bằng chứng Vercel team đích

CLI identity:

```text
thienha100022653824678-stack
```

`vercel teams ls` chỉ trả:

```text
thienha100022653824678-stacks-projects
```

`vercel domains ls --scope thienha100022653824678-stacks-projects` chỉ có:

- `daubepnho.store`
- `yeunauan.live`

Không có `yeubep.shop`. `vercel domains inspect yeubep.shop` ở team này trả lỗi không có quyền đối với domain record.

Điều đó chứng minh team đích không giữ domain inventory/ownership record dưới credential hiện tại.

## 3. Project đang phục vụ traffic

Project:

```text
Team:       thienha100022653824678-stacks-projects
Project:    web-ban-hang-chinh-thuc
Project ID: prj_tJOtibVVzl7FpliWzdk7bs1q9v7D
```

Deployment production:

```text
Deployment ID: dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2
Status:        Ready
Target:        production
URL:           web-ban-hang-chinh-thuc-7etvlx8t7.vercel.app
```

Alias list của chính deployment gồm:

- `https://yeubep.shop`
- `https://shop.yeunauan.live`
- các `.vercel.app` của project

`vercel alias ls --limit 100 --format json` trả đủ 61 alias của team và chỉ có **một custom alias chứa `yeubep.shop`**:

```text
yeubep.shop
→ dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2
→ web-ban-hang-chinh-thuc
```

Không có `www.yeubep.shop` trong alias list của team/project này.

## 4. Trạng thái `www.yeubep.shop`

DNS:

```text
www.yeubep.shop
CNAME db4901082264508b.vercel-dns-017.com
```

HTTP:

```text
https://www.yeubep.shop/ → 307 Location: https://yeubep.shop/
http://www.yeubep.shop/  → 308 lên HTTPS trước
```

Do:

- `www` không nằm trong deployment alias list;
- Project → Settings → Domains do owner cung cấp chỉ nêu apex;
- `www` có CNAME tới Vercel;
- response là redirect về apex;

kết luận thực tế là `www` đang được Vercel xử lý như **redirect domain về apex**, không phải alias trực tiếp phục vụ deployment commerce.

## 5. Registrar và nơi quản lý DNS

RDAP:

```text
Registrar: Namecheap, Inc.
Domain handle: DO17989202-GMO
```

Authoritative DNS:

```text
dns1.registrar-servers.com
dns2.registrar-servers.com
SOA: hostmaster.registrar-servers.com
```

Do đó:

- domain được đăng ký qua Namecheap, không đăng ký qua Vercel;
- DNS authoritative đang quản lý tại Namecheap;
- trạng thái Vercel `Third Party` là phù hợp.

## 6. DNS record đã ghi nhận

| Host | Type | Giá trị hiện tại | Vai trò |
|---|---|---|---|
| `yeubep.shop` | A | `216.198.79.1` | đưa apex tới Vercel |
| `www.yeubep.shop` | CNAME | `db4901082264508b.vercel-dns-017.com` | đưa www tới Vercel redirect |
| `_vercel.yeubep.shop` | TXT | `vc-domain-verify=yeubep.shop,<verification-id>` | xác minh/delegated use cho Vercel |
| `yeubep.shop` | TXT | SPF email forwarding của registrar | email; không được thay |
| apex | NS | `dns1/dns2.registrar-servers.com` | Namecheap authoritative DNS |

Verification ID đầy đủ đã được đọc để xác minh sự tồn tại nhưng không cần sao chép vào tài liệu vận hành công khai. Không thay hoặc xóa TXT này trước khi Vercel Move hoàn tất và domain hoạt động ở team đích.

Không phát hiện wildcard qua các host phổ biến đã kiểm tra. Tuy nhiên DNS không hỗ trợ liệt kê toàn bộ zone nếu không có quyền Namecheap; vì vậy không khẳng định tuyệt đối không tồn tại subdomain khác ngoài các record được Dashboard/DNS công khai cho thấy.

## 7. Verification và delegated access

Đang tồn tại TXT:

```text
_vercel.yeubep.shop = vc-domain-verify=yeubep.shop,...
```

Record này giải thích tại sao một team/project Vercel có thể phục vụ apex dù domain-level inventory nằm ở team khác. Chỉ từ TXT công khai không thể suy ra chính xác team ID tạo token verification.

Không nên:

- tạo TXT verification thứ hai;
- xóa TXT hiện tại;
- claim domain;
- tháo ownership record;

khi tính năng Move giữa hai team còn khả dụng và owner vẫn truy cập được team nguồn.

## 8. Dependency map hiện tại

```text
Namecheap registrar + authoritative DNS
        |
        +-- apex A --------------------+
        |                              |
        +-- _vercel TXT verification   v
        |                      Vercel domain routing
        |                              |
        |                              +--> apex alias
        |                              |    web-ban-hang-chinh-thuc
        |                              |    dpl_DZL1...
        |                              |
        +-- www CNAME -----------------+--> 307 redirect to apex
```

Các phụ thuộc phải bảo vệ:

- traffic `yeubep.shop` hiện tại;
- redirect `www → apex`;
- HTTPS apex/www;
- alias `shop.yeunauan.live` trên cùng deployment cũ;
- TXT verification hiện tại;
- SPF và mọi record email.

Không được tháo `shop.yeunauan.live` khi chuẩn hóa `yeubep.shop`.

## 9. Rollback record trước mọi thao tác tương lai

Trạng thái khôi phục:

```text
Team project hiện tại:
  thienha100022653824678-stacks-projects

Project:
  web-ban-hang-chinh-thuc
  prj_tJOtibVVzl7FpliWzdk7bs1q9v7D

Deployment:
  dpl_DZL1UNyUivz9BBNxPwG9fHGCVdW2

Apex alias:
  yeubep.shop

www:
  CNAME db4901082264508b.vercel-dns-017.com
  redirect 307 → https://yeubep.shop/

DNS:
  apex A 216.198.79.1
  _vercel TXT hiện hữu
  Namecheap NS
```

Nếu một thao tác Move sau này gặp lỗi, ưu tiên rollback ở lớp Vercel:

1. giữ nguyên DNS Namecheap;
2. khôi phục project assignment apex về project/deployment cũ;
3. xác minh apex 200, www redirect, HTTPS;
4. không thay `shop.yeunauan.live`.

Không dùng thay đổi DNS để sửa lỗi ownership nội bộ của Vercel.

## 10. Trình tự đề xuất — chưa thực hiện

Sau khi project mới đã được build, Preview được duyệt và trước cổng Domain:

1. Đăng nhập Dashboard với quyền trên **cả team nguồn và team đích**.
2. Chụp lại Domain page, project assignment, redirect và DNS verification.
3. Dùng chức năng **Move domain/team transfer** từ `thienha336501903-a11ys-projects` sang `thienha100022653824678-stacks-projects`.
4. Không claim và không thêm TXT nếu Move hoạt động.
5. Sau Move, xác minh domain inventory xuất hiện ở team đích nhưng vẫn giữ assignment project cũ.
6. Chỉ khi production project mới được owner duyệt mới chuyển apex assignment sang `web-ban-hang-yeubep-shop`.
7. Cấu hình `www` redirect về apex trong team/project đích.
8. Xác minh HTTPS/redirect/no loop rồi mới coi là hoàn tất.

Move ownership và chuyển project assignment là hai thao tác khác nhau và nên được xác minh tách biệt.

## 11. Giới hạn quyền hiện tại

CLI hiện tại không truy cập team `thienha336501903-a11ys-projects`; lệnh scope team đó trả `scope does not exist`. Vì vậy chưa thể xác minh read-only qua API các field sau:

- internal domain ID tại team nguồn;
- creator/created date của domain record;
- nút/khả năng Move đang hiện;
- redirect configuration object của `www`;
- team ID gắn với TXT verification.

Không cần mở rộng quyền để kết luận project nào đang phục vụ traffic. Tuy nhiên trước khi thực hiện Move, cần một phiên Dashboard có quyền cả hai team hoặc credential read-only của team nguồn để chụp chính xác trạng thái và xác nhận Move khả dụng.

## 12. Trạng thái sau điều tra

Không có thay đổi nào được thực hiện:

- `https://yeubep.shop/`: HTTP 200, project cũ;
- `https://www.yeubep.shop/`: 307 về apex;
- `https://shop.yeunauan.live/`: vẫn giữ nguyên;
- không domain/alias/TXT/DNS/certificate nào bị thêm, xóa hoặc di chuyển.

