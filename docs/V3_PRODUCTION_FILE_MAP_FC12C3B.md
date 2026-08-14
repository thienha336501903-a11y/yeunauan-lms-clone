# V3 Production File Map — baseline `fc12c3b`

## Baseline đã xác minh

- Production domain: `daubepnho.store`
- Vercel project: `web-lms-chinh-thuc`
- Production deployment hiện tại: `dpl_6xCSEJAa18Q5aiD8TVeuRYr83DKY`
- Source repo thật: `thienha100022653824678-stack/web-lms-chinh-thuc`
- Source commit: `fc12c3b21329158e13a4a027833afd2dec61e973`
- Commit message: `fix(lms): harden main video one-tap playback`

Không dùng repo rỗng `thienha336501903-a11y/web-lms-chinh-thuc` làm source-of-truth.

## Kết luận kiến trúc quan trọng

**KHÔNG thêm `v3` trực tiếp vào `utils/v2-runtime-controller.js`.**

Lý do: controller V1/V2 hiện tại là master gate cho nhiều feature V2. Các hot-path đọc `isV2ActiveCached()`. Nếu `activeMode` bị đổi thành `v3`, các reader hiện tại sẽ coi hệ thống không ở V2 và có thể tắt outbox, session/device, CORS hoặc các feature V2 khác.

V3 phải là **presentation layer chạy trên nền V2**, không phải mode thứ ba bên trong V2 controller.

### Model đề xuất

Giữ nguyên:
- `v2_active_mode`: `v1 | v2`
- `v2_kill_switch`: global emergency switch hiện có, ép V1
- toàn bộ `v2-runtime-controller.js` + `v2-runtime-cache.js` + feature flags

Thêm riêng:
- `v3_presentation_enabled`: boolean
- `v3_kill_switch`: boolean, chỉ ép V3 về V2

Mode hiển thị cho Admin được suy ra:

```text
if existing v2_kill_switch == true OR v2 activeMode == v1:
    effective = V1
else if v3_presentation_enabled && !v3_kill_switch:
    effective = V3
else:
    effective = V2
```

Configured/display mode:
- V1: `v3_presentation_enabled=false`, `v2_active_mode=v1`
- V2: `v3_presentation_enabled=false`, `v2_active_mode=v2`
- V3: `v2_active_mode=v2`, sau đó `v3_presentation_enabled=true`

### Thứ tự ghi an toàn

Chuyển sang V3:
1. đảm bảo `v2_active_mode=v2`
2. chỉ khi bước 1 thành công mới bật `v3_presentation_enabled=true`

Chuyển V3 -> V2:
1. tắt `v3_presentation_enabled`
2. giữ V2 runtime nguyên trạng

Chuyển V3/V2 -> V1:
1. tắt `v3_presentation_enabled`
2. gọi controller cũ set V1

Bật global kill cũ:
- giữ nguyên semantics hiện tại: ép V1, bất kể V3 config.

Bật V3 kill:
- chỉ tắt hiệu lực presentation V3; nền V2 vẫn chạy.

---

# File Production sẽ thay đổi

## 1. `admin.html` — MODIFY có giới hạn

Hiện đã có tab `⚙️ Hệ Thống`, card V1/V2, badge mode/effective/kill, nút V1/V2 và global kill switch.

Thay đổi:
- tiêu đề `V1 / V2` -> `V1 / V2 / V3`
- thêm card/nút `V3 — Telegram Channel LMS`
- badge tách rõ:
  - Đã chọn
  - Hiệu lực
  - Global kill switch (cũ, ép V1)
  - V3 kill switch (mới, ép V2)
- giữ nguyên danh sách V2 feature flags hiện tại
- thêm nút mở V3 learner / V3 Admin Preview/direct route
- System UI gọi endpoint unified mới (xem mục 2) thay vì thay contract endpoint V1/V2 cũ.

**Không sửa tab Bài Học / Học Viên / Phân Quyền / Drive ngoài việc có thể tạo link sang V3 Admin.**

## 2. `utils/lms-handlers/admin-v3-runtime-mode.js` — NEW

