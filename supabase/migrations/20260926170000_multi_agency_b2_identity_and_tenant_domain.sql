-- Migration: 20260926170000_multi_agency_b2_identity_and_tenant_domain.sql
-- Description: System B Milestone B2 & B3 — Global Identity FK, Domain Lifecycle & Tenant Resolution RPC
-- Authoritative Plan: SYSTEM_B_MULTI_AGENCY_MASTER_IMPLEMENTATION_PLAN_V1_1.md
-- Target Database: Main Supabase (yyiavtiwtekkocqpephr)

-- 1. Membership Foreign Key to auth.users (Milestone B2.3)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'agency_memberships_user_id_fkey'
          AND conrelid = 'public.agency_memberships'::regclass
    ) THEN
        ALTER TABLE public.agency_memberships
            ADD CONSTRAINT agency_memberships_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
    END IF;
END;
$$;

-- Index on user_id for fast membership lookup across agencies
CREATE INDEX IF NOT EXISTS idx_agency_memberships_user_id 
    ON public.agency_memberships (user_id);

-- 2. Add domain administrative status to agency_domains (Milestone B3)
ALTER TABLE public.agency_domains 
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' 
    CHECK (status IN ('active', 'inactive', 'archived'));

CREATE INDEX IF NOT EXISTS idx_agency_domains_hostname_lookup
    ON public.agency_domains (hostname, status, ssl_status);

-- 3. Trusted Tenant Resolution RPC (Milestone B3)
CREATE OR REPLACE FUNCTION public.resolve_agency_domain(
    p_hostname TEXT
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'found', true,
        'agency_id', a.id,
        'agency_slug', a.slug,
        'agency_name', a.name,
        'agency_status', a.status,
        'domain_id', d.id,
        'hostname', d.hostname,
        'is_primary', d.is_primary,
        'ssl_status', d.ssl_status,
        'domain_status', d.status
    )
    FROM public.agency_domains d
    JOIN public.agencies a ON a.id = d.agency_id
    WHERE d.hostname = lower(trim(p_hostname))
      AND d.status = 'active'
      AND d.ssl_status = 'active'
      AND a.status = 'active'
    LIMIT 1;
$$;

-- Privilege configuration
REVOKE ALL ON FUNCTION public.resolve_agency_domain(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_agency_domain(TEXT) TO anon, authenticated, service_role;
