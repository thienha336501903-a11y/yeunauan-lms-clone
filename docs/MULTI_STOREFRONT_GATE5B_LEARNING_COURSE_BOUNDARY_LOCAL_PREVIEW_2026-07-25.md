# Báo cáo Cổng 5B — Learning course mapping tại commerce boundary

Ngày hoàn tất: **2026-07-25**

## 1. Kết luận

Cổng 5B Local/Preview đạt.

Sales alias `thitxiennuongchaungoc-yeubep` được giữ ở storefront/order, trong khi mọi payload entitlement dry-run dùng canonical LMS slug `thitxiennuongchaungoc`. Không sửa LMS hoặc Portal, không migration/deploy Production và không tạo dữ liệu production.

## 2. Source

- Branch: `feature/yeubep-shop`
- Exact commit cuối: `c15e27c4ed09592fb8e24a4d32caca672565e782`
- Remote branch: cùng exact SHA.
- Worktree sạch.
- Artifact SHA-256: `FF0F80E9B4DE3849F6EFDE26CE14EF65E322E5DB719810E4EBD3501C1C46DDA8`

## 3. Schema

Field thực tế:

- `courses.learning_course_slug`
- `orders.learning_course_slug`

Migration:

- `migrations/20260725_learning_course_boundary.sql`

Rollback:

- `migrations/20260725_learning_course_boundary_rollback.sql`

Migration chỉ thêm hai cột nullable và hai partial index:

- `idx_courses_learning_course_slug`
- `idx_orders_learning_entitlement`

Không backfill, không đổi `courses.slug UNIQUE`, không thay năm field multi-storefront hiện hữu.

Quy tắc legacy:

```text
effective learning slug =
trim(learning_course_slug)
hoặc course_slug
hoặc slug
```

Do đó 7 course và 28 order cũ không cần backfill.

## 4. Helper và validation

File mới: `utils/learning-course.js`

Các hàm:

- `getEffectiveLearningSlug`
- `resolveLearningCourse`
- `resolveLearningCourseFromSupabase`
- `validateLearningCourseTarget`
- `snapshotOrderLearningSlug`
- `hasAnotherGrantingOrder`
- `normalizeCustomerEmail`
- `isGrantingOrderStatus`

Validation server-side:

- target phải tồn tại;
- target phải active;
- target phải có ít nhất một lesson không hidden;
- slug phải hợp lệ;
- chỉ một cấp alias;
- từ chối alias chain;
- từ chối circular mapping;
- storefront không thể gửi/override learning slug;
- chỉ authenticated admin course API được lưu mapping.

## 5. Admin UI

`admin.html` bổ sung:

- nhãn `KHÓA HỌC HỌC TẬP / LMS ĐÍCH`;
- mặc định `Dùng chính khóa học này`;
- chỉ liệt kê canonical course có lesson;
- hiển thị slug và số lesson;
- không nhận URL tự do;
- cảnh báo mapping mới chỉ áp dụng cho order mới;
- persisted response phải khớp mapping đã chọn trước khi báo thành công.

Fixture alias hiển thị:

- sales slug: `thitxiennuongchaungoc-yeubep`;
- site: `yeubep`;
- learning slug: `thitxiennuongchaungoc`;
- lesson count: 4.

## 6. Order snapshot

`api/register.js`:

1. tìm sales course đúng tenant;
2. resolve/validate canonical course server-side;
3. snapshot `learning_course_slug`;
4. giữ `course_slug` là sales identity;
5. client field `learning_course_slug` bị bỏ qua;
6. retry idempotency trả order snapshot cũ.

Pending Portal payload cũng dùng canonical learning slug.

Việc thay mapping course sau khi tạo order không thay snapshot của order cũ.

## 7. Sync behavior

### `syncCourse`

`utils/sync-helpers.js` trả:

- `MAPPED_NOT_REQUIRED` cho LMS;
- `MAPPED_NOT_REQUIRED` cho Portal;
- canonical `learningCourseSlug`.

Không gửi `syncCourse` bằng sales alias và không tạo LMS course rỗng. Canonical course tiếp tục sync như legacy.

### Enrollment/revoke

`syncEnrollmentToExternalSystems()` dùng `getEffectiveLearningSlug(orderData)`.

Payload alias:

```json
{
  "action": "syncEnrollment",
  "courseSlug": "thitxiennuongchaungoc"
}
```

Revoke dùng cùng canonical slug. V2 shadow/outbox cũng nhận canonical slug trước khi enqueue.

Portal và LMS nhận cùng payload canonical. Không có sales alias đi qua commerce boundary.