Endpoint unified dành riêng cho UI V1/V2/V3.

Nhiệm vụ:
- admin auth như `admin-runtime-mode.js`
- đọc snapshot V1/V2 từ controller cũ
- đọc `v3_presentation_enabled`, `v3_kill_switch`
- trả:
  - `configuredMode`: v1|v2|v3
  - `effectiveMode`: v1|v2|v3
  - `globalKillSwitch`
  - `v3KillSwitch`
  - `source`
  - giữ `flags` posture V2 nếu UI cần
- action:
  - `set_mode(v1|v2|v3)` theo thứ tự fail-safe ở trên
  - `set_v3_kill_switch(boolean)`
- audit log riêng cho V3 mode/kill.

**Không xóa hoặc đổi contract `admin-runtime-mode.js`.** Endpoint cũ giữ nguyên để tests/ops hiện tại tiếp tục hoạt động.

## 3. `utils/v3-presentation-controller.js` — NEW

Controller nhỏ chỉ quản lý presentation V3.

Không thay thế V2 controller.

Nhiệm vụ:
- đọc 2 key V3 từ `site_config`
- cache ngắn ~5s
- fail-safe: V3 disabled nếu DB lỗi
- kết hợp với `getRuntimeSnapshot()` của `v2-runtime-controller.js`
- xuất unified `configuredMode/effectiveMode`
- helper set V3 enabled/kill

## 4. `api/lms/admin.js` — MODIFY tối thiểu

Chỉ:
- import `admin-v3-runtime-mode.js`
- mount endpoint mới, ví dụ `endpoint=v3-runtime-mode`

Không đổi warm `v2-runtime-controller`; V3 chạy trên nền đó.

## 5. `utils/lms-handlers/v3-bootstrap.js` — NEW nhưng ADAPT theo Production

Không copy nguyên handler Clone nếu chưa adapt.

Production có session/entry-token/device guard mạnh hơn Clone. Handler Production V3 bootstrap phải:
- ưu tiên verified LMS session/device Production
- tôn trọng session generation/revoke/one-device logic Production
- không tự hạ yêu cầu entry token của course protected
- Google account chooser chỉ là fallback xác định email khi luồng hiện tại cho phép
- chỉ trả danh sách enrollment + session cần thiết; không trả lesson content
- sau khi chọn course, `course-data` Production vẫn là authority.

## 6. `api/lms/portal.js` — MODIFY tối thiểu

Chỉ:
- import V3 bootstrap handler
- mount `endpoint=v3-bootstrap`

Giữ nguyên:
- `warmRuntimeConfig()` V1/V2
- server timing
- logout
- entry token flow hiện tại.

## 7. `api/learning.js` — NEW

URL learner chung cho V3 rollout.

Production không nên copy logic V2 resolver Clone mù quáng.

Đề xuất:
- resolve unified effective mode
- effective V3 -> `/v3` và giữ toàn bộ query/hash-compatible information cần thiết
- effective V1/V2 -> route **đúng đường học hiện tại của Production**, không phát minh auth flow mới

Trước khi cutover cần xác định link từ Student Portal sang LMS và preserve `entry_token` + `course`.

## 8. `vercel.json` — MODIFY additive

Hiện chỉ có no-cache headers.

Thêm rewrite additive:
- `/learning` -> `/api/learning`
- `/v3` -> V3 entry
- `/v3-admin` -> V3 Admin

Không đổi header policy hiện tại.

## 9. V3 learner HTML stack — NEW

Port từ Clone sau khi thay endpoint/base auth phù hợp Production:
- `v3-entry.html`
- `channel-candidate.html`
- `channel-v2-safe-ui.html`
- `channel-v2-toc.html`
- `channel-v2-safe.html`
- `channel-v2.html`
- `channel.html`

Giai đoạn đầu giữ chain đã test, **không refactor/gộp file trong cùng PR port**.

## 10. V3 Admin HTML stack — NEW

Port từ Clone:
- `channel-admin-candidate.html`
- `channel-admin-bg-count.html`
- `channel-admin-bg.html`
- `channel-admin.html`

