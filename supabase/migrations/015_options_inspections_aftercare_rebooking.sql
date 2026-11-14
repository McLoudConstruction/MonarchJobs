-- 015: estimate options and add-ons, before/after inspections, the customer page with "report a problem",
-- aftercare messages, recurring plans and rebooking reminders. Run after 001 to 014.

-- ============================================================ estimate options
-- A line is one of: included (no tier, not optional), part of one tier (good / better / best),
-- or an optional add-on the customer can tick. The customer's choice is saved when they sign.
alter table public.estimate_lines
  add column tier text check (tier in ('good', 'better', 'best')),
  add column optional boolean not null default false,
  add column accepted boolean not null default false,        -- an optional line the customer ticked
  add constraint estimate_lines_tier_or_optional check (not (optional and tier is not null));
alter table public.estimates add column chosen_tier text check (chosen_tier in ('good', 'better', 'best'));
alter table public.estimate_signatures add column chosen_tier text;

-- Changing a line's type is a change to the quote, so it goes in the change log like price and quantity do.
create or replace function public.log_estimate_line_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_job uuid;
  v_email text;
  v_kind text;
  v_details jsonb;
begin
  select email into v_email from public.staff_users where id = auth.uid();

  if tg_op = 'DELETE' then
    v_job := public.estimate_job(old.estimate_id);
    v_kind := 'estimate_line_removed';
    v_details := jsonb_build_object('description', old.description, 'quantity', old.quantity, 'unit_price', old.unit_price);
  elsif tg_op = 'INSERT' then
    v_job := public.estimate_job(new.estimate_id);
    v_kind := 'estimate_line_added';
    v_details := jsonb_build_object('description', new.description, 'quantity', new.quantity, 'unit_price', new.unit_price,
                                    'custom', new.is_custom, 'tier', new.tier, 'optional', new.optional);
  else
    if (new.description, new.quantity, new.unit_price, new.unit, new.tier, new.optional)
       is not distinct from (old.description, old.quantity, old.unit_price, old.unit, old.tier, old.optional) then
      return new;
    end if;
    v_job := public.estimate_job(new.estimate_id);
    v_kind := 'estimate_line_changed';
    v_details := jsonb_build_object(
      'description', new.description,
      'from', jsonb_build_object('description', old.description, 'quantity', old.quantity, 'unit_price', old.unit_price, 'tier', old.tier, 'optional', old.optional),
      'to', jsonb_build_object('description', new.description, 'quantity', new.quantity, 'unit_price', new.unit_price, 'tier', new.tier, 'optional', new.optional)
    );
  end if;

  if v_job is not null then
    insert into public.job_events (job_id, actor_id, actor_email, kind, details)
    values (v_job, auth.uid(), v_email, v_kind, v_details);
  end if;
  return coalesce(new, old);
end;
$$;

-- ============================================================ price list: add-ons and aftercare
alter table public.price_items
  add column is_addon boolean not null default false,                -- offered as a one-tap add-on on estimates
  add column aftercare text not null default '' check (char_length(aftercare) <= 1500),
  add column dry_hours int check (dry_hours is null or dry_hours between 1 and 72);

-- ============================================================ settings
alter table public.settings
  add column aftercare_auto boolean not null default true,
  add column aftercare_default text not null default '' check (char_length(aftercare_default) <= 1500),
  add column rebook_enabled boolean not null default false,
  add column rebook_months int[] not null default '{3,6,12,18,24}',
  add column rebook_message text not null default '' check (char_length(rebook_message) <= 400),
  add column plan_offer_enabled boolean not null default false,
  add column plan_offer_days int not null default 75 check (plan_offer_days between 7 and 365),
  add column plan_offer_message text not null default '' check (char_length(plan_offer_message) <= 400),
  add column plan_remind_enabled boolean not null default true,   -- plans are made by the office, so their reminders start on
  add column plan_remind_days int not null default 14 check (plan_remind_days between 1 and 60),
  add column plan_remind_message text not null default '' check (char_length(plan_remind_message) <= 400);

-- ============================================================ the customer's page for a job
alter table public.jobs add column customer_token uuid not null default gen_random_uuid();
create unique index jobs_customer_token_idx on public.jobs (customer_token);

alter table public.customers add column marketing_opt_out boolean not null default false;

-- ============================================================ inspections (before and after cleaning)
create table public.job_inspections (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('pre', 'post')),
  data jsonb not null default '{}'::jsonb,        -- rooms, spots, results (see lib/inspection.js)
  signer_name text,
  signature_png text,
  signed_at timestamptz,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_inspections_job_idx on public.job_inspections (job_id, kind, created_at desc);
create trigger job_inspections_touch before update on public.job_inspections
  for each row execute function public.touch_updated_at();

-- A signed record never changes. The signing time is the database's, not the phone's.
create or replace function public.job_inspection_guard()
returns trigger language plpgsql as $$
begin
  if old.signed_at is not null then
    raise exception 'INSPECTION_SIGNED';
  end if;
  if new.signature_png is not null then
    if btrim(coalesce(new.signer_name, '')) = '' then raise exception 'INSPECTION_NEEDS_NAME'; end if;
    new.signed_at := now();
  else
    new.signed_at := null;
  end if;
  return new;
