-- 043: Technician alerts, tidied (Nov 22).
--   1. A visit assignment is a plain assignment. It is always an "info" heads-up, never "Needs action",
--      and nothing waits on the tech to answer it. The visit itself (with its time) is the record.
--   2. Technician notifications no longer pile up. Read ones leave the list after a day, finished ones after
--      6 hours, unread heads-ups after 3 days, and anything but an unread "Needs action" after 7 days.
--      Owner and office notifications are left alone (they keep the 90-day cleanup).
--   3. "Day clock" is now "Shift clock" in notification wording (new and existing).
-- Safe to run more than once. Run in the Supabase SQL Editor after 042, before deploying.

-- ------------------------------------------------------------ 1. assignments are never "needs action"
update public.notifications set tier = 'info', resolved_at = coalesce(resolved_at, now())
where type = 'visit_assigned' and tier <> 'info';

-- ------------------------------------------------------------ 2. tidy technician notifications
create or replace function public.notif_tidy_techs()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from public.notifications x
  using public.staff_users s
  where s.id = x.user_id and s.role = 'tech'
    and (
      (x.read_at is not null and x.read_at < now() - interval '1 day')
      or (x.resolved_at is not null and x.resolved_at < now() - interval '6 hours')
      or (x.read_at is null and x.tier = 'info' and x.at < now() - interval '3 days')
      or (not (x.read_at is null and x.resolved_at is null and x.tier = 'action') and x.at < now() - interval '7 days')
    );
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.notif_tidy_techs() from public, anon, authenticated;
grant execute on function public.notif_tidy_techs() to service_role;

-- the existing 10-minute job: same as 011, plus the tidy
create or replace function public.notify_scheduled_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tz text := public.notif_tz();
  v_tomorrow date := (now() at time zone public.notif_tz())::date + 1;
  r record;
begin
  for r in
    select v.id, v.tech_id, v.job_id, v.starts_at
    from public.job_visits v
    where v.status = 'scheduled' and v.tech_id is not null
      and v.starts_at > now() and v.starts_at <= now() + interval '60 minutes'
      and v.created_at < v.starts_at - interval '60 minutes'
  loop
    perform public.notify_users(
      array[r.tech_id], 'visit_reminder', 'info',
      'Reminder: your visit starts soon',
      coalesce(public.notif_job_label(r.job_id), 'Visit') || ' · starts at ' || to_char(r.starts_at at time zone v_tz, 'FMHH12:MI AM'),
      '/jobs/' || r.job_id, r.job_id, null, 'visit:' || r.id || ':reminder', 'skip');
  end loop;

  if extract(hour from now() at time zone v_tz)::int = 18 then
    for r in
      select v.tech_id, count(*) as n, min(v.starts_at) as first_at
      from public.job_visits v
      where v.status = 'scheduled' and v.tech_id is not null
        and (v.starts_at at time zone v_tz)::date = v_tomorrow
      group by v.tech_id
    loop
      perform public.notify_users(
        array[r.tech_id], 'day_summary', 'info',
        'Your schedule for tomorrow',
        r.n || case when r.n = 1 then ' visit' else ' visits' end
          || ' · first one at ' || to_char(r.first_at at time zone v_tz, 'FMHH12:MI AM'),
        '/schedule', null, null, 'tech:' || r.tech_id || ':day:' || v_tomorrow, 'skip');
    end loop;
  end if;

  perform public.notif_tidy_techs();
  delete from public.notifications where at < now() - interval '90 days';
end;
$$;

-- ------------------------------------------------------------ 3. "Shift clock" wording
-- Rewrites the wording inside the existing clock functions (whatever their latest version is), then the stored titles.
do $$
declare
  f record;
  d text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.prosrc ~ 'Day clock' or p.prosrc ~ 'day clock')
  loop
    d := pg_get_functiondef(f.oid);
    d := replace(replace(d, 'Day clock', 'Shift clock'), 'day clock', 'shift clock');
    execute d;
  end loop;
end $$;

update public.notifications
set title = replace(replace(title, 'Day clock', 'Shift clock'), 'day clock', 'shift clock'),
    body = replace(replace(body, 'Day clock', 'Shift clock'), 'day clock', 'shift clock')
where title ~* 'day clock' or body ~* 'day clock';
