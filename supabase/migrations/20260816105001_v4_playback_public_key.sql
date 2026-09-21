alter table public.lms_v4_media_tickets
  add column if not exists playback_public_key_jwk text;;
