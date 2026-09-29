-- Test Script: verify-b1-rpc-lockdown.sql
-- Purpose: Verify B1 & B1.1 V5 Agency RPC Security Lockdown on isolated local Postgres
-- Target: supabase_db_system-b-restore-main (Postgres 17.6)
-- Covers: All B1 baseline tests + ChatGPT Work Blocker 2 mandatory test suite

\set ON_ERROR_STOP on

BEGIN;

-- =============================================================================
-- FIXTURES CLEANUP (IDEMPOTENT RE-RUNNABILITY)
-- =============================================================================
DELETE FROM public.student_entitlements WHERE id IN ('00000006-0000-0000-0000-000000000001', '00000006-0000-0000-0000-000000000002');
DELETE FROM public.canonical_lessons WHERE id IN ('00000005-0000-0000-0000-000000000001', '00000005-0000-0000-0000-000000000002');
DELETE FROM public.canonical_courses WHERE id IN ('00000004-0000-0000-0000-000000000001', '00000004-0000-0000-0000-000000000002');
DELETE FROM public.agency_memberships WHERE id IN ('00000003-0000-0000-0000-000000000001', '00000003-0000-0000-0000-000000000002', '00000003-0000-0000-0000-000000000003');
DELETE FROM public.agencies WHERE id IN ('00000001-0000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000003');
DELETE FROM auth.users WHERE id IN ('00000002-0000-0000-0000-000000000001', '00000002-0000-0000-0000-000000000002', '00000002-0000-0000-0000-000000000003');

-- =============================================================================
-- FIXTURES SETUP
-- =============================================================================

