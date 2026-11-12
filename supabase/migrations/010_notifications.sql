-- 010: in-app notifications, push subscriptions and per-person preferences.
-- Run after 001 to 009. Safe to read top to bottom; run it once.
--
-- How it works
--   * Database triggers write a row into `notifications` the moment something happens (new lead,
--     estimate approved, tech assigned, job completed, ...). That is the bell and the inbox.
--   * The same function then asks the website (/api/push/send) to send a Web Push to that person's
--     phones, using pg_net. Nothing here needs a Vercel cron job.
--   * Time-based reminders (an hour before a visit, tomorrow's schedule) run inside Supabase with
--     pg_cron, every 10 minutes.
--
-- AFTER RUNNING THIS, run the two lines at the very bottom once (site address + secret).

-- ------------------------------------------------------------------ extensions
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net could not be enabled (%). Enable it in Database > Extensions, then push will work.', sqlerrm;
end $$;

-- --------------------------------------------------------------------- tables
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.staff_users (id) on delete cascade,
  type text not null,                    -- see lib/notificationTypes.js
  tier text not null check (tier in ('action', 'info', 'alert')),
  title text not null,
  body text not null default '',
  url text not null default '/dashboard', -- where a tap goes (a path, may end in #tab)
  job_id uuid references public.jobs (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  dedupe_key text,                       -- same key for the same person = same notification, updated in place
  repeat_count int not null default 1,   -- how many times it was updated in place (grouped changes)
  at timestamptz not null default now(), -- when it last happened; the list is sorted by this
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz,               -- set when whatever needed doing has been done
  last_push_at timestamptz
);
create index notifications_user_at_idx on public.notifications (user_id, at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null and resolved_at is null;
create unique index notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_job_idx on public.notifications (job_id) where job_id is not null;
create index notifications_lead_idx on public.notifications (lead_id) where lead_id is not null;
create index notifications_at_idx on public.notifications (at);

-- One row per phone or browser that turned push on. Written only by the server.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff_users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- A row exists only when someone changed a type from its default (on).
create table public.notification_preferences (
  user_id uuid not null references public.staff_users (id) on delete cascade,
  type text not null,
  enabled boolean not null default true,
  primary key (user_id, type)
);

-- Where the database sends push requests. One row, filled in once by hand (see bottom of file).
create table public.notification_config (
  id int primary key default 1 check (id = 1),
  push_url text not null default '',
  push_secret text not null default ''
);
insert into public.notification_config (id) values (1) on conflict do nothing;

-- ------------------------------------------------------------------------ RLS
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_config enable row level security;

create policy notifications_select on public.notifications for select using (user_id = auth.uid());
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_subscriptions_select on public.push_subscriptions for select using (user_id = auth.uid());

create policy notification_preferences_select on public.notification_preferences for select using (user_id = auth.uid());
create policy notification_preferences_insert on public.notification_preferences for insert with check (user_id = auth.uid());
create policy notification_preferences_update on public.notification_preferences for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_preferences_delete on public.notification_preferences for delete using (user_id = auth.uid());

-- No policies on notification_config: only the server and the functions below can read it.

-- A signed-in browser may read its notifications and mark them read; nothing else.
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
revoke all on public.notification_config from anon, authenticated;

-- Live badge: the browser listens for new rows for the signed-in person (RLS applies).
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then
  raise notice 'Could not add notifications to the realtime publication (%). The bell still refreshes every minute.', sqlerrm;
end $$;

-- ------------------------------------------------------------------- helpers
create or replace function public.notif_tz()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from public.settings where id = 1), 'America/Chicago')
$$;

create or replace function public.notif_fmt_time(p timestamptz)
returns text language sql stable security definer set search_path = public as $$
  select to_char(p at time zone public.notif_tz(), 'Dy Mon FMDD, FMHH12:MI AM')
$$;

create or replace function public.notif_job_label(p_job uuid)
returns text language sql stable security definer set search_path = public as $$
  select '#' || j.job_number || ' ' || c.display_name
  from public.jobs j join public.customers c on c.id = j.customer_id
  where j.id = p_job
$$;

-- Everyone who should hear about office-level events. Office mirrors the owner for now.
create or replace function public.notif_office_owner()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.staff_users where active and role in ('owner', 'office')
$$;

create or replace function public.notif_owners()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.staff_users where active and role = 'owner'
$$;

-- Techs who still have a visit coming up (or under way) on the job.
create or replace function public.notif_job_techs(p_job uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct v.tech_id), '{}')
  from public.job_visits v
  where v.job_id = p_job and v.tech_id is not null and v.status in ('scheduled', 'on_the_way', 'started')
