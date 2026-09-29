-- =============================================================================
-- Migration: 20260926201000_multi_agency_m0b1_order_and_homework_hardening.sql
-- Description: M0B.1 Hardening - Snapshotted purchased items, deterministic entitlement lock order,
--              server bank derivation, idempotency ownership binding, refund state machine,
--              canonical lesson FK for homework, and identity-bound RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SCHEMA EXTENSIONS
-- -----------------------------------------------------------------------------

-- Add canonical course link to order items for immutable purchase snapshotting
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS canonical_course_id UUID REFERENCES public.canonical_courses(id) ON DELETE RESTRICT;

ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS canonical_item_type TEXT DEFAULT 'canonical_course';

-- Add canonical lesson FK to homework submissions
ALTER TABLE public.agency_homework_submissions
ADD COLUMN IF NOT EXISTS canonical_lesson_id UUID REFERENCES public.canonical_lessons(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_homework_canonical_lesson 
ON public.agency_homework_submissions(agency_id, canonical_lesson_id);

-- -----------------------------------------------------------------------------
-- 2. HARDENED HOMEWORK RLS (IDENTITY-BOUND VIA auth.uid())
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_select_homework ON public.agency_homework_submissions;
CREATE POLICY tenant_select_homework ON public.agency_homework_submissions
    FOR SELECT TO authenticated
    USING (
        membership_id IN (
            SELECT m.id FROM public.agency_memberships m
            WHERE m.user_id = auth.uid()
              AND m.agency_id = agency_homework_submissions.agency_id
              AND m.status = 'active'
        )
        OR EXISTS (
            SELECT 1 FROM public.agency_memberships m
            WHERE m.user_id = auth.uid()
              AND m.agency_id = agency_homework_submissions.agency_id
              AND m.status = 'active'
              AND m.role IN ('agency_staff', 'agency_owner')
        )
    );

DROP POLICY IF EXISTS tenant_insert_homework ON public.agency_homework_submissions;
CREATE POLICY tenant_insert_homework ON public.agency_homework_submissions
    FOR INSERT TO authenticated
    WITH CHECK (
        membership_id IN (
            SELECT m.id FROM public.agency_memberships m
            WHERE m.user_id = auth.uid()
              AND m.agency_id = agency_homework_submissions.agency_id
              AND m.status = 'active'
        )
    );

DROP POLICY IF EXISTS tenant_update_homework ON public.agency_homework_submissions;
CREATE POLICY tenant_update_homework ON public.agency_homework_submissions
    FOR UPDATE TO authenticated
    USING (
        (
            membership_id IN (
                SELECT m.id FROM public.agency_memberships m
                WHERE m.user_id = auth.uid()
                  AND m.agency_id = agency_homework_submissions.agency_id
                  AND m.status = 'active'
            )
            AND status IN ('draft', 'submitted')
        )
        OR EXISTS (
            SELECT 1 FROM public.agency_memberships m
            WHERE m.user_id = auth.uid()
              AND m.agency_id = agency_homework_submissions.agency_id
              AND m.status = 'active'
              AND m.role IN ('agency_staff', 'agency_owner')
        )
    );

-- -----------------------------------------------------------------------------
-- 3. HARDENED recompute_effective_entitlement WITH PARENT ROW LOCKING
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
    v_locked_id UUID;
    v_active_grants INT;
    v_max_expiry TIMESTAMPTZ;
    v_has_lifetime BOOLEAN;
    v_new_status TEXT;
    v_new_expiry TIMESTAMPTZ;
BEGIN
    -- 1. CRITICAL: Lock parent entitlement row FIRST to serialize concurrent operations
    SELECT id INTO v_locked_id
    FROM public.student_entitlements
    WHERE agency_id = p_agency_id AND id = p_entitlement_id
    FOR UPDATE;

    IF v_locked_id IS NULL THEN
        RETURN 'not_found';
    END IF;

    -- 2. Count active, non-expired grants
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
        -- Check if any expired vs revoked
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

    -- 3. Update parent student_entitlements
    UPDATE public.student_entitlements
    SET status = v_new_status,
        expires_at = v_new_expiry
    WHERE agency_id = p_agency_id
      AND id = p_entitlement_id;

    RETURN v_new_status;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_effective_entitlement(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_effective_entitlement(UUID, UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. HARDENED checkout_agency_offering (SERVER BANK DERIVATION, STORED RETRY SNAPSHOT)
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
    v_bank_id UUID;
    v_bank_code TEXT;
    v_account_number TEXT;
    v_account_holder TEXT;
    v_order_id UUID;
    v_transfer_content TEXT;
    v_existing_order RECORD;
    v_item_count INT;
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

    -- 3. Check idempotency: bound strictly to agency, buyer, and offering
    SELECT id, membership_id, offering_id, status, snapshot_price_vnd, snapshot_bank_code,
           snapshot_account_number, snapshot_account_holder, snapshot_transfer_content
    INTO v_existing_order
    FROM public.agency_orders
    WHERE agency_id = p_agency_id AND order_code = p_idempotency_order_code;

    IF v_existing_order.id IS NOT NULL THEN
        -- Ownership conflict check: Reused code for different buyer or offering fails closed
        IF v_existing_order.membership_id <> p_membership_id OR v_existing_order.offering_id <> p_offering_id THEN
            RETURN jsonb_build_object(
                'ok', false,
                'code', 'idempotency_ownership_conflict',
                'error', 'Order code already exists for a different member or offering'
            );
        END IF;

        -- Return the STORED snapshot (NOT today's recalculation)
        RETURN jsonb_build_object(
            'ok', true,
            'idempotent', true,
            'order_id', v_existing_order.id,
            'order_code', p_idempotency_order_code,
            'status', v_existing_order.status,
            'amount_vnd', v_existing_order.snapshot_price_vnd,
            'bank_code', v_existing_order.snapshot_bank_code,
            'account_number', v_existing_order.snapshot_account_number,
            'account_holder', v_existing_order.snapshot_account_holder,
            'transfer_content', v_existing_order.snapshot_transfer_content
        );
    END IF;

    -- 4. Authoritatively resolve offering and price from database
    SELECT price_vnd, sale_price_vnd, is_published INTO v_offering_price, v_offering_sale_price, v_offering_published
    FROM public.agency_offerings
    WHERE agency_id = p_agency_id AND id = p_offering_id;

    IF v_offering_price IS NULL OR NOT v_offering_published THEN
        RETURN jsonb_build_object('ok', false, 'code', 'offering_not_found', 'error', 'Offering not available');
    END IF;

    v_final_price := COALESCE(v_offering_sale_price, v_offering_price);

    -- Ensure offering has at least one canonical course item
    SELECT COUNT(*) INTO v_item_count
    FROM public.agency_offering_items
    WHERE agency_id = p_agency_id AND offering_id = p_offering_id AND item_type = 'canonical_course';

    IF v_item_count = 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'empty_offering_bundle', 'error', 'Offering bundle contains no courses');
    END IF;

    -- 5. Server-side bank routing rule: Derive active bank account authoritatively
    -- If p_bank_account_id is provided and valid/active, use it; otherwise select agency's active default bank
    IF p_bank_account_id IS NOT NULL THEN
        SELECT id, bank_code, account_number, account_holder
        INTO v_bank_id, v_bank_code, v_account_number, v_account_holder
        FROM public.agency_bank_accounts
        WHERE agency_id = p_agency_id AND id = p_bank_account_id AND is_active = true;
    END IF;

    IF v_bank_id IS NULL THEN
        SELECT id, bank_code, account_number, account_holder
        INTO v_bank_id, v_bank_code, v_account_number, v_account_holder
        FROM public.agency_bank_accounts
        WHERE agency_id = p_agency_id AND is_active = true
        ORDER BY is_default DESC, created_at ASC
        LIMIT 1;
    END IF;

    IF v_bank_code IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'bank_not_found', 'error', 'No active bank account configured for agency');
    END IF;

    v_transfer_content := UPPER(v_agency_slug || ' ' || p_idempotency_order_code);

    -- 6. Insert order with immutable financial snapshot
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
        v_bank_id,
        v_bank_code,
        v_account_number,
        v_account_holder,
        v_transfer_content,
        v_final_price
    ) RETURNING id INTO v_order_id;

    -- 7. Snapshot exact purchased canonical course items into order_items
    INSERT INTO public.order_items (
        agency_id,
        order_id,
        offering_id,
        canonical_course_id,
        canonical_item_type,
        price_vnd,
        quantity
    )
    SELECT
        p_agency_id,
        v_order_id,
        p_offering_id,
        aoi.canonical_id,
        'canonical_course',
        v_final_price,
        1
    FROM public.agency_offering_items aoi
    WHERE aoi.agency_id = p_agency_id
      AND aoi.offering_id = p_offering_id
      AND aoi.item_type = 'canonical_course';

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

REVOKE ALL ON FUNCTION public.checkout_agency_offering(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_agency_offering(UUID, UUID, UUID, UUID, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. HARDENED approve_agency_order (USES STORED ORDER_ITEMS, DETERMINISTIC LOCK ORDER)
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
    v_course_rec RECORD;
    v_entitlement_id UUID;
    v_grants_created INT := 0;
BEGIN
    -- 1. Fetch and lock order row
    SELECT status, membership_id
    INTO v_order_status, v_membership_id
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

    -- 3. Grant entitlement ONLY for the stored snapshotted items in order_items
    -- Ordered deterministically by canonical_course_id to prevent deadlock across concurrent orders
    FOR v_course_rec IN (
        SELECT canonical_course_id
        FROM public.order_items
        WHERE agency_id = p_agency_id
          AND order_id = p_order_id
          AND canonical_course_id IS NOT NULL
        ORDER BY canonical_course_id ASC
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

        -- Lock parent entitlement row explicitly
        PERFORM 1 FROM public.student_entitlements
        WHERE agency_id = p_agency_id AND id = v_entitlement_id
        FOR UPDATE;

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

        -- Recompute effective entitlement (parent row is already locked)
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

REVOKE ALL ON FUNCTION public.approve_agency_order(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_agency_order(UUID, UUID, UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. HARDENED refund_agency_order (STRICT REFUND STATE MACHINE & DETERMINISTIC LOCK ORDER)
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

    -- STRICT STATE MACHINE: Refund is ONLY permitted from 'completed' status
    IF v_order_status <> 'completed' THEN
        RETURN jsonb_build_object(
            'ok', false,
            'code', 'invalid_order_status',
            'error', 'Refund is only permitted for completed orders (current status: ' || v_order_status || ')'
        );
    END IF;

    -- 2. Mark order refunded
    UPDATE public.agency_orders
    SET status = 'refunded',
        audit_notes = COALESCE(audit_notes, '') || ' | Refunded: ' || COALESCE(p_reason, 'No reason provided') || ' at ' || now()::text,
        updated_at = now()
    WHERE agency_id = p_agency_id AND id = p_order_id;

    -- 3. Identify all distinct affected entitlements ordered deterministically
    FOR v_entitlement_rec IN (
        SELECT DISTINCT entitlement_id
        FROM public.entitlement_grants
        WHERE agency_id = p_agency_id
          AND source_type = 'order_purchase'
          AND source_reference_id = p_order_id::text
        ORDER BY entitlement_id ASC
    ) LOOP
        -- Lock parent entitlement row FIRST
        PERFORM 1 FROM public.student_entitlements
        WHERE agency_id = p_agency_id AND id = v_entitlement_rec.entitlement_id
        FOR UPDATE;

        -- Mutate grant to revoked
        UPDATE public.entitlement_grants
        SET status = 'revoked',
            revoked_at = now(),
            revoked_reason = p_reason
        WHERE agency_id = p_agency_id
          AND entitlement_id = v_entitlement_rec.entitlement_id
          AND source_type = 'order_purchase'
          AND source_reference_id = p_order_id::text;

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

REVOKE ALL ON FUNCTION public.refund_agency_order(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_agency_order(UUID, UUID, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 7. HARDENED submit_agency_homework (CANONICAL LESSON FK VALIDATION)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_agency_homework(
    p_agency_id UUID,
    p_membership_id UUID,
    p_canonical_course_id UUID,
    p_canonical_lesson_id UUID,
    p_title TEXT,
    p_content JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_entitlement BOOLEAN;
    v_lesson_course_id UUID;
    v_submission_id UUID;
BEGIN
    -- 1. Validate that the canonical lesson exists and belongs to the specified course
    SELECT canonical_course_id INTO v_lesson_course_id
    FROM public.canonical_lessons
    WHERE id = p_canonical_lesson_id;

    IF v_lesson_course_id IS NULL OR v_lesson_course_id <> p_canonical_course_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'lesson_course_mismatch',
            'error', 'Specified lesson does not exist or does not belong to specified canonical course'
        );
    END IF;

    -- 2. Verify active student entitlement in current agency
    SELECT EXISTS (
        SELECT 1 FROM public.student_entitlements
        WHERE agency_id = p_agency_id
          AND membership_id = p_membership_id
          AND canonical_course_id = p_canonical_course_id
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
    ) INTO v_has_entitlement;

    IF NOT v_has_entitlement THEN
        RETURN jsonb_build_object('success', false, 'code', 'entitlement_required', 'error', 'Active entitlement required');
    END IF;

    -- 3. Insert homework submission
    INSERT INTO public.agency_homework_submissions (
        agency_id,
        membership_id,
        canonical_course_id,
        canonical_lesson_id,
        lesson_id,
        submission_title,
        submission_content,
        status
    ) VALUES (
        p_agency_id,
        p_membership_id,
        p_canonical_course_id,
        p_canonical_lesson_id,
        p_canonical_lesson_id::text,
        p_title,
        COALESCE(p_content, '{}'::jsonb),
        'submitted'
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
        'success', true,
        'submission_id', v_submission_id,
        'status', 'submitted'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_agency_homework(UUID, UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_agency_homework(UUID, UUID, UUID, UUID, TEXT, JSONB) TO service_role;
