# SYSTEM B — MILESTONE M0A IMPLEMENTATION REPORT
**Additive Multi-Agency Schema Foundation on Main Supabase**

**Document Version**: `1.0.0-AUTHORITATIVE`  
**Execution Timestamp**: `2026-09-26T13:46:00+07:00` (`2026-09-26T06:46:00Z`)  
**Target Database**: Main Supabase (`yyiavtiwtekkocqpephr`)  
**Scope**: Milestone M0A ONLY (Additive Foundation)  
**Status**: `M0A_STATUS = PASS`  

---

## 1. Executive Summary & Verification Scorecard

Milestone M0A has been successfully executed in strict accordance with the Owner-approved Master Plan V1.1 (`SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md`). 

The additive multi-agency schema foundation was rehearsed on an isolated local PostgreSQL 17 test database, verified across all security and integrity invariants, and applied exclusively to Main Supabase (`yyiavtiwtekkocqpephr`). Zero existing V5 media or release records were altered, R2 was not touched, and Legacy Supabase (`aqozjkfwzmyfunqvcyjv`) remained 100% operational and unmutated.

```ini
MASTER_PLAN_V1_1 = APPROVED
M0A_LOCAL_REHEARSAL = PASS
M0A_SCHEMA_APPLIED = PASS
TENANT_RLS_ENABLE = PASS
TENANT_FORCE_RLS = PASS
DEFAULT_DENY = PASS
CROSS_TENANT_FK_GUARD = PASS
CROSS_TENANT_RLS_GUARD = PASS
EXISTING_V5_PRESERVED = PASS
R2_MUTATIONS = 0 (UNCHANGED)
LEGACY_MUTATIONS = 0 (UNCHANGED)
M0A_STATUS = PASS

M0B_NOT_STARTED = YES
AGENCY_A_CUTOVER_NOT_STARTED = YES
LEGACY_DECOMMISSION_NOT_STARTED = YES
AGENCY_B_NOT_STARTED = YES
AGENCY_C_NOT_STARTED = YES
```

---

## 2. Production Migration Artifact

- **Repository Path**: `yeunauan-lms-clone/supabase/migrations/20260926140000_multi_agency_m0a_foundation.sql`
- **Migration Version**: `20260926140000`
- **Name**: `multi_agency_m0a_foundation`
- **Registration**: Successfully recorded in remote `supabase_migrations.schema_migrations` table on Main Supabase.

---

## 3. Database Objects Matrix

### A. Exact Objects Created Additively

| Object Name | Object Type | Multi-Tenancy Scope | Description / Constraints |
|---|---|---|---|
| `public.agencies` | Table | Platform Core | Tenant registry (`id`, `slug UNIQUE`, `name`, `status`). |
| `public.agency_domains` | Table | Tenant Partition | Domain to agency mapping (`agency_id`, `hostname UNIQUE`, `ssl_status`). RLS + FORCE RLS ON. |
| `public.agency_ui_profiles` | Table | Tenant Partition | Multi-surface UI variant & design tokens configuration. RLS + FORCE RLS ON. |
| `public.agency_bank_accounts` | Table | Tenant Partition | Agency-specific payment destinations. Primary key `(agency_id, id)`. RLS + FORCE RLS ON. |
| `public.canonical_courses` | Table | Shared Core | Global curriculum master course registry. Links to `courses(id)` via `course_id`. |
| `public.canonical_lessons` | Table | Shared Core | Master syllabus lessons. Links to `canonical_courses(id)` and existing `v5_lessons(id)`. |
| `public.agency_offerings` | Table | Tenant Partition | Decoupled commercial package. Primary key `(agency_id, id)`, `UNIQUE(agency_id, slug)`. RLS + FORCE RLS ON. |
| `public.agency_offering_items` | Table | Tenant Partition | Bundle & offering composition with concrete FK `canonical_course_id`. Primary key `(agency_id, id)`. RLS + FORCE RLS ON. |
| `public.agency_memberships` | Table | Tenant Partition | User tenant profile & role mapping. Primary key `(agency_id, id)`, `UNIQUE(agency_id, user_id)`. RLS + FORCE RLS ON. |
| `public.student_devices` | Table | Tenant Partition | Anti-account-sharing device binding. Primary key `(agency_id, id)`. RLS + FORCE RLS ON. |
| `public.agency_orders` | Table | Tenant Partition | Additive tenant orders preserving legacy `orders`. Primary key `(agency_id, id)`. RLS + FORCE RLS ON. |
| `public.order_items` | Table | Tenant Partition | Purchase lines. Composite FKs to `(agency_id, order_id)` and `(agency_id, offering_id)`. RLS + FORCE RLS ON. |
| `public.student_entitlements` | Table | Tenant Partition | Decoupled student curriculum access. Composite FK to `agency_memberships`. RLS + FORCE RLS ON. |
| `public.entitlement_grants` | Table | Tenant Partition | Multi-source grant audit trail (`order_purchase`, `manual_admin`, `bundle`, etc.). RLS + FORCE RLS ON. |
| `public.agency_lesson_progress` | Table | Tenant Partition | Tenant lesson milestone tracking. Primary key `(agency_id, id)`. RLS + FORCE RLS ON. |
| `public.current_agency_id()` | Function | Security Utility | Returns trusted `app.current_agency_id` as UUID (`SECURITY DEFINER`). |
| `public.set_trusted_agency_context()` | Function | Security Utility | Validates agency active status and sets transaction-level context. |
| `public.v5_authorize_agency_playback()`| Function | Authorization Bridge| Authorizes playback via `agency_memberships -> entitlements -> canonical -> v5_releases`. |