$$;

-- Asks the website to send the push. Fire and forget: the request is sent after the surrounding
-- change commits, and a failure here never blocks the change itself.
create or replace function public.push_notifications(p_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select push_url, push_secret into v_url, v_secret from public.notification_config where id = 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' or cardinality(p_ids) = 0 then
    return;
  end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('ids', to_jsonb(p_ids)),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'push request could not be queued: %', sqlerrm;
  end;
end;
$$;

-- The one function every trigger uses to notify people.
--   p_dedupe     same person + same key = update the existing notification instead of adding another
--   p_if_exists  'update' (default) refreshes it and marks it unread again; 'skip' leaves it alone
--   p_push_gap   when updating in place, send another push only if the last one is at least this old
create or replace function public.notify_users(
  p_user_ids uuid[],
  p_type text,
  p_tier text,
  p_title text,
  p_body text,
  p_url text,
  p_job uuid default null,
  p_lead uuid default null,
  p_dedupe text default null,
  p_if_exists text default 'update',
  p_push_gap interval default interval '0'
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_id bigint;
  v_last_push timestamptz;
  v_push bigint[] := '{}';
begin
  if p_user_ids is null then return; end if;
  foreach v_user in array p_user_ids loop
    continue when v_user is null;
    continue when not exists (select 1 from public.staff_users where id = v_user and active);
    continue when exists (
      select 1 from public.notification_preferences
      where user_id = v_user and type = p_type and not enabled
    );

    v_id := null;
    v_last_push := null;
    if p_dedupe is not null then
      select id, last_push_at into v_id, v_last_push
      from public.notifications where user_id = v_user and dedupe_key = p_dedupe for update;
    end if;

    if v_id is not null then
      continue when p_if_exists = 'skip';
      update public.notifications set
        tier = p_tier, title = p_title, body = coalesce(p_body, ''), url = p_url,
        job_id = coalesce(p_job, job_id), lead_id = coalesce(p_lead, lead_id),
        repeat_count = repeat_count + 1, at = now(), read_at = null, resolved_at = null
      where id = v_id;
      if v_last_push is null or now() - v_last_push >= p_push_gap then
        update public.notifications set last_push_at = now() where id = v_id;
        v_push := array_append(v_push, v_id);
      end if;
    else
      insert into public.notifications (user_id, type, tier, title, body, url, job_id, lead_id, dedupe_key, last_push_at)
      values (v_user, p_type, p_tier, p_title, coalesce(p_body, ''), p_url, p_job, p_lead, p_dedupe, now())
      returning id into v_id;
      v_push := array_append(v_push, v_id);
    end if;
  end loop;

  if cardinality(v_push) > 0 then
    perform public.push_notifications(v_push);
  end if;
end;
$$;

-- Marks "needs doing" notifications as done once whatever they asked for has happened.
create or replace function public.notif_resolve(p_dedupe text)
returns void language sql security definer set search_path = public as $$
  update public.notifications set resolved_at = now() where dedupe_key = p_dedupe and resolved_at is null
$$;

-- ------------------------------------------------------------ triggers: leads
-- New lead (web form, phone, or created by someone in the office). The person who created it is
-- not told about their own action.
create or replace function public.trg_notify_lead_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_users(
    array_remove(public.notif_office_owner(), auth.uid()),
    'new_lead',
    case when new.priority = 'emergency' then 'alert' else 'action' end,
    case when new.priority = 'emergency' then 'EMERGENCY lead: ' else 'New lead: ' end
      || coalesce(nullif(btrim(new.name), ''), 'no name yet'),
    concat_ws(' · ',
      nullif(initcap(replace(new.job_type, '_', ' ')), ''),
      nullif(left(btrim(new.loss_summary), 120), ''),
      nullif(btrim(new.city), '')),
    '/leads/' || new.id, null, new.id, 'lead:' || new.id || ':new'
  );
  return new;
end;
$$;
create trigger leads_notify_insert after insert on public.leads
  for each row execute function public.trg_notify_lead_insert();

-- Once a lead is booked (it became a job) or lost, its "needs doing" notifications are done.
create or replace function public.trg_notify_lead_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('booked', 'lost') and old.status is distinct from new.status then
    update public.notifications set resolved_at = now()
    where lead_id = new.id and type in ('new_lead', 'estimate_approved') and resolved_at is null;
  end if;
  return new;
end;
$$;
create trigger leads_notify_update after update of status on public.leads
  for each row execute function public.trg_notify_lead_update();

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
      'Estimate viewed: ' || v_label, 'The customer opened the estimate.',
      v_url, new.job_id, new.lead_id, 'estimate:' || new.id || ':viewed', 'skip');
  end if;

  -- customer approved and signed
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.notify_users(
      public.notif_office_owner(), 'estimate_approved', 'action',
      'Estimate approved: ' || v_label,
      case when new.lead_id is not null
        then 'Ready to schedule.' || coalesce(' Preferred times: ' || left(v_times, 120), '')
        else 'The customer approved the estimate.' end,
      v_url, new.job_id, new.lead_id, 'estimate:' || new.id || ':approved');
  end if;
  return new;
end;
$$;
create trigger estimates_notify after update on public.estimates
  for each row execute function public.trg_notify_estimate();

-- --------------------------------------------------- triggers: the job history
-- Visit status buttons, price/scope changes and double-booking overrides all land in job_events,
-- so one trigger there covers them wherever they were written from.
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
      v_name || ' is on the way',
      v_label || ' · about ' || coalesce(new.details ->> 'minutes', '?') || ' min out',
      '/jobs/' || new.job_id, new.job_id, null, 'visit:' || v_visit || ':otw');

  elsif new.kind = 'visit_started' then
    perform public.notify_users(
      array_remove(public.notif_office_owner(), new.actor_id), 'job_started', 'info',
      'Started: ' || v_label, v_name || ' started the job.',
      '/jobs/' || new.job_id, new.job_id, null, 'visit:' || v_visit || ':started');

  elsif new.kind = 'visit_finished' then
    if (new.details -> 'job_completed') = 'true'::jsonb then
      perform public.notify_users(
        array_remove(public.notif_office_owner(), new.actor_id), 'job_completed', 'action',
        'Job completed: ' || v_label, 'Finished by ' || v_name || '.',
        '/jobs/' || new.job_id, new.job_id, null, 'job:' || new.job_id || ':completed');
    else
      perform public.notify_users(
        array_remove(public.notif_office_owner(), new.actor_id), 'visit_finished', 'info',
        'Visit finished: ' || v_label, v_name || ' finished. Another visit is still scheduled.',
        '/jobs/' || new.job_id, new.job_id, null, 'visit:' || v_visit || ':finished');
    end if;

  elsif new.kind in ('estimate_line_added', 'estimate_line_changed', 'estimate_line_removed') then
    v_what := case new.kind when 'estimate_line_added' then 'added' when 'estimate_line_removed' then 'removed' else 'changed' end;
    v_desc := v_name || ' ' || v_what || ' "' || left(coalesce(new.details ->> 'description', 'a line'), 80) || '"';
    -- the owner hears about changes made by a tech, grouped per job
    if v_role = 'tech' then
      perform public.notify_users(
        array_remove(public.notif_office_owner(), new.actor_id), 'scope_changed', 'info',
        'Scope or price changed: ' || v_label, v_desc,
        '/jobs/' || new.job_id || '#estimate', new.job_id, null,
        'job:' || new.job_id || ':scope:office', 'update', interval '10 minutes');
    end if;
    -- techs on the job hear about changes made by someone else
    perform public.notify_users(
      array_remove(public.notif_job_techs(new.job_id), new.actor_id), 'job_scope_updated', 'info',
      'Scope or price updated: ' || v_label, v_desc,
      '/jobs/' || new.job_id || '#estimate', new.job_id, null,
      'job:' || new.job_id || ':scope:tech', 'update', interval '10 minutes');

  elsif new.kind in ('work_order_created', 'visit_added', 'visit_rescheduled', 'visit_assigned')
        and (new.details -> 'override_double_booking') = 'true'::jsonb then
    perform public.notify_users(
      array_remove(public.notif_office_owner(), new.actor_id), 'double_booking', 'alert',
      'Double-booked: ' || v_label,
      v_name || ' booked a tech over another job. Check the schedule for flagged jobs.',
      '/schedule', new.job_id, null, null);
  end if;

  return new;
