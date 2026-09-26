# System B Milestone B1 Implementation Report: V5 Agency Playback RPC Security Lockdown

**Execution Date:** 2026-09-26  
**Authoritative Plan:** `SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md`  
**Execution Context:** Anti Execution Engine (Pre-Review Baseline for ChatGPT Work)  
**Main Supabase Reference:** `yyiavtiwtekkocqpephr` (PostgreSQL 17.6)  
**Local Test DB Reference:** `supabase_db_system-b-restore-main` (PostgreSQL 17.6 on Docker port 54332)

---

## 1. Executive Status Scorecard

| Metric | Verified Value | Status |
| :--- | :--- | :--- |
| **B0_SOURCE_CONTROL** | **PASS** (Commit `49c1fa8` on branch `feat/multi-agency-m0a-b1`) | PASS |
| **M0A_HISTORY_REAPPLIED** | **NO** (Catalog verified, historical migrations untouched) | PASS |
| **B1_LOCAL_SECURITY_TEST** | **PASS** (12/12 tests passed: 11 negatives + 1 positive) | PASS |
| **B1_RPC_EXECUTE_PRIVILEGES** | `service_role, authenticated` (`PUBLIC` and `anon` revoked) | PASS |
| **B1_CALLER_BINDING** | `auth.uid()` bound to `agency_memberships.user_id` (authenticated); verified membership context (service_role); GUC detached | PASS |
| **B1_ASSET_RELEASE_BINDING** | Reuses existing `public.v5_authorize_playback_asset(v5_course_id, p_asset_id)` | PASS |
| **B1_MAIN_APPLIED** | **YES** (Migration `20260926155000` applied & recorded on Main) | PASS |
| **V5_RUNTIME_CHANGED** | **NO** (Zero changes to Next.js API, Worker, lease signing) | PASS |
| **R2_MUTATIONS** | **0** (No bucket or object operations) | PASS |
| **LEGACY_MUTATIONS** | **0** (Legacy Supabase untouched) | PASS |
| **B1_RPC_LOCKDOWN** | **PASS** | **PASS** |

---

## 2. Security Defects Identified & Remediated

In Milestone M0A, the initial definition of `public.v5_authorize_agency_playback` had several security limitations:
1. **Unsafe Privilege Grants:** Function had default `EXECUTE` grant to `PUBLIC`, allowing anonymous clients to execute the function directly.
2. **Untrusted Identity Proof:** Accepted `p_agency_id` and `p_membership_id` directly from caller without binding to `auth.uid()`, allowing attackers to guess foreign membership IDs.
3. **Missing Asset Validation:** Ignored `p_asset_id` and did not verify whether the requested media asset belonged to the published release.
4. **Data Egress Bloat:** Extracted and returned the full release manifest JSONB across the network wire.

### B1 Hardening Measures (`20260926155000_v5_agency_rpc_security_lockdown.sql`)
1. **Privilege Revocation:** Explicitly executed `REVOKE ALL FROM PUBLIC, anon, authenticated;` followed by `GRANT EXECUTE TO service_role, authenticated;`.
2. **Deterministic Caller Binding:**
   - For `authenticated` sessions: Derives caller identity strictly from `auth.uid()`. Resolves active membership in `agency_memberships` where `user_id = auth.uid() AND agency_id = p_agency_id AND status = 'active'`. If a client attempts to supply a mismatched `p_membership_id`, it is rejected with `invalid_membership`.
   - For `service_role` sessions: Requires explicit `p_membership_id`, verifying membership exists, belongs to `p_agency_id`, and is active (`cross_agency_forbidden` if mismatched).
   - For `anon` sessions: Explicit defense-in-depth check immediately returns `unauthorized` in addition to Postgres permission denial.
3. **Tenant GUC Detachment:** Completely eliminates reliance on `app.current_agency_id` or `current_setting()`. GUC spoofing has zero impact on authorization.
4. **Canonical & V5 Release Hierarchy:** Validates:
   - Active agency (`agencies.status = 'active'`)
   - Canonical lesson exists (`canonical_lessons`)
   - Canonical course is published (`canonical_courses.status = 'published'`)
   - Active student entitlement exists (`student_entitlements.status = 'active'` and `expires_at > now()`)
   - Underlying V5 course has an active published release (`v5_course_configs.status = 'published'` and `v5_releases.status = 'published'`)
5. **Exact V5 Asset Release Validation:** Calls existing platform function `public.v5_authorize_playback_asset(v_v5_course_id, p_asset_id)`. If the asset is foreign or not part of the active release links, it returns `asset_not_in_release`.
6. **Egress Protection:** Strips out the `manifest` object completely. Returns only lightweight authorization proof (`authorized`, `agency_id`, `membership_id`, `canonical_course_id`, `v5_course_id`, `release_id`, `asset_id`).

