-- =============================================================================
-- Migration: 20260926210000_multi_agency_b5_order_model_and_lock_order_hardening.sql
-- Description: M0B.1 / Pre-M0C Remediation V2 Hardening:
--   1. Unique invariant on agency_offering_items (agency_id, offering_id, canonical_course_id)
--   2. B5 Order Model: Server-only bank selection, concurrent race-safe idempotency (catch unique_violation),
--      deterministic bundle item price apportioning (SUM(item prices) == order total),
--      lock offering during snapshot creation.
--   3. B5 Grant Lock Order: Unify approval and refund lock order to canonical_course_id ASC,
--      bounded deadlock (40P01) retry, strict refund state machine.
--   4. B7 Homework: Revoke direct table writes from authenticated/anon, drop write RLS policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. UNIQUE INVARIANT ON OFFERING ITEMS (PHASE 11)
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_offering_items_course 
ON public.agency_offering_items (agency_id, offering_id, canonical_course_id);

-- -----------------------------------------------------------------------------
-- 2. HARDENED checkout_agency_offering (PHASE 2)
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
    v_item_rec RECORD;
    v_item_idx INT := 0;
    v_base_item_price BIGINT;
    v_remainder_price BIGINT;
    v_line_price BIGINT;
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

    -- 3. Initial check for existing order (idempotency)
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

        -- Return the STORED snapshot (immutable retry)
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

    -- 4. 2E SNAPSHOT RACE: Lock offering row to ensure atomic consistent price and bundle snapshot
    SELECT price_vnd, sale_price_vnd, is_published 
    INTO v_offering_price, v_offering_sale_price, v_offering_published
    FROM public.agency_offerings
    WHERE agency_id = p_agency_id AND id = p_offering_id
    FOR SHARE;

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

    -- 5. 2A BANK SELECTION: Server-only derivation. Client authority completely removed.
    -- p_bank_account_id is ignored. Bank is strictly selected via trusted agency routing rule.
    SELECT id, bank_code, account_number, account_holder
    INTO v_bank_id, v_bank_code, v_account_number, v_account_holder
    FROM public.agency_bank_accounts
    WHERE agency_id = p_agency_id AND is_active = true
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;

    IF v_bank_code IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'bank_not_found', 'error', 'No active bank account configured for agency');
    END IF;

    v_transfer_content := UPPER(v_agency_slug || ' ' || p_idempotency_order_code);

    -- 6. 2B CONCURRENT IDEMPOTENT CHECKOUT: Race-safe INSERT with unique_violation catch
    BEGIN
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
    EXCEPTION WHEN unique_violation THEN
        -- Race condition: another concurrent checkout inserted with same (agency_id, order_code)
        SELECT id, membership_id, offering_id, status, snapshot_price_vnd, snapshot_bank_code,
               snapshot_account_number, snapshot_account_holder, snapshot_transfer_content
        INTO v_existing_order
        FROM public.agency_orders
        WHERE agency_id = p_agency_id AND order_code = p_idempotency_order_code;

        IF v_existing_order.id IS NULL THEN
            RAISE; -- Re-raise if unexpected constraint
        END IF;

        -- Verify ownership strictly
        IF v_existing_order.membership_id <> p_membership_id OR v_existing_order.offering_id <> p_offering_id THEN
            RETURN jsonb_build_object(
                'ok', false,
                'code', 'idempotency_ownership_conflict',
                'error', 'Order code already exists for a different member or offering'
            );
        END IF;

        -- Return the existing order stored snapshot
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
    END;

    -- 7. 2D BUNDLE ITEM PRICE APPORTIONING:
    -- Representation rule: Deterministic integer division where SUM(item price_vnd) == order total.
    -- First item absorbs any rounding remainder.
    v_base_item_price := v_final_price / v_item_count;
    v_remainder_price := v_final_price - (v_base_item_price * v_item_count);

    FOR v_item_rec IN (
        SELECT canonical_course_id
        FROM public.agency_offering_items
        WHERE agency_id = p_agency_id
          AND offering_id = p_offering_id
          AND item_type = 'canonical_course'
        ORDER BY canonical_course_id ASC
    ) LOOP
        v_item_idx := v_item_idx + 1;
        IF v_item_idx = 1 THEN
            v_line_price := v_base_item_price + v_remainder_price;
        ELSE
            v_line_price := v_base_item_price;
        END IF;

        INSERT INTO public.order_items (
            agency_id,
            order_id,
            offering_id,
            canonical_course_id,
            canonical_item_type,
            price_vnd,
            quantity
        ) VALUES (
            p_agency_id,
            v_order_id,
            p_offering_id,
            v_item_rec.canonical_course_id,
            'canonical_course',
            v_line_price,
            1
        );
    END LOOP;

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
-- 3. HARDENED approve_agency_order WITH DETERMINISTIC LOCK ORDER (PHASE 3)
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
    v_retry_count INT := 0;
BEGIN
    -- Bounded deadlock retry loop (SQLSTATE 40P01 only)
    LOOP
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
            -- DETERMINISTIC LOCK ORDER: Always order by canonical_course_id ASC
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

                -- Lock parent entitlement row explicitly in canonical_course_id order
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

            -- Execution succeeded, exit retry loop
            EXIT;
        EXCEPTION WHEN deadlock_detected THEN
            v_retry_count := v_retry_count + 1;
            IF v_retry_count >= 3 THEN
                RAISE;
            END IF;
            PERFORM pg_sleep(0.05 * v_retry_count);
        END;
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
-- 4. HARDENED refund_agency_order WITH MATCHING LOCK ORDER (PHASE 3)
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
    v_retry_count INT := 0;
BEGIN
    -- Bounded deadlock retry loop (SQLSTATE 40P01 only)
    LOOP
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

            -- 3. MATCHING LOCK ORDER: Order entitlements by canonical_course_id ASC
            -- Exactly matches the lock acquisition order in approve_agency_order to prevent deadlocks!
            FOR v_entitlement_rec IN (
                SELECT DISTINCT eg.entitlement_id, se.canonical_course_id
                FROM public.entitlement_grants eg
                JOIN public.student_entitlements se ON se.id = eg.entitlement_id AND se.agency_id = eg.agency_id
                WHERE eg.agency_id = p_agency_id
                  AND eg.source_type = 'order_purchase'
                  AND eg.source_reference_id = p_order_id::text
                ORDER BY se.canonical_course_id ASC
            ) LOOP
                -- Lock parent entitlement row in canonical_course_id order FIRST
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

            -- Succeeded, exit retry loop
            EXIT;
        EXCEPTION WHEN deadlock_detected THEN
            v_retry_count := v_retry_count + 1;
            IF v_retry_count >= 3 THEN
                RAISE;
            END IF;
            PERFORM pg_sleep(0.05 * v_retry_count);
        END;
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
-- 5. HARDENED HOMEWORK ACL & RLS (PHASE 7A & 7D)
-- -----------------------------------------------------------------------------
-- Revoke direct table writes from authenticated and anon
REVOKE INSERT, UPDATE, DELETE ON TABLE public.agency_homework_submissions FROM authenticated, anon, PUBLIC;

-- Drop write RLS policies; all writes MUST go through verified server-side path
DROP POLICY IF EXISTS tenant_insert_homework ON public.agency_homework_submissions;
DROP POLICY IF EXISTS tenant_update_homework ON public.agency_homework_submissions;

-- Maintain strict SELECT policy bound to auth.uid()
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
