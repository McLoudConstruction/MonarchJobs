-- 011: clearer notification wording.
-- Every notification now has a title that says what happened ("You've been assigned a new job"),
-- and the body carries the job number, customer and details. Only text changes: the triggers,
-- who is told, and the dedupe keys are exactly as in 010. Safe to run once, after 010.

-- ------------------------------------------------------------ triggers: leads
create or replace function public.trg_notify_lead_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_users(
    array_remove(public.notif_office_owner(), auth.uid()),
    'new_lead',
    case when new.priority = 'emergency' then 'alert' else 'action' end,
    case when new.priority = 'emergency' then 'New EMERGENCY lead' else 'New lead received' end,
    concat_ws(' · ',
      coalesce(nullif(btrim(new.name), ''), 'No name yet'),
      nullif(initcap(replace(new.job_type, '_', ' ')), ''),
      nullif(left(btrim(new.loss_summary), 120), ''),
      nullif(btrim(new.city), '')),
    '/leads/' || new.id, null, new.id, 'lead:' || new.id || ':new'
  );
  return new;
end;
$$;

-- -------------------------------------------------------- triggers: estimates
create or replace function public.trg_notify_estimate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_url text;
  v_times text;
begin
  if new.job_id is not null then
    v_label := public.notif_job_label(new.job_id);
    v_url := '/jobs/' || new.job_id || '#estimate';
  elsif new.lead_id is not null then
    select coalesce(nullif(btrim(name), ''), 'a lead'), nullif(btrim(preferred_times), '')
      into v_label, v_times from public.leads where id = new.lead_id;
    v_url := '/leads/' || new.lead_id;
  else
    return new;
  end if;
  v_label := coalesce(v_label, 'a customer');

  -- first time the customer opens it
  if old.first_viewed_at is null and new.first_viewed_at is not null then
    perform public.notify_users(
      public.notif_office_owner(), 'estimate_viewed', 'info',
      'A customer viewed their estimate', v_label,
      v_url, new.job_id, new.lead_id, 'estimate:' || new.id || ':viewed', 'skip');
  end if;

  -- customer approved and signed
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.notify_users(
      public.notif_office_owner(), 'estimate_approved', 'action',
      'A customer approved their estimate',
      v_label || case when new.lead_id is not null
        then ' · Ready to schedule.' || coalesce(' Preferred times: ' || left(v_times, 120), '')
        else '' end,
      v_url, new.job_id, new.lead_id, 'estimate:' || new.id || ':approved');
  end if;
  return new;
end;
$$;

-- --------------------------------------------------- triggers: the job history
create or replace function public.trg_notify_job_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_role public.staff_role;
  v_name text;
  v_visit text := new.details ->> 'visit_id';
  v_what text;
  v_desc text;
begin
  if new.job_id is null then return new; end if;

  select role, coalesce(nullif(btrim(full_name), ''), email) into v_role, v_name
  from public.staff_users where id = new.actor_id;
  v_name := coalesce(v_name, 'Someone');
  v_label := public.notif_job_label(new.job_id);
  if v_label is null then return new; end if;

  if new.kind = 'visit_on_the_way' then
    perform public.notify_users(
      array_remove(public.notif_office_owner(), new.actor_id), 'tech_on_the_way', 'info',
      'A tech is on the way',
      v_name || ' · ' || v_label || ' · about ' || coalesce(new.details ->> 'minutes', '?') || ' min out',
      '/jobs/' || new.job_id, new.job_id, null, 'visit:' || v_visit || ':otw');

  elsif new.kind = 'visit_started' then
    perform public.notify_users(
      array_remove(public.notif_office_owner(), new.actor_id), 'job_started', 'info',
      'A job was started', v_label || ' · started by ' || v_name,
      '/jobs/' || new.job_id, new.job_id, null, 'visit:' || v_visit || ':started');

  elsif new.kind = 'visit_finished' then
    if (new.details -> 'job_completed') = 'true'::jsonb then
      perform public.notify_users(
        array_remove(public.notif_office_owner(), new.actor_id), 'job_completed', 'action',
        'A job was completed', v_label || ' · finished by ' || v_name,
        '/jobs/' || new.job_id, new.job_id, null, 'job:' || new.job_id || ':completed');
    else
      perform public.notify_users(
        array_remove(public.notif_office_owner(), new.actor_id), 'visit_finished', 'info',
        'A visit was finished',
        v_label || ' · ' || v_name || ' finished. Another visit is still scheduled.',
        '/jobs/' || new.job_id, new.job_id, null, 'visit:' || v_visit || ':finished');
    end if;

  elsif new.kind in ('estimate_line_added', 'estimate_line_changed', 'estimate_line_removed') then
    v_what := case new.kind when 'estimate_line_added' then 'added' when 'estimate_line_removed' then 'removed' else 'changed' end;
    v_desc := v_label || ' · ' || v_name || ' ' || v_what || ' "' || left(coalesce(new.details ->> 'description', 'a line'), 80) || '"';
    -- the owner hears about changes made by a tech, grouped per job
    if v_role = 'tech' then
      perform public.notify_users(
        array_remove(public.notif_office_owner(), new.actor_id), 'scope_changed', 'info',
        'A tech changed a job''s scope or price', v_desc,
        '/jobs/' || new.job_id || '#estimate', new.job_id, null,
        'job:' || new.job_id || ':scope:office', 'update', interval '10 minutes');
    end if;
    -- techs on the job hear about changes made by someone else
    perform public.notify_users(
      array_remove(public.notif_job_techs(new.job_id), new.actor_id), 'job_scope_updated', 'info',
      'The scope or price on your job changed', v_desc,
      '/jobs/' || new.job_id || '#estimate', new.job_id, null,
      'job:' || new.job_id || ':scope:tech', 'update', interval '10 minutes');

  elsif new.kind in ('work_order_created', 'visit_added', 'visit_rescheduled', 'visit_assigned')
        and (new.details -> 'override_double_booking') = 'true'::jsonb then
    perform public.notify_users(
      array_remove(public.notif_office_owner(), new.actor_id), 'double_booking', 'alert',
      'A tech was double-booked',
      v_label || ' · ' || v_name || ' booked a tech over another job. Check the schedule for flagged jobs.',
      '/schedule', new.job_id, null, null);
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------- triggers: visits
create or replace function public.trg_notify_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_loss text;
  v_return boolean;
