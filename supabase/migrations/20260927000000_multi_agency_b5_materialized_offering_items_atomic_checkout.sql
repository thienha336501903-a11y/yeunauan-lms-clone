-- 20260927000000_multi_agency_b5_materialized_offering_items_atomic_checkout.sql
-- Milestone B5 / Pre-M0C Remediation V3 — Atomic Materialized Offering Item Snapshot
-- Fixes: B5 offering item snapshot race
-- Invariants:
--   1. Materialize exact canonical course IDs ONCE inside checkout transaction.
--   2. Item count is derived from the materialized set (no separate COUNT query).
--   3. order_items are populated strictly by iterating over the materialized array (zero second live table scan).
--   4. Empty bundle set fails closed with empty_offering_bundle before order creation.
--   5. SUM(item price_vnd) == order total guaranteed by integer division + remainder on first item.

CREATE OR REPLACE FUNCTION public.checkout_agency_offering(
    p_agency_id uuid,
    p_membership_id uuid,
    p_offering_id uuid,
    p_bank_account_id uuid, -- Ignored, derived server-side
    p_idempotency_order_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_agency_slug text;
    v_membership_status text;
    v_customer_name text;
    v_customer_phone text;
    v_offering_price bigint;
    v_offering_sale_price bigint;
    v_offering_published boolean;
    v_final_price bigint;
    v_bank_id uuid;
    v_bank_code text;
    v_account_number text;
    v_account_holder text;
    v_transfer_content text;
    v_order_id uuid;
    v_existing_order record;
    -- Materialized item set variables
    v_canonical_course_ids uuid[];
    v_item_count int;
    v_base_item_price bigint;
    v_remainder_price bigint;
    v_current_item_price bigint;
    v_course_id uuid;
    v_item_idx int;
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

    -- 4. 2E SNAPSHOT RACE: Lock offering row to ensure atomic consistent price snapshot
    SELECT price_vnd, sale_price_vnd, is_published 
    INTO v_offering_price, v_offering_sale_price, v_offering_published
    FROM public.agency_offerings
    WHERE agency_id = p_agency_id AND id = p_offering_id
    FOR SHARE;

    IF v_offering_price IS NULL OR NOT v_offering_published THEN
        RETURN jsonb_build_object('ok', false, 'code', 'offering_not_found', 'error', 'Offering not available');
    END IF;

    v_final_price := COALESCE(v_offering_sale_price, v_offering_price);

    -- 5. MATERIALIZE EXACT CANONICAL ITEM SET ONCE (Atomic snapshot, zero separate second reads)
    SELECT COALESCE(ARRAY_AGG(canonical_course_id ORDER BY canonical_course_id ASC), '{}'::uuid[])
    INTO v_canonical_course_ids
    FROM public.agency_offering_items
    WHERE agency_id = p_agency_id 
      AND offering_id = p_offering_id 
      AND item_type = 'canonical_course'
      AND canonical_course_id IS NOT NULL;

    v_item_count := COALESCE(cardinality(v_canonical_course_ids), 0);

    IF v_item_count = 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'empty_offering_bundle', 'error', 'Offering bundle contains no courses');
    END IF;

    -- 6. 2A BANK SELECTION: Server-only derivation. Client authority completely removed.
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

    -- 7. 2B CONCURRENT IDEMPOTENT CHECKOUT: Race-safe INSERT with unique_violation catch
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

    -- 8. 2D BUNDLE ITEM PRICE APPORTIONING:
    -- Created strictly from the materialized item set v_canonical_course_ids (NO second live query).
    -- Deterministic integer division where SUM(item price_vnd) == order total.
    v_base_item_price := v_final_price / v_item_count;
    v_remainder_price := v_final_price - (v_base_item_price * v_item_count);
    v_item_idx := 0;

    FOREACH v_course_id IN ARRAY v_canonical_course_ids LOOP
        v_item_idx := v_item_idx + 1;
        IF v_item_idx = 1 THEN
            v_current_item_price := v_base_item_price + v_remainder_price;
        ELSE
            v_current_item_price := v_base_item_price;
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
            v_course_id,
            'canonical_course',
            v_current_item_price,
            1
        );
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'order_code', p_idempotency_order_code,
        'status', 'pending',
        'amount_vnd', v_final_price,
        'bank_code', v_bank_code,
        'account_number', v_account_number,
        'account_holder', v_account_holder,
        'transfer_content', v_transfer_content,
        'item_count', v_item_count
    );
END;
$$;

-- Secure permissions: revoke from anon and authenticated, grant strictly to service_role
REVOKE ALL ON FUNCTION public.checkout_agency_offering(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_agency_offering(uuid, uuid, uuid, uuid, text) TO service_role;
