-- 007: job documentation. Photos, sketches and updates (internal notes + customer progress updates).
-- Run after 001-006. Safe to run twice.
--
-- Who can do what (same rule everywhere): office and owner on every job, a tech on jobs they are
-- scheduled on. Photos are never hard-deleted by the app ("keep accessible indefinitely"): they are
-- archived, and only the owner could remove a row by hand.

-- ------------------------------------------------------------------ helper
create or replace function public.can_access_job(j uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_office_or_owner() or public.tech_assigned_to_job(j)
$$;

-- --------------------------------------------------------------- sketches
-- One job can have several sketches (for example "Main floor" and "Basement"). The drawing itself
-- is one JSON document: {"v":1,"rooms":[...],"marks":[...]}, measured in feet.
create table if not exists public.job_sketches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  name text not null default 'Sketch' check (length(btrim(name)) between 1 and 60),
  plan jsonb not null default '{"v":1,"rooms":[],"marks":[]}'::jsonb check (octet_length(plan::text) <= 600000),
  sort_order int not null default 0,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  updated_by uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_sketches_job_idx on public.job_sketches (job_id, sort_order, created_at);

-- ----------------------------------------------------------------- photos
-- The row id is chosen by the phone, and the files are named from it, so a retried upload can never
-- create a second copy. The file paths are forced to match the id (see the insert policy).
create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null default 'during' check (kind in ('before', 'during', 'after', 'damage', 'other')),
  caption text not null default '' check (length(caption) <= 500),
  storage_path text not null,
  thumb_path text,
  width int,
  height int,
  bytes int,
  sketch_id uuid references public.job_sketches (id) on delete set null,
  room_key text,                                   -- a room's id inside the sketch's JSON
  derived_from uuid references public.job_photos (id) on delete set null,   -- set on a marked-up copy
  taken_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.staff_users (id) on delete set null
);
create index if not exists job_photos_job_idx on public.job_photos (job_id, taken_at desc);
create index if not exists job_photos_room_idx on public.job_photos (sketch_id, room_key) where room_key is not null;

-- ---------------------------------------------------------------- updates
-- kind 'internal': a quick staff note, posted at once, never visible to customers.
-- kind 'progress': a customer-facing update. Saved as a draft, then sent (by the server) to the
--   customer and the job's extra contacts as a link. Only a sent progress update can be read through
--   its link, and a sent update cannot be edited.
create table if not exists public.job_updates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('internal', 'progress')),
  category text not null default '',
  title text not null default '' check (length(title) <= 120),
  body text not null default '' check (length(body) <= 5000),
  next_steps text not null default '' check (length(next_steps) <= 2000),
  photo_ids uuid[] not null default '{}' check (cardinality(photo_ids) <= 40),
  status text not null default 'posted' check (status in ('posted', 'draft', 'sent')),
  share_token uuid not null unique default gen_random_uuid(),
  sent_at timestamptz,
  sent_by uuid references public.staff_users (id) on delete set null,
  delivery jsonb not null default '{}'::jsonb,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_updates_kind_status check (
    (kind = 'internal' and status = 'posted') or (kind = 'progress' and status in ('draft', 'sent'))
  ),
  constraint job_updates_has_content check (length(btrim(body)) > 0 or cardinality(photo_ids) > 0)
);
create index if not exists job_updates_job_idx on public.job_updates (job_id, created_at desc);

-- ------------------------------------------------------------------ guards
-- A signed-in browser may edit text, not identity or send state. The server (service role, no
-- auth.uid()) is the only thing that can mark an update sent.
create or replace function public.job_updates_guard()
returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.job_id <> old.job_id or new.kind <> old.kind or new.status <> old.status
       or new.share_token <> old.share_token or new.sent_at is distinct from old.sent_at
       or new.sent_by is distinct from old.sent_by or new.delivery <> old.delivery
       or new.view_count <> old.view_count or new.created_by is distinct from old.created_by then
      raise exception 'Those fields cannot be changed from here.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.job_photos_guard()
returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.job_id <> old.job_id or new.storage_path <> old.storage_path
       or new.thumb_path is distinct from old.thumb_path or new.created_by is distinct from old.created_by
       or new.derived_from is distinct from old.derived_from or new.taken_at <> old.taken_at then
      raise exception 'Those fields cannot be changed from here.';
    end if;
    if new.archived_at is distinct from old.archived_at then
      new.archived_by := case when new.archived_at is null then null else auth.uid() end;
    end if;
  end if;
  return new;
