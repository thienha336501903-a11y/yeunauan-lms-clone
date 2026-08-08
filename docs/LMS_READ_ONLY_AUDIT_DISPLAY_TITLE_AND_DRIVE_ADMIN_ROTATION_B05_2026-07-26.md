# BÁO CÁO AUDIT READ-ONLY LMS B05

## “Tên hiển thị trả lớp cho học viên” và cơ chế luân phiên Drive admin

**Ngày audit:** 2026-07-26  
**Múi giờ:** Asia/Saigon  
**Phạm vi:** source LMS Production B05, source commerce Production hiện tại và
trạng thái Supabase liên quan được đọc ở chế độ read-only  
**Không thực hiện:** sửa code, deploy, mutation API Production hoặc ghi Supabase

---

## 1. Baseline và phương pháp

### 1.1 Source LMS được sử dụng

| Thuộc tính | Giá trị |
|---|---|
| Repository | `web-lms-chinh-thuc` |
| Exact commit | `fc12c3b21329158e13a4a027833afd2dec61e973` |
| Safe tag | `backup/B05-2026-07-25` |
| Worktree kiểm tra | `_worktrees/restore-test-B04` |
| Worktree HEAD | đúng exact commit trên |
| Trạng thái Git | detached HEAD; các file báo cáo local là untracked |

Safe tag resolve đúng cùng SHA:

```text
backup/B05-2026-07-25
→ fc12c3b21329158e13a4a027833afd2dec61e973
```

Không dùng `origin/main`. Repo root đang ở commit khác, vì vậy mọi source reference
trong audit được đọc trực tiếp bằng:

```text
git show fc12c3b...:<path>
git grep ... fc12c3b...
```

### 1.2 Source commerce được dùng để truy vết approve

Commerce Production hiện tại:

```text
74c70268f0619d9d9a9be5e564ea60200038100c
```

Phần approve được đọc để xác định request thực tế đi vào LMS. Không gọi endpoint
approve hoặc tạo order.

### 1.3 Phân loại bằng chứng

- **Đã xác minh từ source:** có đường gọi/function/query cụ thể trong exact SHA.
- **Đã xác minh read-only từ Production:** truy vấn GET trực tiếp, output đã loại
  email/token/secret.
- **Suy luận có căn cứ:** hệ quả logic của code nhưng chưa kích hoạt mutation để thử.
- **Chưa thể khẳng định:** thuộc Portal/repository khác hoặc cần mutation/credential.

---

# PHẦN A — TÊN HIỂN THỊ TRẢ LỚP CHO HỌC VIÊN

## 2. Kết luận nhanh vấn đề 1

Field này là **bí danh hiển thị LMS theo course**, không phải đổi tên định danh của
course.

Giá trị được ghi vào hai nơi:

1. nguồn ghi bắt buộc:

```text
site_config.key   = <course-slug>_studentDisplayTitle
site_config.value = { "val": "<tên đã trim>" }
```

2. mirror best-effort:

```text
courses.raw_data.studentDisplayTitle
```

API học viên ưu tiên `courses.raw_data.studentDisplayTitle` trước `site_config`.
Tên này xuất hiện trên course-home LMS, nút quay lại course, watermark course media
và nhãn quay lại course ở lesson page. Nó không đổi ID, slug, lesson, enrollment,
order, URL hoặc tên khóa bán hàng.

---

## 3. Frontend field và element

**Đã xác minh từ source**

File:

```text
lms-admin.html
```

Label tại khoảng dòng 174:

```html
<label>Tên hiển thị trả lớp cho học viên</label>
```

Input:

```html
<input
  id="metaStudentDisplayTitle"
  type="text"
  placeholder="Để trống nếu muốn dùng tên khóa học gốc">
```

Nút lưu:

```html
<button onclick="saveCourseMeta()">Lưu cấu hình</button>
```

UI mô tả:

```text
Nếu nhập tên tại đây, học viên sẽ thấy tên này trong trang học bài và
trang post. Web bán hàng vẫn giữ tên khóa học gốc.
```

### 3.1 Cách field được nạp vào input

Khi chọn course, frontend thực hiện:

```js
document.getElementById("metaStudentDisplayTitle").value =
  STATE.globalConfig[`${course}_studentDisplayTitle`] || "";
```

Source: `lms-admin.html:1437`.

`STATE.globalConfig` được lấy từ GET admin courses, không đọc trực tiếp Supabase
từ browser.

---

## 4. Request khi bấm “Lưu cấu hình”

**Đã xác minh từ source**

Function:

```text
saveCourseMeta()
```

Source: `lms-admin.html:1455` trở đi.

Endpoint:

```text
POST /api/lms/admin?endpoint=courses
```

Headers:

- được tạo bởi `authHeaders()`;
- chứa auth material của admin theo contract;
- report không hiển thị giá trị.

Payload chính xác:

```json
{
  "action": "updateConfig",
  "course": "khoa-hoc-demo",
  "config": {
    "studentDisplayTitle": "Tên dành cho học viên",
    "subtitle": "...",
    "heroImage": "...",
    "posterImage": "...",
    "qrImage": "..."
  }
}
```

Field chính xác cần audit:

```text
config.studentDisplayTitle
```

Frontend gọi `.trim()` trước khi gửi.

Lưu ý nhỏ nhưng quan trọng: UI có input `metaTitle`, nhưng `saveCourseMeta()` hiện
không đưa `title` vào payload này. Việc lưu display title độc lập với course title.

---

## 5. Router và backend handler

**Đã xác minh từ source**

Router:

```text
api/lms/admin.js
```

Routing:

```js
if (endpoint === "courses") {
  return adminCoursesHandler(req, res);
}
```

Handler:

```text
utils/lms-handlers/admin-courses.js
```

Function:

```text
default async function handler(req, res)
```

Các guard:

1. admin CORS mode;
2. OPTIONS;
3. `getAdminFromRequest(req)`;
4. POST;
5. `action === "updateConfig"`;
6. `course` phải có;
7. `config` phải là object.

Không có mutation nếu admin session không hợp lệ.

---

## 6. Persistence chính xác

### 6.1 `site_config`

**Đã xác minh từ source**

Handler duyệt từng field trong `config`. Với display title:

```text
field       = studentDisplayTitle
prefixedKey = <course>_studentDisplayTitle
val         = String(value || "").trim()
```

Supabase operation:

```js
supabase
  .from("site_config")
  .upsert({
    key: prefixedKey,
    value: { val },
    updated_at: new Date().toISOString()
  }, {
    onConflict: "key"
  })
```

Schema:

```text
site_config.key        TEXT PRIMARY KEY
site_config.value      JSONB
site_config.updated_at TIMESTAMPTZ
```

Ví dụ giả:

```json
{
  "key": "banh-demo_studentDisplayTitle",
  "value": {
    "val": "Lớp Bánh Demo Cho Học Viên"
  }
}
```

Không có cột riêng tên `student_display_title` trong `site_config`; nó là key/value.

### 6.2 Mirror vào `courses.raw_data`

Sau các upsert `site_config`, handler đọc:

```text
courses.raw_data WHERE slug = course
```

Sau đó gán:

```js
rawData.studentDisplayTitle = nextStudentDisplayTitle;
```

và update:

```text
courses.raw_data
courses.updated_at
```

Không đổi:

- `courses.id`;
- `courses.slug`;
- `courses.title`;
- `courses.learning_course_slug`;
- `courses.sales_site`.

### 6.3 Hai nguồn không ngang hàng

`site_config` là write bắt buộc: lỗi upsert làm request lỗi.

Mirror `courses.raw_data` là best-effort:

- nằm trong `try/catch` riêng;
- kết quả Supabase update không được kiểm tra `.error`;
- lỗi mirror không làm response POST thất bại.

Do đó có thể có trạng thái:

```text
site_config = tên mới
courses.raw_data.studentDisplayTitle = tên cũ
HTTP response = 200 success
```

Đây là rủi ro nhất quán thực tế của B05.

Mirror dùng mô hình read-modify-write toàn bộ object `raw_data`, không có version/
compare-and-swap. Hai admin mutation đồng thời trên cùng course có khả năng ghi đè
thay đổi `raw_data` của nhau. Đây là suy luận có căn cứ từ source; audit không tạo
concurrent mutation để thử.

---

## 7. Xác nhận lưu thành công và read-after-write

### 7.1 Hành vi thực tế

**Đã xác minh từ source**

Backend trả:

```json
{ "success": true }
```

sau khi vòng upsert `site_config` hoàn thành và block mirror kết thúc.

Frontend kiểm tra:

```js
if (res.ok && d.success)
```

rồi:

- hiển thị toast “Lưu cấu hình khóa học thành công!”;
- cập nhật ngay:

```js
STATE.globalConfig[`${course}_studentDisplayTitle`] =
  payload.config.studentDisplayTitle;
```

### 7.2 Đây không phải read-after-write

Không có SELECT lại row vừa ghi trước khi báo thành công.

Thuật ngữ đúng:

```text
write error checking cho site_config
+ optimistic local state refresh
+ best-effort mirror sang courses.raw_data
```

Không nên mô tả là strict read-after-write.

### 7.3 Cách admin tự xác minh

Read-only confirmation an toàn:

1. bấm lưu một lần;
2. reload `lms-admin.html`;
3. chọn lại course;
4. kiểm tra input được nạp lại từ GET courses;
5. mở course-home LMS bằng tài khoản test hợp lệ và reload.

Nếu admin UI thấy tên mới nhưng học viên vẫn thấy tên cũ, nghi ngờ
`courses.raw_data.studentDisplayTitle` cũ đang ưu tiên hơn `site_config`.

---

## 8. API đọc giá trị sau khi lưu

### 8.1 Admin GET

**Đã xác minh từ source**

```text
GET /api/lms/admin?endpoint=courses
```

Handler:

```text
utils/lms-handlers/admin-courses.js
```

Nó đọc:

- `courses`;
- toàn bộ `site_config`.

Với admin response, `site_config[slug_studentDisplayTitle]` được dùng trước. Chỉ
khi giá trị đó falsy thì fallback từ:

```text
courses.raw_data.studentDisplayTitle
```

### 8.2 Student course-data

**Đã xác minh từ source**

Endpoint runtime chính:

```text
POST /api/lms/portal?endpoint=course-data
```

Router:

```text
api/lms/portal.js
```

Handler:

```text
utils/lms-handlers/course-data.js
```

Response có:

```json
{
  "courseInfo": {
    "title": "Tên cuối cùng dùng cho học viên",
    "originalTitle": "Tên course gốc",
    "studentDisplayTitle": "Tên override hoặc chuỗi rỗng",
    "subtitle": "...",
    "heroImage": "..."
  }
}
```

### 8.3 `exchange-code.js`

File:

```text
utils/lms-handlers/exchange-code.js
```

có code đọc display title với cùng precedence. Tuy nhiên exact B05 không import/map
handler này vào router API nào.

Kết luận:

- code tồn tại;
- nhưng là orphan route;
- không được tính là runtime consumer Production hiện hành.

---

## 9. Thứ tự ưu tiên/fallback chính xác

### 9.1 Student API

`course-data.js:498-507`:

```text
studentDisplayTitle =
  1. courses.raw_data.studentDisplayTitle
  2. site_config["<slug>_studentDisplayTitle"]
  3. ""

originalCourseTitle =
  1. courses.title
  2. site_config["<slug>_title"]
  3. site_config.title
  4. course slug

courseInfo.title =
  1. studentDisplayTitle
  2. originalCourseTitle
  3. "Culinary Academy"
```

Do slug có mặt trong course flow, fallback `"Culinary Academy"` gần như là lớp
phòng thủ cuối.

### 9.2 Frontend course-home

`resolveCurrentCourseTitle(courseInfo)`:

1. `courseInfo.title` nếu không rỗng và khác `"Culinary Academy"`;
2. `courseInfo.subtitle` nếu hợp lệ;
3. course slug.

### 9.3 Admin GET

1. đọc `site_config`;
2. title luôn lấy từ `courses.title`;
3. display title chỉ fallback raw_data nếu site_config value falsy.

### 9.4 Hệ quả khi mirror thất bại

Student API ưu tiên raw_data trước site_config. Vì vậy raw_data cũ có thể che tên
mới trong site_config.