### B. Exact Objects Intentionally Reused & Preserved

| Existing Object | Current Production Count | Status | Notes |
|---|---|---|---|
| `public.v5_media_assets` | 126 rows | **UNCHANGED** | Preserved raw R2 object keys, mime types, checksums, and metadata. |
| `public.v5_releases` | 7 rows | **UNCHANGED** | Preserved published release snapshots and manifests. |
| `public.courses` | 23 rows | **UNCHANGED** | Preserved baseline course catalog linked to V5 course configs. |
| `public.v5_course_configs` | Existing rows | **UNCHANGED** | Preserved V5 configuration bindings. |
| `public.v5_lessons` | Existing rows | **UNCHANGED** | Preserved V5 lesson definitions. |
| `public.v5_posts` | Existing rows | **UNCHANGED** | Preserved V5 post mappings. |
| `public.v5_jobs` | Existing rows | **UNCHANGED** | Preserved media pipeline jobs. |
| `public.orders` (Legacy) | 53 rows | **UNCHANGED** | Preserved single-tenant legacy table intact for existing traffic. |
| `public.lesson_progress` (Legacy) | 0 rows | **UNCHANGED** | Preserved legacy progress table intact. |

---

## 4. Tenant RLS & FORCE RLS Matrix (100% Invariant)

Query against `pg_class` on Main Supabase:

```sql
SELECT relname, relrowsecurity, relforcerowsecurity 
FROM pg_class 
WHERE relnamespace = 'public'::regnamespace 
  AND relname IN (
    'agency_domains', 'agency_ui_profiles', 'agency_bank_accounts', 
    'agency_offerings', 'agency_offering_items', 'agency_memberships', 
    'student_devices', 'agency_orders', 'order_items', 
    'student_entitlements', 'entitlement_grants', 'agency_lesson_progress'
  )
ORDER BY relname;
```

**Observed Production Verification Result**:

```
        relname         | relrowsecurity | relforcerowsecurity 
------------------------+----------------+---------------------
 agency_bank_accounts   | true           | true
 agency_domains         | true           | true
 agency_lesson_progress | true           | true
 agency_memberships     | true           | true
 agency_offering_items  | true           | true
 agency_offerings       | true           | true
 agency_orders          | true           | true
 agency_ui_profiles     | true           | true
 entitlement_grants     | true           | true
 order_items            | true           | true
 student_devices        | true           | true
 student_entitlements   | true           | true
(12 rows)
```

- **TENANT_RLS_ENABLE**: `PASS` (12/12 tenant tables have `relrowsecurity = true`)
- **TENANT_FORCE_RLS**: `PASS` (12/12 tenant tables have `relforcerowsecurity = true`)
- **DEFAULT_DENY**: `PASS` (Queries executed without active agency context return exactly 0 rows)

---

## 5. Cross-Tenant Negative Testing Evidence

### Test 1: Cross-Agency Foreign Key Rejection (`CROSS_TENANT_FK_GUARD`)
- **Scenario**: Inserting an `order_items` record with `agency_id = Agency A` referencing an `offering_id` belonging to `Agency B`.
- **Constraint Tested**:
  ```sql
  FOREIGN KEY (agency_id, offering_id) 
  REFERENCES public.agency_offerings(agency_id, id) ON DELETE RESTRICT
  ```
- **Observed Result**: PostgreSQL engine immediately rejected the insertion with `foreign_key_violation` (code `23503`).
- **Verdict**: `CROSS_TENANT_FK_GUARD = PASS`.

### Test 2: Cross-Agency Bank Account In Order
- **Scenario**: Creating an `agency_orders` record under `Agency A` referencing a `bank_account_id` belonging to `Agency B`.
- **Constraint Tested**:
  ```sql
  FOREIGN KEY (agency_id, bank_account_id) 
  REFERENCES public.agency_bank_accounts(agency_id, id) ON DELETE RESTRICT
  ```
