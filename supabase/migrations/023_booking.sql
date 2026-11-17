-- 023: booking. Run once, after 001 to 022.
--
-- 1. Settings for the open appointment times (days, hours, appointment length, gap, how many jobs at once,
--    notice, how far ahead) and two switches: the public booking page, and picking a time after signing.
-- 2. price_items.bookable_online: which price-list items the PUBLIC booking page may offer. Off by default, so nothing
--    is public until the owner ticks it. Staff booking in person sees every active item regardless.
-- 3. create_work_order is split in two: create_work_order_core does the work with no sign-in check (the server calls
--    it for a customer who is not signed in), and create_work_order is the same function as before: it checks that the
--    caller is office or owner and then calls the core.
-- 4. self_book_slot: books an accepted lead into an open slot, one customer at a time, so two people cannot take the same
--    slot. Server only.

-- ------------------------------------------------------------------ settings
alter table public.settings
  add column if not exists booking_enabled boolean not null default true,
  add column if not exists booking_after_sign boolean not null default true,
  add column if not exists booking_days int[] not null default '{1,2,3,4,5}',
  add column if not exists booking_day_start time not null default '08:00',
  add column if not exists booking_day_end time not null default '17:00',
  add column if not exists booking_slot_minutes int not null default 120,
  add column if not exists booking_gap_minutes int not null default 60,
  add column if not exists booking_crews int not null default 1,
  add column if not exists booking_notice_hours int not null default 24,
  add column if not exists booking_window_days int not null default 30;

alter table public.settings drop constraint if exists settings_booking_check;
alter table public.settings add constraint settings_booking_check check (
  booking_slot_minutes between 30 and 480
  and booking_gap_minutes between 0 and 240
  and booking_crews between 1 and 50
  and booking_notice_hours between 0 and 720
  and booking_window_days between 1 and 90
  and booking_day_end > booking_day_start
  and cardinality(booking_days) between 1 and 7
  and booking_days <@ array[1, 2, 3, 4, 5, 6, 7]
);

alter table public.price_items add column if not exists bookable_online boolean not null default false;

-- Busy-time lookups for the open slots read visits by start time.
create index if not exists job_visits_starts_idx on public.job_visits (starts_at);

