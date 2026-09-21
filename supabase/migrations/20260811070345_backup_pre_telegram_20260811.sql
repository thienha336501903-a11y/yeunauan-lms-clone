create schema if not exists backup_pre_telegram_20260811;

do $$
declare r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  loop
    execute format('create table backup_pre_telegram_20260811.%I (like public.%I including all)', r.tablename, r.tablename);
    execute format('insert into backup_pre_telegram_20260811.%I select * from public.%I', r.tablename, r.tablename);
  end loop;
end $$;

create table backup_pre_telegram_20260811._snapshot_manifest as
select now() as snapshot_at,
       'yyiavtiwtekkocqpephr'::text as project_ref,
       'f2b29045d168b697ac28a347f7a9fc7ecbe354cb'::text as commerce_main_sha,
       'b0e43cd876e368d99fb68d295c6002efaec0390e'::text as lms_main_sha;;
