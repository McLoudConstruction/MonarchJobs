-- 004: estimates and estimate lines, with an automatic change log.
-- Run after 001, 002 and 003.

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'declined')),
  -- Snapshot of the one-per-job minimum when the estimate was started. Editable per estimate.
  minimum_charge numeric(10, 2) not null default 0 check (minimum_charge >= 0),
  share_token uuid not null unique default gen_random_uuid(),
  sent_at timestamptz,
  approved_at timestamptz,
  declined_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  price_item_id uuid references public.price_items (id) on delete set null,
  description text not null,
  unit text not null default 'each' check (unit in ('sqft', 'room', 'flat', 'hour', 'each')),
  quantity numeric(12, 3) not null default 1 check (quantity >= 0),
  unit_price numeric(10, 2) not null,           -- may be negative for a discount line
  is_custom boolean not null default false,
  sort_order int not null default 0,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index estimate_lines_estimate_idx on public.estimate_lines (estimate_id, sort_order);

create trigger estimates_touch before update on public.estimates
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------- helpers
create or replace function public.estimate_job(e uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select job_id from public.estimates where id = e
$$;

-- A job is open for changes until it is closed or cancelled.
create or replace function public.job_open(j uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs where id = j and status not in ('closed', 'cancelled'))
$$;

-- ------------------------------------------------------------- change log
-- Every change to a line or to the minimum/status is written to job_events with who and when,
-- by the database itself, so it cannot be skipped by the app. SECURITY DEFINER lets it write
-- even when the person making the change is a tech.
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
    v_details := jsonb_build_object('description', new.description, 'quantity', new.quantity, 'unit_price', new.unit_price, 'custom', new.is_custom);
  else
    if (new.description, new.quantity, new.unit_price, new.unit) is not distinct from (old.description, old.quantity, old.unit_price, old.unit) then
      return new;
    end if;
    v_job := public.estimate_job(new.estimate_id);
    v_kind := 'estimate_line_changed';
    v_details := jsonb_build_object(
      'description', new.description,
      'from', jsonb_build_object('description', old.description, 'quantity', old.quantity, 'unit_price', old.unit_price),
      'to', jsonb_build_object('description', new.description, 'quantity', new.quantity, 'unit_price', new.unit_price)
    );
  end if;

  if v_job is not null then
    insert into public.job_events (job_id, actor_id, actor_email, kind, details)
    values (v_job, auth.uid(), v_email, v_kind, v_details);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger estimate_lines_log
after insert or update or delete on public.estimate_lines
for each row execute function public.log_estimate_line_change();

create or replace function public.log_estimate_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  select email into v_email from public.staff_users where id = auth.uid();
  if new.minimum_charge is distinct from old.minimum_charge then
    insert into public.job_events (job_id, actor_id, actor_email, kind, details)
    values (new.job_id, auth.uid(), v_email, 'estimate_minimum_changed',
            jsonb_build_object('from', old.minimum_charge, 'to', new.minimum_charge));
  end if;
  if new.status is distinct from old.status then
    insert into public.job_events (job_id, actor_id, actor_email, kind, details)
    values (new.job_id, auth.uid(), v_email, 'estimate_' || new.status,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

create trigger estimates_log
after update on public.estimates
for each row execute function public.log_estimate_change();

-- ----------------------------------------------------------------- RLS
alter table public.estimates enable row level security;
alter table public.estimate_lines enable row level security;

-- Estimates: office/owner and the assigned tech can read. The assigned tech can start one.
-- Only office/owner can change status or the minimum. Only the owner can delete.
create policy estimates_select on public.estimates for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
create policy estimates_insert on public.estimates for insert
  with check ((public.is_office_or_owner() or public.tech_assigned_to_job(job_id)) and public.job_open(job_id));
create policy estimates_update on public.estimates for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy estimates_delete on public.estimates for delete
  using (public.current_staff_role() = 'owner');

-- Lines: office/owner and the assigned tech can add, change and remove while the job is open.
create policy estimate_lines_select on public.estimate_lines for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(public.estimate_job(estimate_id)));
create policy estimate_lines_insert on public.estimate_lines for insert
  with check (
    (public.is_office_or_owner() or public.tech_assigned_to_job(public.estimate_job(estimate_id)))
    and public.job_open(public.estimate_job(estimate_id))
  );
create policy estimate_lines_update on public.estimate_lines for update
  using (
    (public.is_office_or_owner() or public.tech_assigned_to_job(public.estimate_job(estimate_id)))
    and public.job_open(public.estimate_job(estimate_id))
  )
  with check (
    (public.is_office_or_owner() or public.tech_assigned_to_job(public.estimate_job(estimate_id)))
    and public.job_open(public.estimate_job(estimate_id))
  );
create policy estimate_lines_delete on public.estimate_lines for delete
  using (
    (public.is_office_or_owner() or public.tech_assigned_to_job(public.estimate_job(estimate_id)))
    and public.job_open(public.estimate_job(estimate_id))
  );
