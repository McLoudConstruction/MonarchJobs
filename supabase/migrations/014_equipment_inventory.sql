-- 014: company-wide equipment inventory (assets). Run once, after 001 to 013.
--
-- One row per machine the company owns: air movers, dehumidifiers, scrubbers. Each has an asset number (printed on a label with a
-- QR code), a type, a model, a serial and an optional pints-per-day rating. While a machine is placed on a job's sketch, the app
-- keeps `status`, `job_id` and `unit_id` up to date, so the office can see where every machine is.
-- Assets are never deleted: a machine that is sold or scrapped is marked retired, so old job reports still make sense.

alter table public.settings add column if not exists asset_prefix text not null default 'EQ'
  check (asset_prefix ~ '^[A-Za-z0-9]{1,6}$');

create table if not exists public.equipment_assets (
  id uuid primary key default gen_random_uuid(),
  asset_no int generated always as identity,
  type text not null default 'other',                           -- a key of EQUIPMENT_TYPES in lib/equipment.js
  label text not null default '' check (length(label) <= 60),   -- make and model
  serial text not null default '' check (length(serial) <= 60),
  ppd int check (ppd is null or (ppd > 0 and ppd <= 999)),      -- a dehumidifier's rating in pints per day
  notes text not null default '' check (length(notes) <= 300),
  status text not null default 'available' check (status in ('available', 'on_job', 'repair', 'retired')),
  job_id uuid references public.jobs (id) on delete set null,   -- while status is on_job
  unit_id text,                                                 -- the unit's id inside that job's sketch
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index if not exists equipment_assets_no_idx on public.equipment_assets (asset_no);
create index if not exists equipment_assets_status_idx on public.equipment_assets (status);
create index if not exists equipment_assets_job_idx on public.equipment_assets (job_id) where job_id is not null;

create trigger equipment_assets_touch before update on public.equipment_assets
  for each row execute function public.touch_updated_at();

alter table public.equipment_assets enable row level security;
drop policy if exists equipment_assets_select on public.equipment_assets;
drop policy if exists equipment_assets_insert on public.equipment_assets;
drop policy if exists equipment_assets_update on public.equipment_assets;
create policy equipment_assets_select on public.equipment_assets for select using (public.is_staff());
create policy equipment_assets_insert on public.equipment_assets for insert
  with check (public.is_office_or_owner() and created_by = auth.uid());
-- any staff member can update, because placing a machine on a job (tech) changes its status; no policy deletes rows
create policy equipment_assets_update on public.equipment_assets for update
  using (public.is_staff()) with check (public.is_staff());
