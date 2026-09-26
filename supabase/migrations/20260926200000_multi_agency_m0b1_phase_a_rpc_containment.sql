-- =============================================================================
-- Migration: 20260926200000_multi_agency_m0b1_phase_a_rpc_containment.sql
-- Description: M0B.1 Phase A - Immediate RPC containment for privileged B5/B7 functions
-- Scope: Revoke execution from PUBLIC, anon, and authenticated. Allow only service_role.
-- =============================================================================

-- 1. B5: checkout_agency_offering
REVOKE ALL ON FUNCTION public.checkout_agency_offering(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.checkout_agency_offering(UUID, UUID, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.checkout_agency_offering(UUID, UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_agency_offering(UUID, UUID, UUID, UUID, TEXT) TO service_role;

-- 2. B5: approve_agency_order
REVOKE ALL ON FUNCTION public.approve_agency_order(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_agency_order(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.approve_agency_order(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_agency_order(UUID, UUID, UUID) TO service_role;

-- 3. B5: refund_agency_order
REVOKE ALL ON FUNCTION public.refund_agency_order(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_agency_order(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.refund_agency_order(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_agency_order(UUID, UUID, TEXT) TO service_role;

-- 4. B5: recompute_effective_entitlement
REVOKE ALL ON FUNCTION public.recompute_effective_entitlement(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_effective_entitlement(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_effective_entitlement(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_effective_entitlement(UUID, UUID) TO service_role;

-- 5. B7: submit_agency_homework
REVOKE ALL ON FUNCTION public.submit_agency_homework(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_agency_homework(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.submit_agency_homework(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_agency_homework(UUID, UUID, UUID, TEXT, TEXT, JSONB) TO service_role;

-- 6. B7: grade_agency_homework
REVOKE ALL ON FUNCTION public.grade_agency_homework(UUID, UUID, UUID, TEXT, TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grade_agency_homework(UUID, UUID, UUID, TEXT, TEXT, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION public.grade_agency_homework(UUID, UUID, UUID, TEXT, TEXT, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grade_agency_homework(UUID, UUID, UUID, TEXT, TEXT, NUMERIC) TO service_role;
