# AUDIT BỔ SUNG READ-ONLY LMS/PORTAL B05

## One-device, risk score, reset/logout và mức độ bằng chứng Production

Ngày audit: 2026-07-27  
Múi giờ: Asia/Saigon

Baseline LMS bắt buộc:

```text
Repository: web-lms-chinh-thuc
Exact commit: fc12c3b21329158e13a4a027833afd2dec61e973
Safe tag: backup/B05-2026-07-25
Production deployment: dpl_HVQvwrveFjxE81cpsoXRraDB34wR
```

Tài liệu được sửa/bổ sung:

```text
LMS_READ_ONLY_AUDIT_ACCOUNT_SHARING_DETECTION_AND_ALERTS_B05_2026-07-26.md
```

---

## 1. Quy ước bằng chứng

| Nhãn | Ý nghĩa |
|---|---|
| **VERIFIED — exact source** | Đọc trực tiếp bằng `git show`/`git grep` tại exact LMS SHA |
| **VERIFIED — Production metadata** | Vercel metadata/env hoặc snapshot Supabase Production chỉ đọc |
| **VERIFIED — local test** | Fixture/script local, không dùng dữ liệu thật và không gọi mutation |
| **INFERRED** | Suy luận có căn cứ nhưng thiếu một mắt xích exact Production |
| **UNRESOLVED** | Không đủ bằng chứng; báo cáo không kết luận thay |

Audit không dùng `origin/main`, không gọi mutation Production, không gọi GET
account-sharing Production sau khi xác minh GET này có write side effect, không
in secret/PII/raw identifier.

---

## 2. Kết luận điều hành đã sửa

Các kết luận quan trọng nhất:

1. **Production LMS hiện không enforce one-device trên bất kỳ course nào.**
   - `V2_GLOBAL_ONE_DEVICE_ENABLED` unset;
   - `LMS_ENTRY_TOKEN_REQUIRED_COURSES` có key nhưng giá trị rỗng;
   - `site_config.v2_active_mode="v2"` và không có kill-switch row;
   - master gate cho phép các feature V2, nhưng feature flag one-device riêng
     vẫn parse thành false;
   - kết quả: `shouldRequireLmsVerifiedSession()` false cho cả 8 course.

2. **Toàn bộ 8 course hiện cho phép legacy signed-cookie/Google credential
   path tại `course-data`; lesson cho phép signed-cookie path.**

3. **Portal end-to-end chưa thể được gắn với exact Git commit Production.**
   Vercel project/deployment/domain đã xác định, nhưng deployment metadata
   không có Git SHA/ref/repo. Vì vậy audit source Portal dừng đúng tại blocker,
   không lấy một local branch làm Production source.

4. **Ví dụ risk trong báo cáo cũ sai.** Kết quả đúng là **90**, không phải 80.

5. **Risk dashboard có double-count design flaw.** Nó gom Portal device hash và
   LMS device hash vào cùng một Set không namespace. Snapshot Production cho
   thấy 18/18 complete Portal→LMS flows có ít nhất hai distinct device hashes.

6. **“Một session” không đồng nghĩa một LMS session.** Database chỉ ép một
   active `student_active_sessions` mỗi email. Cùng tuple
   email/student-session/LMS-device/course có thể có nhiều active
   `lms_verified_sessions`; snapshot có một tuple tối đa 12 active rows.

7. **`reset_session` không phải logout-all cho runtime hiện tại.** Nó thu hồi
   protected chain đầy đủ, nhưng legacy cookie/Google path không kiểm tra
   `student_session_controls` hoặc `sessions_revoked_before`.

8. **GET danh sách cảnh báo không read-only.** GET list upsert risk summaries
   và cập nhật timestamps. GET detail mới là SELECT-only.

9. **Cảnh báo là on-demand investigation dashboard**, không realtime/periodic
   alert system.

---

## 3. Baseline và trạng thái source

**VERIFIED — exact source**

```text
HEAD = fc12c3b21329158e13a4a027833afd2dec61e973
backup/B05-2026-07-25^{} =
fc12c3b21329158e13a4a027833afd2dec61e973
tracked source diff = 0
```

Repo root khác có HEAD khác không được dùng làm baseline. Mọi trích dẫn trong
báo cáo này lấy từ detached worktree `restore-test-B04` hoặc `git show <SHA>`.

---

## 4. Phạm vi one-device thật trên Production

### 4.1 Bốn lớp phải phân biệt

| Lớp | Trạng thái |
|---|---|
| Có code hỗ trợ global one-device | Có |
| Có env key `V2_GLOBAL_ONE_DEVICE_ENABLED` | Không — unset |
| Master runtime đang cho phép V2 | Có — DB mode `v2`, không thấy kill row |
| Feature flag effective | Không — per-feature flag unset → false |
| Allowlist entry-token có course | Không — chuỗi rỗng |
| Runtime LMS content enforcement | 0/8 course |

