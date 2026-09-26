-- Migration: 20260926180000_multi_agency_b5_commerce_and_grant_lifecycle.sql
-- Description: System B Milestone B5 — Commerce Adaptation, Bank Snapshot & Entitlement Grant Lifecycle
-- Authoritative Plan: SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md
-- Target Database: Main Supabase (yyiavtiwtekkocqpephr)

-- -----------------------------------------------------------------------------
-- 1. ADDITIVE ENHANCEMENTS TO AGENCY_ORDERS (MEMBERSHIP BINDING & IMMUTABLE SNAPSHOTS)
-- -----------------------------------------------------------------------------
ALTER TABLE public.agency_orders
    ADD COLUMN IF NOT EXISTS membership_id UUID,
    ADD COLUMN IF NOT EXISTS offering_id UUID,
    ADD COLUMN IF NOT EXISTS snapshot_bank_code TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_account_number TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_account_holder TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_transfer_content TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_price_vnd BIGINT,
    ADD COLUMN IF NOT EXISTS audit_notes TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_agency_orders_membership'
    ) THEN
        ALTER TABLE public.agency_orders
            ADD CONSTRAINT fk_agency_orders_membership
            FOREIGN KEY (agency_id, membership_id) REFERENCES public.agency_memberships(agency_id, id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_agency_orders_offering'
    ) THEN
        ALTER TABLE public.agency_orders
            ADD CONSTRAINT fk_agency_orders_offering
            FOREIGN KEY (agency_id, offering_id) REFERENCES public.agency_offerings(agency_id, id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agency_orders_membership ON public.agency_orders(agency_id, membership_id);
CREATE INDEX IF NOT EXISTS idx_agency_orders_offering ON public.agency_orders(agency_id, offering_id);

-- -----------------------------------------------------------------------------
-- 2. ADDITIVE ENHANCEMENTS TO ENTITLEMENT_GRANTS (LIFECYCLE, STATUS, REVOCATION)
-- -----------------------------------------------------------------------------
ALTER TABLE public.entitlement_grants
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoked_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_entitlement_grants_source
    ON public.entitlement_grants(agency_id, source_type, source_reference_id);

CREATE INDEX IF NOT EXISTS idx_entitlement_grants_status
    ON public.entitlement_grants(agency_id, entitlement_id, status);

-- Unique constraint for grant idempotency on same source
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_entitlement_grants_idempotency'
    ) THEN
        ALTER TABLE public.entitlement_grants
            ADD CONSTRAINT uq_entitlement_grants_idempotency
            UNIQUE (agency_id, entitlement_id, source_type, source_reference_id);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. EFFECTIVE ENTITLEMENT RECOMPUTATION FUNCTION
-- Recomputes student_entitlements.status from underlying grants.
-- An underlying revoked or expired grant must never leave stale playable entitlement.
-- If multiple grants exist (e.g. order + manual admin), revoking one leaves other active.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_effective_entitlement(
    p_agency_id UUID,
    p_entitlement_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_active_grants INT;
    v_max_expiry TIMESTAMPTZ;
    v_has_lifetime BOOLEAN;
    v_new_status TEXT;
    v_new_expiry TIMESTAMPTZ;
BEGIN
    -- Check for active, non-expired grants
    SELECT 
        COUNT(*),
        BOOL_OR(expires_at IS NULL),
        MAX(expires_at)
    INTO 
        v_active_grants,
        v_has_lifetime,
        v_max_expiry
    FROM public.entitlement_grants
    WHERE agency_id = p_agency_id
      AND entitlement_id = p_entitlement_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now());

    IF v_active_grants > 0 THEN
        v_new_status := 'active';
        IF v_has_lifetime THEN
            v_new_expiry := NULL; -- Lifetime access
        ELSE
            v_new_expiry := v_max_expiry;
        END IF;
    ELSE
        -- No active grants. Check if any expired vs revoked
        IF EXISTS (
            SELECT 1 FROM public.entitlement_grants
            WHERE agency_id = p_agency_id
              AND entitlement_id = p_entitlement_id
              AND (status = 'expired' OR (status = 'active' AND expires_at <= now()))
        ) THEN
            v_new_status := 'expired';
        ELSE
            v_new_status := 'revoked';
        END IF;
        v_new_expiry := now();
    END IF;

    -- Update parent student_entitlements
    UPDATE public.student_entitlements
    SET status = v_new_status,
        expires_at = v_new_expiry
    WHERE agency_id = p_agency_id
      AND id = p_entitlement_id;

    RETURN v_new_status;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. AUTHORITATIVE SERVER CHECKOUT RPC
