begin;

drop policy if exists site_config_public_select on public.site_config;
revoke select on table public.site_config from anon, authenticated;

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon, authenticated;

commit;;
