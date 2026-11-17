-- 021: job costing (owner only), equipment daily rates, dry standards kept per job, and the equipment short-count alert.
-- Run after 001 to 020. Run it once, before deploying this push.
--
--   * Job costing is for the owner alone: nobody else can read or change these tables, and techs never see an amount.
--     A cost is never deleted. A purchase or a time entry is voided, so there is always a trail.
--   * What an hour of someone's time costs the company lives in staff_cost_rates (owner only). A time entry copies the rate
--     when it is made, so changing someone's rate later does not rewrite old jobs.
--   * What a day of each kind of equipment costs lives in equipment_daily_rates (owner only). The equipment line on a job's
--     costs is worked out by the website from the sketch's equipment log (calendar days on site x the daily rate), so it
--     is never out of date; nothing is stored for it.
--   * Dry standards were kept in each sketch. They are now kept on the job, so every sketch of a job uses the same ones.
--   * Short count: when a job is completed or closed with equipment still marked on site, the office and owner get an alert.
--     It clears itself once everything has been picked up.

-- ------------------------------------------------------------------- who can see money
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_staff_role() = 'owner', false)
$$;

-- ------------------------------------------------------------------- cost rates
create table public.staff_cost_rates (
  staff_id uuid primary key references public.staff_users (id) on delete cascade,
  hourly_cents int not null default 0 check (hourly_cents between 0 and 100000),   -- what an hour of this person costs the company
  updated_at timestamptz not null default now()
);
create trigger staff_cost_rates_touch before update on public.staff_cost_rates
  for each row execute function public.touch_updated_at();