-- Derives all prices, banks, and course links authoritatively on the server.
-- Browser-provided prices, banks, or offering links are strictly ignored.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.checkout_agency_offering(
    p_agency_id UUID,
    p_membership_id UUID,
    p_offering_id UUID,
    p_bank_account_id UUID,
    p_idempotency_order_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_agency_slug TEXT;
    v_membership_status TEXT;
    v_customer_name TEXT;
    v_customer_phone TEXT;
    v_offering_price BIGINT;
    v_offering_sale_price BIGINT;
    v_final_price BIGINT;
    v_offering_published BOOLEAN;
    v_bank_code TEXT;
    v_account_number TEXT;
    v_account_holder TEXT;
    v_bank_active BOOLEAN;
    v_order_id UUID;
    v_existing_status TEXT;
    v_transfer_content TEXT;
BEGIN
    -- 1. Validate agency
    SELECT slug INTO v_agency_slug
    FROM public.agencies
    WHERE id = p_agency_id AND status = 'active';

    IF v_agency_slug IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'agency_not_found', 'error', 'Agency not found or inactive');
    END IF;

    -- 2. Validate membership (must be active student or member)
    SELECT status, display_name, phone INTO v_membership_status, v_customer_name, v_customer_phone
    FROM public.agency_memberships
    WHERE agency_id = p_agency_id AND id = p_membership_id;

    IF v_membership_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'membership_not_found', 'error', 'Membership not found');
    END IF;

    IF v_membership_status <> 'active' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'membership_not_active', 'error', 'Membership is not active');
    END IF;

    -- 3. Authoritatively resolve offering and price from database
    SELECT price_vnd, sale_price_vnd, is_published INTO v_offering_price, v_offering_sale_price, v_offering_published
    FROM public.agency_offerings
    WHERE agency_id = p_agency_id AND id = p_offering_id;

    IF v_offering_price IS NULL OR NOT v_offering_published THEN
        RETURN jsonb_build_object('ok', false, 'code', 'offering_not_found', 'error', 'Offering not available');
    END IF;

    v_final_price := COALESCE(v_offering_sale_price, v_offering_price);

    -- 4. Authoritatively resolve bank account
    SELECT bank_code, account_number, account_holder, is_active
    INTO v_bank_code, v_account_number, v_account_holder, v_bank_active
    FROM public.agency_bank_accounts
    WHERE agency_id = p_agency_id AND id = p_bank_account_id;

    IF v_bank_code IS NULL OR NOT v_bank_active THEN
        RETURN jsonb_build_object('ok', false, 'code', 'bank_not_found', 'error', 'Selected bank destination is invalid or inactive');
    END IF;

    -- 5. Check idempotency: if order with this code already exists for this agency
    SELECT id, status INTO v_order_id, v_existing_status
    FROM public.agency_orders
    WHERE agency_id = p_agency_id AND order_code = p_idempotency_order_code;

    IF v_order_id IS NOT NULL THEN
        -- Return existing order snapshot idempotently
        RETURN jsonb_build_object(
            'ok', true,
            'idempotent', true,
            'order_id', v_order_id,
            'order_code', p_idempotency_order_code,
            'status', v_existing_status,
            'amount_vnd', v_final_price,
            'bank_code', v_bank_code,
            'account_number', v_account_number,
            'account_holder', v_account_holder
        );
    END IF;

    v_transfer_content := UPPER(v_agency_slug || ' ' || p_idempotency_order_code);

    -- 6. Insert order with immutable snapshot
    INSERT INTO public.agency_orders (
        agency_id,
        membership_id,
        offering_id,
        order_code,
        customer_name,
        customer_phone,
        total_amount_vnd,
        status,
        bank_account_id,
        snapshot_bank_code,
        snapshot_account_number,
        snapshot_account_holder,
        snapshot_transfer_content,
        snapshot_price_vnd
    ) VALUES (
        p_agency_id,
        p_membership_id,
        p_offering_id,
        p_idempotency_order_code,
        v_customer_name,
        COALESCE(v_customer_phone, ''),
        v_final_price,
        'pending',
        p_bank_account_id,
        v_bank_code,
        v_account_number,
        v_account_holder,
        v_transfer_content,
        v_final_price
    )
    RETURNING id INTO v_order_id;

    -- 7. Insert order items
    INSERT INTO public.order_items (
        agency_id,
        order_id,
        offering_id,
        price_vnd,
        quantity
    ) VALUES (
        p_agency_id,
        v_order_id,
        p_offering_id,
        v_final_price,
        1
    );

    RETURN jsonb_build_object(
        'ok', true,
        'idempotent', false,
        'order_id', v_order_id,
        'order_code', p_idempotency_order_code,
        'status', 'pending',
        'amount_vnd', v_final_price,
        'bank_code', v_bank_code,
        'account_number', v_account_number,
        'account_holder', v_account_holder,
        'transfer_content', v_transfer_content
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. ORDER APPROVAL & ENTITLEMENT GRANT RPC
-- Transactional, idempotent, multi-course bundle support.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_agency_order(
    p_agency_id UUID,
    p_order_id UUID,
    p_approved_by_membership_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status TEXT;
    v_membership_id UUID;
    v_offering_id UUID;
    v_course_rec RECORD;
    v_entitlement_id UUID;
    v_grants_created INT := 0;
BEGIN
    -- 1. Fetch and lock order
    SELECT status, membership_id, offering_id
    INTO v_order_status, v_membership_id, v_offering_id
    FROM public.agency_orders
    WHERE agency_id = p_agency_id AND id = p_order_id
    FOR UPDATE;

    IF v_order_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'order_not_found', 'error', 'Order not found in agency');
    END IF;

    -- Idempotency check: if already completed, return success immediately
    IF v_order_status = 'completed' THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'order_id', p_order_id, 'status', 'completed');
    END IF;

    IF v_order_status <> 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_order_status', 'error', 'Order is not in pending status');
    END IF;

    -- 2. Mark order completed
    UPDATE public.agency_orders
    SET status = 'completed',
        audit_notes = 'Approved by membership ' || p_approved_by_membership_id::text || ' at ' || now()::text,
        updated_at = now()
    WHERE agency_id = p_agency_id AND id = p_order_id;

    -- 3. For all canonical courses associated with this offering, grant entitlement
    FOR v_course_rec IN (
        SELECT canonical_course_id
        FROM public.agency_offering_items
        WHERE agency_id = p_agency_id AND offering_id = v_offering_id
    ) LOOP
        -- Upsert parent entitlement
        INSERT INTO public.student_entitlements (
            agency_id,
            membership_id,
            canonical_course_id,
            status
        ) VALUES (
            p_agency_id,
            v_membership_id,
            v_course_rec.canonical_course_id,
            'active'
        )
        ON CONFLICT (agency_id, membership_id, canonical_course_id)
        DO UPDATE SET status = 'active'
        RETURNING id INTO v_entitlement_id;

        -- Idempotently insert grant
        INSERT INTO public.entitlement_grants (
            agency_id,
            entitlement_id,
            source_type,
            source_reference_id,
            notes,
            status,
            granted_at
        ) VALUES (
            p_agency_id,
            v_entitlement_id,
            'order_purchase',
            p_order_id::text,
            'Purchase order ' || p_order_id::text,
            'active',
            now()
        )
        ON CONFLICT (agency_id, entitlement_id, source_type, source_reference_id)
        DO NOTHING;

        -- Recompute effective entitlement
        PERFORM public.recompute_effective_entitlement(p_agency_id, v_entitlement_id);

        v_grants_created := v_grants_created + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'idempotent', false,
        'order_id', p_order_id,
        'status', 'completed',
        'grants_created', v_grants_created
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. ORDER REFUND & GRANT REVOCATION RPC
-- Revokes purchase grants. If other grants exist (e.g. manual admin), access remains.
-- If no active grants remain, effective entitlement is revoked immediately.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_agency_order(
    p_agency_id UUID,
    p_order_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_status TEXT;
    v_entitlement_rec RECORD;
    v_revoked_count INT := 0;
BEGIN
    -- 1. Fetch and lock order
    SELECT status INTO v_order_status
    FROM public.agency_orders
    WHERE agency_id = p_agency_id AND id = p_order_id
    FOR UPDATE;

    IF v_order_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'order_not_found', 'error', 'Order not found in agency');
    END IF;

    -- Idempotency check: if already refunded, return success immediately
    IF v_order_status = 'refunded' THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'order_id', p_order_id, 'status', 'refunded');
    END IF;

    -- 2. Mark order refunded
    UPDATE public.agency_orders
    SET status = 'refunded',
        audit_notes = COALESCE(audit_notes, '') || ' | Refunded: ' || COALESCE(p_reason, 'No reason provided') || ' at ' || now()::text,
        updated_at = now()
    WHERE agency_id = p_agency_id AND id = p_order_id;

    -- 3. Revoke all grants originating from this order
    FOR v_entitlement_rec IN (
        WITH updated_rows AS (
            UPDATE public.entitlement_grants
            SET status = 'revoked',
                revoked_at = now(),
                revoked_reason = p_reason
            WHERE agency_id = p_agency_id
              AND source_type = 'order_purchase'
              AND source_reference_id = p_order_id::text
            RETURNING entitlement_id
        )
        SELECT DISTINCT entitlement_id FROM updated_rows
    ) LOOP
        -- Recompute parent entitlement
        PERFORM public.recompute_effective_entitlement(p_agency_id, v_entitlement_rec.entitlement_id);
        v_revoked_count := v_revoked_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'idempotent', false,
        'order_id', p_order_id,
        'status', 'refunded',
        'grants_revoked', v_revoked_count
    );
END;
$$;

-- Security grants
REVOKE ALL ON FUNCTION public.recompute_effective_entitlement(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.checkout_agency_offering(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_agency_order(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_agency_order(UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.checkout_agency_offering(UUID, UUID, UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_agency_order(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refund_agency_order(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_effective_entitlement(UUID, UUID) TO authenticated, service_role;
