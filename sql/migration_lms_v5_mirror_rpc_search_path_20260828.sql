-- Forward-only search_path hardening for existing V5 Telegram mirror RPCs.
-- Do not rewrite the 2026-08-27 applied migration; pin the already-created
-- SECURITY DEFINER functions here before first real V5 Telegram-origin rollout.

alter function public.claim_v5_telegram_mirror_job(text)
  set search_path = pg_catalog, public;

alter function public.finish_v5_telegram_mirror_job(uuid,text,boolean,text,bigint,text,text)
  set search_path = pg_catalog, public;
