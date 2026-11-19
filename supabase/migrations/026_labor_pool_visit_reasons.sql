-- 026: the labor pool on the job clock, and a reason on every later visit (with go-backs logged against a tech).
-- Run after 025. Run it once, before deploying this push.
--
--   * labor_pool_people: a bucket of names for people who work a job but are not on the staff list (day labor, a borrowed crew).
--     These are NOT staff_users: no login, no pay rate, never matched against the staff list. Names repeat from job to job, so
--     they are kept here and offered as suggestions the next time. Anyone on staff can read the pool; the office and owner can
--     rename or retire a name. New names are added by the website when a form is signed.
--   * job_labor_certifications: one row per signed labor form. A staff member lists names and times and signs to certify them.
--     The signature is the staff member's, the time is the database's.
--   * job_labor_entries: one row per person per stretch of time on a signed form. An entry can be removed (voided) by the office
--     or owner; it stays on the record. Written by the website (service role); nobody changes it straight from a browser.
--   * job_visits.reason / reason_note: why a visit was added (a list of regular reasons, or "other" with typed words). Asked for on
--     every visit after the first one on a job.
--   * job_gobacks: when the reason is the tech's failure, the visit is also logged here against that tech. Office and owner only.
--   * add_job_visit(): adds the visit and its go-back in one step, so one never exists without the other.

-- ------------------------------------------------------------------- labor pool
create table public.labor_pool_people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 80),
  active boolean not null default true,
  created_by uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- one row per name, whatever the capitals or spacing
create unique index labor_pool_people_name_key on public.labor_pool_people (lower(btrim(name)));

alter table public.labor_pool_people enable row level security;
create policy labor_pool_people_select on public.labor_pool_people for select using (public.is_staff());
create policy labor_pool_people_update on public.labor_pool_people for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
-- no insert / delete policy: names are added by the website when a form is signed, and are retired (active = false), never deleted

create table public.job_labor_certifications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  certified_by uuid references public.staff_users (id) on delete set null,
  certifier_name text not null default '' check (char_length(certifier_name) <= 120),   -- who signed, as they were named then
  signature_png text not null,
  certified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index job_labor_certifications_job_idx on public.job_labor_certifications (job_id, certified_at desc);

create table public.job_labor_entries (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.job_labor_certifications (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  pool_person_id uuid references public.labor_pool_people (id) on delete set null,
  worker_name text not null check (btrim(worker_name) <> '' and char_length(worker_name) <= 80),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  voided_at timestamptz,
  void_reason text not null default '' check (char_length(void_reason) <= 300),
  voided_by uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint job_labor_entries_range check (ended_at > started_at and ended_at - started_at <= interval '24 hours')
);
create index job_labor_entries_job_idx on public.job_labor_entries (job_id, started_at);
create index job_labor_entries_cert_idx on public.job_labor_entries (certification_id);
create index job_labor_entries_pool_idx on public.job_labor_entries (pool_person_id);

alter table public.job_labor_certifications enable row level security;
alter table public.job_labor_entries enable row level security;
create policy job_labor_certifications_select on public.job_labor_certifications for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
create policy job_labor_entries_select on public.job_labor_entries for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
-- no write policies: forms and removals go through the website

-- ------------------------------------------------------------------- visit reasons
alter table public.job_visits
  add column if not exists reason text not null default '' check (char_length(reason) <= 40),
  add column if not exists reason_note text not null default '' check (char_length(reason_note) <= 300);

-- ------------------------------------------------------------------- go-backs
create table public.job_gobacks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  visit_id uuid references public.job_visits (id) on delete set null,   -- the visit added to put it right
  tech_id uuid not null references public.staff_users (id) on delete cascade,
  reason text not null check (char_length(reason) <= 40),
  reason_note text not null default '' check (char_length(reason_note) <= 300),
  logged_by uuid references public.staff_users (id) on delete set null,
  voided_at timestamptz,
  void_reason text not null default '' check (char_length(void_reason) <= 300),
  created_at timestamptz not null default now()
);
create index job_gobacks_tech_idx on public.job_gobacks (tech_id, created_at desc);
create index job_gobacks_job_idx on public.job_gobacks (job_id);

alter table public.job_gobacks enable row level security;
-- Office and owner only: a go-back is about a person's work, so other techs do not see it.
create policy job_gobacks_select on public.job_gobacks for select using (public.is_office_or_owner());
create policy job_gobacks_insert on public.job_gobacks for insert with check (public.is_office_or_owner());
create policy job_gobacks_update on public.job_gobacks for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- Adds a visit with its reason and, for a tech's failure, the go-back, in one step. Runs as the caller, so the same row rules
-- apply as when the website inserted visits directly. Returns the new visit's id.
create or replace function public.add_job_visit(
  p_job uuid,
  p_tech uuid,
  p_starts_at timestamptz,
  p_duration_minutes int,
  p_reason text default '',
  p_reason_note text default '',
  p_goback_tech uuid default null
)
returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  if not public.is_office_or_owner() then
    raise exception 'NOT_ALLOWED: only the office and owner can add visits';
  end if;
  if p_goback_tech is not null and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'GOBACK_NEEDS_REASON: a go-back needs a reason';
  end if;
  insert into public.job_visits (job_id, tech_id, starts_at, duration_minutes, created_by, reason, reason_note)
  values (p_job, p_tech, p_starts_at, p_duration_minutes, auth.uid(), coalesce(p_reason, ''), coalesce(p_reason_note, ''))
  returning id into v_id;
  if p_goback_tech is not null then
    insert into public.job_gobacks (job_id, visit_id, tech_id, reason, reason_note, logged_by)
    values (p_job, v_id, p_goback_tech, p_reason, coalesce(p_reason_note, ''), auth.uid());
  end if;
  return v_id;
end;
$$;
revoke all on function public.add_job_visit(uuid, uuid, timestamptz, int, text, text, uuid) from public;
grant execute on function public.add_job_visit(uuid, uuid, timestamptz, int, text, text, uuid) to authenticated;
