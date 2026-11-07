-- 005: every job starts as a lead. Leads carry everything up to scheduling (contact, address,
-- service, estimate); "Create Work Order" turns a lead into a job in one transaction.
-- Also: visits are scheduled by start time + duration (no end time is ever entered),
-- customers can accept and sign an estimate, and Google Maps / Twilio / Resend can be stored
-- as integrations. Run after 001 to 004.

-- ================================================================= leads
alter table public.leads
  add column customer_type text not null default 'residential'
    check (customer_type in ('residential', 'commercial', 'multifamily')),
  add column first_name text not null default '',
  add column last_name text not null default '',
  add column company_name text not null default '',
  add column street text not null default '',
  add column unit text not null default '',
  add column city text not null default '',
  add column state text not null default 'MO',
  add column zip text not null default '',
  add column gate_code text not null default '',
  add column warnings text not null default '',          -- pets etc.; goes onto the address
  add column job_type text not null default 'floor_cleaning'
    check (job_type in ('floor_cleaning', 'water_restoration', 'other')),
  add column loss_summary text not null default '',      -- short blurb for the tech
  add column po_number text not null default '',
  add column preferred_times text not null default '',   -- filled in by the customer when they accept
  add column accepted_at timestamptz;

-- A customer who accepted the estimate is waiting to be scheduled.
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('new', 'quoted', 'accepted', 'booked', 'lost'));

-- Carry existing leads over: split the old single name and move the old address line into street.
update public.leads set
  first_name = split_part(btrim(name), ' ', 1),
  last_name = btrim(substr(btrim(name), length(split_part(btrim(name), ' ', 1)) + 1)),
  street = btrim(address)
where btrim(name) <> '' or btrim(address) <> '';

-- Keep the old name / address columns filled from the new parts so older queries still work.
create or replace function public.leads_sync_fields()
returns trigger
language plpgsql as $$
begin
  if btrim(new.company_name) <> '' or btrim(new.first_name || new.last_name) <> '' then
    new.name := case when btrim(new.company_name) <> '' then btrim(new.company_name)
                     else btrim(new.first_name || ' ' || new.last_name) end;
  elsif btrim(new.name) <> '' then
    new.first_name := split_part(btrim(new.name), ' ', 1);
    new.last_name := btrim(substr(btrim(new.name), length(split_part(btrim(new.name), ' ', 1)) + 1));
  end if;

  if tg_op = 'INSERT' and btrim(new.street) = '' and btrim(new.address) <> '' then
    new.street := btrim(new.address);
  end if;
  new.address := case when btrim(new.street) = '' then '' else
    concat_ws(', ', btrim(new.street), nullif(btrim(new.unit), ''), nullif(btrim(new.city), ''),
              nullif(btrim(concat_ws(' ', nullif(btrim(new.state), ''), nullif(btrim(new.zip), ''))), '')) end;
  return new;
end;
$$;
create trigger leads_sync before insert or update on public.leads
  for each row execute function public.leads_sync_fields();

-- ============================================= history can belong to a lead first
alter table public.job_events alter column job_id drop not null;
alter table public.job_events add column lead_id uuid references public.leads (id) on delete cascade;
alter table public.job_events add constraint job_events_target check (job_id is not null or lead_id is not null);
create index job_events_lead_idx on public.job_events (lead_id, at desc);

-- ================================================ estimates can belong to a lead first
-- A lead-stage estimate has lead_id only. Creating the work order sets job_id on the same row,
-- so its lines, views and history follow the lead onto the job.
alter table public.estimates alter column job_id drop not null;
alter table public.estimates add column lead_id uuid unique references public.leads (id) on delete set null;

create or replace function public.lead_open(l uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leads where id = l and status not in ('booked', 'lost'))
$$;

-- Can the current user add, change or remove lines on this estimate right now?
create or replace function public.estimate_editable(e uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.estimates es
    where es.id = e
      and (
        (es.job_id is not null and public.job_open(es.job_id)
          and (public.is_office_or_owner() or public.tech_assigned_to_job(es.job_id)))
        or (es.job_id is null and es.lead_id is not null
          and public.is_office_or_owner() and public.lead_open(es.lead_id))
      )
  )
$$;

drop policy estimates_insert on public.estimates;
create policy estimates_insert on public.estimates for insert
  with check (
    ((public.is_office_or_owner() or public.tech_assigned_to_job(job_id)) and public.job_open(job_id))
    or (public.is_office_or_owner() and job_id is null and lead_id is not null and public.lead_open(lead_id))
  );

drop policy estimate_lines_insert on public.estimate_lines;
drop policy estimate_lines_update on public.estimate_lines;
drop policy estimate_lines_delete on public.estimate_lines;
create policy estimate_lines_insert on public.estimate_lines for insert
  with check (public.estimate_editable(estimate_id));
create policy estimate_lines_update on public.estimate_lines for update
  using (public.estimate_editable(estimate_id)) with check (public.estimate_editable(estimate_id));
create policy estimate_lines_delete on public.estimate_lines for delete
  using (public.estimate_editable(estimate_id));

-- Deleting a lead removes an estimate that never became a job.
create or replace function public.leads_delete_orphan_estimate()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.estimates where lead_id = old.id and job_id is null;
  return old;
end;
$$;
create trigger leads_before_delete before delete on public.leads
  for each row execute function public.leads_delete_orphan_estimate();

-- ----------------------------------------------------------------- change log
-- Same as migration 004, but history goes to the job, the lead, or both.
create or replace function public.log_estimate_line_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_est uuid;
  v_job uuid;
  v_lead uuid;
  v_email text;
  v_kind text;
  v_details jsonb;
