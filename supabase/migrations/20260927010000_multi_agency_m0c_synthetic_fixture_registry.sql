-- 20260927010000_multi_agency_m0c_synthetic_fixture_registry.sql
-- System B Milestone M0C — Trusted Synthetic Fixture Registry & Atomic Deprovisioning
-- Authoritative Plan: SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md
-- Phase 6: Trusted Synthetic Fixture Record & Atomic Cleanup Safety

-- 1. Create Server-Only Trusted Fixture Registry
CREATE TABLE IF NOT EXISTS public.agency_test_fixtures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL UNIQUE REFERENCES public.agencies(id) ON DELETE CASCADE,
    run_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_tool TEXT NOT NULL DEFAULT 'agency-provisioner',
    environment_fingerprint TEXT NOT NULL
);

-- Index for run_id lookups
CREATE INDEX IF NOT EXISTS idx_agency_test_fixtures_run_id ON public.agency_test_fixtures(run_id);

-- Lockdown permissions: revoke all from anon, authenticated, public
REVOKE ALL ON TABLE public.agency_test_fixtures FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agency_test_fixtures TO service_role;

-- 2. Atomic Deprovisioning RPC with Strict Validation
CREATE OR REPLACE FUNCTION public.deprovision_synthetic_agency_atomic(
    p_agency_id UUID,
    p_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_fixture_rec RECORD;
    v_agency_slug TEXT;
BEGIN
    -- Step 1: Protected Agencies Check (Immunity guarantee)
    SELECT slug INTO v_agency_slug FROM public.agencies WHERE id = p_agency_id;
    IF v_agency_slug IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'agency_not_found', 'error', 'Agency does not exist');
    END IF;

    IF v_agency_slug IN ('yeunauan', 'agency-a') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'protected_agency', 'error', 'Protected production agency cannot be deprovisioned');
    END IF;

    -- Step 2: Verify trusted fixture registry row
    SELECT * INTO v_fixture_rec FROM public.agency_test_fixtures WHERE agency_id = p_agency_id;
    IF v_fixture_rec.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_synthetic_fixture', 'error', 'Agency has no registered test fixture record (not a synthetic fixture)');
    END IF;

    IF v_fixture_rec.run_id <> p_run_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'run_id_mismatch', 'error', 'Supplied run_id does not match registered test fixture run_id');
    END IF;

    -- Step 3: Atomic cascading delete of tenant resources
    DELETE FROM public.agency_homework_submissions WHERE agency_id = p_agency_id;
    DELETE FROM public.entitlement_grants WHERE agency_id = p_agency_id;
    DELETE FROM public.student_entitlements WHERE agency_id = p_agency_id;
    DELETE FROM public.order_items WHERE agency_id = p_agency_id;
    DELETE FROM public.agency_orders WHERE agency_id = p_agency_id;
    DELETE FROM public.agency_offering_items WHERE agency_id = p_agency_id;
    DELETE FROM public.agency_offerings WHERE agency_id = p_agency_id;
    DELETE FROM public.agency_domains WHERE agency_id = p_agency_id;
    DELETE FROM public.agency_bank_accounts WHERE agency_id = p_agency_id;
    DELETE FROM public.agency_ui_profiles WHERE agency_id = p_agency_id;
    DELETE FROM public.agency_memberships WHERE agency_id = p_agency_id;
    DELETE FROM public.agency_test_fixtures WHERE agency_id = p_agency_id;
    DELETE FROM public.agencies WHERE id = p_agency_id;

    RETURN jsonb_build_object('ok', true, 'code', 'deprovisioned', 'agency_id', p_agency_id, 'slug', v_agency_slug);
END;
$$;

-- Lock down deprovision RPC to service_role only
REVOKE ALL ON FUNCTION public.deprovision_synthetic_agency_atomic(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deprovision_synthetic_agency_atomic(UUID, UUID) TO service_role;
