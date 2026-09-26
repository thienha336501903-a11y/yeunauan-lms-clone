-- =============================================================================
-- MIGRATION: 20260926145000_multi_agency_m0a_trusted_context_hardening.sql
-- PROJECT: System B Multi-Agency Phase 0 (Milestone M0A.1 Patch)
-- TARGET: Main Supabase (yyiavtiwtekkocqpephr)
-- CLASSIFICATION: SECURITY HARDENING — TRUSTED TENANT CONTEXT
-- OBJECTIVE:
--   1. Revoke public/anon/authenticated execute from context-setting helpers.
--   2. Revoke table permissions on private tenant tables from anon.
--   3. Anchor authenticated tenant RLS to verified auth.uid() -> agency_memberships.
--   4. Prevent GUC spoofing (SET app.current_agency_id) from leaking tenant data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. HARDEN CONTEXT-SETTING FUNCTIONS
-- Revoke execution from PUBLIC, anon, and authenticated; restrict to service_role
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_trusted_agency_context(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_trusted_agency_context(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.set_trusted_agency_context(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_trusted_agency_context(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.current_agency_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_agency_id() FROM anon;
REVOKE ALL ON FUNCTION public.current_agency_id() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.current_agency_id() TO service_role;

-- -----------------------------------------------------------------------------
-- 2. TRUSTED AUTHENTICATED TENANT CONTEXT PRIMITIVES
-- Derived strictly from database identity (auth.uid() -> agency_memberships)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trusted_auth_agency_ids() RETURNS SETOF UUID AS $$
    SELECT agency_id 
    FROM public.agency_memberships 
    WHERE user_id = auth.uid() 
      AND status = 'active';
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.trusted_auth_membership_ids() RETURNS SETOF UUID AS $$
    SELECT id 
    FROM public.agency_memberships 
    WHERE user_id = auth.uid() 
      AND status = 'active';
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.trusted_auth_agency_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trusted_auth_agency_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.trusted_auth_agency_ids() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.trusted_auth_membership_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trusted_auth_membership_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.trusted_auth_membership_ids() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. REVOKE ANON PRIVILEGES ON ALL PRIVATE TENANT TABLES
-- Private tenant records must never be accessible directly by anonymous sessions
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.agency_bank_accounts FROM anon;
REVOKE ALL ON TABLE public.agency_orders FROM anon;
REVOKE ALL ON TABLE public.order_items FROM anon;
REVOKE ALL ON TABLE public.agency_memberships FROM anon;
REVOKE ALL ON TABLE public.student_devices FROM anon;
REVOKE ALL ON TABLE public.student_entitlements FROM anon;
REVOKE ALL ON TABLE public.entitlement_grants FROM anon;
REVOKE ALL ON TABLE public.agency_lesson_progress FROM anon;

-- Grant selective access to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agency_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_devices TO authenticated;
GRANT SELECT ON TABLE public.agency_bank_accounts TO authenticated;
GRANT SELECT, INSERT ON TABLE public.agency_orders TO authenticated;
GRANT SELECT, INSERT ON TABLE public.order_items TO authenticated;
GRANT SELECT ON TABLE public.student_entitlements TO authenticated;
GRANT SELECT ON TABLE public.entitlement_grants TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agency_lesson_progress TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. REPLACE POLICIES ON PRIVATE TENANT TABLES WITH IDENTITY-ANCHORED CHECKS
-- -----------------------------------------------------------------------------

-- A. agency_memberships: User can only see/manage their own active memberships
DROP POLICY IF EXISTS tenant_read_memberships ON public.agency_memberships;
CREATE POLICY tenant_read_memberships ON public.agency_memberships
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() AND status = 'active');

-- B. student_devices: User can only access devices tied to their verified memberships
DROP POLICY IF EXISTS tenant_manage_devices ON public.student_devices;
CREATE POLICY tenant_manage_devices ON public.student_devices
    FOR ALL TO authenticated
    USING (
        membership_id IN (SELECT public.trusted_auth_membership_ids())
        AND agency_id IN (SELECT public.trusted_auth_agency_ids())
    )
    WITH CHECK (
        membership_id IN (SELECT public.trusted_auth_membership_ids())
        AND agency_id IN (SELECT public.trusted_auth_agency_ids())
    );

-- C. agency_orders: Student can view own orders (matching registered phone in agency), staff can view agency orders
DROP POLICY IF EXISTS tenant_read_orders ON public.agency_orders;
CREATE POLICY tenant_read_orders ON public.agency_orders
    FOR SELECT TO authenticated
    USING (
        agency_id IN (SELECT public.trusted_auth_agency_ids())
        AND (
            customer_phone IN (
                SELECT phone FROM public.agency_memberships 
                WHERE user_id = auth.uid() AND agency_id = agency_orders.agency_id AND status = 'active'
            )
            OR
            EXISTS (
                SELECT 1 FROM public.agency_memberships
                WHERE user_id = auth.uid() 
                  AND agency_id = agency_orders.agency_id 
                  AND role IN ('agency_owner', 'agency_staff')
                  AND status = 'active'
            )
        )
    );

-- D. order_items: Visible only if the parent order is accessible to the user
DROP POLICY IF EXISTS tenant_read_order_items ON public.order_items;
CREATE POLICY tenant_read_order_items ON public.order_items
    FOR SELECT TO authenticated
    USING (
        agency_id IN (SELECT public.trusted_auth_agency_ids())
        AND order_id IN (SELECT id FROM public.agency_orders)
    );

-- E. student_entitlements: Visible only for user's own active memberships in permitted agencies
DROP POLICY IF EXISTS tenant_read_entitlements ON public.student_entitlements;
CREATE POLICY tenant_read_entitlements ON public.student_entitlements
    FOR SELECT TO authenticated
    USING (
        agency_id IN (SELECT public.trusted_auth_agency_ids())
        AND membership_id IN (SELECT public.trusted_auth_membership_ids())
    );

-- F. entitlement_grants: Restricted to agency staff/owner
DROP POLICY IF EXISTS tenant_read_grants ON public.entitlement_grants;
CREATE POLICY tenant_read_grants ON public.entitlement_grants
    FOR SELECT TO authenticated
    USING (
        agency_id IN (SELECT public.trusted_auth_agency_ids())
        AND EXISTS (
            SELECT 1 FROM public.agency_memberships
            WHERE user_id = auth.uid()
              AND agency_id = entitlement_grants.agency_id
              AND role IN ('agency_owner', 'agency_staff')
              AND status = 'active'
        )
    );

-- G. agency_lesson_progress: User can only view/update their own progress in permitted agencies
DROP POLICY IF EXISTS tenant_manage_progress ON public.agency_lesson_progress;
CREATE POLICY tenant_manage_progress ON public.agency_lesson_progress
    FOR ALL TO authenticated
    USING (
        agency_id IN (SELECT public.trusted_auth_agency_ids())
        AND membership_id IN (SELECT public.trusted_auth_membership_ids())
    )
    WITH CHECK (
        agency_id IN (SELECT public.trusted_auth_agency_ids())
        AND membership_id IN (SELECT public.trusted_auth_membership_ids())
    );

-- H. agency_bank_accounts: Restricted to staff/owner within the agency (checkout uses server-side RPC in M0B)
DROP POLICY IF EXISTS tenant_read_bank ON public.agency_bank_accounts;
CREATE POLICY tenant_read_bank ON public.agency_bank_accounts
    FOR SELECT TO authenticated
    USING (
        agency_id IN (SELECT public.trusted_auth_agency_ids())
        AND EXISTS (
            SELECT 1 FROM public.agency_memberships
            WHERE user_id = auth.uid()
              AND agency_id = agency_bank_accounts.agency_id
              AND role IN ('agency_owner', 'agency_staff')
              AND status = 'active'
        )
    );