begin
  select email into v_email from public.staff_users where id = auth.uid();

  if tg_op = 'DELETE' then
    v_est := old.estimate_id;
    v_kind := 'estimate_line_removed';
    v_details := jsonb_build_object('description', old.description, 'quantity', old.quantity, 'unit_price', old.unit_price);
  elsif tg_op = 'INSERT' then
    v_est := new.estimate_id;
    v_kind := 'estimate_line_added';
    v_details := jsonb_build_object('description', new.description, 'quantity', new.quantity, 'unit_price', new.unit_price, 'custom', new.is_custom);
  else
    if (new.description, new.quantity, new.unit_price, new.unit) is not distinct from (old.description, old.quantity, old.unit_price, old.unit) then
      return new;
    end if;
    v_est := new.estimate_id;
    v_kind := 'estimate_line_changed';
    v_details := jsonb_build_object(
      'description', new.description,
      'from', jsonb_build_object('description', old.description, 'quantity', old.quantity, 'unit_price', old.unit_price),
      'to', jsonb_build_object('description', new.description, 'quantity', new.quantity, 'unit_price', new.unit_price)
    );
  end if;

  select job_id, lead_id into v_job, v_lead from public.estimates where id = v_est;
  if v_job is not null or v_lead is not null then
    insert into public.job_events (job_id, lead_id, actor_id, actor_email, kind, details)
    values (v_job, v_lead, auth.uid(), v_email, v_kind, v_details);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.log_estimate_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  select email into v_email from public.staff_users where id = auth.uid();
  if new.minimum_charge is distinct from old.minimum_charge then
    insert into public.job_events (job_id, lead_id, actor_id, actor_email, kind, details)
    values (new.job_id, new.lead_id, auth.uid(), v_email, 'estimate_minimum_changed',
            jsonb_build_object('from', old.minimum_charge, 'to', new.minimum_charge));
  end if;
  if new.status is distinct from old.status then
    insert into public.job_events (job_id, lead_id, actor_id, actor_email, kind, details)
    values (new.job_id, new.lead_id, auth.uid(), v_email, 'estimate_' || new.status,
            jsonb_build_object('from', old.status, 'to', new.status));

    -- Keep the lead's status in step with its estimate. Approved means the customer is ready
    -- to be scheduled. Booked and lost leads are left alone.
    if new.lead_id is not null then
      update public.leads set
        status = case
          when new.status = 'approved' and status in ('new', 'quoted') then 'accepted'
          when new.status = 'sent' and status = 'new' then 'quoted'
          when new.status in ('draft', 'sent', 'declined') and status = 'accepted' then 'quoted'
          else status end,
        accepted_at = case
          when new.status = 'approved' and status in ('new', 'quoted') then coalesce(new.approved_at, now())
          when new.status in ('draft', 'sent', 'declined') and status = 'accepted' then null
          else accepted_at end
      where id = new.lead_id and status in ('new', 'quoted', 'accepted');
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================ estimate signatures
-- What the customer saw and signed, kept as it was at that moment. Written only by the server.
create table public.estimate_signatures (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  signer_name text not null,
  signature_png text not null,                 -- data URL of the drawn signature
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  total_cents bigint not null,
  minimum_charge numeric(10, 2) not null,
  lines_snapshot jsonb not null,               -- [{description, unit, quantity, unit_price}, ...]
  preferred_times text not null default ''
);
create index estimate_signatures_estimate_idx on public.estimate_signatures (estimate_id, signed_at desc);
alter table public.estimate_signatures enable row level security;
create policy estimate_signatures_select on public.estimate_signatures for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(public.estimate_job(estimate_id)));

-- ========================================================= visits: start + duration
alter table public.job_visits add column duration_minutes int;
update public.job_visits
  set duration_minutes = least(1440, greatest(5, round(extract(epoch from (ends_at - starts_at)) / 60)::int));
alter table public.job_visits alter column duration_minutes set not null;
alter table public.job_visits alter column duration_minutes set default 120;
alter table public.job_visits add constraint job_visits_duration check (duration_minutes between 5 and 1440);

-- ends_at is derived, never typed in. It stays as a column so overlap checks stay simple.
create or replace function public.job_visits_set_end()
returns trigger
language plpgsql as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes);
  return new;
end;
$$;
create trigger job_visits_end before insert or update of starts_at, duration_minutes on public.job_visits
  for each row execute function public.job_visits_set_end();

-- ====================================================== Create Work Order (lead -> job)
-- One transaction: customer, address, job, first visit, estimate and history all move together,
-- or nothing does. SECURITY DEFINER because moving history rows needs rights no one has directly;
-- the function checks for office/owner itself before doing anything.
create or replace function public.create_work_order(
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
  if not public.is_office_or_owner() then
    raise exception 'NOT_ALLOWED';
  end if;
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

-- ===================================================== possible existing customers
-- Matches by phone digits or email so a repeat caller is not entered twice.
create or replace function public.find_customer_matches(p_phone text, p_email text)
returns table (id uuid, display_name text, phone text, email text, customer_type text)
language sql stable as $$
  select c.id, c.display_name, c.phone, c.email, c.customer_type
  from public.customers c
  where not c.archived
    and (
      (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
        and right(regexp_replace(c.phone, '\D', '', 'g'), 10) = right(regexp_replace(p_phone, '\D', '', 'g'), 10))
      or (btrim(coalesce(p_email, '')) <> '' and lower(c.email) = lower(btrim(p_email)))
    )
  order by c.display_name
  limit 5
$$;

-- ================================================ more integrations can be stored
alter table public.integration_credentials drop constraint integration_credentials_provider_check;
alter table public.integration_credentials add constraint integration_credentials_provider_check
  check (provider in ('stripe', 'square', 'google_maps', 'twilio', 'resend'));