Nếu admin lưu chuỗi rỗng nhưng mirror thất bại:

- site_config là `""`;
- raw_data cũ vẫn non-empty;
- GET admin fallback lại raw_data cũ;
- student API tiếp tục trả tên cũ.

Đây là lý do nên reload và kiểm tra bằng course-data sau khi đổi tên quan trọng.

---

## 10. Vị trí hiển thị cuối

### 10.1 Course-home LMS

**Có thay đổi — đã xác minh**

Files:

- `lms.html`;
- legacy/alternate entry `index.html`.

Vị trí:

- hero `<h1 id="courseTitle">`;
- text/title của nút quay lại course;
- watermark trên media course, dạng:

```text
<email học viên> • <tên hiển thị course> • <thời gian>
```

Report không dùng email thật.

### 10.2 Trang bài học

**Thay đổi một phần — đã xác minh**

File:

```text
lesson.html
```

Tên được dùng trong:

- `#courseHomeText`;
- title/label của nút quay lại trang chủ course.

Nó không thay:

- lesson title;
- lesson content;
- chapter/section title;
- `document.title`, hiện vẫn dạng `<lesson title> - Culinary Academy`;
- lesson URL.

Lesson page lấy display title bằng một request `course-data` bổ sung.

### 10.3 Header/breadcrumb

**Có thay đổi giới hạn**

- course-home hero heading thay đổi;
- lesson header “Quay lại trang chủ khóa học …” thay đổi;
- không có bằng chứng source cho một global breadcrumb khác dùng field này.

### 10.4 Trang danh sách khóa học của học viên

**Không xác minh là có thay đổi trong repo LMS**

`goMyCourses()` chuyển sang `MY_COURSES_URL`, là Portal boundary bên ngoài repository.
Commerce → Portal sync chỉ gửi:

```text
action + email + courseSlug
```

không gửi `studentDisplayTitle`.

Do đó:

- trang my-courses Portal không được exact LMS source chứng minh là đọc field này;
- không nên hứa rằng danh sách Portal sẽ đổi tên;
- cần audit repository Portal riêng nếu muốn thay tên tại đó.

Nếu người dùng gọi `lms.html` là “danh sách bài học của khóa”, tên hero tại trang
đó có đổi.

### 10.5 Email hoặc thông báo

**Không thay đổi — đã xác minh trong source đang xét**

- LMS không có caller email dùng `studentDisplayTitle`.
- Commerce approval email hook dùng `orderData.course_title || courseSlug`.
- Hook email commerce hiện còn là TODO/log stub trong source đã đọc.
- Drive share đặt `sendNotificationEmail:false`.

### 10.6 Portal

**Không có đường propagation đã xác minh**

Không có payload sync display title. Portal có thể có dữ liệu/tên riêng nhưng nằm
ngoài scope exact LMS source.

### 10.7 Commerce storefront

**Không thay đổi**

Commerce dùng `courses.title`/sales course config. LMS admin không sửa
`courses.title` trong flow này.

### 10.8 LMS admin

**Có thay đổi**

- input hiện giá trị mới ngay sau success nhờ local state;
- reload sẽ đọc lại GET admin courses;
- course list/title admin vẫn dùng title gốc, vì handler ghi đè key title từ
  `courses.title`.

### 10.9 Commerce admin

**Không thay đổi theo flow này**

Không có mutation commerce admin, sales title hoặc sales slug.

---

## 11. Những dữ liệu tuyệt đối không đổi

Đổi display title không thay:

- course UUID;
- sales course UUID;
- LMS course slug;
- sales slug;
- `learning_course_slug`;
- `sales_site`;
- lesson rows;
- lesson titles;
- enrollment rows;
- order rows;
- `source_order_id`;
- course URL;
- lesson URL;
- Drive folder ID;
- Drive permission;
- tên khóa bán hàng trong commerce.

Nó chỉ thay metadata hiển thị LMS và timestamp cập nhật liên quan.

---

## 12. Hiệu lực, cache, reload và đăng nhập

### 12.1 Server

`course-data` đọc Supabase mỗi request. Không có server cache riêng cho display title
trong handler này.

### 12.2 Course-home

Trang đã render không tự subscribe database. Cần:

- reload;
- hoặc hành động làm frontend gọi lại `course-data`.

Không cần:

- redeploy;
- đăng xuất/đăng nhập lại;
- xóa cookie;
- xóa browser cache assets.

### 12.3 Lesson page

`lesson.html` có in-memory `spaState` cache cho course-data:

```text
SPA_COURSE_CACHE_TTL_MS = 30_000
```

Trong cùng tab SPA, tên cũ có thể tồn tại tối đa khoảng 30 giây hoặc đến khi reload/
refetch. Không phải CDN cache hoặc database cache.

### 12.4 Admin page

Sau POST success, input/state cập nhật ngay. Reload là cách xác nhận persistence.

---

## 13. Đổi lại tên cũ

**Đã xác minh từ source**

Đổi lại tên cũ sử dụng đúng cùng upsert và mirror. Đây là metadata-only và an toàn
về ID/slug/order/enrollment.

Quy trình an toàn:

1. chọn đúng course;
2. nhập tên cũ;
3. lưu một lần;
4. reload admin;
5. reload course-home test;
6. kiểm tra lesson return header/watermark.

Không cần rollback database toàn hệ thống.

---

## 14. Input edge cases

### 14.1 Chuỗi rỗng

- frontend và backend trim;
- site_config row vẫn tồn tại với `{val:""}`;
- raw_data được đặt `""` nếu mirror thành công;
- student API fallback về title gốc.

Rủi ro: nếu mirror thất bại, raw_data cũ có thể tiếp tục thắng.

### 14.2 Tên rất dài

Không có `maxlength` trong input và không có backend max-length validation.

Hệ quả suy luận:

- JSONB lưu được;
- hero heading có thể xuống nhiều dòng;
- button/header có `truncate` ở một số vị trí;
- watermark dài có thể che nội dung;
- payload/DB không có giới hạn nghiệp vụ rõ.

Khuyến nghị vận hành: dùng tên ngắn, dễ đọc, kiểm tra mobile.

### 14.3 HTML

Ví dụ giả:

```text
<b>Lớp Demo</b>
```