-- 1. Create test users in auth.users
INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES 
('00000002-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'student1@agency1.test', 'encrypted', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
('00000002-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'student2@agency2.test', 'encrypted', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
('00000002-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'student3@agency1.test', 'encrypted', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- 2. Create test agencies
INSERT INTO public.agencies (id, slug, name, status) VALUES
('00000001-0000-0000-0000-000000000001', 'test-agency-1', 'Agency One', 'active'),
('00000001-0000-0000-0000-000000000002', 'test-agency-2', 'Agency Two', 'active'),
('00000001-0000-0000-0000-000000000003', 'test-agency-inactive', 'Agency Inactive', 'suspended');

-- 3. Create agency memberships
INSERT INTO public.agency_memberships (id, agency_id, user_id, role, display_name, status) VALUES
('00000003-0000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000001', '00000002-0000-0000-0000-000000000001', 'student', 'Student One', 'active'),
('00000003-0000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000002', '00000002-0000-0000-0000-000000000002', 'student', 'Student Two', 'active'),
('00000003-0000-0000-0000-000000000003', '00000001-0000-0000-0000-000000000001', '00000002-0000-0000-0000-000000000003', 'student', 'Student Three Suspended', 'suspended');

-- 4. Create canonical courses
-- Canonical course 1 maps to published V5 course a645f117-2320-452f-8538-154b80484218
INSERT INTO public.canonical_courses (id, course_id, code, default_title, status, curriculum_metadata) VALUES
('00000004-0000-0000-0000-000000000001', 'a645f117-2320-452f-8538-154b80484218', 'CC-TEST-001', 'Canonical Course 1', 'published', '{}'),
-- Canonical course 2 maps to archived V5 course e3f4698f-846d-4b8f-9c02-40a729fdf2ed (no published release)
('00000004-0000-0000-0000-000000000002', 'e3f4698f-846d-4b8f-9c02-40a729fdf2ed', 'CC-TEST-002', 'Canonical Course Unpublished', 'published', '{}');

-- 5. Create canonical lessons
INSERT INTO public.canonical_lessons (id, canonical_course_id, title, sort_order, is_free_preview, duration_seconds) VALUES
('00000005-0000-0000-0000-000000000001', '00000004-0000-0000-0000-000000000001', 'Lesson 1 (Published)', 1, false, 300),
('00000005-0000-0000-0000-000000000002', '00000004-0000-0000-0000-000000000002', 'Lesson 2 (Unpublished Course)', 1, false, 300);

-- 6. Create student entitlements
INSERT INTO public.student_entitlements (id, agency_id, membership_id, canonical_course_id, status, expires_at) VALUES
-- User 1 has active entitlement for course 1 in Agency 1
('00000006-0000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000001', '00000003-0000-0000-0000-000000000001', '00000004-0000-0000-0000-000000000001', 'active', now() + interval '30 days'),
-- User 1 has revoked entitlement for course 2 in Agency 1
('00000006-0000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000001', '00000003-0000-0000-0000-000000000001', '00000004-0000-0000-0000-000000000002', 'revoked', now() + interval '30 days');

COMMIT;

-- =============================================================================
-- TEST SUITE EXECUTION
-- =============================================================================

-- Test 1: anon direct RPC (Negative)
\echo '=== TEST 1: anon direct RPC ==='
DO $$
BEGIN
    SET ROLE anon;
    BEGIN
        PERFORM public.v5_authorize_agency_playback(
            '00000001-0000-0000-0000-000000000001'::uuid,
            '00000003-0000-0000-0000-000000000001'::uuid,
            '00000005-0000-0000-0000-000000000001'::uuid,
            'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
        );
        RAISE EXCEPTION 'TEST_FAIL: anon should have been denied EXECUTE';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST_PASS: TEST 1 (anon direct RPC denied with insufficient_privilege)';
    END;
    RESET ROLE;
END;
$$;

-- Test 2: Mandatory A — authenticated + missing request.jwt.claim.role (Negative)
\echo '=== TEST 2: authenticated + missing request.jwt.claim.role ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    RESET request.jwt.claim.role;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'unauthorized' AND v_res->>'error' = 'Missing authenticated role claim' THEN
        RAISE NOTICE 'TEST_PASS: TEST 2 (authenticated + missing role claim denied)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 2 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 3: Mandatory B1 — authenticated + altered role claim (service_role) (Negative)
\echo '=== TEST 3: authenticated + altered role claim (service_role) ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'service_role';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'unauthorized' AND v_res->>'error' = 'Role claim mismatch' THEN
        RAISE NOTICE 'TEST_PASS: TEST 3 (authenticated + altered role claim service_role denied)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 3 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 4: Mandatory B2 — authenticated + altered role claim (postgres) (Negative)
\echo '=== TEST 4: authenticated + altered role claim (postgres) ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'postgres';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'unauthorized' AND v_res->>'error' = 'Role claim mismatch' THEN
        RAISE NOTICE 'TEST_PASS: TEST 4 (authenticated + altered role claim postgres denied)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 4 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 5: Mandatory B3 — authenticated + altered role claim (arbitrary_role) (Negative)
\echo '=== TEST 5: authenticated + altered role claim (arbitrary_role) ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'arbitrary_role';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'unauthorized' AND v_res->>'error' = 'Role claim mismatch' THEN
        RAISE NOTICE 'TEST_PASS: TEST 5 (authenticated + altered role claim arbitrary_role denied)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 5 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 6: Mandatory C — authenticated + auth.uid() missing (Negative)
\echo '=== TEST 6: authenticated + auth.uid() missing ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    RESET request.jwt.claim.sub;

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'unauthorized' AND v_res->>'error' = 'Missing authenticated user identifier' THEN
        RAISE NOTICE 'TEST_PASS: TEST 6 (authenticated + missing auth.uid() denied)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 6 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
END;
$$;

-- Test 7: Mandatory D — authenticated + foreign membership UUID (Negative)
\echo '=== TEST 7: authenticated + foreign membership UUID ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    -- User 1 passes User 2's membership ID
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000002'::uuid, -- Foreign membership
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'invalid_membership' THEN
        RAISE NOTICE 'TEST_PASS: TEST 7 (authenticated + foreign membership denied with invalid_membership)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 7 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 8: authenticated guessed agency UUID (Negative)
\echo '=== TEST 8: authenticated guessed agency UUID ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    -- User 1 tries to access Agency 2 (where User 1 is not a member)
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000002'::uuid, -- Agency 2
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'agency_membership_not_found' THEN
        RAISE NOTICE 'TEST_PASS: TEST 8 (guessed agency rejected with agency_membership_not_found)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 8 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 9: cross-agency membership in service_role (Negative)
\echo '=== TEST 9: cross-agency membership ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE service_role;
    RESET request.jwt.claim.sub;
    SET request.jwt.claim.role = 'service_role';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid, -- Agency 1
        '00000003-0000-0000-0000-000000000002'::uuid, -- Membership of Agency 2
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'cross_agency_forbidden' THEN
        RAISE NOTICE 'TEST_PASS: TEST 9 (cross-agency membership rejected with cross_agency_forbidden)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 9 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
END;
$$;

-- Test 10: no entitlement (Negative)
\echo '=== TEST 10: no entitlement ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000002';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000002'::uuid, -- Agency 2
        '00000003-0000-0000-0000-000000000002'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'entitlement_missing' THEN
        RAISE NOTICE 'TEST_PASS: TEST 10 (no entitlement rejected with entitlement_missing)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 10 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 11: revoked entitlement (Negative)
\echo '=== TEST 11: revoked entitlement ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000002'::uuid, -- lesson of course 2
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'entitlement_not_active' THEN
        RAISE NOTICE 'TEST_PASS: TEST 11 (revoked entitlement rejected with entitlement_not_active)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 11 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 12: foreign / nonexistent asset (Negative)
\echo '=== TEST 12: foreign / nonexistent asset ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    -- Non-existent random asset UUID
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'asset_not_in_release' THEN
        RAISE NOTICE 'TEST_PASS: TEST 12 (foreign asset rejected with asset_not_in_release)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 12 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 13: asset from another course (Negative)
\echo '=== TEST 13: asset from another course ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    -- Asset belonging to Course 2 release, but requested against Course 1 lesson
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'a9cee883-780e-457b-87a2-0939204f64e5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'asset_not_in_release' THEN
        RAISE NOTICE 'TEST_PASS: TEST 13 (asset from another course rejected with asset_not_in_release)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 13 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 14: Mandatory E — asset from PREVIOUS RELEASE of the SAME course (Negative)
\echo '=== TEST 14: asset from PREVIOUS RELEASE of the SAME course ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    -- Asset b060270f-bf73-46ac-9438-22fb0a6ba053 belongs to Course 1 (release v1),
    -- but Course 1 current published_release_id is release v5 (9cea2b7b-eb83-43ad-ba9d-c69104cfb40b).
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'b060270f-bf73-46ac-9438-22fb0a6ba053'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'asset_not_in_release' THEN
        RAISE NOTICE 'TEST_PASS: TEST 14 (asset from previous release of same course denied with asset_not_in_release)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 14 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 15: NULL/unpublished release (Negative)
\echo '=== TEST 15: NULL/unpublished release ==='
UPDATE public.student_entitlements
SET status = 'active'
WHERE id = '00000006-0000-0000-0000-000000000002';

DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    -- Course 2 has published_release_id IS NULL (archived course config)
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000002'::uuid, -- Course 2 lesson
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'release_not_published' THEN
        RAISE NOTICE 'TEST_PASS: TEST 15 (unpublished release rejected with release_not_published)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 15 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

UPDATE public.student_entitlements
SET status = 'revoked'
WHERE id = '00000006-0000-0000-0000-000000000002';

-- Test 16: Mandatory G — unexpected DB role (Negative)
\echo '=== TEST 16: unexpected DB role ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    -- When calling from a DB session that is neither authenticated nor service_role (e.g. postgres direct)
    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'unauthorized' AND v_res->>'error' = 'Caller database role is not authorized' THEN
        RAISE NOTICE 'TEST_PASS: TEST 16 (unexpected DB role denied with unauthorized)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 16 unexpected result: %', v_res;
    END IF;
END;
$$;

-- Test 17: direct PostgREST RPC privileges check (Negative)
\echo '=== TEST 17: direct PostgREST RPC privileges ==='
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.routine_privileges
        WHERE routine_name = 'v5_authorize_agency_playback'
          AND grantee = 'anon'
    ) THEN
        RAISE EXCEPTION 'TEST_FAIL: anon role has EXECUTE privilege on v5_authorize_agency_playback';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.routine_privileges
        WHERE routine_name = 'v5_authorize_agency_playback'
          AND grantee = 'PUBLIC'
    ) THEN
        RAISE EXCEPTION 'TEST_FAIL: PUBLIC has EXECUTE privilege on v5_authorize_agency_playback';
    END IF;

    RAISE NOTICE 'TEST_PASS: TEST 17 (direct PostgREST anon RPC blocked: privileges revoked)';
END;
$$;

-- Test 18: GUC spoof attempt (Negative)
\echo '=== TEST 18: GUC spoof attempt ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    -- Attacker attempts to spoof agency via GUC to Agency 2
    BEGIN
        SET app.current_agency_id = '00000001-0000-0000-0000-000000000002';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- The function must bind to auth.uid() and explicit parameter, completely ignoring GUC
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = true AND v_res->>'agency_id' = '00000001-0000-0000-0000-000000000001' THEN
        RAISE NOTICE 'TEST_PASS: TEST 18 (GUC spoof has no effect; identity securely bound)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 18 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 19: Positive Test — authenticated (Valid trusted Agency member + entitlement + current V5 asset)
\echo '=== TEST 19: Positive Test (authenticated) ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = true
       AND v_res->>'agency_id' = '00000001-0000-0000-0000-000000000001'
       AND v_res->>'membership_id' = '00000003-0000-0000-0000-000000000001'
       AND v_res->>'canonical_course_id' = '00000004-0000-0000-0000-000000000001'
       AND v_res->>'v5_course_id' = 'a645f117-2320-452f-8538-154b80484218'
       AND v_res->>'release_id' = '9cea2b7b-eb83-43ad-ba9d-c69104cfb40b'
       AND v_res->>'asset_id' = 'ab79016b-e024-40f3-8ea1-50962e1c22a5'
       AND NOT (v_res ? 'manifest')
    THEN
        RAISE NOTICE 'TEST_PASS: TEST 19 (authenticated positive authorized with minimal payload and NO manifest)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 19 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
    RESET request.jwt.claim.sub;
END;
$$;

-- Test 20: Mandatory F — service_role positive test (Valid explicit membership + entitlement + current V5 asset)
\echo '=== TEST 20: Positive Test (service_role) ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE service_role;
    SET request.jwt.claim.role = 'service_role';
    RESET request.jwt.claim.sub;

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = true
       AND v_res->>'agency_id' = '00000001-0000-0000-0000-000000000001'
       AND v_res->>'membership_id' = '00000003-0000-0000-0000-000000000001'
       AND v_res->>'canonical_course_id' = '00000004-0000-0000-0000-000000000001'
       AND v_res->>'v5_course_id' = 'a645f117-2320-452f-8538-154b80484218'
       AND v_res->>'release_id' = '9cea2b7b-eb83-43ad-ba9d-c69104cfb40b'
       AND v_res->>'asset_id' = 'ab79016b-e024-40f3-8ea1-50962e1c22a5'
       AND NOT (v_res ? 'manifest')
    THEN
        RAISE NOTICE 'TEST_PASS: TEST 20 (service_role positive authorized with minimal payload and NO manifest)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 20 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
    RESET request.jwt.claim.role;
END;
$$;
