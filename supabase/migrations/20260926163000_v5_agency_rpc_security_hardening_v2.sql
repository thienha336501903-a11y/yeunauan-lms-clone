-- Migration: 20260926163000_v5_agency_rpc_security_hardening_v2.sql
-- Description: System B Milestone B1.1 — Remove SECURITY DEFINER Role Fallback & Harden Caller Binding
-- Authoritative Plan: SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md
-- External Review Gate: ChatGPT Work Security Review Remediation
-- Target Database: Main Supabase (yyiavtiwtekkocqpephr)
--
-- Security Hardening Controls:
-- 1. Eliminate coalesce(auth.role(), current_user) security definer fallback.
-- 2. Strict fail-closed caller model: ONLY 'authenticated' and 'service_role' permitted.
-- 3. Authenticated branch requires:
--    - Database role is authenticated
--    - auth.role() claim is present and exactly 'authenticated'
--    - auth.uid() is non-null
--    - Membership resolved strictly from auth.uid()
--    - Caller-provided membership UUID cannot substitute for auth.uid() ownership
--    - Role claim mismatch or missing claim immediately rejected
-- 4. Service role branch requires:
--    - Database role is service_role
--    - Role claim if present must match service_role
--    - Explicit membership ID validated against agency, active status, and entitlement
-- 5. Unexpected / generic DB roles fail closed (no privileged ELSE path).
-- 6. Reuses existing public.v5_authorize_playback_asset for current published release check.
-- 7. Fixed safe search_path = public, pg_temp with schema qualification.
-- 8. Zero raw manifest or R2 key egress.

