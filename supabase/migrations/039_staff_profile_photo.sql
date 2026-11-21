-- Staff profile photo (Priority 3). Run after 038. Safe to run twice.
-- Each person sets their own picture from the account menu. Files live in the private `profile-photos` bucket as
-- {staff id}/{uuid}.jpg and are written by the server only; any signed-in staff member can see them (team screens only).
alter table public.staff_users add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 1048576, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_photo_files_select on storage.objects;
create policy profile_photo_files_select on storage.objects for select
  using (bucket_id = 'profile-photos' and public.is_staff());
-- no insert/update/delete policy: only the server (service role) writes these files

-- A person cannot point their picture at someone else's folder, and a browser cannot write the column at all
-- (the owner policy on staff_users still lets the owner edit rows; the check keeps the folder honest).
alter table public.staff_users drop constraint if exists staff_users_avatar_folder;
alter table public.staff_users add constraint staff_users_avatar_folder check (avatar_path is null or avatar_path like id::text || '/%');