Các vị trí chính dùng:

- `.value`;
- `.innerText`;
- DOM `.title`.

Do đó chuỗi được hiển thị như text, không render `<b>` thành HTML tại các sink đã
truy vết. Không nên dựa vào điều này để nhập markup.

### 14.4 Emoji/ký tự đặc biệt

Không có regex cấm. JSONB/Unicode hỗ trợ emoji và tiếng Việt.

Rủi ro chủ yếu:

- layout;
- font fallback;
- watermark dài;
- copy/paste ký tự vô hình;
- trim chỉ loại whitespace đầu/cuối.

### 14.5 Kiểu dữ liệu không phải string

Frontend luôn gửi string từ input. Backend dùng:

```js
String(value || "").trim()
```

nên số/boolean/object bất thường từ caller thủ công sẽ bị stringify. Endpoint có
admin auth nhưng thiếu per-field type/length allowlist.

---

## 15. Sơ đồ luồng vấn đề 1

```text
LMS admin UI
lms-admin.html
#metaStudentDisplayTitle
        |
        | saveCourseMeta()
        | POST /api/lms/admin?endpoint=courses
        | config.studentDisplayTitle
        v
api/lms/admin.js router
        |
        v
utils/lms-handlers/admin-courses.js
        |
        +--> site_config
        |    key=<slug>_studentDisplayTitle
        |    value={val:<trimmed name>}
        |
        +--> best-effort mirror
             courses.raw_data.studentDisplayTitle
        |
        v
POST response {success:true}
        |
        +--> LMS admin local STATE refresh
        |
        v
POST /api/lms/portal?endpoint=course-data
utils/lms-handlers/course-data.js
        |
        | precedence:
        | raw_data override > site_config override > original title > slug
        v
courseInfo.title
        |
        +--> lms.html/index.html hero H1
        +--> course-home return button
        +--> course media watermark
        +--> lesson.html return-to-course header
```

---

# PHẦN B — ENROLLMENT VÀ LUÂN PHIÊN DRIVE ADMIN

## 16. Ba vai trò phải phân biệt

### 16.1 Admin commerce

Admin commerce duyệt order. Việc này:

- đổi trạng thái order;
- gọi server-to-server sync;
- không trực tiếp dùng Google OAuth của Drive admin;
- không tự insert permission Google Drive.

### 16.2 LMS

LMS:

- xác thực internal sync secret;
- upsert/delete `student_enrollments`;
- sau đó gọi provisioning Google Drive;
- ghi trạng thái Drive, logs và queue.

### 16.3 Drive admin account

Drive admin account là Google OAuth identity thực hiện:

- list folder permission;
- create reader permission;
- delete permission.

Nó không phải commerce admin và cũng không phải LMS admin session.

---

## 17. Commerce approve → LMS endpoint

### 17.1 Approve một order

**Đã xác minh từ exact commerce source**

File:

```text
api/orders.js
```

Khi status đổi thành:

```text
Đã duyệt
```

commerce gọi:

```text
syncEnrollmentToExternalSystems(order, "create")
```

File helper:

```text
utils/sync-helpers.js
```

Function:

```text
syncEnrollmentToExternalSystems(orderData, actionType)
```

Learning slug:

```text
getEffectiveLearningSlug(orderData)
```

Action:

```text
create -> syncEnrollment
revoke -> revokeEnrollment
```

### 17.2 Request LMS

Endpoint:

```text
POST <SYSTEM3_URL>/api/sync
```

Headers:

```text
Content-Type: application/json
X-Sync-Secret: <server-side secret>
```

Body:

```json
{
  "action": "syncEnrollment",
  "email": "student.demo@example.invalid",
  "courseSlug": "khoa-hoc-canonical"
}
```

Commerce không gửi:

- `sales_site`;
- sales alias nếu canonical resolver đã map;
- `source_order_id`;
- display title;
- Drive admin identity.

### 17.3 Portal

Commerce gửi payload tương tự sang `SYSTEM1_URL`. Portal và LMS là hai boundary
riêng; thành công của một bên không tự chứng minh bên kia thành công.

---

## 18. LMS `/api/sync`

**Đã xác minh từ source**

File:

```text
api/sync.js
```

Guard:

- POST only;
- internal CORS mode;
- `X-Sync-Secret`;
- timing-safe secret comparison;
- fail-closed nếu secret env thiếu.

Action branch:

```js
if (action === "syncEnrollment") {
  syncEnrollment(supabase, {
    email,
    courseSlug,
    action: "create"
  });
}
```

Revoke:

```js
action === "revokeEnrollment"
→ syncEnrollment(..., action: "revoke")
```

Function thực tế:

```text
utils/lms.js
syncEnrollment()
```

---

## 19. Enrollment upsert key

### 19.1 Student identity

Email được normalize:

```text
trim + lowercase
```

`students` được tìm theo:

```text
students.email
```

Nếu chưa có thì insert; nếu đã có và request mang name/phone thì update metadata.

### 19.2 Course identity

LMS tìm:

```text
courses.slug = courseSlug
```

để lấy `course_id`. `course_slug` vẫn được ghi ngay cả khi course lookup không trả
ID; `course_id` có thể null theo code.

### 19.3 Enrollment upsert

Payload:

```text
student_id
course_id
course_slug
email
status=active
expired_at
source_order_id
updated_at
```

Conflict key chính xác:

```text
email,course_slug
```

Schema cũng có:

```sql
UNIQUE (email, course_slug)
```

Kết luận:

- không upsert chỉ theo email;
- không upsert chỉ theo `source_order_id`;
- không upsert theo `student_id,course_id`;
- một email có tối đa một enrollment row cho mỗi canonical course slug.

### 19.4 `source_order_id`

`source_order_id` là field snapshot/trace, không thuộc conflict key.

Commerce `/api/sync` hiện chỉ gửi `action,email,courseSlug`, nên đường approve
commerce gọi LMS với `orderId=null`. Vì vậy source order không được truyền qua
đường này.

Manual LMS admin cũng không truyền `orderId`.

---

## 20. Thứ tự enrollment và Drive provisioning

Trong `syncEnrollment()`:

1. create/update student;
2. lookup course;
3. upsert enrollment;
4. gọi `syncGoogleDrivePermission()`;
5. trả response.

