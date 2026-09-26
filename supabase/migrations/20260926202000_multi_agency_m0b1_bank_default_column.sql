-- =============================================================================
-- Migration: 20260926202000_multi_agency_m0b1_bank_default_column.sql
-- Description: Add is_default column to agency_bank_accounts for default bank routing
-- =============================================================================

ALTER TABLE public.agency_bank_accounts 
ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