### 4.2 Env Production đã xác minh

Env được pull tạm thời từ Vercel project LMS, chỉ parse whitelist dưới đây rồi
xóa file local ngay. Không in các env khác.

```text
V2_GLOBAL_ONE_DEVICE_ENABLED = UNSET
LMS_ENTRY_TOKEN_REQUIRED_COURSES = ""
V2_PLATFORM_ENABLED = UNSET
V2_RUNTIME_MODE = UNSET
STUDENT_SESSION_IDLE_HOURS = UNSET
LMS_SESSION_IDLE_HOURS = UNSET
LMS_ENTRY_TOKEN_TTL_MINUTES = UNSET
```

Defaults exact source:

```text
student idle = 24 hours
LMS idle = 24 hours
entry-token TTL = 30 minutes
```

### 4.3 Master gate/kill switch

`api/lms/portal.js:16-20` gọi `warmRuntimeConfig()` trước handler.

`utils/v2-runtime-controller.js` đọc:

```text
site_config.v2_active_mode
site_config.v2_kill_switch
```

Snapshot:

```text
v2_active_mode = "v2"
v2_kill_switch row = absent
```

`isV2ActiveCached()` vì vậy cho phép V2. Tuy nhiên
`isV2GlobalOneDeviceEnabled()` còn bắt buộc:

```javascript
parseBooleanFlag(env.V2_GLOBAL_ONE_DEVICE_ENABLED)
```

Env unset → false. Master gate không làm flag “luôn false”; nó chỉ là
restrict-only outer gate. Trong trạng thái này outer gate true, inner feature
flag false, kết quả cuối vẫn false.

### 4.4 Logic effective

```text
global = isV2ActiveCached()
         AND parseBooleanFlag(V2_GLOBAL_ONE_DEVICE_ENABLED)

protected(course) =
  global
  OR course ∈ split(LMS_ENTRY_TOKEN_REQUIRED_COURSES)
```

Production:

```text
global = true AND false = false
allowlist = []
protected(course) = false với mọi course
```

### 4.5 Ma trận toàn bộ course Production

| course_slug | protected_by_entry_token | legacy_auth_allowed | one_device_enforced | reason |
|---|---:|---:|---:|---|
| `banhmi4k` | No | Yes | No | global flag false; empty allowlist |
| `banhmicamsicula` | No | Yes | No | global flag false; empty allowlist |
| `bonglancuonnhatban` | No | Yes | No | global flag false; empty allowlist |
| `heomoixaolan` | No | Yes | No | global flag false; empty allowlist |
| `nguyencammongtimHT` | No | Yes | No | global flag false; empty allowlist |
| `puddingnama` | No | Yes | No | global flag false; empty allowlist |
| `thitxiennuongchaungoc` | No | Yes | No | global flag false; empty allowlist |
| `thitxiennuongchaungoc-yeubep` | No | Yes | No | global flag false; empty allowlist |

```text
protected_course_count = 0
protected_course_slugs = []
global_one_device_effective = false
```

### 4.6 Các đường nội dung đã kiểm tra

`course-data` khi flag false:

1. thử LMS verified headers nếu có;
2. nếu không có valid LMS access, thử signed session cookie/token;
3. nếu vẫn chưa có email, thử Google credential;
4. kiểm tra enrollment;
5. chỉ bắt entry token nếu course nằm allowlist.

Nguồn: `utils/lms-handlers/course-data.js:357-460`.

`lesson` khi flag false:

1. thử LMS verified headers;
2. fallback signed `course_session_token`;
3. lấy lesson;
4. chỉ bắt verified session nếu course protected;
5. kiểm tra enrollment legacy.

Nguồn: `utils/lms-handlers/lesson.js:381-510`.

`public-config` và `public-lesson` là các endpoint public riêng, không phải đường
student entitlement. Chúng cũng không được mô tả là one-device protected.

---

## 5. Audit exact Portal Production

### 5.1 Đã xác định chắc chắn

**VERIFIED — Production metadata**

```text
Domain: www.yeunauan.live
Vercel project: student-web
Project ID: prj_paRRXhaTAqF6NnqbZBK6HsZP4zm3
Production deployment: dpl_92XTh25gr74NznTbr6vJZDfMo5Mq
Status: READY
Deployment URL:
student-83y8mqx4n-thienha100022653824678-stacks-projects.vercel.app
Created: 2026-07-17 00:49:26 +07:00
```

Local candidate repository:

```text
GitHub repository:
thienha100022653824678-stack/tao-web-tra-bai-hoc-vien
App directory: student-web
```

### 5.2 Blocker exact commit

Vercel deployment metadata trả:

```text
githubCommitSha = null
githubCommitRef = null
githubRepo = null
gitSource = null
```