Source comment nói Drive “runs asynchronously”, nhưng code có:

```js
const driveResult = await syncGoogleDrivePermission(...)
```

Nó được await trong request. Source behavior ưu tiên hơn comment: Drive call tham
gia thời gian xử lý request.

### 20.1 Drive fail không rollback enrollment

`syncEnrollment()` luôn trả:

```json
{
  "success": true,
  "enrollment": { "...": "..." },
  "driveSync": {
    "success": false,
    "pendingRetry": true
  }
}
```

nếu enrollment thành công nhưng Drive thất bại.

`/api/sync` vẫn trả HTTP 200.

Commerce hiện đánh dấu LMS `SUCCESS` chỉ dựa vào `res.ok`, không kiểm tra
`driveSync.success`.

Kết luận vận hành:

```text
commerce sync_lms_status=SUCCESS
không đồng nghĩa
Google Drive permission=success
```

Muốn biết Drive thật sự thành công phải xem:

- `student_enrollments.drive_permission_status`;
- `drive_permission_logs`;
- Drive health/trace.

---

## 21. Nguồn Drive admin pool

### 21.1 Credential source

**Đã xác minh từ source**

Source đọc tối đa ba slot environment:

```text
DRIVE_ADMIN_1_EMAIL
DRIVE_ADMIN_1_CLIENT_ID
DRIVE_ADMIN_1_CLIENT_SECRET
DRIVE_ADMIN_1_REFRESH_TOKEN

DRIVE_ADMIN_2_...
DRIVE_ADMIN_3_...
```

Một slot chỉ được đưa vào pool nếu đủ cả bốn giá trị:

```text
email + clientId + clientSecret + refreshToken
```

Vercel sanitized metadata xác nhận đủ 12 tên biến được cấu hình ở scope
Production/Preview; giá trị không được đọc hoặc xuất trong báo cáo.

### 21.2 Vai trò `drive_admin_accounts`

Bảng không lưu OAuth credential. Nó overlay:

- `display_name`;
- `status`;
- `daily_share_count`;
- `last_used_at`;
- `last_error`;
- `last_error_at`.

Identity join key:

```text
normalized email
```

Env quyết định account nào tồn tại trong runtime pool. DB row không có bộ env tương
ứng sẽ không tự trở thành Drive client.

### 21.3 Legacy fallback

Nếu không có slot env đầy đủ, source dùng `syncGoogleDrivePermissionLegacy()` và
`getGoogleDriveClient()`:

1. ưu tiên `GOOGLE_SERVICE_ACCOUNT` nếu có;
2. fallback OAuth access/refresh token trong `site_config`;
3. refresh bằng `GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET`.

Đây là đường khác với three-admin pool.

---

## 22. Thuật toán chọn admin

### 22.1 Loại thuật toán

**Đã xác minh: round-robin theo cursor**

Không phải:

- random;
- least-loaded;
- theo course;
- theo học viên;
- theo `daily_share_count`;
- luôn main rồi fallback cố định.

### 22.2 Danh sách đầu vào

1. lấy env accounts theo slot 1 → 2 → 3;
2. overlay DB status;
3. lọc:

```text
status === "active"
```

Chỉ active account tham gia.

### 22.3 Cursor

Lưu trong:

```text
site_config.key = drive_admin_pool_cursor
site_config.value = { val: <number> }
```

Ordering:

```text
start = cursor % activeAccounts.length
ordered = accounts[start..end] + accounts[0..start-1]
```

### 22.4 Advance

Sau create/revoke thành công:

```text
cursor = (index of used admin + 1) % activeAccounts.length
```

Cursor chỉ advance sau success.

Cursor là chỉ số trên **danh sách active tại thời điểm request**, không phải slot ID
cố định. Khi một account đổi từ active sang error/paused hoặc quay lại active, cùng
một giá trị cursor có thể trỏ tới account khác.

### 22.5 Concurrency caveat

**Suy luận có căn cứ**

Cursor read/update không nằm trong transaction/atomic RPC. Hai request đồng thời
có thể đọc cùng cursor và chọn cùng admin.

Do đó đây là round-robin best-effort, không phải strict distributed scheduler.

---

## 23. Khi nào chuyển admin tiếp theo

Trong một request:

1. thử admin đầu theo cursor;
2. nếu success: ghi state/log, advance cursor, dừng;
3. nếu lỗi: đánh dấu admin, ghi log, thử admin kế trong ordered active list;
4. nếu hết: enrollment `pending_retry`, ghi queue, trả Drive failure.

Mỗi active pool account được thử tối đa một lần trong một invocation.

Không có sleep/backoff giữa các pool accounts.

---

## 24. Xử lý quota, token, disable, timeout và permission error

### 24.1 Quota/rate-limit

`isDriveQuotaError()` tìm các dấu hiệu:

- rate limit;
- quota;
- user rate limit;
- sharing rate limit;
- daily limit.

Account được update:

```text
status=quota_limited
last_error
last_error_at
```

Rồi thử account kế tiếp.

### 24.2 Token/permission/timeout/lỗi khác

Không quota:

```text
status=error
last_error
last_error_at
```

Rồi thử account kế tiếp.

### 24.3 Disabled/paused

Schema cho status:

```text
active
paused
quota_limited
error
```

Mọi status khác `active` bị loại khỏi pool.

### 24.4 Tự phục hồi account

Không có scheduler trong B05 tự chuyển:

```text
quota_limited/error → active
```

Và account bị loại không được thử trong request mới, nên không có cơ hội tự chuyển
active qua một success mới.

Muốn phục hồi cần thao tác quản trị dữ liệu/config được phê duyệt hoặc sửa vận hành;
UI B05 chỉ xem, không có endpoint chỉnh pool status.

### 24.5 Chi tiết lỗi bị xóa

**Đã xác minh source + live read-only**

`safeUpsertDriveAdminAccount()` khi không có patch lỗi ghi:

```text
last_error=null
last_error_at=null
```

Trong lúc load pool, function gọi safe upsert cho mọi account. Vì vậy DB có thể giữ
`status=error` nhưng mất error detail.

Live state quan sát đúng pattern này ở Admin 2/3.

---

