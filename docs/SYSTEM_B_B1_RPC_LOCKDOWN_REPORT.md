# System B Milestone B1 & B1.1 Implementation Report: V5 Agency Playback RPC Security Lockdown & Hardening

**Execution Date:** 2026-09-26  
**Authoritative Plan:** `SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md`  
**Execution Context:** Anti Execution Engine (Post-Review Remediation for ChatGPT Work)  
**Main Supabase Reference:** `yyiavtiwtekkocqpephr` (PostgreSQL 17.6)  
**Local Test DB Reference:** `supabase_db_system-b-restore-main` (PostgreSQL 17.6 on Docker port 54332)

---

## 1. Executive Status Scorecard

| Metric | Verified Value | Status |
| :--- | :--- | :--- |
| **B1_BASE** | **PASS** | PASS |
| **B1_1_ROLE_FALLBACK_REMOVED** | **PASS** (`coalesce(auth.role(), current_user)` completely eliminated; fail-closed `v_db_role`) | PASS |
| **B1_1_AUTHENTICATED_ROLE_BINDING** | **PASS** (Strictly requires DB role `authenticated`, explicit claim `authenticated`, non-null `auth.uid()`, binding to `user_id`) | PASS |
| **B1_1_SERVICE_ROLE_BOUNDARY** | **PASS** (DB role must be `service_role`; rejects altered claims; validates explicit membership context) | PASS |
| **B1_1_SECURITY_DEFINER_HARDENING** | **PASS** (Safe fixed `search_path = public, pg_temp`, schema qualification, zero manifest/R2 egress) | PASS |
| **B1_1_PREVIOUS_RELEASE_NEGATIVE** | **PASS** (Asset from superseded release of same course rejected with `asset_not_in_release`) | PASS |
| **B1_1_LOCAL_SECURITY_TEST** | **PASS** (20/20 test cases passing on isolated local target) | PASS |
| **POSTGREST_RPC_TEST** | **NOT_AVAILABLE_WITH_CURRENT_LOCAL_TARGET** (Local restore target runs standalone Postgres container on port 54332 without attached PostgREST service container; simulated via exact transaction roles and JWT session claims) | DOCUMENTED |
| **B1_1_MAIN_APPLIED** | **YES** (Migration `20260926163000` applied & recorded in schema_migrations on Main) | PASS |
| **PUBLIC_EXECUTE** | `false` | PASS |
| **ANON_EXECUTE** | `false` | PASS |
| **AUTHENTICATED_EXECUTE** | `true` (Enforcing strict `auth.uid()` contract) | PASS |
| **SERVICE_ROLE_EXECUTE** | `true` (Enforcing verified membership/entitlement context) | PASS |
| **V5_RUNTIME_CHANGED** | **NO** | PASS |
| **R2_MUTATIONS** | **0** | PASS |
| **LEGACY_MUTATIONS** | **0** | PASS |
| **ENTITLEMENT_GRANT_LIFECYCLE** | **DEFERRED_BEFORE_M0C** (Per owner direction, commerce lifecycle design deferred) | DEFERRED |
| **B1_1_STATUS** | **PASS** | **PASS** |

---

## 2. Security Defects Remediated in B1.1

Following the review by ChatGPT Work, two blocking findings were remediated:

### Blocker 1: Elimination of SECURITY DEFINER Role Fallback
- **Vulnerability:** In B1, `v_caller_role` was assigned `coalesce(auth.role(), current_user)`. In a `SECURITY DEFINER` function, `current_user` evaluates to the function definer (`postgres`). When called without an active JWT role claim, the function defaulted to `postgres` and fell into a generic privileged `ELSE` branch.
- **Remediation (`20260926163000_v5_agency_rpc_security_hardening_v2.sql`):**
  - Completely removed `current_user` from role resolution.
  - Implemented fail-closed detection:
    ```sql
    v_db_role := CASE 
        WHEN current_setting('role', true) IS NOT NULL AND current_setting('role', true) <> 'none' 
            THEN current_setting('role', true)
        ELSE session_user
    END;
    ```
  - Permitted caller classes restricted to exactly: `'authenticated'` and `'service_role'`.
  - All other roles (including `postgres`, `anon`, `none`, or unexpected roles) immediately return `{ "authorized": false, "code": "unauthorized", "error": "Caller database role is not authorized" }`.
  - Authenticated calls strictly enforce:
    - `v_jwt_role IS NOT NULL`
    - `v_jwt_role = 'authenticated'`
    - `v_jwt_uid IS NOT NULL`
    - Membership ownership bound to `auth.uid()`
  - Service role calls enforce:
    - If `v_jwt_role` is set, it must equal `'service_role'` (rejecting altered claims).
    - Membership ID validated against agency, active status, and entitlement.

