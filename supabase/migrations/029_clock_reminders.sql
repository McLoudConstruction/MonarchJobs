-- 029: "Still clocked in?" reminders, for a job clock, the day clock, or a break that looks forgotten.
-- Run after 028. Run it once, before deploying this push. Needs pg_cron (already used by 010).
--
-- The check runs every 15 minutes. It never uses time of day alone, because overnight emergency work is normal. A clock is
-- only flagged when something else says the person has probably moved on:
--   1. finished     the visit is finished or the job is completed or closed, and the clock is still running (30 min later)
--   2. quiet        the clock has run longer than the limit (10 hours, 14 on an emergency job) AND the person has done
--                   nothing in the app for 2 hours (no photo, chat, sketch or moisture reading, job change or clock action)
--   3. night        the same long run, but in the night window (9 pm to 5 am) and only 1 hour of quiet is needed
--   6. new day      the clock was started before this morning (5 am) and there has been 2 hours of quiet since
--   7. no day clock a job clock has run over an hour with no day clock running, for someone who uses the day clock
--   8. break        a break has been open over 45 minutes
-- Someone who keeps working (photos, readings, chat) is never reminded, however long the clock has run. A person with a job
-- clock running gets one reminder at a time (the day clock is not reminded separately).
-- The reminder is a quiet "info" notification that opens the job (or the dashboard for the day clock). It is sent at most twice,
-- 2 hours apart. If it is still ignored 2 hours after the second, the owner is told once. Clocking out resolves it.
-- The numbers live in clock_reminder_settings (one row), so they can be changed in the SQL Editor without a deploy.

create table if not exists public.clock_reminder_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  long_hours numeric not null default 10,
  emergency_extra_hours numeric not null default 4,
  idle_minutes int not null default 120,
  night_idle_minutes int not null default 60,
  night_start_hour int not null default 21 check (night_start_hour between 0 and 23),
  night_end_hour int not null default 5 check (night_end_hour between 0 and 23),
  morning_hour int not null default 5 check (morning_hour between 0 and 23),
  finished_grace_minutes int not null default 30,
  mismatch_minutes int not null default 60,
  break_minutes int not null default 45,
  max_nudges int not null default 2,
  nudge_gap_minutes int not null default 120
);
insert into public.clock_reminder_settings (id) values (1) on conflict do nothing;
alter table public.clock_reminder_settings enable row level security;
create policy clock_reminder_settings_select on public.clock_reminder_settings for select using (public.is_office_or_owner());

-- activity lookups for "has this person done anything lately"
create index if not exists job_events_actor_idx on public.job_events (actor_id, at desc);
create index if not exists chat_messages_author_idx on public.chat_messages (author_id, created_at desc);
create index if not exists job_photos_creator_idx on public.job_photos (created_by, created_at desc);
create index if not exists job_sketches_updater_idx on public.job_sketches (updated_by, updated_at desc);

-- the last time this person did anything in the app (never earlier than `p_since`)
create or replace function public.clock_last_activity(p_staff uuid, p_since timestamptz)
returns timestamptz language sql stable security definer set search_path = public as $$
  select greatest(
    p_since,
    coalesce((select max(e.at) from public.job_events e where e.actor_id = p_staff), 'epoch'::timestamptz),
    coalesce((select max(m.created_at) from public.chat_messages m where m.author_id = p_staff), 'epoch'::timestamptz),
    coalesce((select max(p.created_at) from public.job_photos p where p.created_by = p_staff), 'epoch'::timestamptz),
    -- sketches hold the moisture readings and equipment, so editing one counts as working
    coalesce((select max(k.updated_at) from public.job_sketches k where k.updated_by = p_staff), 'epoch'::timestamptz))
$$;

-- "11 h 05 min"
create or replace function public.clock_fmt_duration(p_from timestamptz)
returns text language sql stable as $$
  select (extract(epoch from now() - p_from)::int / 3600)::text || ' h ' || lpad(((extract(epoch from now() - p_from)::int % 3600) / 60)::text, 2, '0') || ' min'
$$;

