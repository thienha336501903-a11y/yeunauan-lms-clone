# Báo cáo hoàn tất Production launch yeubep.shop

Thời gian hoàn tất: 2026-07-25 23:50 (Asia/Saigon)

## Kết luận

`yeubep.shop` đã được chuyển thành công sang storefront yeubep mới. Website cũ `shop.yeunauan.live` tiếp tục hoạt động độc lập. Canary data và Preview production credentials đã được cleanup hoàn toàn trước cutover.

## Source và deployments

- Exact commit: `e65262f3e8eca39d8224f5b010bd376f27e1f9e3`
- Branch: `origin/feature/yeubep-shop`
- Không merge.
- Old project: `prj_tJOtibVVzl7FpliWzdk7bs1q9v7D`
- Old deployment: `dpl_FSiFqdnYgqeVricUhS17MN7gUb7h`, READY
- New project: `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8`
- New deployment: `dpl_3APL1GiQ99FHKSWEgG7vqZVnuiq6`, READY

## Dry-run guard và tests

Guard chung nằm trong `syncCourseToExternalSystems()` và `syncEnrollmentToExternalSystems()`, trước outbox/fetch/email.

- Full suite: 65/65 pass
- Learning Boundary: 15/15 pass
- Secret scan: 0
- Dry-run fetch/outbox/email side effects: 0
- Alias payload luôn dùng `thitxiennuongchaungoc`
- Production adapter khi dry-run unset giữ contract cũ

## Canary và cleanup

Protected Preview canary chứng minh:

- Approve canonical order: dry-run `syncEnrollment`
- Approve alias order: dry-run `syncEnrollment`, canonical slug
- Revoke alias khi canonical còn approved: `SHARED_ENTITLEMENT_RETAINED`
- Revoke order cuối: đúng một dry-run `revokeEnrollment`
- Idempotency retry: 0 order mới
- Outbox canary: 0
- Enrollments giữ 20

Cleanup:

- Xóa đúng 2 canary order theo exact IDs + marker + normalized email
- Orders trở lại 28
- Gỡ 7/7 Preview env
- Xóa canary project/deployments
- Xóa local admin secret, state, pulled env và OIDC file
- Không còn Preview credential production

## Clone activation

- ID: `fb2dd9ac-3353-48c9-85c2-9be634bd121d`
- Slug: `thitxiennuongchaungoc-yeubep`
- `sales_site=yeubep`
- `learning_course_slug=thitxiennuongchaungoc`
- `active=true`
- `is_published=true`
- Canonical target: 4 lesson
- Fingerprint các field ngoài active/published không đổi
- Không LMS course hoặc lesson alias mới

## Domain ownership và assignment

Owner đã Move domain-level ownership thủ công:

- Từ: `thienha336501903-a11ys-projects`
- Sang: `thienha100022653824678-stacks-projects`

CLI xác minh `yeubep.shop` nằm trong Domains của team đích.

Assignment cuối:

- Old project: `shop.yeunauan.live`
- New project: `yeubep.shop`
- New project: `www.yeubep.shop` → redirect 308 tới `https://yeubep.shop/`

Cả apex và www đều `verified=true`.

Không thay:

- DNS A/CNAME
- `_vercel` TXT
- nameserver
- SPF/MX/DKIM/DMARC

DNS snapshot:

- Apex A: `216.198.79.1`
- www CNAME: `db4901082264508b.vercel-dns-017.com`

## Smoke test cuối

- `https://yeubep.shop` → 200
- Yeubep clone slug → 200
- Yeubep source slug → 404
- `www.yeubep.shop` → 308 về apex, không loop
- HTTPS hợp lệ
- `https://shop.yeunauan.live` → 200
- Old source slug → 200
- Old clone slug → 404
- Old `/admin.html` → 200
- Old `/orders.html` → 200
- LMS `https://www.daubepnho.store` → 200

Không tạo order thật trong smoke test.

## Database cuối

- courses: 8
- orders: 28
- student_enrollments: 20
- lessons: 39
- site_config: 73
- course_slug_mappings: 6
- Canary rows: 0
- Clone active/published: true/true
- Canonical lessons: 4

## Backup after-launch

Đường dẫn:

`C:\Users\gaomi\Downloads\Telegram Desktop\web-ban-hang-chinh-thuc\_local_backups\after-yeubep-launch-20260725-235050`

Backup gồm schema, courses, orders, enrollments, lessons, site_config, mappings, counts, invariants, deployment/domain/DNS snapshot và SHA-256. Tất cả JSON đã parse lại và thư mục có ACL riêng.

SHA-256 chính:

- courses: `9f4b7d4f13d0a730cb61d5d596eb3a342496dca3b3e24a51d593af147e6658c8`
- orders: `b786542dad6194785b32645b07c2686ea69413af27f0ddd2cd4f0af14afaefc0`
- schema: `d7e6eb1ff3ac1366782c7ced8f5eeecc689456a109d2cf847e45bad39b077f51`
- deployment/domain/DNS: `d93e747937b99da3d20c8854ea71cf7f5544620d915548e333452f57000aacf5`

## Git tag

- Annotated tag: `launch/yeubep-shop-2026-07-25`
- Dereference: `e65262f3e8eca39d8224f5b010bd376f27e1f9e3`
- Tag đã push lên origin
- Không force tag

## Rollback

Không cần rollback cutover. Rollback plan vẫn là:

1. Gỡ apex/www khỏi project mới.
2. Gắn apex lại project cũ.
3. Đưa clone về inactive/unpublished.
4. Giữ DNS và schema nguyên trạng.
5. Không restore database nếu không có mất dữ liệu.