Alias có branch-like suffix nhưng không phải cryptographic commit evidence.
Thời điểm deployment nằm giữa một số local commits cũng không chứng minh commit
nào đã deploy. Có thể deployment được tạo từ local artifact.

Vì yêu cầu bắt buộc xác định exact Production commit trước khi đọc Portal
source, audit **dừng phần source Portal tại đây**.

### 5.3 Những mục Portal vẫn UNRESOLVED

- exact endpoint Google login;
- nơi sinh `portal_device_id`;
- cookie/localStorage chính xác của Portal Production;
- exact caller RPC `handle_student_session_login`;
- exact `p_conflict_policy`;
- caller tạo `lms_entry_tokens`;
- các route Portal có thể bỏ qua RPC/entry token;
- Portal logout cascade;
- Portal feature flag effective.

RPC tồn tại và database có event không đủ để gán behavior cho exact Portal
deployment. Báo cáo không dùng source local candidate để lấp blocker.

### 5.4 Bằng chứng Production gián tiếp, không thay exact source

Snapshot event có các event type Portal/entry token và các complete flow.
Điều này chứng minh Production đã tạo session/token events tại một thời điểm,
nhưng không chứng minh mọi login path hiện tại đều đi qua RPC.

---

## 6. Công thức risk score chính xác

Handler:

```text
utils/lms-handlers/admin-account-sharing-alerts.js
function summarizeEmailEvents()
```

### 6.1 Event bị loại

Scoring input:

1. `dedupeEvents(events)`;
2. loại admin event:
   - `event_source === "admin"`, hoặc
   - event type bắt đầu `admin_`;
3. loại event có `hash_version` khác current
   `hmac_sha256_v2`;
4. event không có `hash_version` vẫn được giữ.

### 6.2 Dedupe

Key:

```text
event_idempotency_key
```

Nếu thiếu:

```text
id:created_at:event_type
```

### 6.3 Unique device source fields

Mỗi event đóng góp union:

```text
old_device_hash
new_device_hash
lms_device_hash
```

Các giá trị falsy bị bỏ, sau đó JavaScript `Set` dedupe exact string.

`uniqueDevices24h` là Set của ba field trên với event trong 1 ngày.
`uniqueDevices7d` là Set tương tự với event trong 7 ngày.

Không dùng:

```text
portal_device_id raw
lms_device_id raw
IP hash
user agent
physical hardware ID
```

### 6.4 blockedCount

Tăng 1 nếu:

```text
event_type === "login_blocked_other_device"
OR reason === "active_session_on_another_device"
```

Một event thỏa cả hai vẫn chỉ tăng 1 vì một `if`.

### 6.5 deviceChangeCount

Tăng 1 nếu cùng event có:

```text
old_device_hash truthy
AND new_device_hash truthy
AND old_device_hash !== new_device_hash
```

Khác biệt giữa `new_device_hash` và `lms_device_hash` không tự tăng
`deviceChangeCount`; nó chỉ làm tăng unique device Set.

### 6.6 Công thức

```text
device24Score =
  min(max(0, uniqueDevices24h - 1) × 18, 36)

device7Score =
  min(max(0, uniqueDevices7d - 2) × 10, 30)

blockedScore =
  min(blockedCount × 14, 42)

changeScore =
  min(max(0, deviceChangeCount - 1) × 8, 24)

total =
  device24Score + device7Score + blockedScore + changeScore
```

Hai điểm 24h và 7d **được cộng đồng thời**. Cùng các device trong 24h cũng nằm
trong 7d; đây là intentional overlap theo code hiện tại.

### 6.7 Ví dụ 80 hay 90

Input giả:

```text
uniqueDevices24h = 3
uniqueDevices7d = 3
blockedCount = 2
deviceChangeCount = 3
```

Local calculation từ công thức exact:

```text
device24Score = 36
device7Score = 10
blockedScore = 28
changeScore = 16
total = 90
```

**Kết luận: 90.** Báo cáo cũ ghi 80 vì bỏ sót `device7Score=10`.

Ngưỡng:

```text
normal: <20
watch: 20–44
suspicious: 45–79
high: >=80
```

Ví dụ vẫn thuộc `high`, nhưng số điểm tài liệu phải sửa từ 80 thành 90.

---

## 7. Nguy cơ đếm trùng Portal device và LMS device

### 7.1 Event writer

`logStudentDeviceEvent()`:

```text
new_device_hash =
  caller-supplied newDeviceHash
  OR HMAC(lmsDeviceId)

lms_device_hash = HMAC(lmsDeviceId)
lms_session_hash = HMAC(lmsSessionId)
ip_hash = caller value OR HMAC(ip)
```

Với LMS event có `lmsDeviceId`, `new_device_hash` và `lms_device_hash` thường
giống nhau. Set dedupe chúng thành một hash trong cùng event.

