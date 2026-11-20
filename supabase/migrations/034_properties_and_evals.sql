-- 034: Properties and Evals (the Evals tab on the Leads page).
-- A property is an apartment complex or other managed site, with its property manager and maintenance supervisor contacts.
-- An eval is one multi-family carpet evaluation sheet (one per unit) kept against a property before any job exists; the sheet itself
-- is one JSON document (lib/evalSheet.js). Photos of the unit and of a paper copy go in their own private bucket.
-- Office and owner only. Run once in the Supabase SQL Editor.

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  address text not null default '' check (char_length(address) <= 200),
  manager_name text not null default '' check (char_length(manager_name) <= 80),
  manager_email text not null default '' check (char_length(manager_email) <= 120),
  manager_phone text not null default '' check (char_length(manager_phone) <= 30),
  maint_name text not null default '' check (char_length(maint_name) <= 80),
  maint_email text not null default '' check (char_length(maint_email) <= 120),
  maint_phone text not null default '' check (char_length(maint_phone) <= 30),
  notes text not null default '' check (char_length(notes) <= 600),
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists properties_name_uniq on public.properties (lower(btrim(name)));
drop trigger if exists properties_touch on public.properties;
create trigger properties_touch before update on public.properties
  for each row execute function public.touch_updated_at();

create table if not exists public.evals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete restrict,
  eval_date date,
  status text not null default 'todo' check (status in ('todo', 'done', 'quoted', 'converted')),
  total_cents integer not null default 0 check (total_cents >= 0),
  data jsonb not null default '{}'::jsonb,
  job_id uuid references public.jobs (id) on delete set null,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists evals_property_idx on public.evals (property_id, created_at);
create index if not exists evals_status_idx on public.evals (status);
drop trigger if exists evals_touch on public.evals;
create trigger evals_touch before update on public.evals
  for each row execute function public.touch_updated_at();

create table if not exists public.eval_photos (
  id uuid primary key default gen_random_uuid(),
  eval_id uuid not null references public.evals (id) on delete cascade,
  kind text not null default 'unit' check (kind in ('unit', 'paper')),   -- pictures of the unit, or of the filled-in paper copy
  storage_path text not null,
  thumb_path text not null,
  width integer,
  height integer,
  bytes integer,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists eval_photos_eval_idx on public.eval_photos (eval_id, created_at);

alter table public.properties enable row level security;
alter table public.evals enable row level security;
alter table public.eval_photos enable row level security;

-- properties: office and owner read, add and edit; nothing is deleted (an eval keeps pointing at its property)
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select using (public.is_office_or_owner());
drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert with check (public.is_office_or_owner());
drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- evals: a converted eval is locked (it became a work order); only the owner deletes
drop policy if exists evals_select on public.evals;
create policy evals_select on public.evals for select using (public.is_office_or_owner());
drop policy if exists evals_insert on public.evals;
create policy evals_insert on public.evals for insert with check (public.is_office_or_owner());
drop policy if exists evals_update on public.evals;
create policy evals_update on public.evals for update using (public.is_office_or_owner() and status <> 'converted') with check (public.is_office_or_owner());
drop policy if exists evals_delete on public.evals;
create policy evals_delete on public.evals for delete using (public.current_staff_role() = 'owner' and status <> 'converted');

-- photos follow the eval they belong to
drop policy if exists eval_photos_select on public.eval_photos;
create policy eval_photos_select on public.eval_photos for select using (public.is_office_or_owner());
drop policy if exists eval_photos_insert on public.eval_photos;
create policy eval_photos_insert on public.eval_photos for insert
  with check (public.is_office_or_owner() and exists (select 1 from public.evals e where e.id = eval_id and e.status <> 'converted'));
drop policy if exists eval_photos_delete on public.eval_photos;
create policy eval_photos_delete on public.eval_photos for delete
  using (public.is_office_or_owner() and exists (select 1 from public.evals e where e.id = eval_id and e.status <> 'converted'));

-- storage: a private bucket, files are {eval_id}/{photo_id}.jpg and {eval_id}/{photo_id}_t.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eval-photos', 'eval-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists eval_photo_files_select on storage.objects;
create policy eval_photo_files_select on storage.objects for select
  using (bucket_id = 'eval-photos' and public.is_office_or_owner());
drop policy if exists eval_photo_files_insert on storage.objects;
create policy eval_photo_files_insert on storage.objects for insert
  with check (bucket_id = 'eval-photos' and public.is_office_or_owner());
drop policy if exists eval_photo_files_delete on storage.objects;
create policy eval_photo_files_delete on storage.objects for delete
  using (bucket_id = 'eval-photos' and public.is_office_or_owner());