## 25. Cấp quyền Google Drive

### 25.1 Folder

Source lấy/discover course folder ID. Nếu không có:

- log error;
- queue;
- không share.

### 25.2 Đảm bảo Drive admin có quyền

Trước khi share cho học viên:

```text
ensureAdminHasFolderAccess()
```

dùng main Drive client để bảo đảm Drive admin có writer/owner access. Nếu chưa có,
nó tạo writer permission với:

```text
sendNotificationEmail=false
```

Lỗi bước này chỉ warning; request vẫn thử dùng admin client.

### 25.3 Cấp cho học viên

Admin client:

1. list permissions;
2. tìm normalized student email;
3. nếu đã có: reuse permission ID, không create mới;
4. nếu chưa có: create `reader` permission;
5. `sendNotificationEmail=false`.

### 25.4 Fields ghi nhớ account/lượt

`student_enrollments`:

- `drive_permission_status`;
- `drive_permission_admin_email`;
- `drive_permission_id`;
- `drive_folder_id`;
- `drive_permission_error`;
- `drive_permission_retry_count`;
- `drive_permission_updated_at`.

`drive_admin_accounts`:

- `last_used_at`;
- `daily_share_count`;
- `status`;
- error fields.

`site_config`:

- `drive_admin_pool_cursor`.

`drive_permission_logs`:

- student/course/folder/admin;
- permission ID;
- action/status;
- error/retry/time/request.

### 25.5 `daily_share_count`

Counter tăng một khi create permission mới thành công. Không tăng nếu permission
đã có.

Nó:

- chỉ là telemetry;
- không tham gia chọn account;
- không có reset theo ngày trong exact B05 dù tên field là “daily”.

---

## 26. `drive_permission_logs`

Mỗi attempt pool có thể tạo một log:

- success;
- failed;
- quota_limited;
- pending_retry khi không có active admin.

Do failover, một enrollment operation có thể có:

```text
Admin A failed
Admin B failed
Admin C success
```

và ba log riêng.

Log là audit/health history, không phải queue worker.

Nếu insert schema mới lỗi, source fallback sang wrapper log legacy.

---

## 27. `drive_sync_queue`

### 27.1 Khi ghi

Queue được ghi khi:

- không có active admin;
- tất cả active admin fail;
- legacy path fail/folder/client unavailable.

Natural lookup:

```text
email + course_slug + action
```

Nếu row đã tồn tại:

- `attempts += 1`;
- update error/time.

Nếu chưa:

- insert attempts=1.

### 27.2 Không có automatic consumer

**Đã xác minh từ toàn bộ exact B05 source**

Không có:

- cron;
- scheduled function;
- queue worker;
- loop tự đọc `drive_sync_queue`;
- max-attempt scheduler;
- backoff schedule cho queue.

Source chỉ:

- insert/update queue;
- đọc queue trong student trace.

### 27.3 Queue không được resolve/delete

Không có source xóa row queue sau retry success. Bảng cũng không có status/resolved
field trong migration đã đọc.

Vì vậy:

- queue row có thể là lịch sử lỗi cũ;
- `queueRows` không đồng nghĩa số lỗi hiện tại;
- nguồn current tốt hơn là enrollment drive status + recent logs.

---

## 28. Retry

### 28.1 Pool path

Immediate failover:

- tối đa số active accounts;
- mỗi account một attempt;
- không delay.

Sau khi hết pool:

- queue;
- manual retry cần admin.

### 28.2 Legacy path

Nếu không có complete env pool:

```text
maxAttempts = 3
```

Backoff giữa lần:

- sau failure 1: `2^1 * 1000` = 2 giây;
- sau failure 2: `2^2 * 1000` = 4 giây;
- sau failure 3: kết thúc.

### 28.3 Manual retry endpoints

LMS admin:

```text
POST /api/lms/admin?endpoint=drive-permission
```

retry một enrollment theo ID.

```text
POST /api/lms/admin?endpoint=drive-retry
```

Types:

- `single`;
- `course`;
- `all`.

Handlers kiểm tra enrollment còn active trước khi create permission.

### 28.4 Retry không tự xóa queue

Manual retry success cập nhật enrollment/log, nhưng exact source không delete queue.

---

## 29. Nguy cơ cấp trùng

### 29.1 Enrollment

DB unique `(email,course_slug)` và upsert giúp tránh duplicate enrollment rows.

### 29.2 Google Drive permission

Mỗi create attempt list permission trước và skip nếu email đã có.

### 29.3 Race condition

**Suy luận có căn cứ**

Hai request đồng thời có thể:

1. cùng đọc cursor;
2. cùng list trước khi permission tồn tại;
3. cùng create.

Không có distributed lock/idempotency key cho Google permission.

Google Drive có thể deduplicate hoặc có thể tạo hơn một permission tùy API behavior;
audit không kích hoạt mutation để xác nhận. Vì vậy nguy cơ thấp nhưng không bằng 0.

Nếu nhiều permission cùng email tồn tại, revoke source tìm và xóa `find()` đầu tiên,
có nguy cơ còn permission khác.

---

## 30. Revoke dùng admin nào

### 30.1 Hành vi exact source

Revoke chạy cùng round-robin selection như create. Nó không đọc:

```text
student_enrollments.drive_permission_admin_email
```

để bắt buộc dùng lại original admin.

Admin được chọn hiện tại:

1. được bảo đảm writer access;
2. list permission theo student email;
3. delete matched permission.

Do Drive permission là resource của folder, một admin khác có đủ quyền có thể revoke.

### 30.2 State sau revoke

Enrollment create path khi revoke:

- `syncEnrollment()` xóa enrollment trước;
- sau đó `safeUpdateEnrollmentDriveState()` không còn row để update.

Log vẫn ghi revoking admin. Với direct Drive retry/update flows khác, enrollment có
thể còn để ghi trạng thái.

### 30.3 Shared entitlement

Commerce kiểm tra shared entitlement trước khi gọi LMS revoke. Nếu còn approved
order khác cùng canonical course, commerce không gọi revoke.

---

## 31. Trạng thái pool quan sát read-only

Thời điểm đọc:

```text
2026-07-26T08:48:55Z
2026-07-26 15:48:55 +07
```