### 7.2 Không namespace

Hash input không có prefix:

```text
"portal:" + id
"lms:" + id
```

`getEventDeviceHashes()` cũng không giữ loại/source. Nó gom raw HMAC strings
vào cùng Set.

### 7.3 Production aggregate

Không xuất hash/email/flow ID thật. Chỉ aggregate:

```text
event rows = 64
flow groups có flow_id = 21
complete flows có entry_token_created + lms_session_created = 18
complete flows có >=2 distinct device hashes = 18/18
```

Phân bố:

```text
17 flow có 2 distinct hashes
1 flow có 3 distinct hashes
3 flow có 1 distinct hash
```

Đây là bằng chứng Production rằng một end-to-end flow đang góp nhiều profile
hash vào cùng risk Set.

### 7.4 Một người, một browser bị tính 1 hay 2?

**Thực tế aggregate: có thể bị tính 2.**

Ví dụ giả:

```text
Portal profile ID: portal_A
LMS localStorage ID: lms_B

entry_token_created.new_device_hash = HMAC(portal_A)
lms_session_created.new_device_hash = HMAC(lms_B)
lms_session_created.lms_device_hash = HMAC(lms_B)
```

Set:

```text
{ HMAC(portal_A), HMAC(lms_B) }
```

Kết quả: 2 profiles dù người dùng thực hiện một hành trình trên một browser.

Vì exact Portal source bị blocker, báo cáo không khẳng định cách Portal sinh ID.
Tuy nhiên snapshot complete-flow đủ chứng minh hai hash khác nhau đã được ghi
và cùng được scoring code gom.

---

## 8. “Một session” nghĩa là gì

### 8.1 Thuật ngữ chuẩn

| Thuật ngữ | Ý nghĩa |
|---|---|
| Account | Normalized email |
| Portal/student session | Row `student_active_sessions`, global theo account |
| LMS verified session | Row `lms_verified_sessions`, gắn student session + browser profile + course |
| Browser profile | Storage context tạo/gửi device ID |
| Physical device | Điện thoại/máy tính vật lý; source không chứng minh |

Không gọi browser profile là physical device.

### 8.2 Student active session

Partial unique index:

```sql
UNIQUE (lower(email)) WHERE status='active'
```

Tối đa một active Portal/student session mỗi account email.

### 8.3 LMS verified session

Schema chỉ unique:

```text
lms_session_id
```

Không unique các tuple:

```text
(email, course_slug)
(email, lms_device_id, course_slug)
(email, student_session_id, lms_device_id, course_slug)
```

`createLmsVerifiedSession()` luôn `.insert()`, không upsert/reuse.

### 8.4 Entry-token reuse

Token lookup yêu cầu status `active`; sau success được đổi sang `used`.
Sequential reuse bị chặn. Nhưng không có atomic database function bao trọn:

```text
verify active token
insert LMS session
mark token used
```

Hai request song song có thể cùng đọc token active trước update. Không thấy
row lock/conditional consume RPC. Đây là race risk.

### 8.5 Production cardinality

Aggregate snapshot:

```text
raw active LMS sessions = 17
duplicate active tuple groups
(email, student_session_id, lms_device_id, course_slug) = 2
maximum active rows in one identical tuple = 12
```

Vì vậy câu “một account có một session” là sai. Câu đúng:

> Một account bị giới hạn một active Portal/student session; nó có thể có
> nhiều active LMS verified sessions, kể cả nhiều row trùng browser profile và
> course.

### 8.6 Cleanup/expiry

LMS/session expiry là lazy khi access, không có scheduler cleanup row. Row cũ
được đổi status khi chạm đúng path; không bị xóa tự động trong exact source.

---

## 9. Phạm vi thật của `reset_session`

Endpoint:

```text
POST /api/lms/admin?endpoint=account-sharing-alerts
action=reset_session
```

### 9.1 Protected flow

RPC `reset_student_session_guard`:

1. advisory lock;
2. upsert `student_session_controls`;
3. tăng `session_generation`;
4. đặt `sessions_revoked_before`;
5. active parent → `admin_reset`;
6. active entry tokens → `revoked`;
7. active LMS sessions → `admin_reset`;
8. audit.

Verifier protected flow kiểm tra parent/control/status. Kết quả:

```text
reset_session logout toàn bộ protected flow = YES
```

Trong nghĩa server-side authorization chain; browser storage chưa được xóa từ
xa nhưng stored IDs không còn hợp lệ.

### 9.2 Legacy flow

`course-data` legacy:

```text
verifyStudentSession(signed cookie/token)
OR verifyGoogleIdToken(credential)
then check enrollment
```

`lesson` legacy:

```text
verifyStudentSession(cookie)
then check enrollment
```

Hai path không đọc:

```text
student_session_controls
sessions_revoked_before
student_active_sessions status
```

