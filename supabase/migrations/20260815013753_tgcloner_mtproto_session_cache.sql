alter table public.tgcloner_settings
  add column if not exists mtproto_session_ciphertext text null;

comment on column public.tgcloner_settings.mtproto_session_ciphertext is
  'AES-256-GCM encrypted Teleproto StringSession for bot media cold-start reuse; decryption key stays in runtime environment.';;
