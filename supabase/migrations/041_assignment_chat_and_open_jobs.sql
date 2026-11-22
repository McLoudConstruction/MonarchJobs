-- 041: Push 1B (job page changes, Nov 22).
--   1. Assigning a tech: the job chat says "<name> has now been assigned" and no longer asks the tech to tap
--      "Got it". The tech still gets a push, now as a heads-up (info tier) instead of "Needs action".
--      Moved / taken off / cancelled visits still ask for "Got it".
--   2. Back way into jobs: any active staff member, techs included, can open any job. Their own jobs stay on
--      My Day (that list reads the person's own visits). Every job policy goes through the two helpers below,
--      so redefining them is the only change needed. A tech still cannot change or start a visit that is not theirs.
-- Safe to run more than once. Run in the Supabase SQL Editor after 040, before deploying.

-- ------------------------------------------------------------ 1. assignment chat line
create or replace function public.trg_chat_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new_name text;
  v_old_name text;
begin
  select coalesce(nullif(btrim(full_name), ''), email) into v_new_name from public.staff_users where id = new.tech_id;

  if tg_op = 'INSERT' then
    if new.tech_id is not null and new.status = 'scheduled' then
      -- a heads-up only: the push goes out, nobody has to tap "Got it"
      perform public.chat_job_system_message(new.job_id, auth.uid(),
        'scheduled a visit for ' || coalesce(v_new_name, 'a tech') || ': ' || public.notif_fmt_time(new.starts_at),
        '{}', 'visit:' || new.id || ':assigned');
    end if;
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into v_old_name from public.staff_users where id = old.tech_id;

  if new.tech_id is distinct from old.tech_id then
    if new.tech_id is not null and new.status = 'scheduled' then
      perform public.chat_job_system_message(new.job_id, auth.uid(),
        coalesce(v_new_name, 'A tech') || ' has now been assigned',
        '{}', 'visit:' || new.id || ':assigned');
    end if;
    if old.tech_id is not null and old.status in ('scheduled', 'on_the_way') then
      perform public.chat_job_system_message(new.job_id, auth.uid(),
        'took ' || coalesce(v_old_name, 'a tech') || ' off the visit on ' || public.notif_fmt_time(old.starts_at),
        array_remove(array[old.tech_id], auth.uid()), 'visit:' || new.id || ':changed:' || old.tech_id);
    end if;
  elsif new.tech_id is not null and new.status = 'scheduled'
        and (new.starts_at, new.duration_minutes) is distinct from (old.starts_at, old.duration_minutes) then
    perform public.chat_job_system_message(new.job_id, auth.uid(),
      'moved ' || coalesce(v_new_name, 'the') || '''s visit to ' || public.notif_fmt_time(new.starts_at)
        || ' (was ' || public.notif_fmt_time(old.starts_at) || ')',
      array_remove(array[new.tech_id], auth.uid()), 'visit:' || new.id || ':changed:' || new.tech_id);
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' and new.tech_id is not null then
    perform public.chat_job_system_message(new.job_id, auth.uid(),
      'cancelled the visit on ' || public.notif_fmt_time(new.starts_at),
      array_remove(array[new.tech_id], auth.uid()), 'visit:' || new.id || ':changed:' || new.tech_id);
  end if;
  return new;
end $$;

-- the assignment notification is a heads-up (still pushed), not a "Needs action" item; the removal title uses the calmer wording
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
        array_remove(array[new.tech_id], auth.uid()), 'visit_assigned', 'info',
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
        array_remove(array[new.tech_id], auth.uid()), 'visit_assigned', 'info',
        'You''ve been assigned a new job',
        concat_ws(E'\n', v_label || ' · ' || public.notif_fmt_time(new.starts_at), nullif(v_loss, '')),
        '/jobs/' || new.job_id, new.job_id, null, 'visit:' || new.id || ':assigned');
    end if;
    if old.tech_id is not null and old.status in ('scheduled', 'on_the_way') then
      perform public.notif_resolve('visit:' || new.id || ':assigned');
      perform public.notify_users(
        array_remove(array[old.tech_id], auth.uid()), 'visit_changed', 'alert',
        'A visit was removed from your schedule',
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

-- ------------------------------------------------------------ 2. back way into jobs
-- Named "tech_assigned_to_job" because that is what every policy calls. It now means: signed-in, active
-- staff and the job exists. Office and owner already had every job.
create or replace function public.tech_assigned_to_job(j uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and exists (select 1 from public.jobs where id = j)
$$;

-- A tech can read a customer (and their addresses and contacts) once the customer has a job.
create or replace function public.tech_can_see_customer(c uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and exists (select 1 from public.jobs jb where jb.customer_id = c)
$$;
