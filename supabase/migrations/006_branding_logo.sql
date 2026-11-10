-- 006: business logo.
-- The logo file lives in a public Supabase Storage bucket (a logo is meant to be seen by customers on
-- their estimate page). Only server code can write to it (service role, owner only, see
-- /api/branding/logo), so no storage write policies are created: with RLS on, anon and signed-in
-- browsers cannot upload, replace or delete anything in the bucket.

alter table public.settings add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
