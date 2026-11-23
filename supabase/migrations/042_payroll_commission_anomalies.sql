-- 042: Push 1B.
--   #114 payroll export       pay period setting (the CSV itself is made on screen from the clocks)
--   #84  commission calculator one rule per person (percent of paid invoices, or of margin), owner only
--   #107 profit by loss type   no database change (read from jobs, invoices and the job costing tables)
--   #108 cash-flow forecast    no database change (read from invoices, estimates and visits)
--   #112 anomaly alerts        settings, a hourly check, and the owner notification (off until switched on in Settings > Reminders)
-- Safe to run more than once. Run in the Supabase SQL Editor after 041, before deploying.

-- ============================================================ settings
alter table public.settings
  add column if not exists payroll_period text not null default 'biweekly',
  add column if not exists payroll_anchor date,
  add column if not exists anomaly_alerts_enabled boolean not null default false,
  add column if not exists anomaly_hours_pct int not null default 120,
  add column if not exists anomaly_cost_pct int not null default 75,
  add column if not exists anomaly_equip_days int not null default 5;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_payroll_period_chk') then
    alter table public.settings add constraint settings_payroll_period_chk check (payroll_period in ('weekly', 'biweekly', 'semimonthly', 'monthly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_anomaly_chk') then
    alter table public.settings add constraint settings_anomaly_chk
      check (anomaly_hours_pct between 100 and 500 and anomaly_cost_pct between 10 and 200 and anomaly_equip_days between 1 and 60);
  end if;
end $$;

-- ============================================================ commission rules (owner only)
create table if not exists public.commission_rules (
  staff_id uuid primary key references public.staff_users (id) on delete cascade,
  basis text not null default 'paid' check (basis in ('paid', 'margin')),
  percent numeric(5, 2) not null default 0 check (percent >= 0 and percent <= 100),
  updated_at timestamptz not null default now()
);
drop trigger if exists commission_rules_touch on public.commission_rules;
create trigger commission_rules_touch before update on public.commission_rules
  for each row execute function public.touch_updated_at();

alter table public.commission_rules enable row level security;
drop policy if exists commission_rules_owner on public.commission_rules;
create policy commission_rules_owner on public.commission_rules for all
  using (public.is_owner()) with check (public.is_owner());

-- ============================================================ anomaly alerts
-- Tells the owners about one anomaly on one job, once. Returns true when a notification was made, false when that alert was
-- already sent. Called by the website's hourly check (service role only).
create or replace function public.anomaly_notify(p_job uuid, p_kind text, p_title text, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_key text := 'anomaly:' || p_job::text || ':' || p_kind;
begin
  if p_kind not in ('hours', 'cost', 'equipment') then
    raise exception 'BAD_KIND: unknown alert kind';
  end if;
  if exists (select 1 from public.notifications where dedupe_key = v_key) then
    return false;
  end if;
  perform public.notify_users(
    public.notif_owners(), 'anomaly_alert', 'alert',
    left(p_title, 160), left(p_body, 400),
    '/jobs/' || p_job::text, p_job, null, v_key, 'skip');
  return true;
end;
$$;
revoke all on function public.anomaly_notify(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.anomaly_notify(uuid, text, text, text) to service_role;

-- When a job finishes or is cancelled its alerts are done: they stop counting in the bell.
create or replace function public.anomaly_resolve_closed()
returns void language sql security definer set search_path = public as $$
  update public.notifications n set resolved_at = now()
  from public.jobs j
  where n.type = 'anomaly_alert' and n.resolved_at is null and n.job_id = j.id
    and j.status in ('completed', 'closed', 'cancelled')
$$;
revoke all on function public.anomaly_resolve_closed() from public, anon, authenticated;
grant execute on function public.anomaly_resolve_closed() to service_role;

-- The database knocks on the site's door once an hour; the site decides whether anything is worth an alert.
alter table public.notification_config add column if not exists anomaly_url text not null default '';

create or replace function public.ping_anomalies()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
  v_on boolean;
begin
  select anomaly_url, push_secret into v_url, v_secret from public.notification_config where id = 1;
  select anomaly_alerts_enabled into v_on from public.settings where id = 1;
  if not coalesce(v_on, false) or coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return; end if;
  begin
    perform net.http_post(
      url := v_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'anomaly check could not be queued: %', sqlerrm;
  end;
end;
$$;
revoke all on function public.ping_anomalies() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('hourly-anomaly-check') where exists (select 1 from cron.job where jobname = 'hourly-anomaly-check');
  perform cron.schedule('hourly-anomaly-check', '15 * * * *', 'select public.ping_anomalies()');
exception when others then
  raise notice 'pg_cron could not be set up (%). Enable it in Database > Extensions and run this block again: job alerts will not run until then.', sqlerrm;
end $$;

-- ================================================================== AFTER RUNNING
-- Job alerts are OFF until the owner turns them on in Settings > Reminders. To let the hourly check reach the site, run this once
-- with your real site address:
--
--   update public.notification_config
--   set anomaly_url = 'https://jobs.monarchcleaningsolutions.com/api/cron/anomalies'
--   where id = 1;