- **Observed Result**: PostgreSQL engine rejected with `foreign_key_violation`. Bank account delete behavior cannot null `agency_id`.
- **Verdict**: `PASS`.

### Test 3: Cross-Agency Student Entitlement Mismatch
- **Scenario**: Creating a `student_entitlements` record under `Agency A` referencing a `membership_id` belonging to `Agency B`.
- **Observed Result**: PostgreSQL engine rejected with `foreign_key_violation`.
- **Verdict**: `PASS`.

### Test 4: Cross-Tenant RLS Visibility Isolation (`CROSS_TENANT_RLS_GUARD`)
- **Setup**: Seeded 1 offering for Agency A, 1 offering for Agency B. Granted `SELECT` to `anon`.
- **Execution as non-superuser (`anon`)**:
  1. `SET app.current_agency_id = ''`: Returned **0 rows** (`DEFAULT_DENY = PASS`).
  2. `SET app.current_agency_id = Agency A UUID`: Returned **exactly 1 row** (Agency A only; Agency B invisible).
  3. `SET app.current_agency_id = Agency B UUID`: Returned **exactly 1 row** (Agency B only; Agency A invisible).
- **Verdict**: `CROSS_TENANT_RLS_GUARD = PASS`.

---

## 6. Safety & Boundary Verifications

1. **Existing V5 Content & Media Preservation**:
   - `SELECT count(*) FROM public.v5_media_assets`: **126** (100% match with baseline)
   - `SELECT count(*) FROM public.v5_releases`: **7** (100% match with baseline)
   - `SELECT count(*) FROM public.courses`: **23** (100% match with baseline)
   - `EXISTING_V5_PRESERVED = PASS`
2. **Cloudflare R2 Media Bucket**:
   - Zero operations, zero re-encodings, zero object path changes.
   - `R2_MUTATIONS = 0 (UNCHANGED)`
3. **Legacy Supabase (`aqozjkfwzmyfunqvcyjv`)**:
   - Zero connections, zero schema modifications, zero queries.
   - Remains completely untouched and operational.
   - `LEGACY_MUTATIONS = 0 (UNCHANGED)`

---

## 7. Rollback & Reset Procedure (Documented)

In the unlikely event that Milestone M0A requires rollback prior to M0B application adaptation:

```sql
-- 1. Drop authorization bridge function
DROP FUNCTION IF EXISTS public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID);

-- 2. Drop tenant tables (reverse dependency order)
DROP TABLE IF EXISTS public.agency_lesson_progress CASCADE;
DROP TABLE IF EXISTS public.entitlement_grants CASCADE;
DROP TABLE IF EXISTS public.student_entitlements CASCADE;
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.agency_orders CASCADE;
DROP TABLE IF EXISTS public.student_devices CASCADE;
DROP TABLE IF EXISTS public.agency_memberships CASCADE;
DROP TABLE IF EXISTS public.agency_offering_items CASCADE;
DROP TABLE IF EXISTS public.agency_offerings CASCADE;
DROP TABLE IF EXISTS public.canonical_lessons CASCADE;
DROP TABLE IF EXISTS public.canonical_courses CASCADE;
DROP TABLE IF EXISTS public.agency_bank_accounts CASCADE;
DROP TABLE IF EXISTS public.agency_ui_profiles CASCADE;
DROP TABLE IF EXISTS public.agency_domains CASCADE;
DROP TABLE IF EXISTS public.agencies CASCADE;

-- 3. Drop context security functions
DROP FUNCTION IF EXISTS public.set_trusted_agency_context(UUID);
DROP FUNCTION IF EXISTS public.current_agency_id() CASCADE;

-- 4. Revert migration history entry
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260926140000';
```
*(Tested and verified in isolated local rehearsal: dropping these objects leaves all existing V5 tables and legacy tables completely untouched and operational).*

---

## 8. Final Status Declaration

Milestone M0A is complete, verified, and sealed.

```ini
MASTER_PLAN_V1_1 = APPROVED
M0A_LOCAL_REHEARSAL = PASS
M0A_SCHEMA_APPLIED = PASS
TENANT_RLS_ENABLE = PASS
TENANT_FORCE_RLS = PASS
DEFAULT_DENY = PASS
CROSS_TENANT_FK_GUARD = PASS
CROSS_TENANT_RLS_GUARD = PASS
EXISTING_V5_PRESERVED = PASS
R2_MUTATIONS = 0 (UNCHANGED)
LEGACY_MUTATIONS = 0 (UNCHANGED)
M0A_STATUS = PASS
```

**STOPPED.** Milestone M0B has not been started. Awaiting Owner instruction for subsequent phases.
