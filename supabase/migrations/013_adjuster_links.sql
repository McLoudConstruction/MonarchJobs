-- 013: read-only adjuster links. Run once, after 001 to 012.
--
-- An office user makes a link for a job and sends it to the carrier's adjuster. The page it opens shows the
-- drying (moisture readings by day, status by room), the equipment and the dehumidifier performance, read only.
-- It never shows staff names, notes or photos. The link stops working when it is revoked or expires.
-- The public page reads through the server (service key), so there is no public policy here.
create table if not exists public.adjuster_links (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  label text not null default '' check (length(label) <= 80),          -- who it is for, e.g. "State Farm, claim 123"
  expires_at timestamptz not null default (now() + interval '90 days'),
  revoked_at timestamptz,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0
);
create index if not exists adjuster_links_job_idx on public.adjuster_links (job_id, created_at desc);

alter table public.adjuster_links enable row level security;
drop policy if exists adjuster_links_select on public.adjuster_links;
drop policy if exists adjuster_links_insert on public.adjuster_links;
drop policy if exists adjuster_links_update on public.adjuster_links;
create policy adjuster_links_select on public.adjuster_links for select using (public.is_office_or_owner());
create policy adjuster_links_insert on public.adjuster_links for insert
  with check (public.is_office_or_owner() and created_by = auth.uid());
-- revoking or relabelling is an update; a link is never deleted, so the record of it stays
create policy adjuster_links_update on public.adjuster_links for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