---

## 3. Local Test Suite Verification (Isolated Test DB)

Executed test script `scripts/verify-b1-rpc-lockdown.sql` on `supabase_db_system-b-restore-main`:

| # | Test Scenario | Execution Context / Parameters | Expected Behavior | Observed Result | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **anon direct RPC** | `SET ROLE anon;` direct execution | Denied with `insufficient_privilege` | `insufficient_privilege` caught | **PASS** |
| **2** | **Guessed Agency UUID** | Authenticated User 1 requesting Agency 2 | `authorized: false`, code `agency_membership_not_found` | `agency_membership_not_found` | **PASS** |
| **3** | **Guessed Membership UUID** | Authenticated User 1 passing User 2 membership | `authorized: false`, code `invalid_membership` | `invalid_membership` | **PASS** |
| **4** | **Cross-Agency Membership** | `service_role` passing Agency 2 membership for Agency 1 | `authorized: false`, code `cross_agency_forbidden` | `cross_agency_forbidden` | **PASS** |
| **5** | **No Entitlement** | Authenticated User 2 requesting course without entitlement | `authorized: false`, code `entitlement_missing` | `entitlement_missing` | **PASS** |
| **6** | **Revoked Entitlement** | Authenticated User 1 requesting course with revoked entitlement | `authorized: false`, code `entitlement_not_active` | `entitlement_not_active` | **PASS** |
| **7** | **Foreign Asset** | Authenticated User 1 requesting random non-existent UUID | `authorized: false`, code `asset_not_in_release` | `asset_not_in_release` | **PASS** |
| **8** | **Asset Outside Release** | Authenticated User 1 requesting asset from different course | `authorized: false`, code `asset_not_in_release` | `asset_not_in_release` | **PASS** |
| **9** | **Unpublished Release** | Authenticated User 1 requesting archived course with NULL release | `authorized: false`, code `release_not_published` | `release_not_published` | **PASS** |
| **10** | **Direct PostgREST RPC** | Schema privileges query on `anon` and `PUBLIC` | No execute privileges for `anon` or `PUBLIC` | `anon` and `PUBLIC` 0 execute rows | **PASS** |
| **11** | **GUC Spoof Attempt** | Authenticated User 1 setting `app.current_agency_id = Agency 2` | Function ignores GUC, evaluates strictly from identity | GUC ignored, bound to identity | **PASS** |
| **12** | **Positive Test** | Valid member + active entitlement + published course + valid asset | `authorized: true`, minimal proof, NO manifest | `authorized: true`, manifest omitted | **PASS** |

---

## 4. Main Supabase Verification (`yyiavtiwtekkocqpephr`)

### Migration Registration
- File: `supabase/migrations/20260926155000_v5_agency_rpc_security_lockdown.sql`
- Remote `supabase_migrations.schema_migrations` record: `version = '20260926155000'`
- Migration status: Local and remote synchronized.

### Privilege Verification on Main DB
```sql
SELECT has_function_privilege('anon', 'public.v5_authorize_agency_playback(uuid, uuid, uuid, uuid)', 'EXECUTE') AS anon_has_execute,
       has_function_privilege('public', 'public.v5_authorize_agency_playback(uuid, uuid, uuid, uuid)', 'EXECUTE') AS public_has_execute,
       has_function_privilege('authenticated', 'public.v5_authorize_agency_playback(uuid, uuid, uuid, uuid)', 'EXECUTE') AS auth_has_execute,
       has_function_privilege('service_role', 'public.v5_authorize_agency_playback(uuid, uuid, uuid, uuid)', 'EXECUTE') AS service_has_execute;
```
**Results:**
- `anon_has_execute`: `false`
- `public_has_execute`: `false`
- `auth_has_execute`: `true` (enforces safe `auth.uid()` contract)
- `service_has_execute`: `true`

---

## 5. Non-Interference Confirmation

- **V5 Runtime:** Zero edits to `utils/lms-handlers/v5-play.js`, `utils/v5-playback-lease.js`, or any V5 application code.
- **V5 Media / Storage:** Zero edits to R2 buckets, objects, or keys.
- **Cloudflare Worker:** Worker code and routing untouched.
- **Cryptographic Leases:** P-256 ECDSA signing, proof key format, and verification contracts remain identical.
- **Legacy Supabase (`aqozjkfwzmyfunqvcyjv`):** Untouched.