end;
$$;
create trigger job_events_notify after insert on public.job_events
  for each row execute function public.trg_notify_job_event();

-- ----------------------------------------------------------- triggers: visits
-- Assignments and schedule changes for the tech. Status buttons (on the way, started, finished)
-- are covered by job_events above and do not come through here, except to close assignments.
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
        case when v_return then 'Return visit: ' else 'New visit: ' end || v_label,
        concat_ws(E'\n', public.notif_fmt_time(new.starts_at), nullif(v_loss, '')),
        '/jobs/' || new.job_id, new.job_id, null, 'visit:' || new.id || ':assigned');
    end if;
    return new;
  end if;

  -- a different tech now has the visit
  if new.tech_id is distinct from old.tech_id then
    if new.tech_id is not null and new.status = 'scheduled' then
      perform public.notify_users(
        array_remove(array[new.tech_id], auth.uid()), 'visit_assigned', 'action',
        'New visit: ' || v_label,
        concat_ws(E'\n', public.notif_fmt_time(new.starts_at), nullif(v_loss, '')),
        '/jobs/' || new.job_id, new.job_id, null, 'visit:' || new.id || ':assigned');
    end if;
    if old.tech_id is not null and old.status in ('scheduled', 'on_the_way') then
      perform public.notif_resolve('visit:' || new.id || ':assigned');
      perform public.notify_users(
        array_remove(array[old.tech_id], auth.uid()), 'visit_changed', 'alert',
        'Removed from visit: ' || v_label, 'This visit was reassigned: ' || public.notif_fmt_time(old.starts_at),
        '/schedule', new.job_id, null, 'visit:' || new.id || ':changed:' || old.tech_id);
    end if;
  -- same tech, new time
  elsif new.tech_id is not null and new.status = 'scheduled'
        and (new.starts_at, new.duration_minutes) is distinct from (old.starts_at, old.duration_minutes) then
    perform public.notify_users(
      array_remove(array[new.tech_id], auth.uid()), 'visit_changed', 'alert',
      'Visit moved: ' || v_label,
      'Now ' || public.notif_fmt_time(new.starts_at) || ' (was ' || public.notif_fmt_time(old.starts_at) || ')',
      '/jobs/' || new.job_id, new.job_id, null, 'visit:' || new.id || ':changed:' || new.tech_id);
  end if;

  -- cancelled
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.tech_id is not null then
    perform public.notify_users(
      array_remove(array[new.tech_id], auth.uid()), 'visit_changed', 'alert',
      'Visit cancelled: ' || v_label, public.notif_fmt_time(new.starts_at),
      '/schedule', new.job_id, null, 'visit:' || new.id || ':changed:' || new.tech_id);
  end if;

  -- the assignment is no longer waiting on the tech once the visit moves on
  if new.status is distinct from old.status and new.status <> 'scheduled' then
    perform public.notif_resolve('visit:' || new.id || ':assigned');
  end if;
  return new;