end $$;

create or replace function public.job_sketches_guard()
returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.job_id <> old.job_id or new.created_by is distinct from old.created_by then
      raise exception 'Those fields cannot be changed from here.';
    end if;
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists job_updates_guard on public.job_updates;
create trigger job_updates_guard before update on public.job_updates for each row execute function public.job_updates_guard();
drop trigger if exists job_photos_guard on public.job_photos;
create trigger job_photos_guard before update on public.job_photos for each row execute function public.job_photos_guard();
drop trigger if exists job_sketches_guard on public.job_sketches;
create trigger job_sketches_guard before update on public.job_sketches for each row execute function public.job_sketches_guard();

-- --------------------------------------------------------------------- RLS
alter table public.job_sketches enable row level security;
alter table public.job_photos enable row level security;
alter table public.job_updates enable row level security;

drop policy if exists job_sketches_select on public.job_sketches;
drop policy if exists job_sketches_insert on public.job_sketches;
drop policy if exists job_sketches_update on public.job_sketches;
drop policy if exists job_sketches_delete on public.job_sketches;
create policy job_sketches_select on public.job_sketches for select using (public.can_access_job(job_id));
create policy job_sketches_insert on public.job_sketches for insert
  with check (public.can_access_job(job_id) and created_by = auth.uid());
create policy job_sketches_update on public.job_sketches for update
  using (public.can_access_job(job_id)) with check (public.can_access_job(job_id));
create policy job_sketches_delete on public.job_sketches for delete using (public.is_office_or_owner());

drop policy if exists job_photos_select on public.job_photos;
drop policy if exists job_photos_insert on public.job_photos;
drop policy if exists job_photos_update on public.job_photos;
drop policy if exists job_photos_delete on public.job_photos;
create policy job_photos_select on public.job_photos for select using (public.can_access_job(job_id));
create policy job_photos_insert on public.job_photos for insert
  with check (
    public.can_access_job(job_id)
    and created_by = auth.uid()
    and storage_path = job_id::text || '/' || id::text || '.jpg'
    and (thumb_path is null or thumb_path = job_id::text || '/' || id::text || '_t.jpg')
  );
create policy job_photos_update on public.job_photos for update
  using (public.can_access_job(job_id)) with check (public.can_access_job(job_id));
create policy job_photos_delete on public.job_photos for delete using (public.current_staff_role() = 'owner');

drop policy if exists job_updates_select on public.job_updates;
drop policy if exists job_updates_insert on public.job_updates;
drop policy if exists job_updates_update on public.job_updates;
drop policy if exists job_updates_delete on public.job_updates;
create policy job_updates_select on public.job_updates for select using (public.can_access_job(job_id));
create policy job_updates_insert on public.job_updates for insert
  with check (
    public.can_access_job(job_id)
    and created_by = auth.uid()
    and ((kind = 'internal' and status = 'posted') or (kind = 'progress' and status = 'draft'))
  );
-- Own notes and drafts, or anything for office/owner, until it has been sent.
create policy job_updates_update on public.job_updates for update
  using (public.can_access_job(job_id) and status <> 'sent' and (public.is_office_or_owner() or created_by = auth.uid()))
  with check (public.can_access_job(job_id));
create policy job_updates_delete on public.job_updates for delete
  using (
    (public.is_office_or_owner() or (created_by = auth.uid() and public.can_access_job(job_id)))
    and status <> 'sent'
  );

-- ------------------------------------------------------------------ storage
-- Private bucket. Files are {job_id}/{photo_id}.jpg and {job_id}/{photo_id}_t.jpg. The browser may
-- read and add files for jobs it can access, nothing else: no overwrite, no delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.job_file_access(object_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  folder text := split_part(object_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_access_job(folder::uuid);
end $$;

drop policy if exists job_photo_files_select on storage.objects;
drop policy if exists job_photo_files_insert on storage.objects;
create policy job_photo_files_select on storage.objects for select
  using (bucket_id = 'job-photos' and public.job_file_access(name));
create policy job_photo_files_insert on storage.objects for insert
  with check (bucket_id = 'job-photos' and public.job_file_access(name));
