-- 032: clearer wording for clock edit notifications, for both kinds of clock (the job clock and the day clock).
--   Owner:  "Pat submitted a clock edit for review"
--   Tech:   "Your clock edit was Approved" / "Your clock edit was Denied"
-- Who is told, when, and the dedupe keys are as in 024 and 025. The tech's day clock notification now opens the Time clock page.
-- Run after 031. Run it once.

create or replace function public.trg_notify_time_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_who text;
  v_job text;
begin
  select coalesce(nullif(btrim(full_name), ''), email) into v_who from public.staff_users where id = new.requested_by;
  v_job := public.notif_job_label(new.job_id);
  if tg_op = 'INSERT' then
    perform public.notify_users(
      public.notif_owners(), 'time_edit_request', 'action',
      coalesce(v_who, 'A tech') || ' submitted a clock edit for review',
      concat_ws(' · ', v_job, left(btrim(new.reason), 120)),
      '/dashboard?tab=overview#time-requests', new.job_id, null, 'timeedit:' || new.id);
  elsif tg_op = 'UPDATE' and new.status <> 'pending' and old.status = 'pending' then
    perform public.notif_resolve('timeedit:' || new.id);
    perform public.notify_users(
      array[new.requested_by], 'time_edit_decided', 'info',
      case when new.status = 'approved' then 'Your clock edit was Approved' else 'Your clock edit was Denied' end,
      concat_ws(' · ', v_job, nullif(left(btrim(new.decision_note), 120), '')),
      '/jobs/' || new.job_id, new.job_id, null, 'timeedit:' || new.id || ':decided');
  end if;
  return new;
end;
$$;

create or replace function public.trg_notify_shift_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_who text;
  v_what text;
begin
  select coalesce(nullif(btrim(full_name), ''), email) into v_who from public.staff_users where id = new.requested_by;
  v_what := case new.target when 'add' then 'add a missed shift' when 'break' then 'change a break' else 'change a shift' end;
  if tg_op = 'INSERT' then
    perform public.notify_users(
      public.notif_owners(), 'shift_edit_request', 'action',
      coalesce(v_who, 'Someone') || ' submitted a clock edit for review',
      concat_ws(' · ', 'Asks to ' || v_what, left(btrim(new.reason), 120)),
      '/dashboard?tab=timeclock', null, null, 'shiftedit:' || new.id);
  elsif tg_op = 'UPDATE' and new.status <> 'pending' and old.status = 'pending' then
    perform public.notif_resolve('shiftedit:' || new.id);
    perform public.notify_users(
      array[new.requested_by], 'shift_edit_decided', 'info',
      case when new.status = 'approved' then 'Your clock edit was Approved' else 'Your clock edit was Denied' end,
      concat_ws(' · ', 'You asked to ' || v_what, nullif(left(btrim(new.decision_note), 120), '')),
      '/timeclock', null, null, 'shiftedit:' || new.id || ':decided');
  end if;
  return new;
end;
$$;