-- ------------------------------------------------- Create Work Order, without the sign-in check
-- Same body as migration 005. Nothing about what it does changes for staff.
create or replace function public.create_work_order_core(
  p_lead uuid,
  p_starts_at timestamptz,
  p_duration_minutes int,
  p_tech uuid default null,
  p_allow_conflict boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_lead public.leads%rowtype;
  v_customer uuid;
  v_addr uuid;
  v_job uuid;
  v_email text;
begin
  if p_starts_at is null then raise exception 'NEEDS_START_TIME'; end if;
  if p_duration_minutes is null or p_duration_minutes < 5 or p_duration_minutes > 1440 then
    raise exception 'BAD_DURATION';
  end if;

  select * into v_lead from public.leads where id = p_lead for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if v_lead.status = 'booked' then raise exception 'LEAD_ALREADY_BOOKED'; end if;
  if v_lead.status = 'lost' then raise exception 'LEAD_IS_LOST'; end if;
  if btrim(v_lead.street) = '' then raise exception 'LEAD_NEEDS_ADDRESS'; end if;

  if p_tech is not null and not p_allow_conflict and exists (
    select 1 from public.job_visits v
    where v.tech_id = p_tech
      and v.status in ('scheduled', 'on_the_way', 'started')
      and v.starts_at < p_starts_at + make_interval(mins => p_duration_minutes)
      and v.ends_at > p_starts_at
  ) then
    raise exception 'TECH_DOUBLE_BOOKED';
  end if;

  -- customer
  v_customer := v_lead.customer_id;
  if v_customer is null then
    if btrim(v_lead.company_name || v_lead.first_name || v_lead.last_name) = '' then
      raise exception 'LEAD_NEEDS_NAME';
    end if;
    insert into public.customers (customer_type, first_name, last_name, company_name, phone, email)
    values (v_lead.customer_type, v_lead.first_name, v_lead.last_name, v_lead.company_name, v_lead.phone, v_lead.email)
    returning id into v_customer;
  end if;

  -- address: reuse the customer's matching one, otherwise add it
  select id into v_addr from public.addresses
  where customer_id = v_customer
    and lower(btrim(street)) = lower(btrim(v_lead.street))
    and lower(btrim(unit)) = lower(btrim(v_lead.unit))
  limit 1;
  if v_addr is null then
    insert into public.addresses (customer_id, street, unit, city, state, zip, gate_code, warnings)
    values (v_customer, btrim(v_lead.street), btrim(v_lead.unit), btrim(v_lead.city), btrim(v_lead.state),
            btrim(v_lead.zip), btrim(v_lead.gate_code), btrim(v_lead.warnings))
    returning id into v_addr;
  else
    update public.addresses set
      gate_code = case when gate_code = '' then btrim(v_lead.gate_code) else gate_code end,
      warnings = case when warnings = '' then btrim(v_lead.warnings) else warnings end
    where id = v_addr;
  end if;

  insert into public.jobs (customer_id, address_id, lead_id, job_type, po_number, loss_summary, internal_notes, created_by)
  values (v_customer, v_addr, v_lead.id, v_lead.job_type, v_lead.po_number, v_lead.loss_summary, v_lead.notes, auth.uid())
  returning id into v_job;

  insert into public.job_visits (job_id, tech_id, starts_at, duration_minutes, created_by)
  values (v_job, p_tech, p_starts_at, p_duration_minutes, auth.uid());

  -- the estimate and the lead's history follow the lead onto the job
  update public.estimates set job_id = v_job where lead_id = v_lead.id and job_id is null;
  update public.job_events set job_id = v_job where lead_id = v_lead.id and job_id is null;

  select email into v_email from public.staff_users where id = auth.uid();
  insert into public.job_events (job_id, lead_id, actor_id, actor_email, kind, details)
  values (v_job, v_lead.id, auth.uid(), v_email, 'work_order_created',
          jsonb_build_object('tech_id', p_tech, 'starts_at', p_starts_at, 'duration_minutes', p_duration_minutes,
                             'override_double_booking', p_allow_conflict));

  update public.leads set status = 'booked', job_id = v_job, customer_id = v_customer where id = v_lead.id;
  return v_job;
end;
$$;

revoke all on function public.create_work_order_core(uuid, timestamptz, int, uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_work_order_core(uuid, timestamptz, int, uuid, boolean) to service_role;

-- The function the app already calls. Office and owner only, exactly as before.
create or replace function public.create_work_order(
  p_lead uuid,
  p_starts_at timestamptz,
  p_duration_minutes int,
  p_tech uuid default null,
  p_allow_conflict boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_office_or_owner() then
    raise exception 'NOT_ALLOWED';
  end if;
  return public.create_work_order_core(p_lead, p_starts_at, p_duration_minutes, p_tech, p_allow_conflict);
end;
$$;

-- ------------------------------------------------------------------ book a slot
-- The lead must be "accepted" (the customer approved and signed). The slot is checked here, under a lock, against every
-- active visit including the gap on either side, so a second customer picking the same time gets SLOT_TAKEN.
-- The visit is the standard appointment length and starts unassigned; the office assigns a tech.
-- Which times are offered at all (days, hours, notice) is decided by the server before this is called.
create or replace function public.self_book_slot(p_lead uuid, p_starts_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_set public.settings%rowtype;
  v_status text;
  v_end timestamptz;
  v_gap interval;
  v_busy int;
begin
  select * into v_set from public.settings where id = 1;
  v_end := p_starts_at + make_interval(mins => v_set.booking_slot_minutes);
  v_gap := make_interval(mins => v_set.booking_gap_minutes);

  -- one booking at a time, until this transaction ends
  perform pg_advisory_xact_lock(hashtext('monarch_booking_slots'));

  select status into v_status from public.leads where id = p_lead;
  if v_status is null then raise exception 'LEAD_NOT_FOUND'; end if;
  if v_status <> 'accepted' then raise exception 'LEAD_NOT_READY'; end if;

  select count(*) into v_busy from public.job_visits v
  where v.status in ('scheduled', 'on_the_way', 'started')
    and v.starts_at < v_end + v_gap
    and v.ends_at + v_gap > p_starts_at;
  if v_busy >= v_set.booking_crews then raise exception 'SLOT_TAKEN'; end if;

  return public.create_work_order_core(p_lead, p_starts_at, v_set.booking_slot_minutes, null, false);
end;
$$;

revoke all on function public.self_book_slot(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.self_book_slot(uuid, timestamptz) to service_role;