-- Sends one reminder and handles the repeats: at most `max_nudges` to the person, `nudge_gap_minutes` apart, then one note to the owners.
-- p_escalate false = one reminder only (nothing repeats, nobody else is told).
create or replace function public.clock_nudge(p_staff uuid, p_key text, p_title text, p_body text, p_url text, p_job uuid, p_who text, p_escalate boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.clock_reminder_settings%rowtype;
  n record;
begin
  select * into c from public.clock_reminder_settings where id = 1;
  select id, repeat_count, at, resolved_at into n from public.notifications where user_id = p_staff and dedupe_key = p_key;
  if not found then
    perform public.notify_users(array[p_staff], 'clock_reminder', 'info', p_title, p_body, p_url, p_job, null, p_key);
    return;
  end if;
  if n.resolved_at is not null or not p_escalate then return; end if;
  if now() - n.at < make_interval(mins => c.nudge_gap_minutes) then return; end if;
  if n.repeat_count < c.max_nudges then
    perform public.notify_users(array[p_staff], 'clock_reminder', 'info', p_title, p_body, p_url, p_job, null, p_key);
  else
    perform public.notify_users(public.notif_owners(), 'clock_reminder_office', 'info',
      coalesce(p_who, 'Someone') || ' may still be clocked in', p_body, p_url, p_job, null, p_key || ':office', 'skip');
  end if;
end;
$$;

create or replace function public.notify_clock_checks()
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.clock_reminder_settings%rowtype;
  v_tz text := public.notif_tz();
  v_hour int;
  v_night boolean;
  v_morning timestamptz;
  r record;
  v_hours numeric;
  v_idle numeric;
  v_long numeric;
  v_why text;
  v_label text;
begin
  select * into c from public.clock_reminder_settings where id = 1;
  if not found or not c.enabled then return; end if;
  v_hour := extract(hour from now() at time zone v_tz)::int;
  v_night := case when c.night_start_hour > c.night_end_hour
                  then (v_hour >= c.night_start_hour or v_hour < c.night_end_hour)
                  else (v_hour >= c.night_start_hour and v_hour < c.night_end_hour) end;
  v_morning := ((now() at time zone v_tz)::date + make_interval(hours => c.morning_hour)) at time zone v_tz;

  -- ---------------------------------------------------------------- job clocks
  for r in
    select s.id, s.staff_id, s.job_id, s.started_at, j.status as job_status, j.updated_at as job_updated,
           vv.status as visit_status, vv.finished_at,
           exists (select 1 from public.leads l where l.id = j.lead_id and l.priority = 'emergency') as emerg,
           public.clock_last_activity(s.staff_id, s.started_at) as last_activity,
           coalesce(nullif(btrim(u.full_name), ''), u.email) as who,
           exists (select 1 from public.shifts sh where sh.staff_id = s.staff_id and sh.ended_at is null and sh.voided_at is null) as shift_open,
           exists (select 1 from public.shifts sh where sh.staff_id = s.staff_id and sh.voided_at is null and sh.started_at > now() - interval '14 days') as uses_day_clock
    from public.job_clock_sessions s
    join public.jobs j on j.id = s.job_id
    join public.staff_users u on u.id = s.staff_id and u.active
    left join public.job_visits vv on vv.id = s.visit_id
    where s.ended_at is null and s.voided_at is null
  loop
    v_hours := extract(epoch from now() - r.started_at) / 3600;
    v_idle := extract(epoch from now() - r.last_activity) / 60;
    v_long := c.long_hours + case when r.emerg then c.emergency_extra_hours else 0 end;
    v_label := coalesce(public.notif_job_label(r.job_id), 'a job');
    v_why := null;

    if (r.job_status in ('completed', 'closed') and now() - r.job_updated >= make_interval(mins => c.finished_grace_minutes))
       or (r.visit_status = 'finished' and now() - coalesce(r.finished_at, r.job_updated) >= make_interval(mins => c.finished_grace_minutes)) then
      v_why := 'finished';
    elsif v_hours >= v_long and v_idle >= c.idle_minutes then
      v_why := 'quiet';
    elsif v_hours >= v_long and v_night and v_idle >= c.night_idle_minutes then
      v_why := 'night';
    elsif r.started_at < v_morning and now() >= v_morning and v_idle >= c.idle_minutes then
      v_why := 'newday';
    end if;

    if v_why is not null then
      perform public.clock_nudge(r.staff_id, 'clock:job:' || r.id,
        'Still clocked in?',
        v_label || ' · on the clock for ' || public.clock_fmt_duration(r.started_at) || case when v_why = 'finished' then '. The job looks finished.' else '.' end,
        '/jobs/' || r.job_id, r.job_id, r.who);
    elsif r.uses_day_clock and not r.shift_open and now() - r.started_at >= make_interval(mins => c.mismatch_minutes) then
      perform public.clock_nudge(r.staff_id, 'clock:mismatch:' || r.id,
        'Day clock is not running',
        v_label || ' · your job clock is running, but your day clock is not.',
        '/dashboard', r.job_id, r.who, false);
    end if;
  end loop;

  -- ------------------------------------------------------------------ day clocks
  for r in
    select sh.id, sh.staff_id, sh.started_at,
           public.clock_last_activity(sh.staff_id, sh.started_at) as last_activity,
           exists (select 1 from public.job_clock_sessions s2 join public.jobs j2 on j2.id = s2.job_id
                   join public.leads l2 on l2.id = j2.lead_id
                   where s2.staff_id = sh.staff_id and s2.ended_at is null and s2.voided_at is null and l2.priority = 'emergency') as emerg,
           coalesce(nullif(btrim(u.full_name), ''), u.email) as who
    from public.shifts sh
    join public.staff_users u on u.id = sh.staff_id and u.active
    where sh.ended_at is null and sh.voided_at is null
      -- one reminder at a time: a running job clock is reminded about on its own, and a break has its own rule
      and not exists (select 1 from public.job_clock_sessions s where s.staff_id = sh.staff_id and s.ended_at is null and s.voided_at is null)
      and not exists (select 1 from public.shift_breaks b where b.shift_id = sh.id and b.ended_at is null and b.voided_at is null)
  loop
    v_hours := extract(epoch from now() - r.started_at) / 3600;
    v_idle := extract(epoch from now() - r.last_activity) / 60;
    v_long := c.long_hours + case when r.emerg then c.emergency_extra_hours else 0 end;
    v_why := null;
    if v_hours >= v_long and v_idle >= c.idle_minutes then v_why := 'quiet';
    elsif v_hours >= v_long and v_night and v_idle >= c.night_idle_minutes then v_why := 'night';
    elsif r.started_at < v_morning and now() >= v_morning and v_idle >= c.idle_minutes then v_why := 'newday';
    end if;
    if v_why is not null then
      perform public.clock_nudge(r.staff_id, 'clock:shift:' || r.id,
        'Still clocked in?',
        'Your day clock has been running for ' || public.clock_fmt_duration(r.started_at) || '.',
        '/dashboard', null, r.who);
    end if;
  end loop;

  -- ---------------------------------------------------------------------- breaks
  for r in
    select b.id, b.staff_id, b.started_at, coalesce(nullif(btrim(u.full_name), ''), u.email) as who
    from public.shift_breaks b
    join public.staff_users u on u.id = b.staff_id and u.active
    where b.ended_at is null and b.voided_at is null
      and now() - b.started_at >= make_interval(mins => c.break_minutes)
  loop
    perform public.clock_nudge(r.staff_id, 'clock:break:' || r.id,
      'Still on a break?',
      'Your break started ' || public.clock_fmt_duration(r.started_at) || ' ago.',
      '/dashboard', null, r.who);
  end loop;
end;
$$;

-- Clocking out (or removing the entry) closes the reminder, and the owner's note with it.
create or replace function public.trg_clock_resolve_session()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.ended_at is not null or new.voided_at is not null) then
    perform public.notif_resolve('clock:job:' || new.id);
    perform public.notif_resolve('clock:job:' || new.id || ':office');
    perform public.notif_resolve('clock:mismatch:' || new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists job_clock_sessions_clock_resolve on public.job_clock_sessions;
create trigger job_clock_sessions_clock_resolve after update of ended_at, voided_at on public.job_clock_sessions
  for each row execute function public.trg_clock_resolve_session();

create or replace function public.trg_clock_resolve_shift()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- starting the day clock answers "the day clock is not running"
    update public.notifications set resolved_at = now()
    where user_id = new.staff_id and dedupe_key like 'clock:mismatch:%' and resolved_at is null;
  elsif (new.ended_at is not null or new.voided_at is not null) then
    perform public.notif_resolve('clock:shift:' || new.id);
    perform public.notif_resolve('clock:shift:' || new.id || ':office');
  end if;
  return new;
end;
$$;
drop trigger if exists shifts_clock_resolve on public.shifts;
create trigger shifts_clock_resolve after insert or update of ended_at, voided_at on public.shifts
  for each row execute function public.trg_clock_resolve_shift();

create or replace function public.trg_clock_resolve_break()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.ended_at is not null or new.voided_at is not null) then
    perform public.notif_resolve('clock:break:' || new.id);
    perform public.notif_resolve('clock:break:' || new.id || ':office');
  end if;
  return new;
end;
$$;
drop trigger if exists shift_breaks_clock_resolve on public.shift_breaks;
create trigger shift_breaks_clock_resolve after update of ended_at, voided_at on public.shift_breaks
  for each row execute function public.trg_clock_resolve_break();

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('notify-clock-checks', '*/15 * * * *', 'select public.notify_clock_checks()');
exception when others then
  raise notice 'pg_cron could not be set up (%). Enable it in Database > Extensions and run this block again: clock reminders will not run until then.', sqlerrm;
end $$;