begin
  v_label := public.notif_job_label(new.job_id);
  if v_label is null then return new; end if;
  select left(btrim(loss_summary), 160) into v_loss from public.jobs where id = new.job_id;

  if tg_op = 'INSERT' then
    if new.tech_id is not null and new.status = 'scheduled' then
      v_return := exists (select 1 from public.job_visits where job_id = new.job_id and id <> new.id and status = 'finished');
      perform public.notify_users(
        array_remove(array[new.tech_id], auth.uid()), 'visit_assigned', 'action',
        case when v_return then 'You''ve been assigned a return visit' else 'You''ve been assigned a new job' end,
        concat_ws(E'\n', v_label || ' · ' || public.notif_fmt_time(new.starts_at), nullif(v_loss, '')),
        '/jobs/' || new.job_id, new.job_id, null, 'visit:' || new.id || ':assigned');
    end if;
    return new;
  end if;

  -- a different tech now has the visit
  if new.tech_id is distinct from old.tech_id then
    if new.tech_id is not null and new.status = 'scheduled' then
      perform public.notify_users(
        array_remove(array[new.tech_id], auth.uid()), 'visit_assigned', 'action',
        'You''ve been assigned a new job',
        concat_ws(E'\n', v_label || ' · ' || public.notif_fmt_time(new.starts_at), nullif(v_loss, '')),
        '/jobs/' || new.job_id, new.job_id, null, 'visit:' || new.id || ':assigned');
    end if;
    if old.tech_id is not null and old.status in ('scheduled', 'on_the_way') then
      perform public.notif_resolve('visit:' || new.id || ':assigned');
      perform public.notify_users(
        array_remove(array[old.tech_id], auth.uid()), 'visit_changed', 'alert',
        'You''ve been removed from a visit',
        v_label || ' · reassigned. It was ' || public.notif_fmt_time(old.starts_at),
        '/schedule', new.job_id, null, 'visit:' || new.id || ':changed:' || old.tech_id);
    end if;
  -- same tech, new time
  elsif new.tech_id is not null and new.status = 'scheduled'
        and (new.starts_at, new.duration_minutes) is distinct from (old.starts_at, old.duration_minutes) then
    perform public.notify_users(
      array_remove(array[new.tech_id], auth.uid()), 'visit_changed', 'alert',
      'Your visit was rescheduled',
      v_label || ' · now ' || public.notif_fmt_time(new.starts_at) || ' (was ' || public.notif_fmt_time(old.starts_at) || ')',
      '/jobs/' || new.job_id, new.job_id, null, 'visit:' || new.id || ':changed:' || new.tech_id);
  end if;

  -- cancelled
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.tech_id is not null then
    perform public.notify_users(
      array_remove(array[new.tech_id], auth.uid()), 'visit_changed', 'alert',
      'Your visit was cancelled', v_label || ' · was ' || public.notif_fmt_time(new.starts_at),
      '/schedule', new.job_id, null, 'visit:' || new.id || ':changed:' || new.tech_id);
  end if;

  -- the assignment is no longer waiting on the tech once the visit moves on
  if new.status is distinct from old.status and new.status <> 'scheduled' then
    perform public.notif_resolve('visit:' || new.id || ':assigned');
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------- triggers: jobs
create or replace function public.trg_notify_job_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_changed text[] := '{}';
begin
  if new.warning is distinct from old.warning then v_changed := array_append(v_changed, 'warning'); end if;
  if new.loss_summary is distinct from old.loss_summary then v_changed := array_append(v_changed, 'loss summary'); end if;
  if new.internal_notes is distinct from old.internal_notes then v_changed := array_append(v_changed, 'internal notes'); end if;
  if new.address_id is distinct from old.address_id then v_changed := array_append(v_changed, 'address'); end if;

  if cardinality(v_changed) > 0 then
    perform public.notify_users(
      array_remove(public.notif_job_techs(new.id), auth.uid()), 'job_info_changed', 'alert',
      'Details changed on your job',
      public.notif_job_label(new.id) || ' · updated: ' || array_to_string(v_changed, ', '),
      '/jobs/' || new.id, new.id, null, 'job:' || new.id || ':info', 'update', interval '5 minutes');
  end if;

  if new.status in ('closed', 'cancelled') and old.status is distinct from new.status then
    perform public.notif_resolve('job:' || new.id || ':completed');
  end if;
  return new;
