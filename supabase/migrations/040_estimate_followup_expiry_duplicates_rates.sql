-- 040: Push 1A.
--   #11 estimate follow-up (daily nudges for sent, unanswered estimates; off until the owner turns it on)
--   #12 estimate expiry for restoration estimates (valid-for days, shown on the customer page, owner can extend)
--   #9  duplicate check when a lead is typed in (phone, email, address)
--   #3  call script prompts the owner edits, shown beside the new-lead form
--   #24 per-property rates (price overrides applied in the estimate builder)
-- Safe to run more than once. Run in the Supabase SQL Editor after 039, before deploying.

-- ============================================================ settings
alter table public.settings
  add column if not exists estimate_followup_enabled boolean not null default false,
  add column if not exists estimate_followup_days int[] not null default '{2,5,10}',
  add column if not exists estimate_followup_unopened text not null default '',
  add column if not exists estimate_followup_opened text not null default '',
  add column if not exists estimate_expiry_enabled boolean not null default false,
  add column if not exists estimate_valid_days int not null default 30,
  add column if not exists call_script_carpet text not null default '',
  add column if not exists call_script_restoration text not null default '';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_estimate_valid_days_chk') then
    alter table public.settings add constraint settings_estimate_valid_days_chk check (estimate_valid_days between 1 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_estimate_followup_text_chk') then
    alter table public.settings add constraint settings_estimate_followup_text_chk
      check (char_length(estimate_followup_unopened) <= 400 and char_length(estimate_followup_opened) <= 400);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_call_script_chk') then
    alter table public.settings add constraint settings_call_script_chk
      check (char_length(call_script_carpet) <= 4000 and char_length(call_script_restoration) <= 4000);
  end if;
end $$;

-- ============================================================ estimates
alter table public.estimates
  add column if not exists expires_at timestamptz,
  add column if not exists followups_paused boolean not null default false,
  add column if not exists property_id uuid references public.properties (id) on delete set null;
create index if not exists estimates_followup_idx on public.estimates (status) where status = 'sent';

-- One row per nudge actually delivered. A nudge is logged only when a text or email went out.
create table if not exists public.estimate_followups (
  id bigint generated always as identity primary key,
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  step int not null check (step between 1 and 20),
  dedupe_key text not null,                         -- step + the day the estimate was sent, so a re-send starts over
  opened boolean not null default false,            -- had the customer opened the link when this went out
  keys text[] not null default '{}',                -- who it went to, so one person gets one message a day
  results jsonb not null default '{}'::jsonb,       -- { sms: {status, detail}, email: {...} }
  at timestamptz not null default now(),
  unique (estimate_id, dedupe_key)
);
create index if not exists estimate_followups_at_idx on public.estimate_followups (at desc);
alter table public.estimate_followups enable row level security;
drop policy if exists estimate_followups_select on public.estimate_followups;
create policy estimate_followups_select on public.estimate_followups for select using (public.is_office_or_owner());

-- ============================================================ estimate expiry
-- Restoration estimates get a "valid through" date when they are sent, if the owner turned expiry on. The estimate
-- is valid through the whole last day (business time zone), so expires_at is the start of the day after.
-- Sending again starts a new window. Changing only expires_at (the owner's Extend) is left alone.
create or replace function public.estimates_set_expiry()
returns trigger language plpgsql set search_path = public as $$
declare
  v_on boolean;
  v_days int;
  v_tz text;
  v_type text;
begin
  if new.status = 'draft' then
    new.expires_at := null;
    return new;
  end if;
  if new.status <> 'sent' then return new; end if;                                   -- approved / declined keep what they had
  if tg_op = 'UPDATE' then
    if new.expires_at is distinct from old.expires_at then return new; end if;        -- set on purpose
    if old.status = 'sent' and new.sent_at is not distinct from old.sent_at then return new; end if;  -- nothing re-sent
  end if;

  select estimate_expiry_enabled, estimate_valid_days, coalesce(nullif(timezone, ''), 'America/Chicago')
    into v_on, v_days, v_tz from public.settings where id = 1;
  if not coalesce(v_on, false) then
    new.expires_at := null;
    return new;
  end if;

  if new.job_id is not null then
    select job_type into v_type from public.jobs where id = new.job_id;
  elsif new.lead_id is not null then
    select job_type into v_type from public.leads where id = new.lead_id;
  end if;
  if v_type is distinct from 'water_restoration' then
    new.expires_at := null;
    return new;
  end if;

  new.expires_at := (((coalesce(new.sent_at, now()) at time zone v_tz)::date + v_days + 1)::timestamp) at time zone v_tz;
  return new;
end $$;

drop trigger if exists estimates_expiry on public.estimates;
create trigger estimates_expiry before insert or update on public.estimates
  for each row execute function public.estimates_set_expiry();

-- Owner: keep a sent estimate open for another N days (counted from today, or from its end date if that is later).
create or replace function public.extend_estimate_expiry(p_estimate uuid, p_days int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_base timestamptz;
  v_new timestamptz;
  v_status text;
  v_cur timestamptz;
begin
  if public.current_staff_role() is distinct from 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if p_days is null or p_days < 1 or p_days > 90 then raise exception 'BAD_DAYS'; end if;
  select status, expires_at into v_status, v_cur from public.estimates where id = p_estimate;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'sent' then raise exception 'NOT_SENT'; end if;
  select coalesce(nullif(timezone, ''), 'America/Chicago') into v_tz from public.settings where id = 1;
  v_base := greatest(now(), coalesce(v_cur, now()));
  v_new := ((((v_base - interval '1 second') at time zone v_tz)::date + p_days + 1)::timestamp) at time zone v_tz;
  update public.estimates set expires_at = v_new where id = p_estimate;
  return v_new;
end $$;
revoke all on function public.extend_estimate_expiry(uuid, int) from public;
grant execute on function public.extend_estimate_expiry(uuid, int) to authenticated;

-- ============================================================ per-property rates
create table if not exists public.property_rates (
  property_id uuid not null references public.properties (id) on delete cascade,
  price_item_id uuid not null references public.price_items (id) on delete cascade,
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  updated_at timestamptz not null default now(),
  primary key (property_id, price_item_id)
);
alter table public.property_rates enable row level security;
drop policy if exists property_rates_select on public.property_rates;
-- any staff can read (like the price list), so a tech adding a line to a property's estimate gets the property's price
create policy property_rates_select on public.property_rates for select using (public.is_staff());
drop policy if exists property_rates_insert on public.property_rates;
create policy property_rates_insert on public.property_rates for insert with check (public.is_office_or_owner());
drop policy if exists property_rates_update on public.property_rates;
create policy property_rates_update on public.property_rates for update using (public.is_office_or_owner()) with check (public.is_office_or_owner());
drop policy if exists property_rates_delete on public.property_rates;
create policy property_rates_delete on public.property_rates for delete using (public.is_office_or_owner());

-- ============================================================ duplicate check
-- A street written two ways should match: "123 N. Main Street" and "123 north main st".
-- lib/duplicateCheck.js has the same steps and a test that keeps them in agreement.
create or replace function public.norm_street_full(p_street text)
returns text language plpgsql immutable as $$
declare
  v text := regexp_replace(lower(coalesce(p_street, '')), '[^a-z0-9]+', ' ', 'g');
  pairs text[] := array['street','st','avenue','ave','road','rd','drive','dr','lane','ln','court','ct','boulevard','blvd',
                        'place','pl','circle','cir','north','n','south','s','east','e','west','w'];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) / 2 loop
    v := regexp_replace(v, '\y' || pairs[i * 2 - 1] || '\y', pairs[i * 2], 'g');
  end loop;
  return regexp_replace(v, '\s+', '', 'g');
end $$;

-- Existing customers and open leads that look like the person being typed in. Any of the four can be blank.
-- A match needs a phone (last 10 digits, 10 or more typed), an email, or a street plus zip (or plus city when there is no zip).
-- Two different unit numbers at one street are different people. Runs as the signed-in person.
create or replace function public.find_duplicate_customers(p_phone text, p_email text, p_street text, p_unit text, p_city text, p_zip text)
returns table (kind text, id uuid, display_name text, phone text, email text, status text, same_phone boolean, same_email boolean, same_address boolean)
language sql stable as $$
  with q as (
    select
      right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) as phone10,
      length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) as phone_len,
      nullif(lower(btrim(coalesce(p_email, ''))), '') as email,
      public.norm_street_full(p_street) as street,
      regexp_replace(lower(coalesce(p_unit, '')), '[^a-z0-9]', '', 'g') as unit,
      lower(btrim(coalesce(p_city, ''))) as city,
      left(regexp_replace(coalesce(p_zip, ''), '\D', '', 'g'), 5) as zip
  ),
  people as (
    select 'customer'::text as kind, c.id, c.display_name, c.phone, c.email, ''::text as status,
      (q.phone_len >= 10 and right(regexp_replace(c.phone, '\D', '', 'g'), 10) = q.phone10) as same_phone,
      (q.email is not null and lower(btrim(c.email)) = q.email) as same_email,
      exists (
        select 1 from public.addresses a
        where a.customer_id = c.id and length(q.street) >= 4
          and public.norm_street_full(a.street) = q.street
          and (q.unit = '' or regexp_replace(lower(a.unit), '[^a-z0-9]', '', 'g') = '' or regexp_replace(lower(a.unit), '[^a-z0-9]', '', 'g') = q.unit)
          and ((length(q.zip) = 5 and left(a.zip, 5) = q.zip) or (length(q.zip) <> 5 and q.city <> '' and lower(btrim(a.city)) = q.city))
      ) as same_address,
      c.last_visit_at as sort_at
    from public.customers c, q
    where not c.archived
    union all
    select 'lead'::text, l.id, l.name, l.phone, l.email, l.status,
      (q.phone_len >= 10 and right(regexp_replace(l.phone, '\D', '', 'g'), 10) = q.phone10),
      (q.email is not null and lower(btrim(l.email)) = q.email),
      (length(q.street) >= 4 and public.norm_street_full(l.street) = q.street
        and (q.unit = '' or regexp_replace(lower(l.unit), '[^a-z0-9]', '', 'g') = '' or regexp_replace(lower(l.unit), '[^a-z0-9]', '', 'g') = q.unit)
        and ((length(q.zip) = 5 and left(l.zip, 5) = q.zip) or (length(q.zip) <> 5 and q.city <> '' and lower(btrim(l.city)) = q.city))),
      l.created_at
    from public.leads l, q
    where l.status in ('new', 'quoted', 'accepted')
  )
  select kind, id, display_name, phone, email, status, same_phone, same_email, same_address
  from people
  where same_phone or same_email or same_address
  order by (same_phone::int + same_email::int + same_address::int) desc, (kind = 'customer') desc, sort_at desc nulls last
  limit 4
$$;
grant execute on function public.find_duplicate_customers(text, text, text, text, text, text) to authenticated;
