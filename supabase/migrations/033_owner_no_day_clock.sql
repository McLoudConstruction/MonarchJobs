-- 033: The owner no longer has a day clock (the Dashboard card is hidden for the owner), so the clock reminders skip owners for the
-- day-clock rules: "day clock is not running", a day clock still running, and a break that ran long. Job-clock reminders are unchanged.
-- Run once in the Supabase SQL Editor.

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
           (u.role <> 'owner' and exists (select 1 from public.shifts sh where sh.staff_id = s.staff_id and sh.voided_at is null and sh.started_at > now() - interval '14 days')) as uses_day_clock
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
    join public.staff_users u on u.id = sh.staff_id and u.active and u.role <> 'owner'
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
    join public.staff_users u on u.id = b.staff_id and u.active and u.role <> 'owner'
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