end;
$$;

create or replace function public.trg_notify_address_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_changed text[] := '{}';
  r record;
begin
  if new.gate_code is distinct from old.gate_code then v_changed := array_append(v_changed, 'gate code'); end if;
  if new.warnings is distinct from old.warnings then v_changed := array_append(v_changed, 'warnings'); end if;
  if new.access_notes is distinct from old.access_notes then v_changed := array_append(v_changed, 'access notes'); end if;
  if (new.street, new.unit, new.city, new.zip) is distinct from (old.street, old.unit, old.city, old.zip) then
    v_changed := array_append(v_changed, 'address');
  end if;
  if cardinality(v_changed) = 0 then return new; end if;

  for r in select id from public.jobs where address_id = new.id and status not in ('closed', 'cancelled') loop
    perform public.notify_users(
      array_remove(public.notif_job_techs(r.id), auth.uid()), 'job_info_changed', 'alert',
      'Details changed on your job',
      public.notif_job_label(r.id) || ' · updated: ' || array_to_string(v_changed, ', '),
      '/jobs/' || r.id, r.id, null, 'job:' || r.id || ':info', 'update', interval '5 minutes');
  end loop;
  return new;
end;
$$;

-- ------------------------------------------------------ triggers: job updates
create or replace function public.trg_notify_job_update_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.staff_role;
  v_name text;
  v_label text;
begin
  if tg_op = 'DELETE' then
    perform public.notif_resolve('update:' || old.id || ':draft');
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.status = 'sent' and old.status <> 'sent' then
      perform public.notif_resolve('update:' || new.id || ':draft');
    end if;
    return new;
  end if;

  select role, coalesce(nullif(btrim(full_name), ''), email) into v_role, v_name
  from public.staff_users where id = new.created_by;
  v_label := public.notif_job_label(new.job_id);
  if v_label is null then return new; end if;

  -- a tech saved a customer progress update that someone in the office has to send
  if new.kind = 'progress' and new.status = 'draft' and v_role = 'tech' then
    perform public.notify_users(
      array_remove(public.notif_office_owner(), new.created_by), 'progress_draft', 'action',
      'A progress update needs review',
      v_label || ' · ' || coalesce(v_name, 'A tech') || ' saved a draft that needs to be reviewed and sent.',
      '/jobs/' || new.job_id || '#updates', new.job_id, null, 'update:' || new.id || ':draft');
  end if;

  -- the office left an internal note on a job that a tech is scheduled on
  if new.kind = 'internal' and v_role in ('owner', 'office') then
    perform public.notify_users(
      array_remove(public.notif_job_techs(new.job_id), new.created_by), 'job_info_changed', 'alert',
      'Details changed on your job', v_label || ' · updated: internal notes',
      '/jobs/' || new.job_id || '#updates', new.job_id, null, 'job:' || new.job_id || ':info', 'update', interval '5 minutes');
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------ triggers: sign-ups
create or replace function public.trg_notify_staff()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not new.active then
      perform public.notify_users(
        public.notif_owners(), 'staff_signup', 'action',
        'A new user is waiting for activation',
        coalesce(nullif(btrim(new.full_name), ''), new.email) || ' · activate in Settings > Users.',
        '/settings#users', null, null, 'staff:' || new.id || ':signup');
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.active and not old.active then
      perform public.notif_resolve('staff:' || new.id || ':signup');
    end if;
    return new;
  end if;
  perform public.notif_resolve('staff:' || old.id || ':signup');
  return old;
end;
$$;

-- -------------------------------------------------- time-based (pg_cron) reminders
create or replace function public.notify_scheduled_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tz text := public.notif_tz();
  v_tomorrow date := (now() at time zone public.notif_tz())::date + 1;
  r record;
begin
  -- an hour ahead; only for visits booked more than an hour before they start
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

  -- tomorrow's schedule, once a day at 6 pm
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

  delete from public.notifications where at < now() - interval '90 days';
end;
$$;