RPC không thể xóa cookie/localStorage trong browser từ database. Nó cũng không
revoke Google credential tại Google.

Kết quả:

```text
reset_session logout toàn bộ legacy flow = NO
```

Với Production hiện 0/8 protected, signed cookie còn hợp lệ có thể tiếp tục
qua course-data/lesson sau reset, miễn enrollment vẫn active.

### 9.3 Những gì reset không vô hiệu hóa trực tiếp

| Artifact | Reset server-side |
|---|---:|
| Active student session | Yes |
| Active entry token | Yes |
| Active LMS verified session | Yes |
| Session-control timestamp | Set/update |
| Signed cookie legacy trong browser | No |
| Google credential/token | No |
| LMS localStorage device/session values | No |
| Enrollment | No |

### 9.4 Local test

Exact tests xác nhận:

- flag-off giữ legacy path;
- flag-on cookie không bypass;
- reset active returns affected sessions;
- reset error fails safely;
- token revoked by session control bị từ chối.

Targeted result:

```text
runtime/logout/revoke: 41/41 pass
policy/legacy/protected/token: 36/36 pass
```

---

## 10. GET account-sharing có write side effects

### 10.1 GET list

```text
GET /api/lms/admin?endpoint=account-sharing-alerts
```

Flow:

```text
listAlerts()
→ refreshRiskSummaries(max(days,30))
→ computeAlertsFromEvents()
→ summaryPayload()
→ student_account_risk_summaries.upsert(...)
→ SELECT summaries
```

Write fields gồm:

```text
risk_score
risk_level
devices_24h
devices_7d
devices_30d
blocked_count
device_change_count
last_event_at
last_device_change_at
recent_devices
course_slugs
reasons
review fields mirror
risk_rule_version
summary_window_days
computed_at
stale_after
updated_at
```

Nếu không có alerts thì `refreshed=0` và không upsert. Nếu summary table thiếu,
handler fallback tính trong memory.

### 10.2 GET detail

```text
GET ...&mode=detail&email=...
```

`getDetail()` chỉ SELECT event/session/review/note/audit. Không gọi refresh và
không write.

### 10.3 Reload admin

Mở/reload tab list gọi GET list. Khi có event:

- summary có thể được upsert lại;
- `computed_at`, `stale_after`, `updated_at` tiến lên;
- không có `admin_audit_logs` row cho refresh GET.

### 10.4 Kết luận read-only

Một audit gọi GET list Production **không còn là read-only về semantic**.
Vì vậy task này không gọi endpoint đó. GET detail về source là SELECT-only,
nhưng cũng không cần gọi vì snapshot đã đủ.

### 10.5 Thiết kế nên có

Không sửa trong task. Đề xuất:

- GET chỉ SELECT;
- compute summary bằng scheduled worker hoặc explicit POST admin action;
- hoặc view/materialized view read-only;
- nếu vẫn refresh on request, dùng endpoint POST rõ side effect và ghi audit.

---

## 11. Logout và child session tồn đọng

Endpoint:

```text
POST /api/lms/portal?endpoint=logout
```

### 11.1 Exact behavior LMS

Khi verified access hợp lệ:

```text
student_active_sessions.status = logged_out
logout_at = now
```

Helper `markStudentSessionLoggedOut()` không update:

```text
lms_entry_tokens
lms_verified_sessions
```

Cookie `course_session_token` được clear trong response.

Khi flag false và request không có valid verified headers:

```text
clear cookie
serverRevoked=false
```

### 11.2 Effective access sau logout

Ví dụ:

```text
parent student_active_sessions.status = logged_out
child lms_verified_sessions.status = active
```

Request protected tiếp theo:

1. child row lookup thành công;
2. child raw status active;
3. parent lookup thành công;
4. parent status không active;
5. verifier trả `student_session_logged_out`;
6. access bị từ chối.

Raw child active không có nghĩa effective-active.

### 11.3 Dashboard có thể gây hiểu nhầm

Admin detail select raw status của parent và child, không tính cột
`effectiveActive`. Một child active bên cạnh parent logged_out có thể bị hiểu
nhầm là còn truy cập được.

Risk summary không dùng raw active child count, nên score không tăng vì orphan
status. Nhưng operator/UI session review có thể bị sai nhận thức.

### 11.4 Snapshot

Tại thời điểm snapshot:

```text
active LMS children with non-active/missing parent = 0
```

Source vẫn cho phép trạng thái đó sau LMS logout. Snapshot 0 không phủ định
design debt.

### 11.5 Cleanup

Không thấy automatic child cascade/cleanup scheduler trong exact LMS source.
Admin reset mới cascade status đầy đủ.

---

## 12. Cảnh báo realtime hay on-demand

### 12.1 Không tìm thấy

Exact source không có consumer account-sharing cho:

- realtime worker;
- Vercel cron;
- scheduled risk refresh;
- scheduled retention cleanup;
- email;
- webhook;
- push;
- Slack;
- Telegram;
- notification badge realtime;
- auto-block theo score.

### 12.2 Có gì thực sự

- event được ghi best-effort tại runtime;
- summary được recompute khi admin GET list;
- cleanup RPC chỉ chạy qua POST admin action `cleanup_retention`;
- `stale_after` được ghi `now+15m` nhưng không có scheduler/consumer dùng để
  refresh;
- score không nối vào authorization.

### 12.3 Phân loại chính xác

```text
realtime alert = NO
periodic alert = NO
on-demand investigation dashboard = YES
```

Event logging gần realtime không biến dashboard thành realtime alert.

---

## 13. Mức độ bảo vệ của device ID

### 13.1 LMS frontend

`lms.html`:

```text
key = lms_device_id
storage = localStorage
generation = 24 random bytes bằng crypto.getRandomValues
fallback = timestamp + Math.random
```

Nếu storage thiếu, sinh ID và `localStorage.setItem`.
Nếu storage exception, sinh ID tạm mới.

### 13.2 Binding

ID được gửi:

```text
body.lms_device_id ở verify-entry-token
X-LMS-Device-Id ở course-data/lesson/logout
```

Server bind plaintext ID vào `lms_verified_sessions.lms_device_id`. Event log
chỉ giữ HMAC hash.

### 13.3 Không có

- server signature trên device ID;
- hardware attestation;
- WebAuthn key;
- TPM/Secure Enclave binding;
- rotation policy;
- IndexedDB protection;
- HttpOnly storage;
- proof device ID được tạo bởi trusted client.

Client có thể tự đặt body/header. Nếu copy cả LMS session ID và device ID sang
browser khác, exact verifier chỉ thấy cặp khớp.

### 13.4 Kết luận thuật ngữ

```text
browser-profile identifier
≠ hardware device identifier
≠ anti-sharing proof
```

Nó là một shared-secret-like client label, hữu ích cho friction và telemetry,
không phải bằng chứng vật lý.

---

## 14. False-positive / false-negative matrix

Chú thích:

- “Protected” là behavior nếu course thực sự protected.
- Production hiện không có protected course; cột legacy phản ánh behavior thật.
- Portal block ghi UNRESOLVED khi cần exact Portal source.

| Tình huống | Device profile mới? | Risk tăng? | Portal login block? | Protected course | Legacy course hiện tại | FP/FN risk |
|---|---|---|---|---|---|---|
| Cùng máy, Chrome và Safari | Có, LMS localStorage tách | Có thể; unique hash tăng | UNRESOLVED exact Portal; thiết kế thường khác profile | Browser thứ hai cần session chain hợp lệ | Signed cookie/Google riêng vẫn có thể vào | False positive cao nếu chủ account dùng hợp lệ |
| Điện thoại và máy tính | Có | Có thể | UNRESOLVED exact Portal | Session/device khác bị từ chối nếu không cấp chain | Legacy auth vẫn cho vào sau login/enrollment | False positive cao |
| Xóa cookie, giữ localStorage | LMS device ID giữ | Thường không tăng từ LMS ID; event khác có thể tăng | UNRESOLVED | Stored verified session có thể còn; cookie không quyết định protected | Cần signed cookie mới hoặc Google credential | Thấp/trung bình |
| Xóa toàn bộ site data | Có LMS profile mới | Có thể tăng | UNRESOLVED | Session ID/device ID cũ mất; cần entry flow mới | Có thể Google login lại và vào | False positive |
| Private mode | Thường profile mới/không bền | Có thể tăng mỗi phiên | UNRESOLVED | Cần session chain mỗi private context | Legacy Google/cookie mới vẫn được phép | False positive cao |
| VPN | Không nếu storage giữ | Không theo formula; IP không scoring | Không thể kết luận Portal | Không chặn chỉ vì VPN | Không chặn chỉ vì VPN | Ít FP từ score; IP log dễ bị hiểu sai |
| Đổi Wi-Fi/4G | Không nếu storage giữ | Không theo formula | Không thể kết luận Portal | Không chặn chỉ vì IP | Không chặn chỉ vì IP | Ít FP |
| Copy localStorage/session sang máy khác | Không theo server — cùng copied ID | Không hoặc khó phát hiện | Portal UNRESOLVED | Có thể bypass device equality | Có thể copy signed cookie/session | False negative nghiêm trọng |
| Hai người dùng cùng session/device ID | Server thấy cùng profile | Không tăng unique hash | Portal UNRESOLVED | Cả hai có thể được chấp nhận nếu replay hợp lệ | Legacy cookie replay có thể vào | False negative nghiêm trọng |
| Session cũ idle >24h | Không nhất thiết | Không tự tăng | UNRESOLVED | Lazy-expire và từ chối | Signed cookie legacy không đọc idle session table | False negative ở legacy |
| Nhiều khóa học cùng account | Cùng LMS browser ID có thể giữ | Course khác không làm hash mới; duplicate Portal/LMS hash vẫn có | UNRESOLVED | Có LMS session per course; cùng parent | Cookie/Google + enrollment theo course | Không nhất thiết sharing; session count dễ bị hiểu sai |

