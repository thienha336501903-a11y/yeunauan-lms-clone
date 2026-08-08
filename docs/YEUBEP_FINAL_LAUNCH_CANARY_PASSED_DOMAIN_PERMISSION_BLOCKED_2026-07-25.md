# Yeubep final launch — canary đạt, domain permission bị chặn

Thời gian: 2026-07-25, Asia/Saigon

## Kết luận

Dry-run patch, production-persistence canary, cleanup và tenant smoke đều đạt. Quy trình dừng tại bước Move domain vì Vercel CLI credential hiện tại không có quyền truy cập team ownership nguồn.

Không có external mutation thật, không còn canary data/credential/Preview. Clone đã được rollback về inactive/unpublished và domain vẫn ở project cũ.

## Exact source

- Baseline: `c15e27c4ed09592fb8e24a4d32caca672565e782`
- Commit mới: `e65262f3e8eca39d8224f5b010bd376f27e1f9e3`
- Branch: `origin/feature/yeubep-shop`
- Worktree sạch sau commit/push.
- Không merge.

## Dry-run guard

File sửa:

- `utils/sync-helpers.js`
- `tests/learning-course-boundary.test.mjs`

Guard nằm trước secret lookup, outbox, fetch và email side effect trong cả:

- `syncCourseToExternalSystems()`
- `syncEnrollmentToExternalSystems()`

Khi `EXTERNAL_SYNC_MODE=dry-run`, helper trả deterministic object:

- `dryRun=true`
- action
- canonical `courseSlug`
- payload LMS và Portal dự kiến
- không secret

Alias `thitxiennuongchaungoc-yeubep` luôn resolve thành `thitxiennuongchaungoc`. Production mode unset giữ adapter cũ.

Test:

- Full suite: 65/65 pass
- Learning Boundary: 15/15 pass
- HTML/Node syntax và diff check: pass
- Secret scan: 0
- Spy dry-run fetch count: 0
- Outbox/email side effect trong dry-run: 0
- Production adapter test: vẫn gọi hai adapter với canonical payload

## Canary persistence

Canary project tạm:

`web-ban-hang-yeubep-canary-20260725`

Protected Preview:

- Deployment: `dpl_7Nth4i4QgFvqDHgoozAqoGR2FMnb`
- Exact source: `e65262f3e8eca39d8224f5b010bd376f27e1f9e3`
- `SALES_SITE=yeubep`
- `COMMERCE_DATA_MODE=supabase`
- `EXTERNAL_SYNC_MODE=dry-run`

Hai order giả dùng cùng synthetic email/marker và canonical learning slug.

Kết quả:

1. Approve A: `dryRun=true`, `syncEnrollment`, canonical slug.
2. Approve B: `dryRun=true`, `syncEnrollment`, canonical slug.
3. Revoke B: `SHARED_ENTITLEMENT_RETAINED`.
4. Revoke A cuối: đúng một `dryRun=true`, `revokeEnrollment`, canonical slug.
5. Retry cùng idempotency key: 0 row mới.
6. `student_enrollments`: giữ 20.
7. Canary rows trong `sync_outbox`: 0.

Không request mutation thật tới LMS/Portal và không Cloudinary write.

## Cleanup

Cleanup dùng đồng thời exact IDs, marker và normalized synthetic email:

- Deleted: đúng 2 order.
- Orders: 30 trở lại 28.
- Courses: 8.
- Enrollments: 20.
- Lessons: 39.
- Canary marker/email: 0.
- Clone orders/enrollments/lessons: 0.

Sau đó:

- Gỡ 7/7 Preview env.
- Xác minh Preview env list trống.
- Xóa toàn bộ canary project và deployments.
- Xóa local admin secret, state file, pulled env và OIDC `.env.local`.

Không còn Preview credential production.

## Production deployments

Cả hai project đã deploy exact commit mới:

### Commerce cũ

- Deployment: `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h`
- State: READY
- Giữ aliases `shop.yeunauan.live` và `yeubep.shop`.

### Yeubep mới

- Deployment: `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6`
- State: READY
- Chỉ alias `.vercel.app`, không custom domain.

## Clone activation và rollback

Clone ID:

`fb2dd9ac-3353-48c9-85c2-9be634bd121d`

Clone được cập nhật đúng `active=true`, `is_published=true`; fingerprint mọi field khác không đổi. Canonical target có 4 lesson.

Tenant smoke trước cutover:

- Old source: 200
- Old alias: 404
- New source: 404
- New alias: 200

Sau khi domain bị block, clone được rollback đúng yêu cầu:

- `active=false`
- `is_published=false`
- sales_site và learning_course_slug không đổi
- Orders: 28
- Enrollments: 20

## Domain blocker

CLI credential chỉ liệt kê:

`thienha100022653824678-stacks-projects`

Khi kiểm tra scope owner nguồn:

`thienha336501903-a11ys-projects`

Vercel trả:

`The specified scope does not exist`

Vì không thể truy cập đồng thời team nguồn và team đích, chức năng Move chính thức không thể thực hiện an toàn.

Không thực hiện:

- Move ownership
- remove/attach apex
- cấu hình www mới
- DNS/TXT/nameserver/email record change

Trạng thái giữ nguyên:

- `yeubep.shop` vẫn ở project cũ
- `shop.yeunauan.live` vẫn hoạt động
- Apex A `216.198.79.1`
- `www` CNAME `db4901082264508b.vercel-dns-017.com`
- LMS HTTP 200

## Backup và tag

Backup pre-launch:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_backups\before-yeubep-launch-20260725-221847`

Không tạo “backup after launch” hoặc annotated tag vì domain launch chưa hoàn tất. Tạo tag lúc này sẽ ghi nhận sai trạng thái hoàn thành.

## Điều kiện tiếp tục

Cần một Vercel session/credential có quyền truy cập đồng thời:

- `thienha336501903-a11ys-projects`
- `thienha100022653824678-stacks-projects`

Sau đó tiếp tục từ Move domain. Trước khi Move cần xác minh lại DB baseline và clone inactive, rồi kích hoạt clone ngay trước cutover.
