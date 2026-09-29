-- Migration: 20260926155000_v5_agency_rpc_security_lockdown.sql
-- Description: System B Milestone B1 — V5 Agency Playback RPC Security Lockdown
-- Authoritative Plan: SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md
-- Target Database: Main Supabase (yyiavtiwtekkocqpephr)
--
-- Security Controls:
-- 1. Revoke unsafe EXECUTE from PUBLIC, anon, and authenticated.
-- 2. Grant EXECUTE to service_role and authenticated with safe identity binding.
-- 3. Reject anonymous callers immediately (defense-in-depth in SQL logic).
-- 4. In authenticated sessions, bind strictly to auth.uid() against agency_memberships.
--    Reject caller-supplied membership IDs that do not match the caller's verified membership.
-- 5. Disallow tenant context GUCs (app.current_agency_id) from acting as authorization proof.
-- 6. Verify active agency, active membership, and active student entitlement.
-- 7. Verify canonical course publishing status and active V5 published release.
-- 8. Delegate asset release membership check to existing public.v5_authorize_playback_asset.
-- 9. Eliminate raw manifest egress (return minimal authorization proof).
-- 10. Preserve unchanged: V5 playback lease, Cloudflare Worker, R2 layout, and media pipeline.

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
    v_caller_role TEXT := coalesce(auth.role(), current_user);
    v_caller_uid UUID := auth.uid();
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
    -- 1. TRUSTED CALLER / IDENTITY BINDING (NO SPOOFING, NO GUC RELIANCE)
    -- =========================================================================
    -- Reject anonymous callers immediately
    IF v_caller_role = 'anon' OR (v_caller_uid IS NULL AND v_caller_role NOT IN ('service_role', 'postgres', 'supabase_admin')) THEN
        RETURN jsonb_build_object(
            'authorized', false,
            'code', 'unauthorized',
            'error', 'Anonymous execution is prohibited'
        );
    END IF;

    -- If called by authenticated user, bind strictly to auth.uid()
    IF v_caller_role = 'authenticated' THEN
        -- Find active membership belonging to this authenticated user in the requested agency
        SELECT id, status INTO v_effective_membership_id, v_membership_status
        FROM public.agency_memberships
        WHERE user_id = v_caller_uid
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

        -- If browser also passed a membership_id, ensure it matches caller's own verified membership
        IF p_membership_id IS NOT NULL AND p_membership_id <> v_effective_membership_id THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'invalid_membership',
                'error', 'Supplied membership ID does not match authenticated user membership'
            );
        END IF;
    ELSE
        -- service_role / backend execution:
        IF p_membership_id IS NULL THEN
            RETURN jsonb_build_object(
                'authorized', false,
                'code', 'missing_membership',
                'error', 'Membership ID is required for service_role execution'
            );
        END IF;

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
    -- 5. EXACT V5 PUBLISHED RELEASE VERIFICATION
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
    -- 6. REUSE EXISTING v5_authorize_playback_asset (ASSET IN RELEASE)
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
    -- 7. RETURN MINIMAL AUTHORIZATION PROOF (NO MANIFEST BLOAT)
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

-- Security Hardening: Revoke default EXECUTE privileges
REVOKE ALL ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) FROM authenticated;

-- Grant EXECUTE to service_role and authenticated (safe contract enforced)
GRANT EXECUTE ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.v5_authorize_agency_playback(UUID, UUID, UUID, UUID) TO authenticated;