---

## 15. Những kết luận báo cáo cũ cần sửa

| Kết luận cũ | Sửa thành |
|---|---|
| Scope phụ thuộc allowlist nhưng chưa biết giá trị | Allowlist Production rỗng; protected count 0 |
| Global flag vắng theo snapshot tên | Đã xác minh trực tiếp env Production: unset/effective false |
| Risk example = 80 | Risk example = 90 |
| Device/profile count mô tả chung | Portal và LMS hashes bị gom chung; 18/18 complete flows có >=2 hashes |
| Một active Portal session, có thể nhiều LMS session | Bổ sung: exact tuple có thể trùng nhiều active rows; max 12 trong snapshot |
| Reset gần với logout all | Chỉ logout-all protected chain; không revoke legacy cookie/Google path |
| GET dashboard dùng để xem | GET list có upsert/write timestamps; không phải read-only |
| Child active có thể tồn đọng | Bổ sung: verifier từ chối effective access qua parent; UI vẫn hiển thị raw active |
| Risk on-demand | Giữ nguyên và nâng mức bằng chứng: không cron/worker/notification consumer |
| Portal caller chưa ở repo LMS | Bổ sung exact blocker: Vercel deployment không có Git SHA; không audit guessed source |

---

## 16. Bugs và design debt đã xác minh

### 16.1 LMS one-device effective 0/8

Phân loại: security configuration gap.  
Code có nhưng Production config không bật và allowlist rỗng.

### 16.2 Legacy reset bypass

Phân loại: High security design gap.  
Admin reset không vô hiệu hóa signed-cookie/Google legacy content path.

### 16.3 Risk double count

Phân loại: scoring bug/design flaw.  
Portal và LMS browser identifiers khác loại bị coi là nhiều “device”.

### 16.4 Overlapping 24h/7d score

Phân loại: model design.  
Cùng hash trong 24h đóng góp cả 24h và 7d score. Có thể là chủ ý nhưng phải
document; ví dụ cũ chứng minh dễ bị bỏ sót.

### 16.5 GET writes

Phân loại: HTTP semantics/design debt.  
GET admin list mutate summary timestamps/data.

### 16.6 Duplicate active LMS sessions

Phân loại: data integrity/idempotency gap.  
Không unique/upsert tuple; token verify/consume không atomic. Production đã có
duplicate active tuple.

### 16.7 Logout parent-only

Phân loại: lifecycle consistency debt.  
Effective access bị chặn đúng, nhưng raw child status có thể stale và UI gây
nhầm.

### 16.8 No proactive alerting

Phân loại: product/operations gap.  
Tên “cảnh báo” dễ khiến hiểu nhầm; thực tế là dashboard điều tra theo yêu cầu.

### 16.9 Portal artifact provenance

Phân loại: release governance gap.  
Production deployment không mang exact Git provenance, cản audit/reproducibility.

---

## 17. Cải tiến đề xuất — chưa triển khai

1. Gắn exact commit metadata/SBOM vào mọi Portal deployment.
2. Tạo safe tag/backup cho exact Portal artifact trước thay đổi.
3. Audit exact Portal source sau khi provenance được khôi phục.
4. Thiết kế và rollout global one-device có Preview/canary/rollback.
5. Trước rollout, sửa legacy reset để cookie/credential path đọc revoke control
   hoặc tắt hoàn toàn legacy authorization.
6. Namespace risk identity:
   - `portal:<hash>`;
   - `lms:<hash>`;
   - hoặc map hai ID cùng flow thành một browser-profile entity.
7. Không cộng Portal và LMS profile như hai physical devices.
8. Viết unit test exact example 90 và boundary thresholds.
9. Atomically consume entry token và create/reuse LMS session bằng RPC.
10. Unique active tuple hoặc idempotent reuse LMS session.
11. GET list chỉ SELECT; chuyển refresh sang explicit POST/worker.
12. Thêm scheduler có audit cho summary refresh/cleanup nếu owner muốn periodic.
13. Thêm `effective_status` ở admin UI dựa trên parent/control.
14. Cascade child status khi logout hoặc có cleanup reconciliation.
15. Đổi nhãn UI từ “thiết bị” thành “browser profile” khi không có hardware
    evidence.
16. Không auto-block dựa riêng risk score trước khi giảm false positives.
17. Xem xét rotating server-issued device credential/WebAuthn.

Không mục nào được triển khai trong task này.

---

## 18. Kết quả local tests