end;
$$;
create trigger job_inspections_guard before update on public.job_inspections
  for each row execute function public.job_inspection_guard();

alter table public.job_inspections enable row level security;
create policy job_inspections_select on public.job_inspections for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
create policy job_inspections_insert on public.job_inspections for insert
  with check ((public.is_office_or_owner() or public.tech_assigned_to_job(job_id)) and public.job_open(job_id) and signed_at is null);
create policy job_inspections_update on public.job_inspections for update
  using ((public.is_office_or_owner() or public.tech_assigned_to_job(job_id)) and public.job_open(job_id))
  with check (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
create policy job_inspections_delete on public.job_inspections for delete
  using (public.current_staff_role() = 'owner');

-- ============================================================ "report a problem" from the customer page
create table public.job_problem_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('spot_returned', 'not_clean', 'damage', 'drying', 'other')),
  details text not null default '' check (char_length(details) <= 2000),
  contact_phone text not null default '',
  status text not null default 'new' check (status in ('new', 'handled')),
  handled_at timestamptz,
  handled_by uuid references public.staff_users (id) on delete set null,
  handled_note text not null default '' check (char_length(handled_note) <= 1000),
  ip text,
  created_at timestamptz not null default now()
);
create index job_problem_reports_job_idx on public.job_problem_reports (job_id, created_at desc);

alter table public.job_problem_reports enable row level security;
-- Written only by the server (the customer page). Office and owner read and close them.
create policy job_problem_reports_select on public.job_problem_reports for select using (public.is_office_or_owner());
create policy job_problem_reports_update on public.job_problem_reports for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());

create or replace function public.trg_notify_problem()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text := public.notif_job_label(new.job_id);
begin
  if tg_op = 'INSERT' then
    perform public.notify_users(
      public.notif_office_owner(), 'problem_reported', 'alert',
      'Customer reported a problem: ' || coalesce(v_label, 'a job'),
      concat_ws(' · ',
        case new.kind when 'spot_returned' then 'A spot came back' when 'not_clean' then 'An area is not clean'
                      when 'damage' then 'Damage' when 'drying' then 'Drying or wet carpet' else 'Other' end,
        nullif(left(btrim(new.details), 120), '')),
      '/jobs/' || new.job_id || '#overview', new.job_id, null, 'problem:' || new.id);
  elsif new.status = 'handled' and old.status <> 'handled' then
    perform public.notif_resolve('problem:' || new.id);
  end if;
  return new;
end;
$$;
create trigger job_problem_reports_notify after insert or update of status on public.job_problem_reports
  for each row execute function public.trg_notify_problem();

-- ============================================================ recurring plans
create table public.service_plans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  address_id uuid references public.addresses (id) on delete set null,
  name text not null check (btrim(name) <> ''),
  interval_months int not null check (interval_months between 1 and 24),
  price numeric(10, 2) check (price is null or price >= 0),
  note text not null default '',
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  next_due date not null,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index service_plans_due_idx on public.service_plans (next_due) where status = 'active';
create index service_plans_customer_idx on public.service_plans (customer_id);
create trigger service_plans_touch before update on public.service_plans
  for each row execute function public.touch_updated_at();

alter table public.service_plans enable row level security;
create policy service_plans_select on public.service_plans for select using (public.is_office_or_owner());
create policy service_plans_insert on public.service_plans for insert with check (public.is_office_or_owner());
create policy service_plans_update on public.service_plans for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy service_plans_delete on public.service_plans for delete using (public.current_staff_role() = 'owner');

-- ============================================================ reminders sent to customers
create table public.outreach_log (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  kind text not null check (kind in ('rebook', 'plan_offer', 'plan_reminder')),
  dedupe_key text not null,                          -- one message per customer per reason
  results jsonb not null default '{}'::jsonb,        -- { sms: {status, detail}, email: {...} }
  at timestamptz not null default now(),
  unique (customer_id, dedupe_key)
);
create index outreach_log_customer_idx on public.outreach_log (customer_id, at desc);
alter table public.outreach_log enable row level security;
create policy outreach_log_select on public.outreach_log for select using (public.is_office_or_owner());

-- ============================================================ daily reminder run (no Vercel cron)
-- The database only knocks on the site's door once a day. The site decides who gets what and sends it.
alter table public.notification_config add column outreach_url text not null default '';

create or replace function public.ping_outreach()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select outreach_url, push_secret into v_url, v_secret from public.notification_config where id = 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return; end if;
  begin
    perform net.http_post(
      url := v_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'outreach request could not be queued: %', sqlerrm;
  end;
end;
$$;
revoke all on function public.ping_outreach() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('daily-outreach', '0 15 * * *', 'select public.ping_outreach()');
exception when others then
  raise notice 'pg_cron could not be set up (%). Enable it in Database > Extensions and run this block again: reminders will not run until then.', sqlerrm;
end $$;

-- ================================================================== AFTER RUNNING
-- Rebooking reminders and plan offers are OFF until the owner turns them on in Settings > Reminders
-- (reminders for a plan the office set up are on from the start). To let the daily run reach the site, run this once with your real site address
-- (the secret is the one you already saved for push):
--
--   update public.notification_config
--   set outreach_url = 'https://YOUR-SITE.vercel.app/api/cron/outreach'
--   where id = 1;
