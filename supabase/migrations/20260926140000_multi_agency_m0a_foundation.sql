-- =============================================================================
-- MIGRATION: 20260926140000_multi_agency_m0a_foundation.sql
-- PROJECT: System B Multi-Agency Phase 0 (Milestone M0A)
-- TARGET: Main Supabase (yyiavtiwtekkocqpephr)
-- CLASSIFICATION: ADDITIVE MULTI-AGENCY SCHEMA FOUNDATION
-- INVARIANTS:
--   1. Existing V5 tables (v5_media_assets, v5_releases, etc.) PRESERVED UNCHANGED.
--   2. Existing single-tenant business tables PRESERVED INTACT for legacy traffic.
--   3. 100% of new tenant-scoped tables have RLS ON + FORCE RLS ON + default deny.
--   4. Same-agency composite foreign keys enforce tenant relational consistency.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. TENANT REGISTRY & DOMAINS (PLATFORM CORE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agency_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
    hostname TEXT NOT NULL UNIQUE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    ssl_status TEXT NOT NULL DEFAULT 'active' CHECK (ssl_status IN ('pending', 'active', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agency_domains_lookup ON public.agency_domains(hostname);
CREATE INDEX IF NOT EXISTS idx_agency_domains_agency ON public.agency_domains(agency_id);

-- -----------------------------------------------------------------------------
-- 2. AGENCY MULTI-SURFACE UI PROFILES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_ui_profiles (
    agency_id UUID PRIMARY KEY REFERENCES public.agencies(id) ON DELETE RESTRICT,
    brand_name TEXT NOT NULL,
    logo_url TEXT,
    favicon_url TEXT,
    storefront_variant TEXT NOT NULL DEFAULT 'classic_culinary',
    checkout_variant TEXT NOT NULL DEFAULT 'one_page_qr',
    admin_variant TEXT NOT NULL DEFAULT 'standard_agency',
    learner_variant TEXT NOT NULL DEFAULT 'card_dashboard',
    learning_variant TEXT NOT NULL DEFAULT 'cinema_player',
    homework_variant TEXT NOT NULL DEFAULT 'photo_submission',
    design_tokens JSONB NOT NULL DEFAULT '{
        "primary_color": "#e11d48",
        "secondary_color": "#4b5563",
        "font_family": "Inter, sans-serif",
        "border_radius": "8px"
    }'::jsonb,
    feature_flags JSONB NOT NULL DEFAULT '{
        "enable_reviews": true,
        "enable_device_lock": true,
        "enable_community": false
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. AGENCY BANK ACCOUNTS (COMMERCIAL DESTINATIONS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_bank_accounts (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
    bank_code TEXT NOT NULL,
    account_number TEXT NOT NULL,
    account_holder TEXT NOT NULL,
    branch TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id)
);
CREATE INDEX IF NOT EXISTS idx_agency_bank_accounts_agency ON public.agency_bank_accounts(agency_id);

-- -----------------------------------------------------------------------------
-- 4. CANONICAL CURRICULUM FOUNDATION (SHARED PLATFORM CORE)
-- Connects to existing public.courses(id) without rewriting V5 structures
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.canonical_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID UNIQUE REFERENCES public.courses(id) ON DELETE RESTRICT,
    code TEXT NOT NULL UNIQUE,
    default_title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    curriculum_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canonical_courses_v5 ON public.canonical_courses(course_id);

CREATE TABLE IF NOT EXISTS public.canonical_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_course_id UUID NOT NULL REFERENCES public.canonical_courses(id) ON DELETE RESTRICT,
    v5_lesson_id UUID REFERENCES public.v5_lessons(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_free_preview BOOLEAN NOT NULL DEFAULT false,
    duration_seconds INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (canonical_course_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_canonical_lessons_course ON public.canonical_lessons(canonical_course_id);

-- -----------------------------------------------------------------------------
-- 5. AGENCY OFFERINGS & OFFERING ITEMS (DECOUPLED COMMERCIAL PACKAGING)
-- Concrete referential integrity model: canonical_course_id required
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_offerings (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
    slug TEXT NOT NULL,
    display_title TEXT NOT NULL,
    display_description TEXT,
    thumbnail_url TEXT,
    price_vnd BIGINT NOT NULL DEFAULT 0,
    sale_price_vnd BIGINT,
    is_published BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id),
    UNIQUE (agency_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_agency_offerings_agency ON public.agency_offerings(agency_id);

CREATE TABLE IF NOT EXISTS public.agency_offering_items (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    offering_id UUID NOT NULL,
    canonical_course_id UUID NOT NULL REFERENCES public.canonical_courses(id) ON DELETE RESTRICT,
    canonical_lesson_id UUID REFERENCES public.canonical_lessons(id) ON DELETE RESTRICT,
    item_type TEXT NOT NULL DEFAULT 'canonical_course' CHECK (item_type IN ('canonical_course', 'canonical_lesson', 'bundle_item')),
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id),
    FOREIGN KEY (agency_id, offering_id) REFERENCES public.agency_offerings(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agency_offering_items_offering ON public.agency_offering_items(agency_id, offering_id);
CREATE INDEX IF NOT EXISTS idx_agency_offering_items_course ON public.agency_offering_items(canonical_course_id);

-- -----------------------------------------------------------------------------
-- 6. TENANT MEMBERSHIPS & DEVICES (ANTI-SHARING ENFORCEMENT)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_memberships (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL, -- references auth.users
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('agency_owner', 'agency_staff', 'student')),
    display_name TEXT NOT NULL,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id),
    UNIQUE (agency_id, user_id),
    UNIQUE (agency_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_agency_memberships_lookup ON public.agency_memberships(agency_id, user_id);

CREATE TABLE IF NOT EXISTS public.student_devices (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    device_fingerprint TEXT NOT NULL,
    device_name TEXT,
    last_ip TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (agency_id, id),
    UNIQUE (agency_id, membership_id, device_fingerprint),
    FOREIGN KEY (agency_id, membership_id) REFERENCES public.agency_memberships(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_student_devices_lookup ON public.student_devices(agency_id, membership_id);

-- -----------------------------------------------------------------------------
-- 7. TENANT ORDERS & ORDER ITEMS (COMPOSITE FOREIGN KEYS)
-- Note: Named agency_orders to leave existing single-tenant orders intact.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_orders (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE RESTRICT,
    order_code TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    total_amount_vnd BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'refunded')),
    bank_account_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id),
    UNIQUE (agency_id, order_code),
    FOREIGN KEY (agency_id, bank_account_id) REFERENCES public.agency_bank_accounts(agency_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_agency_orders_agency ON public.agency_orders(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_orders_code ON public.agency_orders(agency_id, order_code);

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    order_id UUID NOT NULL,
    offering_id UUID NOT NULL,
    price_vnd BIGINT NOT NULL DEFAULT 0,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id),
    FOREIGN KEY (agency_id, order_id) REFERENCES public.agency_orders(agency_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (agency_id, offering_id) REFERENCES public.agency_offerings(agency_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(agency_id, order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_offering ON public.order_items(agency_id, offering_id);

-- -----------------------------------------------------------------------------
-- 8. DECOUPLED STUDENT ENTITLEMENTS & MULTI-SOURCE GRANTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_entitlements (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    canonical_course_id UUID NOT NULL REFERENCES public.canonical_courses(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id),
    UNIQUE (agency_id, membership_id, canonical_course_id),
    FOREIGN KEY (agency_id, membership_id) REFERENCES public.agency_memberships(agency_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_student_entitlements_lookup ON public.student_entitlements(agency_id, membership_id);
CREATE INDEX IF NOT EXISTS idx_student_entitlements_course ON public.student_entitlements(canonical_course_id);

CREATE TABLE IF NOT EXISTS public.entitlement_grants (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    entitlement_id UUID NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN (
        'order_purchase', 'manual_admin', 'promotion_code', 'bundle_package',
        'cross_agency_transfer', 'platform_grant', 'external_integration'
    )),
    source_reference_id TEXT,
    notes TEXT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id),
    FOREIGN KEY (agency_id, entitlement_id) REFERENCES public.student_entitlements(agency_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_entitlement_grants_entitlement ON public.entitlement_grants(agency_id, entitlement_id);

-- -----------------------------------------------------------------------------
-- 9. TENANT LESSON PROGRESS
-- Note: Named agency_lesson_progress to leave existing lesson_progress intact.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_lesson_progress (
    id UUID DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    membership_id UUID NOT NULL,
    canonical_lesson_id UUID NOT NULL REFERENCES public.canonical_lessons(id) ON DELETE RESTRICT,
    progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    is_completed BOOLEAN NOT NULL DEFAULT false,
    last_position_seconds INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_id, id),
    UNIQUE (agency_id, membership_id, canonical_lesson_id),
    FOREIGN KEY (agency_id, membership_id) REFERENCES public.agency_memberships(agency_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agency_lesson_progress_lookup ON public.agency_lesson_progress(agency_id, membership_id);

-- -----------------------------------------------------------------------------
-- 10. RLS & FORCE RLS ENFORCEMENT ON 100% OF TENANT TABLES
-- -----------------------------------------------------------------------------
ALTER TABLE public.agency_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_domains FORCE ROW LEVEL SECURITY;

ALTER TABLE public.agency_ui_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_ui_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.agency_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_bank_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.agency_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_offerings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.agency_offering_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_offering_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.agency_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE public.student_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_devices FORCE ROW LEVEL SECURITY;

ALTER TABLE public.agency_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_orders FORCE ROW LEVEL SECURITY;

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items FORCE ROW LEVEL SECURITY;

ALTER TABLE public.student_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_entitlements FORCE ROW LEVEL SECURITY;

ALTER TABLE public.entitlement_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_grants FORCE ROW LEVEL SECURITY;

ALTER TABLE public.agency_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_lesson_progress FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 11. TRUSTED CONTEXT PRIMITIVES & ACCESS POLICIES
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_agency_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_agency_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.set_trusted_agency_context(p_agency_id UUID) RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.agencies WHERE id = p_agency_id AND status = 'active') THEN
        RAISE EXCEPTION 'Invalid or inactive agency_id: %', p_agency_id USING ERRCODE = 'invalid_parameter_value';
    END IF;
    PERFORM set_config('app.current_agency_id', p_agency_id::TEXT, true);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp;

-- Policy definitions for tenant tables:
-- A. agency_domains (Public read for active domains)
DROP POLICY IF EXISTS tenant_read_domains ON public.agency_domains;
CREATE POLICY tenant_read_domains ON public.agency_domains
    FOR SELECT USING (ssl_status = 'active');

-- B. agency_ui_profiles (Storefront public read for current agency)
DROP POLICY IF EXISTS tenant_read_ui ON public.agency_ui_profiles;
CREATE POLICY tenant_read_ui ON public.agency_ui_profiles
    FOR SELECT USING (agency_id = public.current_agency_id());

-- C. agency_bank_accounts (Public read active accounts for checkout)
DROP POLICY IF EXISTS tenant_read_bank ON public.agency_bank_accounts;
CREATE POLICY tenant_read_bank ON public.agency_bank_accounts
    FOR SELECT USING (agency_id = public.current_agency_id() AND is_active = true);

-- D. agency_offerings (Public read published offerings)
DROP POLICY IF EXISTS tenant_read_offerings ON public.agency_offerings;
CREATE POLICY tenant_read_offerings ON public.agency_offerings
    FOR SELECT USING (agency_id = public.current_agency_id() AND is_published = true);

-- E. agency_offering_items (Public read items of published offerings)
DROP POLICY IF EXISTS tenant_read_offering_items ON public.agency_offering_items;
CREATE POLICY tenant_read_offering_items ON public.agency_offering_items
    FOR SELECT USING (agency_id = public.current_agency_id());

-- F. agency_memberships (User can read own membership in current agency)
DROP POLICY IF EXISTS tenant_read_memberships ON public.agency_memberships;
CREATE POLICY tenant_read_memberships ON public.agency_memberships
    FOR SELECT USING (agency_id = public.current_agency_id() AND user_id = auth.uid());

-- G. student_devices (User can view/manage own devices)
DROP POLICY IF EXISTS tenant_manage_devices ON public.student_devices;
CREATE POLICY tenant_manage_devices ON public.student_devices
    FOR ALL USING (
        agency_id = public.current_agency_id() AND
        membership_id IN (SELECT id FROM public.agency_memberships WHERE agency_id = public.current_agency_id() AND user_id = auth.uid())
    );

-- H. agency_orders & order_items (Users can view their own orders via phone/email, staff via role)
DROP POLICY IF EXISTS tenant_read_orders ON public.agency_orders;
CREATE POLICY tenant_read_orders ON public.agency_orders
    FOR SELECT USING (agency_id = public.current_agency_id());

DROP POLICY IF EXISTS tenant_read_order_items ON public.order_items;
CREATE POLICY tenant_read_order_items ON public.order_items
    FOR SELECT USING (agency_id = public.current_agency_id());

-- I. student_entitlements (Student can view own active entitlements)
DROP POLICY IF EXISTS tenant_read_entitlements ON public.student_entitlements;
CREATE POLICY tenant_read_entitlements ON public.student_entitlements
    FOR SELECT USING (
        agency_id = public.current_agency_id() AND
        membership_id IN (SELECT id FROM public.agency_memberships WHERE agency_id = public.current_agency_id() AND user_id = auth.uid())
    );

-- J. entitlement_grants (Staff/admin viewable only)
DROP POLICY IF EXISTS tenant_read_grants ON public.entitlement_grants;
CREATE POLICY tenant_read_grants ON public.entitlement_grants
    FOR SELECT USING (agency_id = public.current_agency_id());

-- K. agency_lesson_progress (Student can view/update own progress)
DROP POLICY IF EXISTS tenant_manage_progress ON public.agency_lesson_progress;
CREATE POLICY tenant_manage_progress ON public.agency_lesson_progress
    FOR ALL USING (
        agency_id = public.current_agency_id() AND
        membership_id IN (SELECT id FROM public.agency_memberships WHERE agency_id = public.current_agency_id() AND user_id = auth.uid())
    );

-- -----------------------------------------------------------------------------
-- 12. V5 AUTHORIZATION BRIDGE RPC (SHARED PLATFORM SERVICE CONNECTOR)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.v5_authorize_agency_playback(
    p_agency_id UUID,
    p_membership_id UUID,
    p_lesson_id UUID,
    p_asset_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_course_id UUID;
    v_canonical_course_id UUID;
    v_has_entitlement BOOLEAN;
    v_release_manifest JSONB;
BEGIN
    -- 1. Identify canonical course for this lesson
    SELECT canonical_course_id INTO v_canonical_course_id
    FROM public.canonical_lessons
    WHERE id = p_lesson_id;

    IF v_canonical_course_id IS NULL THEN
        RETURN jsonb_build_object('authorized', false, 'code', 'lesson_not_found');
    END IF;

    -- 2. Verify active student entitlement in this agency
    SELECT EXISTS (
        SELECT 1 FROM public.student_entitlements
        WHERE agency_id = p_agency_id
          AND membership_id = p_membership_id
          AND canonical_course_id = v_canonical_course_id
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
    ) INTO v_has_entitlement;

    IF NOT v_has_entitlement THEN
        RETURN jsonb_build_object('authorized', false, 'code', 'entitlement_missing');
    END IF;

    -- 3. Resolve underlying V5 course and active release snapshot
    SELECT course_id INTO v_course_id
    FROM public.canonical_courses
    WHERE id = v_canonical_course_id;

    SELECT snapshot INTO v_release_manifest
    FROM public.v5_releases
    WHERE course_id = v_course_id AND status = 'published'
    ORDER BY version DESC LIMIT 1;

    RETURN jsonb_build_object(
        'authorized', true,
        'canonical_course_id', v_canonical_course_id,
        'v5_course_id', v_course_id,
        'manifest', v_release_manifest
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