Không xuất email thật.

| Nhãn | Status | Share count | Last used | Error detail hiện còn |
|---|---|---:|---|---|
| Drive Admin 1 | active | 0 | null | no |
| Drive Admin 2 | error | 1 | null | no |
| Drive Admin 3 | error | 9 | null | no |

Cursor:

```text
drive_admin_pool_cursor = 2
```

Vì active list hiện chỉ có `Drive Admin 1`:

```text
2 % 1 = 0
```

account được chọn kế tiếp vẫn là `Drive Admin 1`.

Trạng thái này là snapshot live read-only, không phải cấu hình bất biến.

### 31.1 Queue/log snapshot

- queue rows: 11;
- queue action quan sát: create;
- attempts phần lớn 1, một row 3;
- 100 log gần nhất:
  - success: 45;
  - failed: 9;
  - pending_retry: 7.

Không dùng queue count làm current failure count vì queue không được resolve/delete.

---

## 32. Health và màn hình quản trị pool

### 32.1 Health endpoint

```text
GET /api/lms/admin?endpoint=drive-health&range=<today|7d|30d|...>
```

Handler:

```text
utils/lms-handlers/admin-drive-health.js
```

Đọc:

- permission logs;
- recent errors;
- `drive_admin_accounts`;
- enrollment Drive errors;
- courses thiếu Drive folder.

### 32.2 LMS admin UI

`lms-admin.html` có màn hình Drive health hiển thị:

- active/quota/error counts;
- account status;
- daily share count;
- last error;
- missing folders;
- recent errors;
- nút retry one/course/all;
- student trace với enrollment/queue/logs.

### 32.3 Có chỉnh pool từ UI không?

**Không — đã xác minh từ exact source**

Không có handler/UI để:

- thêm credential account;
- đổi thứ tự slot;
- đổi status account;
- reset cursor;
- reset daily count.

Credential thay đổi ở Vercel env. Status/cursor hiện cần thao tác DB/config có kiểm
soát hoặc thay đổi code trong một task được duyệt.

---

## 33. Display title có ảnh hưởng Drive/enrollment không?

**Không.**

Drive/enrollment dùng:

- normalized email;
- canonical `courseSlug`;
- course ID/folder ID;
- account env/status/cursor.

`studentDisplayTitle` không được đọc trong:

- `syncEnrollment`;
- Drive pool selection;
- permission create/delete;
- retry;
- health;
- queue/log key.

Đổi display title không đổi admin được chọn và không cấp/revoke enrollment.

---

## 34. Sơ đồ luồng vấn đề 2

```text
Admin commerce bấm duyệt đơn
api/orders.js
        |
        | status = "Đã duyệt"
        v
syncEnrollmentToExternalSystems()
canonical learning course slug
        |
        | POST <LMS>/api/sync
        | action=syncEnrollment
        | email + courseSlug
        v
api/sync.js
X-Sync-Secret validation
        |
        v
utils/lms.js :: syncEnrollment()
        |
        +--> students find/create
        |
        +--> student_enrollments upsert
        |    conflict = email,course_slug
        |    status = active
        |
        v
syncGoogleDrivePermission()
        |
        +--> có complete DRIVE_ADMIN_1..3 env?
        |       |
        |       +-- yes --> pool path
        |       |           env identities
        |       |           + DB status overlay
        |       |           + site_config cursor
        |       |           -> ordered active accounts
        |       |
        |       +-- no --> legacy Drive client
        |
        v
Drive folder permission
        |
        +-- success
        |    -> drive_admin_accounts telemetry
        |    -> advance cursor
        |    -> drive_permission_logs success
        |    -> enrollment drive status success
        |
        +-- account failure
        |    -> quota_limited/error
        |    -> failure log
        |    -> next active admin
        |
        +-- all failed/no active
             -> enrollment pending_retry
             -> drive_permission_logs
             -> drive_sync_queue
             -> manual LMS admin retry
        |
        v
Học viên có LMS enrollment
        |
        +--> Drive success: truy cập folder content
        +--> Drive pending: LMS row active nhưng Drive cần xử lý retry
```

---

## 35. Khác biệt giữa tài liệu và source

### 35.1 “Read-after-write”

Tài liệu tổng thể khuyến nghị read-after-write. Exact LMS B05 flow display title
không SELECT lại sau POST. Báo cáo này ưu tiên source và gọi đúng là optimistic
local refresh.

### 35.2 “Queue/retry”

Tài liệu tổng thể có thể tạo cảm giác queue có retry tự động. Exact B05 không có
queue consumer/cron. Chỉ immediate pool failover, legacy retry nội bộ và manual
admin retry.

### 35.3 “Drive chạy bất đồng bộ”

Comment source nói “runs asynchronously”, nhưng code `await` Drive call. Request
đợi Drive logic hoàn tất/failover trước khi trả.

### 35.4 “LMS sync success”

Commerce xem HTTP 2xx là LMS success. Exact LMS response có thể chứa
`driveSync.success=false`. Hai khái niệm phải được giám sát riêng.

---

## 36. Ví dụ giả hoàn chỉnh

Giả sử:

```text
course slug: banh-demo
student: student.demo@example.invalid
display title mới: Lớp Bánh Demo Tháng 8
```

### 36.1 Display title

Admin POST:

```json
{
  "action": "updateConfig",
  "course": "banh-demo",
  "config": {
    "studentDisplayTitle": "Lớp Bánh Demo Tháng 8",
    "subtitle": "",
    "heroImage": "",
    "posterImage": "",
    "qrImage": ""
  }
}
```

Persistence:

```text
site_config["banh-demo_studentDisplayTitle"]
  = {"val":"Lớp Bánh Demo Tháng 8"}

courses.raw_data.studentDisplayTitle
  = "Lớp Bánh Demo Tháng 8"
```

Student course-data:

```json
{
  "courseInfo": {
    "title": "Lớp Bánh Demo Tháng 8",
    "originalTitle": "Khóa Bánh Demo",
    "studentDisplayTitle": "Lớp Bánh Demo Tháng 8"
  }
}
```

### 36.2 Enrollment/Drive

Commerce:

```json
{
  "action": "syncEnrollment",
  "email": "student.demo@example.invalid",
  "courseSlug": "banh-demo"
}
```