## 8. Multi-order entitlement

Granting status hiện được định nghĩa rõ:

- `Đã duyệt`

Trước revoke, commerce kiểm tra các order khác theo:

- normalized customer email;
- effective learning slug;
- granting status;
- loại current order theo ID.

Kết quả:

- canonical order còn hiệu lực + revoke alias → `SHARED_ENTITLEMENT_RETAINED`, không gọi LMS/Portal revoke;
- revoke order cấp quyền cuối cùng → gửi `revokeEnrollment` canonical;
- email được trim/lowercase;
- resync và standard status update dùng cùng guard.

## 9. File đã sửa

- `utils/learning-course.js`
- `utils/sync-helpers.js`
- `utils/preview-fixture.js`
- `api/register.js`
- `api/courses.js`
- `api/orders.js`
- `api/approve-all.js`
- `admin.html`
- `scripts/local-stub-server.mjs`
- hai migration SQL
- `tests/learning-course-boundary.test.mjs`

Không sửa LMS hoặc Portal.

## 10. Tests

- Full suite: **63/63 pass**.
- Test learning boundary mới: 13.
- Migration cycle:
  - migration lần 1: pass;
  - migration lần 2: pass;
  - legacy NULL: giữ nguyên;
  - global unique slug: giữ nguyên;
  - rollback: pass;
  - migration lại: pass.
- Inline HTML scripts: 3/3 page pass.
- `node --check`: 20 file pass.
- `git diff --check`: pass.
- Secret scan: 0 hit.

Bao phủ:

- legacy fallback;
- alias canonical;
- missing/inactive/no-lesson target;
- chain/cycle;
- immutable snapshot;
- browser override;
- syncCourse skip;
- canonical enrollment/revoke/Portal payload;
- tenant-isolated approve-all;
- idempotency;
- shared entitlement retain;
- final-order revoke;
- email normalization.

## 11. Local

Local URL: `http://127.0.0.1:4185`

Kết quả:

- alias page/config: 200;
- canonical sales slug trên `yeubep`: 404;
- retry cùng idempotency key: cùng order;
- snapshot: `thitxiennuongchaungoc`;
- approve dry-run payload: canonical slug;
- approve count: 1.

## 12. Preview

- Project: `web-ban-hang-yeubep-shop`
- Project ID: `prj_l9vV0TI5AFN5yWSMzvNiLWzAnxq8`
- Deployment ID: `dpl_42snucKrHLBcPUyQLKVpq7AyiVdN`
- URL: `https://web-ban-hang-yeubep-shop-2sa7vqvku.vercel.app`
- State: `READY`
- Target: Preview
- Custom alias: không có.
- Exact metadata commit: `c15e27c4ed09592fb8e24a4d32caca672565e782`

Preview env names:

- `SALES_SITE`
- `COMMERCE_DATA_MODE`
- `EXTERNAL_SYNC_MODE`
- `PUBLIC_SITE_URL`
- `ADMIN_PASSWORD`

Preview dùng fixture + dry-run, không production write.

Smoke:

- sales alias: 200;
- canonical sales slug: 404;
- register fixture: 200;
- sales slug trong order response: alias;
- learning snapshot: canonical;
- malicious client learning override: bị bỏ qua;
- admin courses: 200;
- learning lesson count: 4;
- HTML/JS secret hits: 0.

Dry-run approve/revoke canonical payload và shared-entitlement behavior được chứng minh bằng Local + automated tests; fixture state giữa các Vercel serverless function không được coi là shared persistence.

## 13. Production read-only

Production sau Cổng 5B:

- courses: 7;
- orders: 28;
- student_enrollments: 20;
- lessons: 39;
- target slug: 0;
- production `learning_course_slug` columns: 0.

Điều này xác nhận migration chưa chạy Production và không có clone/order/enrollment production.

- Shop source course: 200.
- LMS home: 200.
- Không gọi sync thật.
- Không sửa LMS/Portal.
- Không domain/DNS/TXT change.

## 14. Rủi ro và Cổng 5C dự kiến

Trước Production:

1. backup/delta preflight mới;
2. chạy migration hai cột trên production theo transaction;
3. deploy exact commerce artifact cho cả old/new project;
4. tạo clone commerce inactive hoặc active theo phê duyệt;
5. read-after-write mapping và storefront isolation;
6. chỉ dùng order canary nếu owner phê duyệt riêng;
7. xác minh reference-count trên hosted safe test/approved canary;
8. domain move/assignment vẫn là cổng riêng.

Chưa thực hiện bất kỳ bước Cổng 5C nào.