Route chuẩn:
- `/v3-admin?course=<slug>`

Admin session hiện có của Production phải tiếp tục là authority.

## 11. `utils/lms-handlers/admin-upload-gdrive-video.js` — MODIFY nhỏ

Production hiện `get-folder` vẫn ép media type thành:
- `main_video`
- hoặc `lesson_media_video`

V3 cần mở rộng whitelist như Clone:
- `main_video`
- `lesson_media_video`
- `lesson_media_image`
- `lesson_media`
- `lesson_material`

Chỉ sửa type resolver; giữ toàn bộ CORS/admin auth/Drive pool Production hiện tại.

## 12. `utils/lms-handlers/admin-lessons.js` — MODIFY nhỏ, cherry-pick logic chứ không overwrite

Production file có thêm recipe digest + System1 sync mà Clone không có.

Do đó **không copy file Clone**.

Chỉ cherry-pick helper normalize description/link và áp dụng vào:
- create `description`
- update `description`

Giữ nguyên:
- `buildCourseRecipeDigest`
- `syncCourseRecipeDigestToPortal`
- CORS
- soft-delete
- section fallback
- mọi behavior Production khác.

---

# File Production nên giữ nguyên trong PR V3 đầu tiên

- `utils/v2-runtime-controller.js`
- `utils/v2-runtime-cache.js`
- `utils/v2-flags.js`
- `api/v2/*`
- `lms.html` (V2 learner hiện tại)
- `lesson.html`
- `lms-admin.html`
- `utils/lms-session-guard.js` trừ khi V3 bootstrap thực sự cần helper export mới tối thiểu
- migrations V2 hiện tại
- outbox/reconciliation/worker V2

Mục tiêu: V3 presentation không tạo regression cho V2 platform.

---

# Test bắt buộc trên Production Preview

## Runtime

1. Baseline Preview trước port: V1/V2 switch như hiện tại.
2. Sau port: V1 -> V2 -> V3 -> V2 -> V3 nhiều vòng.
3. Existing global kill ON trong configured V3 -> effective V1.
4. Global kill OFF -> quay lại configured mode theo thiết kế.
5. V3 kill ON trong configured V3 -> effective V2.
6. V3 kill OFF -> effective V3.
7. DB V3 config unreadable -> V3 disabled; V1/V2 controller cũ vẫn quyết định.

## V2 regression

1. V2 learner direct flow không đổi.
2. Portal entry_token -> LMS V2 không đổi.
3. one-device/session-device guard không đổi.
4. logout/revoke không đổi.
5. V2 feature flag posture không đổi.
6. outbox/worker/reconciliation không đổi.

## V3 learner

1. Entry token/session từ Portal sang V3.
2. Wrong Google Admin account không có enrollment bị từ chối.
3. Đúng learner account vào đúng course.
4. multi-course chọn đúng course.
5. feed/mosaic/viewer/TOC/search/scroll.
6. F5/new tab/session recovery.

## V3 Admin

1. Admin session Production dùng được.
2. course guard đúng.
3. multi-media background upload.
4. direct Drive folder cho image/video/material.
5. F5 resume.
6. publish order.
7. recipe/System1 sync Production không regression.

---

# Name collision với tài liệu `docs/V3_SYSTEM_KNOWLEDGE_TRANSFER.md`

Production đã có tài liệu cũ tên V3 từ 2026-07-15. Đây là **tài liệu nghiên cứu kiến trúc V3 tương lai** (RLS/CQRS/monorepo/worker/TS...), không phải Telegram Channel V3 của dự án hiện tại.

Không xóa tài liệu cũ. Tên mới của feature nên ghi rõ `Telegram Channel V3` trong PR/docs để tránh nhầm.

---

# Quyền GitHub hiện tại

Connector hiện chỉ có:
- `pull: true`
- `push: false`

trên `thienha100022653824678-stack/web-lms-chinh-thuc`.

Vì vậy hiện chỉ có thể audit/mapping; chưa được tạo feature branch hoặc commit Production Preview.