Enrollment natural key:

```text
student.demo@example.invalid + banh-demo
```

Nếu Admin 1 active và share thành công:

```text
enrollment active
drive_permission_status=success
cursor advance
success log
```

Nếu Admin 1 lỗi và không còn active admin khác:

```text
enrollment vẫn active
drive_permission_status=pending_retry
queue row attempts increment
LMS HTTP response vẫn có thể 200/success=true
```

---

## 37. Kết luận dễ hiểu cho chủ hệ thống

### 37.1 Tên hiển thị

Ô “Tên hiển thị trả lớp cho học viên” chỉ đổi nhãn học viên thấy trong LMS. Nó
không đổi khóa học thật, link, bài học, đơn hàng hay quyền học.

Sau khi lưu:

- reload trang course của học viên để thấy tên mới;
- lesson tab đang mở có thể giữ tên cũ khoảng 30 giây;
- không cần deploy hoặc đăng nhập lại.

Tên mới không tự đổi:

- website bán hàng;
- Portal my-courses;
- email;
- commerce admin.

Điểm cần để ý: LMS lưu tên ở `site_config` và mirror sang `courses.raw_data`. Nếu
hai nơi lệch, học viên ưu tiên raw_data. Vì vậy sau khi đổi tên quan trọng nên reload
admin và course-home để kiểm tra.

### 37.2 Luân phiên Drive admin

Admin commerce chỉ duyệt đơn. LMS mới tạo enrollment và chọn Google Drive admin.

Pool hiện dùng round-robin, nhưng chỉ account status `active` được chọn. Snapshot
read-only cho thấy chỉ `Drive Admin 1` active; Admin 2 và 3 đang error. Vì vậy dù
cursor là 2, lượt tiếp theo vẫn dùng Admin 1.

Nếu Drive lỗi:

- enrollment vẫn có thể đã active;
- commerce có thể báo LMS sync success;
- quyền Drive có thể đang pending retry;
- phải xem Drive health/enrollment Drive status, không chỉ nhìn order sync status.

Queue B05 không tự chạy. Admin phải retry từ LMS admin hoặc thực hiện quy trình
khôi phục pool được phê duyệt.

---

## 38. Những thao tác admin có thể làm an toàn và những thao tác không nên làm

### 38.1 Có thể làm an toàn

- Đổi display title cho đúng course.
- Dùng tên ngắn, plain text, có thể dùng tiếng Việt/emoji vừa phải.
- Để trống để fallback về title gốc, rồi reload kiểm tra.
- Đổi lại tên cũ bằng cùng form.
- Reload admin và course-home sau khi lưu.
- Xem Drive Health, Student Trace và enrollment status.
- Retry một học viên có enrollment active.
- Retry theo course sau khi kiểm tra phạm vi.
- Dùng dữ liệu test giả ở Preview/dry-run cho thử nghiệm.

### 38.2 Cần thận trọng

- Retry “all” vì có blast radius toàn hệ thống.
- Tên rất dài vì ảnh hưởng layout/watermark.
- Chuỗi HTML/ký tự vô hình dù sink hiện dùng text.
- Tin toast save mà không reload kiểm tra.
- Tin `sync_lms_status=SUCCESS` là Drive success.
- Dùng queue row count làm số lỗi hiện tại.

### 38.3 Không nên làm

- Không sửa course ID/slug để đổi tên.
- Không sửa `learning_course_slug`.
- Không backfill order/enrollment.
- Không tạo LMS alias course mới.
- Không sửa trực tiếp secret/token/email Drive admin trong DB.
- Không in hoặc gửi refresh token/admin email thật.
- Không chuyển account error về active khi chưa xử lý token/quota/root cause.
- Không xóa queue/log để “hết lỗi” mà chưa xác minh permission.
- Không gọi mutation Production để test.
- Không deploy từ `origin/main`.
- Không sửa code/schema trong một task chỉ yêu cầu đổi display name.

---

## 39. File/function/index tham chiếu

| Nội dung | Source |
|---|---|
| Display input | `lms-admin.html:174-176` |
| Save button | `lms-admin.html:206` |
| Load field | `lms-admin.html:1437` |
| `saveCourseMeta()` | `lms-admin.html:1455-1496` |
| LMS admin router | `api/lms/admin.js` |
| Config handler | `utils/lms-handlers/admin-courses.js` |
| Student course-data | `utils/lms-handlers/course-data.js:476-510` |
| Portal router | `api/lms/portal.js` |
| Course-home render | `lms.html:909-914,2226-2234` |
| Alternate course-home | `index.html:810-815,2094-2102` |
| Watermark | `lms.html:999` / `index.html:900` |
| Lesson header | `lesson.html:695-715,1698,1830-1855` |
| Lesson cache TTL | `lesson.html:496` |
| Commerce sync helper | `utils/sync-helpers.js:198-304` ở commerce repo |
| LMS internal sync | `api/sync.js:158-198` |
| Enrollment function | `utils/lms.js:1513-1610` |
| Env pool reader | `utils/lms.js:866-886` |
| DB pool overlay | `utils/lms.js:918-964` |
| Cursor/round-robin | `utils/lms.js:967-1004` |
| Pool provisioning | `utils/lms.js:1158-1314` |
| Queue writer | `utils/lms.js:1317-1349` |
| Legacy retry | `utils/lms.js:1353-1503` |
| Drive retry handler | `utils/lms-handlers/admin-drive-retry.js` |
| Drive health handler | `utils/lms-handlers/admin-drive-health.js` |
| Pool migration | `migration_drive_admin_pool.sql` |
| Queue migration | `migration_drive_sync.sql` |
| Base schema | `supabase_schema.sql:127-147` |

---

## 40. Audit boundary

Audit này không:

- gửi POST/PUT/DELETE tới Production;
- duyệt order;
- tạo enrollment;
- create/revoke Drive permission;
- thay display title;
- thay account status/cursor;
- đọc hoặc in secret/token;
- in email admin/học viên thật;
- sửa source hoặc deploy.

Các kết luận về behavior được lấy từ exact B05 source. Trạng thái account/cursor/
queue là snapshot read-only tại thời điểm ghi và có thể thay đổi sau đó.
