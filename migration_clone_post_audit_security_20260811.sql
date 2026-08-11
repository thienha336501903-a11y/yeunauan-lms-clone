-- Clone post-audit security migration
-- Applied to Supabase Clone yyiavtiwtekkocqpephr on 2026-08-11.
-- No secret values are read or changed by this migration.

begin;

-- site_config stores server-side configuration, including Drive credential rows.
-- Clone backends use service_role; browser roles must not read this table.
drop policy if exists site_config_public_select on public.site_config;
revoke select on table public.site_config from anon, authenticated;

-- The RLS auto-enable event-trigger helper is SECURITY DEFINER and should not
-- be callable by browser-facing database roles.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon, authenticated;

commit;
