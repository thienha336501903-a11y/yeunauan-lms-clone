-- Test Script: verify-b1-rpc-lockdown.sql
-- Purpose: Verify B1 V5 Agency RPC Security Lockdown on isolated local Postgres
-- Target: supabase_db_system-b-restore-main (Postgres 17.6)

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

-- Test 2: authenticated guessed agency UUID (Negative)
\echo '=== TEST 2: authenticated guessed agency UUID ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';
    SET request.jwt.claim.role = 'authenticated';

    -- User 1 tries to access Agency 2 (where User 1 is not a member)
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000002'::uuid, -- Agency 2
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'agency_membership_not_found' THEN
        RAISE NOTICE 'TEST_PASS: TEST 2 (guessed agency rejected with agency_membership_not_found)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 2 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Test 3: authenticated guessed membership UUID (Negative)
\echo '=== TEST 3: authenticated guessed membership UUID ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';
    SET request.jwt.claim.role = 'authenticated';

    -- User 1 is in Agency 1, but passes User 2's membership ID
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid, -- Agency 1
        '00000003-0000-0000-0000-000000000002'::uuid, -- Membership belonging to User 2
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'invalid_membership' THEN
        RAISE NOTICE 'TEST_PASS: TEST 3 (guessed membership rejected with invalid_membership)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 3 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Test 4: cross-agency membership (Negative)
\echo '=== TEST 4: cross-agency membership ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    -- service_role caller attempting to pass membership from Agency 2 against Agency 1
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
        RAISE NOTICE 'TEST_PASS: TEST 4 (cross-agency membership rejected with cross_agency_forbidden)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 4 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Test 5: no entitlement (Negative)
\echo '=== TEST 5: no entitlement ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    -- User 2 in Agency 2 has active membership, but NO entitlement for course 1
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000002';
    SET request.jwt.claim.role = 'authenticated';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000002'::uuid, -- Agency 2
        '00000003-0000-0000-0000-000000000002'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'entitlement_missing' THEN
        RAISE NOTICE 'TEST_PASS: TEST 5 (no entitlement rejected with entitlement_missing)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 5 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Test 6: revoked entitlement (Negative)
\echo '=== TEST 6: revoked entitlement ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    -- User 1 has entitlement for course 2, but its status is 'revoked'
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';
    SET request.jwt.claim.role = 'authenticated';

    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000002'::uuid, -- lesson of course 2
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'entitlement_not_active' THEN
        RAISE NOTICE 'TEST_PASS: TEST 6 (revoked entitlement rejected with entitlement_not_active)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 6 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Test 7: foreign asset (Negative)
\echo '=== TEST 7: foreign asset ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';
    SET request.jwt.claim.role = 'authenticated';

    -- Non-existent random asset UUID
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'asset_not_in_release' THEN
        RAISE NOTICE 'TEST_PASS: TEST 7 (foreign asset rejected with asset_not_in_release)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 7 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Test 8: asset outside current release (Negative)
\echo '=== TEST 8: asset outside current release ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';
    SET request.jwt.claim.role = 'authenticated';

    -- Asset belonging to Course 2 release, but requested against Course 1 lesson
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000001'::uuid,
        'a9cee883-780e-457b-87a2-0939204f64e5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'asset_not_in_release' THEN
        RAISE NOTICE 'TEST_PASS: TEST 8 (asset outside release rejected with asset_not_in_release)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 8 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Test 9: NULL/unpublished release (Negative)
\echo '=== TEST 9: NULL/unpublished release ==='
-- Temporarily set entitlement active for course 2 to isolate release check
UPDATE public.student_entitlements
SET status = 'active'
WHERE id = '00000006-0000-0000-0000-000000000002';

DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';
    SET request.jwt.claim.role = 'authenticated';

    -- Course 2 has published_release_id IS NULL (archived course config)
    v_res := public.v5_authorize_agency_playback(
        '00000001-0000-0000-0000-000000000001'::uuid,
        '00000003-0000-0000-0000-000000000001'::uuid,
        '00000005-0000-0000-0000-000000000002'::uuid, -- Course 2 lesson
        'ab79016b-e024-40f3-8ea1-50962e1c22a5'::uuid
    );

    IF (v_res->>'authorized')::boolean = false AND v_res->>'code' = 'release_not_published' THEN
        RAISE NOTICE 'TEST_PASS: TEST 9 (unpublished release rejected with release_not_published)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 9 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Restore revoked status
UPDATE public.student_entitlements
SET status = 'revoked'
WHERE id = '00000006-0000-0000-0000-000000000002';

-- Test 10: direct PostgREST RPC by anon role (Negative)
\echo '=== TEST 10: direct PostgREST RPC ==='
DO $$
BEGIN
    -- Verify anon role cannot execute via routine privileges check
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

    RAISE NOTICE 'TEST_PASS: TEST 10 (direct PostgREST anon RPC blocked: privileges revoked)';
END;
$$;

-- Test 11: GUC spoof attempt (Negative)
\echo '=== TEST 11: GUC spoof attempt ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';
    SET request.jwt.claim.role = 'authenticated';

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
        RAISE NOTICE 'TEST_PASS: TEST 11 (GUC spoof has no effect; identity securely bound)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 11 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;

-- Test 12: Positive Test (Valid trusted Agency member + entitlement + valid current V5 asset)
\echo '=== TEST 12: Positive Test ==='
DO $$
DECLARE
    v_res JSONB;
BEGIN
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '00000002-0000-0000-0000-000000000001';
    SET request.jwt.claim.role = 'authenticated';

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
        RAISE NOTICE 'TEST_PASS: TEST 12 (Positive authorized with minimal payload and NO manifest)';
    ELSE
        RAISE EXCEPTION 'TEST_FAIL: TEST 12 unexpected result: %', v_res;
    END IF;

    RESET ROLE;
END;
$$;
