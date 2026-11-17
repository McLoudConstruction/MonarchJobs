-- 018: photo capture details. Where and when a photo was taken (locked at the shutter), tags, a content hash to catch
-- the same picture added twice, a link from an "after" photo to its "before", and an optional full-size original.
-- Run after 001-017. Safe to run twice.
--
-- Rules kept here:
--   * taken_at (the phone's clock at the shutter) and created_at (the server's clock when it arrived) are both kept,
--     and neither can be changed from a signed-in browser. The same goes for the location, the hash and the files.
--   * Tags, room, folder and caption stay editable.
--   * Photos are still never deleted by the app; they are archived.
--   * The public pages (progress updates, customer page, adjuster link) pick their columns by name, so none of the
--     new columns (location, tags) can reach a customer.

alter table public.job_photos
  add column if not exists gps_lat double precision check (gps_lat between -90 and 90),
  add column if not exists gps_lng double precision check (gps_lng between -180 and 180),
  add column if not exists gps_accuracy_m real check (gps_accuracy_m >= 0),
  add column if not exists content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists tags text[] not null default '{}' check (cardinality(tags) <= 20),
  add column if not exists pair_of uuid references public.job_photos (id) on delete set null,
  add column if not exists original_path text,
  add column if not exists original_bytes int check (original_bytes >= 0);

alter table public.job_photos drop constraint if exists job_photos_gps_both;
alter table public.job_photos add constraint job_photos_gps_both check ((gps_lat is null) = (gps_lng is null));

create index if not exists job_photos_hash_idx on public.job_photos (job_id, content_hash) where content_hash is not null;
create index if not exists job_photos_tags_idx on public.job_photos using gin (tags);
create index if not exists job_photos_pair_idx on public.job_photos (pair_of) where pair_of is not null;

-- Business setting: keep the full-size original next to the web copy. Off by default (it uses more storage).
alter table public.settings add column if not exists keep_original_photos boolean not null default false;

-- ------------------------------------------------------------------ guard
create or replace function public.job_photos_guard()
returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.job_id <> old.job_id or new.storage_path <> old.storage_path
       or new.thumb_path is distinct from old.thumb_path or new.created_by is distinct from old.created_by
       or new.derived_from is distinct from old.derived_from or new.taken_at <> old.taken_at
       or new.created_at <> old.created_at
       or new.gps_lat is distinct from old.gps_lat or new.gps_lng is distinct from old.gps_lng
       or new.gps_accuracy_m is distinct from old.gps_accuracy_m
       or new.content_hash is distinct from old.content_hash
       or new.original_path is distinct from old.original_path or new.original_bytes is distinct from old.original_bytes
       or new.pair_of is distinct from old.pair_of then
      raise exception 'Those fields cannot be changed from here.';
    end if;
    if new.archived_at is distinct from old.archived_at then
      new.archived_by := case when new.archived_at is null then null else auth.uid() end;
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ insert policy
-- Same as before, plus the original file name must match the id when there is one.
drop policy if exists job_photos_insert on public.job_photos;
create policy job_photos_insert on public.job_photos for insert
  with check (
    public.can_access_job(job_id)
    and created_by = auth.uid()
    and storage_path = job_id::text || '/' || id::text || '.jpg'
    and (thumb_path is null or thumb_path = job_id::text || '/' || id::text || '_t.jpg')
    and (original_path is null or original_path = job_id::text || '/' || id::text || '_o.jpg')
    and (pair_of is null or exists (select 1 from public.job_photos b where b.id = pair_of and b.job_id = job_photos.job_id))
  );
