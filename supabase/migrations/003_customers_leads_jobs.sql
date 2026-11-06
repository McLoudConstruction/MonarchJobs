-- 003: customers, addresses, contacts, leads, price list, jobs, visits, job history.
-- Run after 001 and 002.

create sequence public.job_number_seq start 1001;

-- Business-wide minimum charge: one per job, not per room.
alter table public.settings add column job_minimum numeric(10,2) not null default 0 check (job_minimum >= 0);

-- Role helpers
create or replace function public.is_office_or_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_staff_role() in ('owner', 'office'), false)
$$;

-- ---------------------------------------------------------------- customers
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_type text not null default 'residential'
    check (customer_type in ('residential', 'commercial', 'multifamily')),
  first_name text not null default '',
  last_name text not null default '',
  company_name text not null default '',
  display_name text generated always as (
    case when company_name <> '' then company_name else btrim(first_name || ' ' || last_name) end
  ) stored,
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  tags text[] not null default '{}',
  external_id text unique,            -- customer ID from Markate, used by the import
  last_visit_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_has_name check (company_name <> '' or btrim(first_name || last_name) <> '')
);
create index customers_display_name_idx on public.customers (lower(display_name));

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label text not null default '',
  street text not null,
  unit text not null default '',
  city text not null default '',
  state text not null default 'MO',
  zip text not null default '',
  gate_code text not null default '',
  warnings text not null default '',     -- pets etc.; shown as a banner on jobs
  access_notes text not null default '',
  created_at timestamptz not null default now()
);
create index addresses_customer_idx on public.addresses (customer_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text not null,
  phone text not null default '',
  email text not null default '',
  role text not null default '',        -- e.g. adjuster, property manager, tenant
  receives_notifications boolean not null default true,
  created_at timestamptz not null default now()
);
create index contacts_customer_idx on public.contacts (customer_id);

-- -------------------------------------------------------------------- leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'phone' check (source in ('phone', 'web', 'referral', 'manual')),
  status text not null default 'new' check (status in ('new', 'quoted', 'booked', 'lost')),
  customer_id uuid references public.customers (id) on delete set null,
  name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  service_requested text not null default '',
  notes text not null default '',
  lost_reason text not null default '',
  job_id uuid,                           -- set when booked (FK added below)
  created_by uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_status_idx on public.leads (status, created_at desc);

-- --------------------------------------------------------------- price list
create table public.price_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  unit text not null default 'sqft' check (unit in ('sqft', 'room', 'flat', 'hour', 'each')),
  price numeric(10, 2) not null check (price >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------- jobs
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number bigint not null unique default nextval('public.job_number_seq'),
  customer_id uuid not null references public.customers (id) on delete restrict,
  address_id uuid not null references public.addresses (id) on delete restrict,
  billing_contact_id uuid references public.contacts (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  job_type text not null default 'floor_cleaning'
    check (job_type in ('floor_cleaning', 'water_restoration', 'other')),
  status text not null default 'booked'
    check (status in ('booked', 'on_the_way', 'in_progress', 'completed', 'closed', 'cancelled')),
  po_number text not null default '',
  loss_summary text not null default '',     -- short blurb sent to the tech
  customer_notes text not null default '',   -- may appear on customer-facing documents
  internal_notes text not null default '',   -- never shown to the customer
  warning text not null default '',          -- job-level warning, in addition to the address warnings
  created_by uuid references public.staff_users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_customer_idx on public.jobs (customer_id);
create index jobs_status_idx on public.jobs (status);

alter table public.leads
  add constraint leads_job_fk foreign key (job_id) references public.jobs (id) on delete set null;

-- Extra contacts who receive this job's notifications
create table public.job_contacts (
  job_id uuid not null references public.jobs (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  primary key (job_id, contact_id)
);

-- Each trip to the site. A returning visit is just another row.
create table public.job_visits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  tech_id uuid references public.staff_users (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'on_the_way', 'started', 'finished', 'cancelled')),
  minutes_out int,
  on_the_way_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  notes text not null default '',
  created_by uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_visits_range check (ends_at > starts_at)
);
create index job_visits_tech_idx on public.job_visits (tech_id, starts_at);
create index job_visits_job_idx on public.job_visits (job_id);

-- Who changed what and when (status, notes, assignments, later price changes)
create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references public.staff_users (id) on delete set null,
  actor_email text,
  kind text not null,
  details jsonb not null default '{}'::jsonb
);
create index job_events_job_idx on public.job_events (job_id, at desc);

