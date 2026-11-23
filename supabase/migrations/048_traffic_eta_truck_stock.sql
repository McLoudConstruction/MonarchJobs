-- 048: Traffic ETA and truck stock (Nov 23, Round 2B, #37 and #32).
--   1. job_visits.eta_live: the "minutes away" on a visit came from the live drive time (so the customer page can say so).
--   2. Truck stock: trucks, the supplies they carry, how much each has, and a log of every change. Finishing a visit takes the
--      usual amount off the truck of the tech who finished it, once per crew. When a supply gets down to its "low at" level, the
--      office and owner get an alert, which goes away when it is restocked. Nothing here messages customers.
-- Safe to run more than once. Run in the Supabase SQL Editor after 047, before deploying.

alter table public.job_visits add column if not exists eta_live boolean not null default false;

create table if not exists public.trucks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  tech_ids uuid[] not null default '{}' check (cardinality(tech_ids) <= 10),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.truck_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  unit text not null default '' check (char_length(unit) <= 20),
  per_visit numeric(8, 2) not null default 0 check (per_visit >= 0 and per_visit <= 999),
  low_at numeric(10, 2) not null default 0 check (low_at >= 0 and low_at <= 99999),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.truck_stock (
  truck_id uuid not null references public.trucks(id) on delete cascade,
  item_id uuid not null references public.truck_items(id) on delete cascade,
  qty numeric(10, 2) not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (truck_id, item_id)
);
create table if not exists public.truck_log (
  id bigserial primary key,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  item_id uuid not null references public.truck_items(id) on delete cascade,
  change numeric(10, 2) not null,
  qty_after numeric(10, 2) not null,
  reason text not null check (reason in ('restock', 'used', 'count')),
  job_id uuid references public.jobs(id) on delete set null,
  visit_id uuid,
  dedupe text,
  note text not null default '' check (char_length(note) <= 200),
  by_staff uuid references public.staff_users(id) on delete set null,
  at timestamptz not null default now()
);
create unique index if not exists truck_log_dedupe_idx on public.truck_log (truck_id, item_id, dedupe) where dedupe is not null;
create index if not exists truck_log_recent_idx on public.truck_log (truck_id, at desc);

alter table public.trucks enable row level security;
alter table public.truck_items enable row level security;
alter table public.truck_stock enable row level security;
alter table public.truck_log enable row level security;
do $$ declare t text; begin
  foreach t in array array['trucks', 'truck_items', 'truck_stock', 'truck_log'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.is_staff())', t || '_read', t);
  end loop;
  foreach t in array array['trucks', 'truck_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all using (public.is_office_or_owner()) with check (public.is_office_or_owner())', t || '_write', t);
  end loop;
end $$;

-- alert the office and owner when a supply is at or under its "low at" level; clear it when it is back above
create or replace function public.truck_low_check(p_truck uuid, p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  key text := 'truck:' || p_truck || ':' || p_item || ':low';
begin
  select t.name as truck, i.name as item, i.unit, i.low_at, i.active, s.qty
    into r from public.truck_stock s join public.trucks t on t.id = s.truck_id join public.truck_items i on i.id = s.item_id
    where s.truck_id = p_truck and s.item_id = p_item;
  if r.item is null or not r.active or r.low_at <= 0 or r.qty > r.low_at then
    perform public.notif_resolve(key);
    return;
  end if;
  perform public.notify_users(public.notif_office_owner(), 'truck_low', 'action',
    case when r.qty = 0 then r.truck || ' is out of ' || r.item else r.truck || ' is low on ' || r.item end,
    trim(trailing ' ' from r.qty::float8::text || ' ' || r.unit) || ' left. Restock it, then enter the new count under Equipment, Truck stock.',
    '/equipment', null, null, key, 'update', interval '12 hours');
end $$;
revoke all on function public.truck_low_check(uuid, uuid) from public, anon, authenticated;

-- change one supply on one truck and log it. p_set: set the count to this instead of adding p_change.
create or replace function public.truck_apply(p_truck uuid, p_item uuid, p_change numeric, p_set numeric, p_reason text,
  p_job uuid default null, p_visit uuid default null, p_dedupe text default null, p_note text default '')
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_old numeric;
  v_new numeric;
begin
  insert into public.truck_stock (truck_id, item_id, qty) values (p_truck, p_item, 0) on conflict do nothing;
  select qty into v_old from public.truck_stock where truck_id = p_truck and item_id = p_item for update;
  v_new := greatest(0, coalesce(p_set, v_old + p_change));
  if p_dedupe is not null and exists (select 1 from public.truck_log where truck_id = p_truck and item_id = p_item and dedupe = p_dedupe) then
    return v_old;
  end if;
  update public.truck_stock set qty = v_new, updated_at = now() where truck_id = p_truck and item_id = p_item;
  insert into public.truck_log (truck_id, item_id, change, qty_after, reason, job_id, visit_id, dedupe, note, by_staff)
    values (p_truck, p_item, v_new - v_old, v_new, p_reason, p_job, p_visit, p_dedupe, coalesce(p_note, ''), auth.uid());
  perform public.truck_low_check(p_truck, p_item);
  return v_new;
end $$;
revoke all on function public.truck_apply(uuid, uuid, numeric, numeric, text, uuid, uuid, text, text) from public, anon, authenticated;

-- for the app: add stock ('add') or set the count ('count'). Office and owner for any truck; a tech only for a truck they drive.
create or replace function public.truck_adjust(p_truck uuid, p_item uuid, p_mode text, p_value numeric, p_note text default '')
returns numeric language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED'; end if;
  if not public.is_office_or_owner() and not exists (select 1 from public.trucks where id = p_truck and auth.uid() = any (tech_ids)) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_value is null or p_value < 0 or p_value > 99999 then raise exception 'BAD_QTY'; end if;
  if p_mode = 'add' then
    return public.truck_apply(p_truck, p_item, p_value, null, 'restock', null, null, null, p_note);
  elsif p_mode = 'count' then
    return public.truck_apply(p_truck, p_item, 0, p_value, 'count', null, null, null, p_note);
  end if;
  raise exception 'BAD_MODE';
end $$;
revoke all on function public.truck_adjust(uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.truck_adjust(uuid, uuid, text, numeric, text) to authenticated;

-- a visit finishes: take the usual amount off the truck that tech drives, once per crew
create or replace function public.trg_truck_deduct()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_truck uuid;
  r record;
  v_key text := coalesce(new.crew_id::text, new.id::text);
begin
  if new.status is distinct from 'finished' or old.status = 'finished' or new.tech_id is null then return new; end if;
  begin
    select id into v_truck from public.trucks where active and new.tech_id = any (tech_ids) order by created_at limit 1;
    if v_truck is null then return new; end if;
    for r in
      select s.item_id, i.per_visit from public.truck_stock s join public.truck_items i on i.id = s.item_id
      where s.truck_id = v_truck and i.active and i.per_visit > 0
    loop
      perform public.truck_apply(v_truck, r.item_id, -r.per_visit, null, 'used', new.job_id, new.id, v_key, '');
    end loop;
  exception when others then
    raise warning 'truck stock for visit % was not updated: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists job_visits_truck_deduct on public.job_visits;
create trigger job_visits_truck_deduct after update of status on public.job_visits
  for each row execute function public.trg_truck_deduct();