### Blocker 2: Expanded Test Suite
- Extended `scripts/verify-b1-rpc-lockdown.sql` from 12 to 20 comprehensive automated test assertions.
- Added tests for missing role claim, altered role claims (`service_role`, `postgres`, `arbitrary_role`), missing `auth.uid()`, foreign membership IDs, previous release of the same course, unexpected DB role, and `service_role` positive authorization.

---

## 3. Local Test Suite Verification (20/20 PASS)

Executed on `supabase_db_system-b-restore-main`:

| # | Test Scenario | Context & Parameters | Expected Result | Observed | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | anon direct RPC | `SET ROLE anon;` | Denied with `insufficient_privilege` | Caught `insufficient_privilege` | **PASS** |
| **2** | Auth + missing role claim | `SET ROLE authenticated;` (no role claim) | Denied with `Missing authenticated role claim` | `code: unauthorized` | **PASS** |
| **3** | Auth + altered claim (service_role) | Role claim spoofed to `service_role` | Denied with `Role claim mismatch` | `code: unauthorized` | **PASS** |
| **4** | Auth + altered claim (postgres) | Role claim spoofed to `postgres` | Denied with `Role claim mismatch` | `code: unauthorized` | **PASS** |
| **5** | Auth + altered claim (arbitrary) | Role claim spoofed to `arbitrary_role` | Denied with `Role claim mismatch` | `code: unauthorized` | **PASS** |
| **6** | Auth + missing auth.uid() | Role claim valid, `sub` missing | Denied with `Missing authenticated user identifier` | `code: unauthorized` | **PASS** |
| **7** | Auth + foreign membership UUID | User 1 passing User 2 membership | Denied with `invalid_membership` | `code: invalid_membership` | **PASS** |
| **8** | Auth + guessed agency UUID | User 1 requesting Agency 2 | Denied with `agency_membership_not_found` | `code: agency_membership_not_found` | **PASS** |
| **9** | Cross-agency membership | `service_role` passing Agency 2 member for Agency 1 | Denied with `cross_agency_forbidden` | `code: cross_agency_forbidden` | **PASS** |
| **10** | No entitlement | User 2 requesting unentitled course | Denied with `entitlement_missing` | `code: entitlement_missing` | **PASS** |
| **11** | Revoked entitlement | User 1 requesting revoked entitlement course | Denied with `entitlement_not_active` | `code: entitlement_not_active` | **PASS** |
| **12** | Foreign / nonexistent asset | Random UUID `00000000-0000-0000-0000-000000000000` | Denied with `asset_not_in_release` | `code: asset_not_in_release` | **PASS** |
| **13** | Asset from another course | Valid asset from Course 2 requested for Course 1 | Denied with `asset_not_in_release` | `code: asset_not_in_release` | **PASS** |
| **14** | Asset from PREVIOUS RELEASE of same course | Asset `b060270f-...` (v1) requested for Course 1 (v5 published) | Denied with `asset_not_in_release` | `code: asset_not_in_release` | **PASS** |
| **15** | Unpublished release | Requesting archived course with NULL release | Denied with `release_not_published` | `code: release_not_published` | **PASS** |
| **16** | Unexpected DB role | Direct postgres session without SET ROLE | Denied with `Caller database role is not authorized` | `code: unauthorized` | **PASS** |
| **17** | Direct PostgREST privileges | Schema inspection of routine privileges | No EXECUTE granted to `anon` or `PUBLIC` | 0 rows for `anon` / `PUBLIC` | **PASS** |
| **18** | GUC spoof attempt | Setting `app.current_agency_id` | GUC ignored completely, bound to identity | Identity bound | **PASS** |
| **19** | Positive: authenticated | User 1 + active entitlement + published asset | Authorized: minimal proof, NO manifest | `authorized: true` | **PASS** |
| **20** | Positive: service_role | Explicit context + active entitlement + published asset | Authorized: minimal proof, NO manifest | `authorized: true` | **PASS** |

---

## 4. Main Supabase Verification (`yyiavtiwtekkocqpephr`)

1. **Migration Registered:**
   - File: `supabase/migrations/20260926163000_v5_agency_rpc_security_hardening_v2.sql`
   - Remote record: `version = '20260926163000'` in `supabase_migrations.schema_migrations`.
2. **Routine Privileges:**
   - `public_execute`: `false`
   - `anon_execute`: `false`
   - `authenticated_execute`: `true`
   - `service_role_execute`: `true`
3. **Safe Negative Check on Main:**
   - Executing `SELECT public.v5_authorize_agency_playback(...)` directly via database console:
     `{"authorized": false, "code": "unauthorized", "error": "Caller database role is not authorized"}`.
   - Proves that even `postgres` definer role cannot bypass authorization or enter a privileged path.
