-- Migration: V5 Retire/Purge trigger-function privilege hardening
-- Purpose: trigger-only SECURITY DEFINER guards must not be callable as RPCs.
-- The triggers remain installed and continue to execute normally.

revoke all on function public.enforce_v5_retired_course_sale_lock() from public;
revoke all on function public.enforce_v5_retired_course_sale_lock() from anon;
revoke all on function public.enforce_v5_retired_course_sale_lock() from authenticated;
revoke all on function public.enforce_v5_retired_course_sale_lock() from service_role;

revoke all on function public.enforce_v5_archived_config_lock() from public;
revoke all on function public.enforce_v5_archived_config_lock() from anon;
revoke all on function public.enforce_v5_archived_config_lock() from authenticated;
revoke all on function public.enforce_v5_archived_config_lock() from service_role;