CREATE OR REPLACE FUNCTION public.v5_authorize_agency_playback(
    p_agency_id UUID,
    p_membership_id UUID,
    p_lesson_id UUID,
    p_asset_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    -- Fail-closed caller role detection (NO generic current_user fallback)
    v_db_role TEXT := CASE 
        WHEN current_setting('role', true) IS NOT NULL AND current_setting('role', true) <> 'none' 
            THEN current_setting('role', true)
        ELSE session_user
    END;
    v_jwt_role TEXT := auth.role();
    v_jwt_uid UUID := auth.uid();

    v_effective_membership_id UUID;
    v_membership_status TEXT;
    v_membership_agency_id UUID;
    v_agency_status TEXT;
    v_canonical_lesson_id UUID;
    v_canonical_course_id UUID;
    v_v5_course_id UUID;
    v_course_status TEXT;
    v_entitlement_status TEXT;
    v_entitlement_expires_at TIMESTAMPTZ;
    v_published_release_id UUID;
    v_authorized_release_id UUID;
BEGIN
    -- =========================================================================
    -- 1. STRICT CALLER ROLE VALIDATION (NO FALLBACK, FAIL CLOSED)
    -- =========================================================================
    IF v_db_role = 'authenticated' THEN
        -- Authenticated caller requirements:
        -- A. JWT claim role must be explicitly present
        IF v_jwt_role IS NULL THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'unauthorized',
                'error', 'Missing authenticated role claim'
            );
        END IF;

        -- B. JWT claim role must match authenticated (reject altered claims)
        IF v_jwt_role <> 'authenticated' THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'unauthorized',
                'error', 'Role claim mismatch'
            );
        END IF;

        -- C. auth.uid() must be non-null
        IF v_jwt_uid IS NULL THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'unauthorized',
                'error', 'Missing authenticated user identifier'
            );
        END IF;

        -- D. Membership must be resolved strictly from auth.uid()
        SELECT id, status INTO v_effective_membership_id, v_membership_status
        FROM public.agency_memberships
        WHERE user_id = v_jwt_uid
          AND agency_id = p_agency_id;

        IF v_effective_membership_id IS NULL THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'agency_membership_not_found',
                'error', 'Caller has no membership in requested agency'
            );
        END IF;

        IF v_membership_status <> 'active' THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'membership_not_active',
                'error', 'Caller membership in requested agency is not active'
            );
        END IF;

        -- Caller-provided membership UUID must never substitute for auth.uid() ownership
        IF p_membership_id IS NOT NULL AND p_membership_id <> v_effective_membership_id THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'invalid_membership',
                'error', 'Supplied membership ID does not match authenticated user membership'
            );
        END IF;

    ELSIF v_db_role = 'service_role' THEN
        -- Service role requirements:
        -- A. If JWT claim role is set, it must match service_role (reject altered claim)
        IF v_jwt_role IS NOT NULL AND v_jwt_role <> 'service_role' THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'unauthorized',
                'error', 'Role claim mismatch'
            );
        END IF;

        -- B. Membership ID is required for service_role context
        IF p_membership_id IS NULL THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'missing_membership',
                'error', 'Membership ID is required for service_role execution'
            );
        END IF;

        -- C. Validate membership belongs to requested agency and is active
        SELECT agency_id, status INTO v_membership_agency_id, v_membership_status
        FROM public.agency_memberships
        WHERE id = p_membership_id;

        IF v_membership_agency_id IS NULL THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'invalid_membership',
                'error', 'Membership not found'
            );
        END IF;

        IF v_membership_agency_id <> p_agency_id THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'cross_agency_forbidden',
                'error', 'Membership does not belong to specified agency'
            );
        END IF;

        IF v_membership_status <> 'active' THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'membership_not_active',
                'error', 'Membership is not active'
            );
        END IF;

        v_effective_membership_id := p_membership_id;

    ELSE
        -- Unexpected / generic DB roles fail closed (no privileged fallback)
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'unauthorized',
            'error', 'Caller database role is not authorized'
        );
    END IF;

    -- =========================================================================
    -- 2. ACTIVE AGENCY VERIFICATION
    -- =========================================================================
    SELECT status INTO v_agency_status
    FROM public.agencies
    WHERE id = p_agency_id;

    IF v_agency_status IS NULL OR v_agency_status <> 'active' THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'agency_not_active',
            'error', 'Agency does not exist or is not active'
        );
    END IF;

    -- =========================================================================
    -- 3. CANONICAL LESSON & COURSE RESOLUTION
    -- =========================================================================
    SELECT 
        cl.id,
        cl.canonical_course_id,
        cc.course_id,
        cc.status
    INTO 
        v_canonical_lesson_id,
        v_canonical_course_id,
        v_v5_course_id,
        v_course_status
    FROM public.canonical_lessons cl
    JOIN public.canonical_courses cc ON cc.id = cl.canonical_course_id
    WHERE cl.id = p_lesson_id;

    IF v_canonical_lesson_id IS NULL THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'lesson_not_found',
            'error', 'Canonical lesson not found'
        );
    END IF;

    IF v_course_status <> 'published' THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'canonical_course_not_published',
            'error', 'Canonical course is not published'
        );
    END IF;

    IF v_v5_course_id IS NULL THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'v5_course_not_mapped',
            'error', 'Canonical course has no underlying V5 course mapped'
        );
    END IF;

    -- =========================================================================
    -- 4. ACTIVE STUDENT ENTITLEMENT CHECK
    -- =========================================================================
    SELECT status, expires_at INTO v_entitlement_status, v_entitlement_expires_at
    FROM public.student_entitlements
    WHERE agency_id = p_agency_id
      AND membership_id = v_effective_membership_id
      AND canonical_course_id = v_canonical_course_id;

    IF v_entitlement_status IS NULL THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'entitlement_missing',
            'error', 'No entitlement found for student in this course'
        );
    END IF;

    IF v_entitlement_status <> 'active' OR (v_entitlement_expires_at IS NOT NULL AND v_entitlement_expires_at <= now()) THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'entitlement_not_active',
            'error', 'Student entitlement is revoked or expired'
        );
    END IF;

    -- =========================================================================
    -- 5. EXACT V5 CURRENT PUBLISHED RELEASE VERIFICATION
    -- =========================================================================
    SELECT published_release_id INTO v_published_release_id
    FROM public.v5_course_configs
    WHERE course_id = v_v5_course_id
      AND status = 'published';

    IF v_published_release_id IS NULL THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'release_not_published',
            'error', 'V5 course has no active published release'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.v5_releases
        WHERE id = v_published_release_id
          AND course_id = v_v5_course_id
          AND status = 'published'
    ) THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'release_not_published',
            'error', 'Release is not in published status'
        );
    END IF;

    -- =========================================================================
    -- 6. REUSE EXISTING v5_authorize_playback_asset (ASSET IN CURRENT RELEASE)
    -- =========================================================================
    v_authorized_release_id := public.v5_authorize_playback_asset(
        v_v5_course_id,
        p_asset_id
    );

    IF v_authorized_release_id IS NULL THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'asset_not_in_release',
            'error', 'Requested media asset does not belong to the active published release'
        );
    END IF;

    -- =========================================================================
    -- 7. RETURN MINIMAL AUTHORIZATION PROOF (NO MANIFEST BLOAT, NO R2 KEYS)
    -- =========================================================================
    RETURN jsonb_build_object(
        'authorized', true,
        'agency_id', p_agency_id,
        'membership_id', v_effective_membership_id,
        'canonical_course_id', v_canonical_course_id,
        'v5_course_id', v_v5_course_id,
        'release_id', v_authorized_release_id,
        'asset_id', p_asset_id
    );
END;
$$;

-- Explicit privilege configuration
REVOKE ALL ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) TO authenticated;