create table public.equipment_daily_rates (
  type text primary key check (btrim(type) <> ''),     -- a key of EQUIPMENT_TYPES in lib/equipment.js
  daily_cents int not null default 0 check (daily_cents between 0 and 1000000),   -- what one unit costs per calendar day on a job
  updated_at timestamptz not null default now()
);
create trigger equipment_daily_rates_touch before update on public.equipment_daily_rates
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------- what was bought for a job
create table public.job_purchases (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  purchased_on date not null default current_date,
  vendor text not null default '' check (char_length(vendor) <= 120),
  description text not null check (btrim(description) <> '' and char_length(description) <= 300),
  category text not null default 'materials' check (category in ('materials', 'equipment_rental', 'disposal', 'fuel', 'subcontract', 'other')),
  amount_cents bigint not null check (amount_cents >= 0 and amount_cents <= 100000000),
  note text not null default '' check (char_length(note) <= 500),
  voided_at timestamptz,
  void_reason text not null default '' check (char_length(void_reason) <= 300),
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_purchases_job_idx on public.job_purchases (job_id, purchased_on desc);
create trigger job_purchases_touch before update on public.job_purchases
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------- hours worked on a job
-- Typed in after the fact for now. A clock in / clock out timer is not built (not decided yet).
create table public.job_time_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  staff_id uuid references public.staff_users (id) on delete set null,
  worker_name text not null default '' check (char_length(worker_name) <= 80),   -- kept so the entry still reads right if the account goes
  worked_on date not null default current_date,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  rate_cents int not null default 0 check (rate_cents between 0 and 100000),     -- the hourly cost when the entry was made
  note text not null default '' check (char_length(note) <= 500),
  voided_at timestamptz,
  void_reason text not null default '' check (char_length(void_reason) <= 300),
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_time_entries_job_idx on public.job_time_entries (job_id, worked_on desc);
create trigger job_time_entries_touch before update on public.job_time_entries
  for each row execute function public.touch_updated_at();

alter table public.staff_cost_rates enable row level security;
alter table public.equipment_daily_rates enable row level security;
alter table public.job_purchases enable row level security;
alter table public.job_time_entries enable row level security;

create policy staff_cost_rates_all on public.staff_cost_rates for all using (public.is_owner()) with check (public.is_owner());
create policy equipment_daily_rates_all on public.equipment_daily_rates for all using (public.is_owner()) with check (public.is_owner());
create policy job_purchases_select on public.job_purchases for select using (public.is_owner());
create policy job_purchases_insert on public.job_purchases for insert with check (public.is_owner());
create policy job_purchases_update on public.job_purchases for update using (public.is_owner()) with check (public.is_owner());
create policy job_time_entries_select on public.job_time_entries for select using (public.is_owner());
create policy job_time_entries_insert on public.job_time_entries for insert with check (public.is_owner());
create policy job_time_entries_update on public.job_time_entries for update using (public.is_owner()) with check (public.is_owner());
-- no policy deletes rows: a cost is voided, never removed

-- ------------------------------------------------------------------- dry standards on the job
alter table public.jobs add column if not exists dry_standards jsonb not null default '{}'::jsonb;

-- Anyone who can work the job (office, owner, or the tech on it) may set its dry standards. { material: { val, type } }
create or replace function public.set_job_dry_standards(p_job uuid, p_standards jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_office_or_owner() or public.tech_assigned_to_job(p_job)) then
    raise exception 'NOT_ALLOWED: you cannot change this job';
  end if;
  if jsonb_typeof(coalesce(p_standards, '{}'::jsonb)) <> 'object' then
    raise exception 'BAD_STANDARDS: expected an object';
  end if;
  update public.jobs set dry_standards = coalesce(p_standards, '{}'::jsonb) where id = p_job;
end;
$$;
revoke all on function public.set_job_dry_standards(uuid, jsonb) from public;
grant execute on function public.set_job_dry_standards(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------- equipment short count
-- The units a sketch still has on site: the last thing in each unit's log (by the order of the sketch's days, then time) is not
-- a pick-up. Returns codes like 'AM 2'. Same rule as lib/equipment.js (unitAt).
create or replace function public.plan_units_on_site(p_plan jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(code order by code), '{}')
  from (
    select
      (case u.v->>'t'
        when 'airmover' then 'AM' when 'dehu' then 'DH' when 'dehuconv' then 'CD' when 'desiccant' then 'DD'
        when 'scrubber' then 'AS' when 'negair' then 'NA' when 'hydroxyl' then 'HG' when 'mat' then 'DM'
        when 'heater' then 'HT' else 'EQ' end) || ' ' || coalesce(u.v->>'n', '?') as code,
      (select e.v->>'action'
         from jsonb_array_elements(coalesce(u.v->'log', '[]'::jsonb)) as e(v)
         join jsonb_array_elements(coalesce(p_plan->'days', '[]'::jsonb)) with ordinality as d(v, i) on d.v->>'id' = e.v->>'day'
        order by d.i desc, e.v->>'at' desc limit 1) as last_action
    from jsonb_array_elements(coalesce(p_plan->'equipment', '[]'::jsonb)) as u(v)
  ) x
  where last_action is not null and last_action <> 'removed'
$$;

create or replace function public.job_units_on_site(p_job uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(c order by c), '{}')
  from (select unnest(public.plan_units_on_site(plan)) as c from public.job_sketches where job_id = p_job) x
$$;

create or replace function public.raise_short_count(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_units text[]; v_status text;
begin
  select status into v_status from public.jobs where id = p_job;
  if v_status not in ('completed', 'closed') then return; end if;
  v_units := public.job_units_on_site(p_job);
  if cardinality(v_units) = 0 then
    perform public.notif_resolve('job:' || p_job || ':shortcount');
    return;
  end if;
  perform public.notify_users(
    public.notif_office_owner(), 'equipment_short', 'alert',
    'Equipment still on site: ' || public.notif_job_label(p_job),
    cardinality(v_units) || (case when cardinality(v_units) = 1 then ' piece is' else ' pieces are' end)
      || ' not marked picked up (' || array_to_string(v_units[1:8], ', ') || (case when cardinality(v_units) > 8 then ', ...' else '' end) || ').',
    '/jobs/' || p_job || '#moisture', p_job, null, 'job:' || p_job || ':shortcount');
end;
$$;

create or replace function public.trg_short_count_on_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('completed', 'closed') and old.status is distinct from new.status then
    begin
      perform public.raise_short_count(new.id);
    exception when others then
      raise warning 'short count for job % was not checked: %', new.id, sqlerrm;
    end;
  elsif new.status not in ('completed', 'closed') and old.status in ('completed', 'closed') then
    perform public.notif_resolve('job:' || new.id || ':shortcount'); -- reopened for a return visit
  end if;
  return new;
end;
$$;
create trigger jobs_short_count after update of status on public.jobs
  for each row execute function public.trg_short_count_on_job();

-- Once equipment is picked up after the job finished, the alert goes away (it never comes back from a sketch save; only finishing
-- the job raises it).
create or replace function public.trg_short_count_on_sketch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.plan is distinct from old.plan
     and (select status from public.jobs where id = new.job_id) in ('completed', 'closed')
     and cardinality(public.job_units_on_site(new.job_id)) = 0 then
    perform public.notif_resolve('job:' || new.job_id || ':shortcount');
  end if;
  return new;
end;
$$;
create trigger job_sketches_short_count after update of plan on public.job_sketches
  for each row execute function public.trg_short_count_on_sketch();