end;
$$;
create trigger job_visits_notify after insert or update on public.job_visits
  for each row execute function public.trg_notify_visit();

-- ------------------------------------------------------------- triggers: jobs
-- Warning banner, loss blurb, internal notes or address changed: tell the techs on the job.
-- Values are never put in the message (gate codes and the like stay in the app).
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
      'Job details changed: ' || public.notif_job_label(new.id),
      'Updated: ' || array_to_string(v_changed, ', '),
      '/jobs/' || new.id, new.id, null, 'job:' || new.id || ':info', 'update', interval '5 minutes');
  end if;

  if new.status in ('closed', 'cancelled') and old.status is distinct from new.status then
    perform public.notif_resolve('job:' || new.id || ':completed');
  end if;
  return new;
end;
$$;
create trigger jobs_notify after update of warning, loss_summary, internal_notes, address_id, status on public.jobs
  for each row execute function public.trg_notify_job_update();

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
      'Job details changed: ' || public.notif_job_label(r.id),
      'Updated: ' || array_to_string(v_changed, ', '),
      '/jobs/' || r.id, r.id, null, 'job:' || r.id || ':info', 'update', interval '5 minutes');
  end loop;
  return new;
end;
$$;
create trigger addresses_notify after update on public.addresses
  for each row execute function public.trg_notify_address_update();

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
      'Progress update waiting: ' || v_label,
      coalesce(v_name, 'A tech') || ' saved a draft that needs to be reviewed and sent.',
      '/jobs/' || new.job_id || '#updates', new.job_id, null, 'update:' || new.id || ':draft');
  end if;

  -- the office left an internal note on a job that a tech is scheduled on
  if new.kind = 'internal' and v_role in ('owner', 'office') then
    perform public.notify_users(
      array_remove(public.notif_job_techs(new.job_id), new.created_by), 'job_info_changed', 'alert',
      'Job details changed: ' || v_label, 'Updated: internal notes',
      '/jobs/' || new.job_id || '#updates', new.job_id, null, 'job:' || new.job_id || ':info', 'update', interval '5 minutes');
  end if;
  return new;