### 18.1 PASS có mục tiêu

```text
rp2b2 logout
rp2b3 revoke
v2 runtime controller
Result: 41/41 pass
```

```text
flag/policy
legacy vs protected course-data/lesson
verify-entry-token
exchange-code
Result: 36/36 pass
```

### 18.2 Lần chạy rộng đầu tiên

```text
101/105 pass
4 fail
```

Bốn test defer-touch rơi khỏi fake Supabase stub và cố resolve domain giả
`rp2b1-test.supabase.co`, dẫn tới `ENOTFOUND`/unexpected status. Không có request
Production. Các failure được ghi nhận là test-harness/environment seam, không
được dùng làm bằng chứng Production behavior.

---

## 19. Bảng vấn đề và bước tiếp theo

| Vấn đề | Mức độ | Đã xác minh? | Ảnh hưởng thực tế | Cần sửa code hay tài liệu | Đề xuất bước tiếp theo |
|---|---|---|---|---|---|
| One-device effective 0/8 course | Critical | Source + Production env/data | Toàn bộ course vẫn có legacy auth path | Config và có thể code | Thiết kế cutover sau khi sửa reset/legacy |
| Reset không revoke legacy cookie/Google path | Critical | Exact source + local tests | Admin tưởng đã logout-all nhưng học viên có thể tiếp tục | Code | Bind legacy path vào revoke control hoặc disable |
| Portal exact commit không xác định | High | Vercel metadata | Không audit/reproduce exact Production Portal | Release process + tài liệu | Khôi phục artifact provenance trước audit |
| Risk double-count Portal/LMS hash | High | Source + Production aggregate | Score tăng nhầm cho một flow/browser | Code + data interpretation | Namespace/map profile; recompute summaries |
| Duplicate active LMS tuple | High | Schema/source + Production aggregate | Session bloat, race/idempotency yếu | Code + constraint/RPC | Atomic consume/reuse + migration reviewed |
| Device ID có thể copy/replay | High | Exact frontend/backend source | Hai người có thể dùng cùng copied identity | Code/architecture | Server credential rotation/WebAuthn |
| GET list ghi database | Medium | Exact source | Audit GET làm đổi summary/timestamps | Code + API docs | Tách compute write khỏi GET |
| Logout chỉ đổi parent | Medium | Exact source | Child raw status stale; admin UI gây hiểu nhầm | Code/UI | Cascade hoặc effective-status projection |
| Risk 24h và 7d cộng chồng | Medium | Exact function + local calc | Score cao nhanh; tài liệu dễ sai | Có thể code, chắc chắn tài liệu | Chốt policy và thêm unit tests |
| Ví dụ risk ghi 80 thay vì 90 | Low | Local calculation | Báo cáo sai số | Tài liệu | Sửa thành 90 |
| Không realtime/periodic alert | Medium | Exact source inventory | Admin chỉ thấy khi mở dashboard | Product/code | Chọn rõ on-demand hoặc thêm worker |
| `stale_after` không có consumer | Low | Exact source | Field gây kỳ vọng refresh tự động | Code/tài liệu | Worker hoặc bỏ field/đổi mô tả |
| Cleanup không scheduled | Medium | Exact source | Log tăng không giới hạn vận hành | Operations/code | Cron có dry-run/audit/retention approval |
| Browser profile bị gọi là physical device | Medium | Exact source | Admin dễ kết luận chia sẻ sai | UI/tài liệu | Đổi thuật ngữ |
| Test defer-touch seam lỗi fake DNS | Low | Local test | Full suite không hermetic | Test code | Sửa stub, cấm network trong tests |

---

## 20. Quy tắc vận hành an toàn hiện tại

- Không dùng risk score một mình để kết luận chia sẻ.
- Không nói “một thiết bị vật lý”; dùng “browser profile”.
- Không nói `reset_session` là logout-all khi legacy path còn bật.
- Không dùng GET list account-sharing cho audit read-only Production.
- Muốn xem không ghi, ưu tiên snapshot hoặc GET detail đã review source.
- Không bật global flag trước khi sửa reset/legacy và test Portal exact artifact.
- Không xóa enrollment/order để xử lý session.
- Không sửa trực tiếp raw session rows trong Supabase dashboard.
- Khi đổi máy hợp lệ, ghi note/reason và theo dõi, tránh kết luận từ two-profile
  score.
- Không audit Portal source từ branch local cho đến khi exact Production commit
  được chứng minh.

---

## 21. Audit boundary

Task chỉ đọc:

- exact LMS Git source;
- Vercel project/deployment/env metadata;
- local Production backup snapshot;
- local fixture/unit tests.

Không sửa source, không deploy, không merge, không ghi Supabase, không gọi
mutation Production, không gọi GET account-sharing list Production, không in
secret/raw token/full session ID/IP/email thật.

