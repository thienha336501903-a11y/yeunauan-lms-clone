-- =============================================================================
-- Migration: 20260926203000_multi_agency_m0b1_fix_checkout_offering_column.sql
-- Description: Align checkout_agency_offering to select aoi.canonical_course_id
-- =============================================================================

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
        aoi.canonical_course_id,
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