end;
$$;
create trigger job_updates_notify after insert or update or delete on public.job_updates
  for each row execute function public.trg_notify_job_update_row();

-- ------------------------------------------------------------ triggers: sign-ups
-- A new account starts inactive until the owner activates it in Settings > Users.
create or replace function public.trg_notify_staff()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not new.active then
      perform public.notify_users(
        public.notif_owners(), 'staff_signup', 'action',
        'New sign-up: ' || coalesce(nullif(btrim(new.full_name), ''), new.email),
        'Waiting for activation in Settings > Users.',
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
create trigger staff_users_notify after insert or update of active or delete on public.staff_users
  for each row execute function public.trg_notify_staff();

-- -------------------------------------------------- time-based (pg_cron, no Vercel cron)
-- Runs every 10 minutes:
--   * an hour before a scheduled visit, the tech gets a reminder
--   * at 6 pm business time, each tech gets tomorrow's visit count
--   * notifications older than 90 days are removed
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
      'Coming up: ' || coalesce(public.notif_job_label(r.job_id), 'visit'),
      'Starts at ' || to_char(r.starts_at at time zone v_tz, 'FMHH12:MI AM'),
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
        'Tomorrow: ' || r.n || case when r.n = 1 then ' visit' else ' visits' end,
        'First one at ' || to_char(r.first_at at time zone v_tz, 'FMHH12:MI AM'),
        '/schedule', null, null, 'tech:' || r.tech_id || ':day:' || v_tomorrow, 'skip');
    end loop;
  end if;

  delete from public.notifications where at < now() - interval '90 days';
end;
$$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('notify-scheduled-reminders', '*/10 * * * *', 'select public.notify_scheduled_reminders()');
exception when others then
  raise notice 'pg_cron could not be set up (%). Enable it in Database > Extensions and run this block again: reminders will not run until then.', sqlerrm;
end $$;

-- ================================================================== AFTER RUNNING
-- Run these two lines once in the SQL Editor, with your real site address and a long random secret.
-- Put the SAME secret in Vercel as PUSH_WEBHOOK_SECRET (CRON_SECRET also works if you prefer one value).
--
--   update public.notification_config
--   set push_url = 'https://YOUR-SITE.vercel.app/api/push/send', push_secret = 'PASTE-A-LONG-RANDOM-SECRET'
--   where id = 1;
--
-- Until then the bell and inbox work and push is simply skipped.
