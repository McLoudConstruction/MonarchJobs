-- 050: Push 2C (Nov 23).
--   #33  Self-reschedule: a customer opens the link from their text, picks a new open time, and the old time is freed.
--        The office is told; a tech who is busy or off at the new time is taken off the visit so the office can reassign.
--   #17  Slow-day pricing: offers a percent off for days that are mostly empty. A customer who books through the offer gets a
--        discount line on the estimate. Off until the owner turns it on.
--   #25  Storm trigger: a National Weather Service storm alert for the business area opens a capacity check and a preview of
--        a message to past customers. Nothing is sent until the owner or office taps Send. Off until turned on.
--   Freeze warning: a freeze alert for the business area is sent to everyone's devices with the owner's precautions list.
-- Safe to run more than once. Run in the Supabase SQL Editor after 049, before deploying.

-- ============================================================ settings
alter table public.settings
  add column if not exists reschedule_enabled boolean not null default false,
  add column if not exists reschedule_notice_hours int not null default 24,
  add column if not exists reschedule_max int not null default 2,
  add column if not exists slowday_enabled boolean not null default false,
  add column if not exists slowday_percent int not null default 10,
  add column if not exists slowday_look_ahead_days int not null default 7,
  add column if not exists slowday_min_notice_hours int not null default 48,
  add column if not exists slowday_open_share int not null default 60,
  add column if not exists slowday_max_dates int not null default 3,
  add column if not exists slowday_max_per_day int not null default 10,
  add column if not exists slowday_quiet_days int not null default 60,
  add column if not exists slowday_message text not null default '',
  add column if not exists weather_location text not null default '',
  add column if not exists weather_lat double precision,
  add column if not exists weather_lng double precision,
  add column if not exists weather_geo_for text not null default '',
  add column if not exists storm_enabled boolean not null default false,
  add column if not exists storm_events text[] not null default '{"Tornado Warning","Severe Thunderstorm Warning","Flash Flood Warning","Flood Warning","Hurricane Warning","Tropical Storm Warning","Winter Storm Warning","Ice Storm Warning","Blizzard Warning","High Wind Warning"}',
  add column if not exists storm_window_days int not null default 5,
  add column if not exists storm_max int not null default 25,
  add column if not exists storm_message text not null default '',
  add column if not exists freeze_enabled boolean not null default false,
  add column if not exists freeze_precautions text not null default 'Bring in or cover anything that holds water and can freeze: hoses, pumps, water lines and fittings. Keep batteries and electronics out of the cold. Drain or protect equipment that stays outside.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_reschedule_chk') then
    alter table public.settings add constraint settings_reschedule_chk
      check (reschedule_notice_hours between 0 and 336 and reschedule_max between 1 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_slowday_chk') then
    alter table public.settings add constraint settings_slowday_chk
      check (slowday_percent between 1 and 50 and slowday_look_ahead_days between 1 and 30 and slowday_min_notice_hours between 0 and 336
        and slowday_open_share between 10 and 100 and slowday_max_dates between 1 and 7 and slowday_max_per_day between 1 and 50
        and slowday_quiet_days between 0 and 730 and char_length(slowday_message) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_weather_chk') then
    alter table public.settings add constraint settings_weather_chk
      check (char_length(weather_location) <= 60 and storm_window_days between 1 and 14 and storm_max between 1 and 100
        and char_length(storm_message) <= 300 and char_length(freeze_precautions) <= 600);
  end if;
end $$;

-- ============================================================ #33 reschedule bookkeeping on the visit
alter table public.job_visits
  add column if not exists reschedule_count int not null default 0,
  add column if not exists rescheduled_by_customer_at timestamptz;

-- Moves a scheduled visit (and everyone on its crew) to a new open time chosen by the customer. Server only.
-- The server has already checked that the time is one the booking rules offer; this re-checks capacity under the same lock the
-- online booking uses, so two customers cannot take one slot. Returns what the server needs to tell the customer.
create or replace function public.self_reschedule_visit(p_token uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_set public.settings%rowtype;
  v public.job_visits%rowtype;
  v_type text;
  v_end timestamptz;
  v_gap interval;
  v_busy int;
  v_crews int;
  v_day date;
  r public.job_visits%rowtype;
  v_conflict boolean;
  v_unassigned int := 0;
  v_label text;
begin
  select * into v_set from public.settings where id = 1;
  if not coalesce(v_set.reschedule_enabled, false) then raise exception 'RESCHEDULE_OFF'; end if;

  perform pg_advisory_xact_lock(hashtext('monarch_booking_slots'));

  select * into v from public.job_visits where share_token = p_token for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.status <> 'scheduled' then raise exception 'NOT_SCHEDULED'; end if;
  select job_type into v_type from public.jobs where id = v.job_id;
  if v_type is distinct from 'floor_cleaning' then raise exception 'NOT_ALLOWED_TYPE'; end if;
  if v.starts_at < now() + make_interval(hours => v_set.reschedule_notice_hours) then raise exception 'TOO_LATE'; end if;
  if v.reschedule_count >= v_set.reschedule_max then raise exception 'LIMIT_REACHED'; end if;
  if p_starts_at < now() + make_interval(hours => v_set.booking_notice_hours) then raise exception 'SLOT_TAKEN'; end if;
  if p_starts_at = v.starts_at then raise exception 'SAME_TIME'; end if;

  v_end := p_starts_at + make_interval(mins => v.duration_minutes);
  v_gap := make_interval(mins => v_set.booking_gap_minutes);
  v_day := (p_starts_at at time zone v_set.timezone)::date;
  v_crews := case when v_set.booking_capacity_enabled then public.crews_on(v_day) else v_set.booking_crews end;

  -- every other active visit counts, the gap on either side included; this visit's own crew rows are the ones moving
  select count(*) into v_busy from public.job_visits o
  where o.status in ('scheduled', 'on_the_way', 'started')
    and o.id <> v.id
    and (v.crew_id is null or o.crew_id is distinct from v.crew_id)
    and o.starts_at < v_end + v_gap
    and o.ends_at + v_gap > p_starts_at;
  if v_busy >= v_crews then raise exception 'SLOT_TAKEN'; end if;

  for r in
    select * from public.job_visits
    where status = 'scheduled' and (id = v.id or (v.crew_id is not null and crew_id = v.crew_id))
    for update
  loop
    v_conflict := r.tech_id is not null and (
      exists (
        select 1 from public.job_visits o
        where o.tech_id = r.tech_id and o.id <> r.id
          and (v.crew_id is null or o.crew_id is distinct from v.crew_id)
          and o.status in ('scheduled', 'on_the_way', 'started')
          and o.starts_at < v_end and o.ends_at > p_starts_at
      )
      or exists (select 1 from public.time_off t where t.staff_id = r.tech_id and t.starts_on <= v_day and v_day <= t.ends_on)
    );
    update public.job_visits set
      starts_at = p_starts_at,
      tech_id = case when v_conflict then null else tech_id end,
      reschedule_count = reschedule_count + 1,
      rescheduled_by_customer_at = now()
    where id = r.id;
    if v_conflict then v_unassigned := v_unassigned + 1; end if;
  end loop;

  insert into public.job_events (job_id, kind, details)
  values (v.job_id, 'visit_rescheduled_by_customer',
          jsonb_build_object('visit_id', v.id, 'from', v.starts_at, 'to', p_starts_at, 'unassigned', v_unassigned));

  begin
    v_label := public.notif_job_label(v.job_id);
    perform public.notify_users(
      public.notif_office_owner(), 'customer_rescheduled', case when v_unassigned > 0 then 'action' else 'info' end,
      'A customer chose a new time',
      concat_ws(' · ', v_label, 'now ' || public.notif_fmt_time(p_starts_at) || ' (was ' || public.notif_fmt_time(v.starts_at) || ')',
        case when v_unassigned > 0 then 'a tech needs to be assigned' end),
      '/jobs/' || v.job_id, v.job_id, null, 'resched:' || v.id);
  exception when others then
    raise warning 'reschedule notice failed: %', sqlerrm;
  end;

  return jsonb_build_object('job_id', v.job_id, 'from', v.starts_at, 'to', p_starts_at,
                            'ends_at', v_end, 'unassigned', v_unassigned, 'count', v.reschedule_count + 1);
end;
$$;
revoke all on function public.self_reschedule_visit(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.self_reschedule_visit(uuid, timestamptz) to service_role;

-- ============================================================ weather alerts (#25 storm, freeze warning)
create table if not exists public.weather_alerts (
  id bigint generated always as identity primary key,
  nws_id text not null unique,
  kind text not null check (kind in ('storm', 'freeze')),
  event text not null,
  severity text not null default '',
  headline text not null default '',
  area text not null default '',
  note text not null default '',
  starts_at timestamptz,
  expires_at timestamptz,
  status text not null default 'open' check (status in ('open', 'sent', 'dismissed', 'ended')),
  handled_by uuid references public.staff_users (id) on delete set null,
  handled_at timestamptz,
  sent_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists weather_alerts_open_idx on public.weather_alerts (status, created_at desc);
alter table public.weather_alerts enable row level security;
-- Freeze alerts show on everyone's screen; storm alerts are for the office and owner.
drop policy if exists weather_alerts_select on public.weather_alerts;
create policy weather_alerts_select on public.weather_alerts for select
  using ((kind = 'freeze' and public.is_staff()) or public.is_office_or_owner());

create or replace function public.weather_notify(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.weather_alerts%rowtype;
begin
  select * into a from public.weather_alerts where id = p_id;
  if a.id is null then return; end if;
  if a.kind = 'freeze' then
    perform public.notify_users(
      array(select id from public.staff_users where active), 'freeze_warning', 'alert',
      'A freeze is expected in our area',
      concat_ws(E'\n', coalesce(nullif(a.headline, ''), a.event), 'Please bring in or protect any equipment that is outside.', nullif(a.note, '')),
      '/schedule', null, null, 'weather:' || a.id);
  else
    perform public.notify_users(
      public.notif_office_owner(), 'storm_alert', 'action',
      'Storm alert for our area',
      concat_ws(E'\n', coalesce(nullif(a.headline, ''), a.event), 'Check capacity and decide whether to reach out to past customers.'),
      '/schedule#storm', null, null, 'weather:' || a.id);
  end if;
end $$;
revoke all on function public.weather_notify(bigint) from public, anon, authenticated;
grant execute on function public.weather_notify(bigint) to service_role;

-- Alerts the weather service no longer lists (or that ran out) close, and their notification goes away.
create or replace function public.weather_end(p_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  foreach v_id in array coalesce(p_ids, '{}') loop
    update public.weather_alerts set status = 'ended' where id = v_id and status in ('open', 'sent');
    perform public.notif_resolve('weather:' || v_id);
  end loop;
end $$;
revoke all on function public.weather_end(bigint[]) from public, anon, authenticated;
grant execute on function public.weather_end(bigint[]) to service_role;

-- The site calls this after an approved batch went out: the alert is handled and its notification goes away. Server only.
create or replace function public.weather_alert_mark_sent(p_id bigint, p_count int, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.weather_alerts set status = 'sent', sent_count = sent_count + greatest(coalesce(p_count, 0), 0),
    handled_by = p_user, handled_at = now()
  where id = p_id and status in ('open', 'sent');
  perform public.notif_resolve('weather:' || p_id);
end $$;
revoke all on function public.weather_alert_mark_sent(bigint, int, uuid) from public, anon, authenticated;
grant execute on function public.weather_alert_mark_sent(bigint, int, uuid) to service_role;

-- Office or owner: set a storm alert aside without messaging anyone.
create or replace function public.weather_alert_dismiss(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_office_or_owner() then raise exception 'NOT_ALLOWED'; end if;
  update public.weather_alerts set status = 'dismissed', handled_by = auth.uid(), handled_at = now()
  where id = p_id and kind = 'storm' and status = 'open';
  perform public.notif_resolve('weather:' || p_id);
  return true;
end $$;
revoke all on function public.weather_alert_dismiss(bigint) from public, anon;
grant execute on function public.weather_alert_dismiss(bigint) to authenticated;

-- The database knocks on the site's door every 30 minutes; the site asks the weather service and decides what matters.
alter table public.notification_config add column if not exists weather_url text not null default '';
update public.notification_config set weather_url = replace(outreach_url, '/api/cron/outreach', '/api/cron/weather')
where id = 1 and weather_url = '' and outreach_url like '%/api/cron/outreach';
update public.notification_config set weather_url = replace(anomaly_url, '/api/cron/anomalies', '/api/cron/weather')
where id = 1 and weather_url = '' and anomaly_url like '%/api/cron/anomalies';

create or replace function public.ping_weather()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
  v_on boolean;
begin
  select weather_url, push_secret into v_url, v_secret from public.notification_config where id = 1;
  select (coalesce(storm_enabled, false) or coalesce(freeze_enabled, false)) into v_on from public.settings where id = 1;
  if not coalesce(v_on, false) or coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return; end if;
  begin
    perform net.http_post(
      url := v_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'weather check could not be queued: %', sqlerrm;
  end;
end $$;
revoke all on function public.ping_weather() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('weather-alert-check') where exists (select 1 from cron.job where jobname = 'weather-alert-check');
  perform cron.schedule('weather-alert-check', '*/30 * * * *', 'select public.ping_weather()');
exception when others then
  raise notice 'pg_cron could not be set up (%). Enable it in Database > Extensions and run this block again: weather alerts will not run until then.', sqlerrm;
end $$;

-- ============================================================ #17 slow-day offers
-- One row per customer per offer. The customer's link carries the token; it is good for the listed days only and works once.
create table if not exists public.slowday_offers (
  id bigint generated always as identity primary key,
  token uuid not null unique default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  percent int not null check (percent between 1 and 50),
  dates date[] not null check (cardinality(dates) between 1 and 7),
  expires_on date not null,
  used_at timestamptz,
  lead_id uuid references public.leads (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists slowday_offers_customer_idx on public.slowday_offers (customer_id, created_at desc);
alter table public.slowday_offers enable row level security;
drop policy if exists slowday_offers_select on public.slowday_offers;
create policy slowday_offers_select on public.slowday_offers for select using (public.is_office_or_owner());

-- ============================================================ new reminders are logged with the others
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.outreach_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.outreach_log drop constraint %I', c.conname);
  end loop;
  alter table public.outreach_log add constraint outreach_log_kind_check
    check (kind in ('rebook', 'plan_offer', 'plan_reminder', 'street_offer', 'slowday_offer', 'storm_offer'));
end $$;

-- ================================================================== AFTER RUNNING
-- Everything above is OFF until turned on in Settings > Outreach (rescheduling, slow-day offers, storm alerts, freeze warning)
-- and Settings > Booking is unchanged. The weather check reaches the site through the address already saved for the daily
-- reminders or the hourly job alerts; if neither was saved, run this once with your real site address:
--
--   update public.notification_config
--   set weather_url = 'https://jobs.monarchcleaningsolutions.com/api/cron/weather'
--   where id = 1;