-- updated_at triggers
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();
create trigger job_visits_touch before update on public.job_visits for each row execute function public.touch_updated_at();

-- ------------------------------------------------------- tech visibility helpers
create or replace function public.tech_assigned_to_job(j uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and exists (
    select 1 from public.job_visits v where v.job_id = j and v.tech_id = auth.uid()
  )
$$;

create or replace function public.tech_can_see_customer(c uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and exists (
    select 1 from public.jobs jb join public.job_visits v on v.job_id = jb.id
    where jb.customer_id = c and v.tech_id = auth.uid()
  )
$$;

-- ------------------------------------------------------------------- RLS
alter table public.customers enable row level security;
alter table public.addresses enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.price_items enable row level security;
alter table public.jobs enable row level security;
alter table public.job_contacts enable row level security;
alter table public.job_visits enable row level security;
alter table public.job_events enable row level security;

-- Customers, addresses, contacts: office/owner full access; techs read only customers on their jobs.
create policy customers_select on public.customers for select
  using (public.is_office_or_owner() or public.tech_can_see_customer(id));
create policy customers_write on public.customers for insert with check (public.is_office_or_owner());
create policy customers_update on public.customers for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy customers_delete on public.customers for delete using (public.current_staff_role() = 'owner');

create policy addresses_select on public.addresses for select
  using (public.is_office_or_owner() or public.tech_can_see_customer(customer_id));
create policy addresses_insert on public.addresses for insert with check (public.is_office_or_owner());
create policy addresses_update on public.addresses for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy addresses_delete on public.addresses for delete using (public.is_office_or_owner());

create policy contacts_select on public.contacts for select
  using (public.is_office_or_owner() or public.tech_can_see_customer(customer_id));
create policy contacts_insert on public.contacts for insert with check (public.is_office_or_owner());
create policy contacts_update on public.contacts for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy contacts_delete on public.contacts for delete using (public.is_office_or_owner());

-- Leads: office/owner only
create policy leads_select on public.leads for select using (public.is_office_or_owner());
create policy leads_insert on public.leads for insert with check (public.is_office_or_owner());
create policy leads_update on public.leads for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy leads_delete on public.leads for delete using (public.current_staff_role() = 'owner');

-- Price list: all staff read, owner writes
create policy price_items_select on public.price_items for select using (public.is_staff());
create policy price_items_insert on public.price_items for insert with check (public.current_staff_role() = 'owner');
create policy price_items_update on public.price_items for update
  using (public.current_staff_role() = 'owner') with check (public.current_staff_role() = 'owner');
create policy price_items_delete on public.price_items for delete using (public.current_staff_role() = 'owner');

-- Jobs: office/owner full access; techs read jobs they are scheduled on
create policy jobs_select on public.jobs for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(id));
create policy jobs_insert on public.jobs for insert with check (public.is_office_or_owner());
create policy jobs_update on public.jobs for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy jobs_delete on public.jobs for delete using (public.current_staff_role() = 'owner');

create policy job_contacts_select on public.job_contacts for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
create policy job_contacts_insert on public.job_contacts for insert with check (public.is_office_or_owner());
create policy job_contacts_delete on public.job_contacts for delete using (public.is_office_or_owner());

-- Visits: office/owner full; a tech reads only their own. Tech status changes go through the
-- server (service role) so they cannot edit times or reassign visits.
create policy job_visits_select on public.job_visits for select
  using (public.is_office_or_owner() or tech_id = auth.uid());
create policy job_visits_insert on public.job_visits for insert with check (public.is_office_or_owner());
create policy job_visits_update on public.job_visits for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy job_visits_delete on public.job_visits for delete using (public.is_office_or_owner());

-- Job history: readable with the job; staff may add entries as themselves
create policy job_events_select on public.job_events for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
create policy job_events_insert on public.job_events for insert
  with check (public.is_staff() and actor_id = auth.uid());
