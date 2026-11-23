-- 047: On-call rotation (Nov 23, Round 2B, #29).
-- One person is on call each week, in a rotation the owner sets in Settings. When an EMERGENCY lead comes in, the on-call person
-- gets their own alert. If nobody claims the lead within the wait time, the next person in the rotation and the office and owner
-- are told. Someone on time off (Time off tab) is skipped, and a one-off swap can be added for any stretch of time.
-- OFF until the owner turns it on in Settings > Reminders. Safe to run more than once. Run in the Supabase SQL Editor after 046.

alter table public.settings
  add column if not exists oncall_enabled boolean not null default false,
  add column if not exists oncall_order uuid[] not null default '{}',
  add column if not exists oncall_start date,
  add column if not exists oncall_handoff_hour integer not null default 8,
  add column if not exists oncall_wait_minutes integer not null default 15;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_oncall_chk') then
    alter table public.settings add constraint settings_oncall_chk check (
      oncall_handoff_hour between 0 and 23 and oncall_wait_minutes between 5 and 120 and cardinality(oncall_order) <= 30);
  end if;
end $$;

-- one-off swaps: this person covers this stretch of time instead of the rotation
create table if not exists public.oncall_overrides (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null default '',
  created_by uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint oncall_overrides_range check (ends_at > starts_at and ends_at - starts_at <= interval '60 days'),
  constraint oncall_overrides_note check (char_length(note) <= 200)
);
create index if not exists oncall_overrides_time_idx on public.oncall_overrides (starts_at, ends_at);
alter table public.oncall_overrides enable row level security;
drop policy if exists oncall_overrides_read on public.oncall_overrides;
create policy oncall_overrides_read on public.oncall_overrides for select using (public.is_staff());
drop policy if exists oncall_overrides_write on public.oncall_overrides;
create policy oncall_overrides_write on public.oncall_overrides for all using (public.is_office_or_owner()) with check (public.is_office_or_owner());

-- one row per emergency lead that was handed to the on-call person
create table if not exists public.oncall_alerts (
  id bigserial primary key,
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  first_staff uuid references public.staff_users(id) on delete set null,
  backup_staff uuid references public.staff_users(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_by uuid references public.staff_users(id) on delete set null,
  claimed_at timestamptz,
  escalated_at timestamptz
);
create index if not exists oncall_alerts_open_idx on public.oncall_alerts (created_at) where claimed_at is null;
alter table public.oncall_alerts enable row level security;
drop policy if exists oncall_alerts_read on public.oncall_alerts;
create policy oncall_alerts_read on public.oncall_alerts for select using (public.is_staff());

-- the first person in `order`, starting at position p_from (1-based), who is active and not on time off that day
create or replace function public.oncall_pick(p_order uuid[], p_from integer, p_day date, p_skip uuid default null)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  n integer := coalesce(cardinality(p_order), 0);
  i integer;
  c uuid;
begin
  if n = 0 then return null; end if;
  for i in 0..n - 1 loop
    c := p_order[((p_from - 1 + i) % n) + 1];
    continue when c is null or c = p_skip;
    continue when not exists (select 1 from public.staff_users where id = c and active);
    continue when exists (select 1 from public.time_off t where t.staff_id = c and p_day between t.starts_on and t.ends_on);
    return c;
  end loop;
  return null;
end $$;

-- who is on call at p_at, and until when
create or replace function public.oncall_at(p_at timestamptz default now())
returns table (staff_id uuid, until timestamptz, swapped boolean, week_start date)
language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  tz text;
  o record;
  shifted timestamp;
  wk date;
  idx integer;
  n integer;
begin
  select oncall_order, oncall_start, oncall_handoff_hour, coalesce(nullif(timezone, ''), 'America/Chicago') as tz
    into s from public.settings where id = 1;
  tz := s.tz;
  select v.staff_id, v.ends_at into o from public.oncall_overrides v
    where v.starts_at <= p_at and v.ends_at > p_at
      and exists (select 1 from public.staff_users u where u.id = v.staff_id and u.active)
    order by v.created_at desc limit 1;
  if o.staff_id is not null then
    return query select o.staff_id, o.ends_at, true, null::date;
    return;
  end if;
  n := coalesce(cardinality(s.oncall_order), 0);
  if n = 0 or s.oncall_start is null then return; end if;
  shifted := (p_at at time zone tz) - make_interval(hours => s.oncall_handoff_hour);
  wk := date_trunc('week', shifted)::date;
  idx := ((((wk - s.oncall_start) / 7) % n) + n) % n + 1;
  return query select public.oncall_pick(s.oncall_order, idx, (p_at at time zone tz)::date),
    ((wk + 7)::timestamp + make_interval(hours => s.oncall_handoff_hour)) at time zone tz, false, wk;
end $$;

-- for the app: who is on call right now (any signed-in staff member)
create or replace function public.oncall_now()
returns table (staff_id uuid, until timestamptz, swapped boolean)
language sql stable security definer set search_path = public as $$
  select a.staff_id, a.until, a.swapped from public.oncall_at(now()) a
  where public.is_staff() and (select oncall_enabled from public.settings where id = 1)
$$;
revoke all on function public.oncall_now() from public, anon;
grant execute on function public.oncall_now() to authenticated;

-- someone takes an emergency lead ("I've got it")
create or replace function public.oncall_claim(p_lead uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not public.is_staff() then return false; end if;
  update public.oncall_alerts set claimed_by = auth.uid(), claimed_at = now()
    where lead_id = p_lead and claimed_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    perform public.notif_resolve('oncall:' || p_lead);
    perform public.notif_resolve('oncall:' || p_lead || ':esc');
  end if;
  return n > 0;
end $$;
revoke all on function public.oncall_claim(uuid) from public, anon;
grant execute on function public.oncall_claim(uuid) to authenticated;

-- emergency leads waiting for someone to take them, for the on-call banner. Techs cannot open leads, so this carries
-- what they need to make the call. Shown to the person it was sent to, the backup, and the office and owner.
create or replace function public.oncall_open()
returns table (lead_id uuid, name text, phone text, city text, summary text, created_at timestamptz, escalated boolean)
language sql stable security definer set search_path = public as $$
  select a.lead_id, coalesce(nullif(btrim(l.name), ''), 'No name yet'), nullif(btrim(l.phone), ''), nullif(btrim(l.city), ''),
         nullif(left(btrim(l.loss_summary), 160), ''), a.created_at, a.escalated_at is not null
  from public.oncall_alerts a join public.leads l on l.id = a.lead_id
  where public.is_staff() and a.claimed_at is null and l.status = 'new'
    and (public.is_office_or_owner() or auth.uid() in (a.first_staff, a.backup_staff))
  order by a.created_at
$$;
revoke all on function public.oncall_open() from public, anon;
grant execute on function public.oncall_open() to authenticated;

-- new emergency lead -> the on-call person
create or replace function public.trg_oncall_lead_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  v_on boolean;
begin
  if new.priority is distinct from 'emergency' then return new; end if;
  begin
    select oncall_enabled into v_on from public.settings where id = 1;
    if not coalesce(v_on, false) then return new; end if;
    select a.staff_id into v from public.oncall_at(now()) a;
    insert into public.oncall_alerts (lead_id, first_staff) values (new.id, v) on conflict (lead_id) do nothing;
    if v is null then
      perform public.notify_users(public.notif_office_owner(), 'oncall_alert', 'alert', 'No one is on call',
        'An emergency lead came in and nobody is on the on-call rotation right now. Check Settings > Reminders.',
        '/leads/' || new.id, null, new.id, 'oncall:' || new.id || ':esc');
    else
      perform public.notify_users(array[v], 'oncall_alert', 'alert', 'You are on call: new EMERGENCY lead',
        concat_ws(' · ', coalesce(nullif(btrim(new.name), ''), 'No name yet'), nullif(initcap(replace(new.job_type, '_', ' ')), ''),
          nullif(left(btrim(new.loss_summary), 120), ''), nullif(btrim(new.city), ''), nullif(btrim(new.phone), '')),
        case when exists (select 1 from public.staff_users where id = v and role in ('owner', 'office')) then '/leads/' || new.id else '/schedule' end,
        null, new.id, 'oncall:' || new.id);
    end if;
  exception when others then
    raise warning 'on-call alert for lead % failed: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists leads_oncall_insert on public.leads;
create trigger leads_oncall_insert after insert on public.leads
  for each row execute function public.trg_oncall_lead_insert();

-- a lead that moves on (quoted, booked, lost) counts as handled
create or replace function public.trg_oncall_lead_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'new' and new.status is distinct from 'new' then
    update public.oncall_alerts set claimed_at = coalesce(claimed_at, now()), claimed_by = coalesce(claimed_by, auth.uid())
      where lead_id = new.id and claimed_at is null;
    perform public.notif_resolve('oncall:' || new.id);
    perform public.notif_resolve('oncall:' || new.id || ':esc');
  end if;
  return new;
end $$;
drop trigger if exists leads_oncall_update on public.leads;
create trigger leads_oncall_update after update of status on public.leads
  for each row execute function public.trg_oncall_lead_update();

-- every minute: an emergency lead nobody claimed within the wait goes to the next person and the office and owner
create or replace function public.oncall_escalate()
returns integer language plpgsql security definer set search_path = public as $$
declare
  s record;
  r record;
  b uuid;
  n integer := 0;
  pos integer;
begin
  select oncall_enabled, oncall_order, oncall_wait_minutes, coalesce(nullif(timezone, ''), 'America/Chicago') as tz
    into s from public.settings where id = 1;
  if not coalesce(s.oncall_enabled, false) then return 0; end if;
  for r in
    select a.id, a.lead_id, a.first_staff, l.name, l.city, l.status
    from public.oncall_alerts a join public.leads l on l.id = a.lead_id
    where a.claimed_at is null and a.escalated_at is null
      and a.created_at <= now() - make_interval(mins => s.oncall_wait_minutes)
  loop
    if r.status <> 'new' then
      update public.oncall_alerts set claimed_at = now() where id = r.id;
      continue;
    end if;
    b := null;
    if r.first_staff is not null and s.oncall_order is not null then
      pos := array_position(s.oncall_order, r.first_staff);
      b := public.oncall_pick(s.oncall_order, coalesce(pos, 0) + 1, (now() at time zone s.tz)::date, r.first_staff);
    end if;
    perform public.notify_users(
      array_remove(array_append(public.notif_office_owner(), b), null), 'oncall_alert', 'alert',
      'Emergency lead not picked up',
      concat_ws(' · ', coalesce(nullif(btrim(r.name), ''), 'No name yet'), nullif(btrim(r.city), ''), 'Nobody has claimed it yet.'),
      '/leads/' || r.lead_id, null, r.lead_id, 'oncall:' || r.lead_id || ':esc');
    update public.oncall_alerts set escalated_at = now(), backup_staff = b where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.oncall_escalate() from public, anon, authenticated;
grant execute on function public.oncall_escalate() to service_role;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('oncall-escalate') where exists (select 1 from cron.job where jobname = 'oncall-escalate');
  perform cron.schedule('oncall-escalate', '* * * * *', 'select public.oncall_escalate()');
exception when others then
  raise notice 'pg_cron could not be set up (%). Enable it in Database > Extensions and run this block again: on-call escalation will not run until then.', sqlerrm;
end $$;
