-- 045: Push 2A (Nov 23).
--   #125 PTO calendar: whole days off per person. The scheduler warns before booking someone on a day they are off.
--   #28  Capacity-aware slots: an optional setting. When on, the crews that can go out on a day are the active techs who are
--        not off that day, instead of the fixed "Jobs at the same time" number. Off by default; the old rule stays until you switch it.
-- Safe to run more than once. Run in the Supabase SQL Editor after 044, before deploying.

alter table public.settings add column if not exists booking_capacity_enabled boolean not null default false;

create table if not exists public.time_off (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.staff_users (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text not null default '',
  created_by uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint time_off_range check (ends_on >= starts_on and ends_on - starts_on < 120),
  constraint time_off_note check (char_length(note) <= 200)
);
create index if not exists time_off_staff_idx on public.time_off (staff_id, starts_on);
create index if not exists time_off_dates_idx on public.time_off (ends_on, starts_on);

alter table public.time_off enable row level security;
drop policy if exists time_off_select on public.time_off;
create policy time_off_select on public.time_off for select using (public.is_staff());
drop policy if exists time_off_insert on public.time_off;
create policy time_off_insert on public.time_off for insert with check (public.is_office_or_owner());
drop policy if exists time_off_update on public.time_off;
create policy time_off_update on public.time_off for update using (public.is_office_or_owner()) with check (public.is_office_or_owner());
drop policy if exists time_off_delete on public.time_off;
create policy time_off_delete on public.time_off for delete using (public.is_office_or_owner());

-- Crews available on a date: active techs who are not off that day.
create or replace function public.crews_on(p_date date)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.staff_users s
  where s.role = 'tech' and s.active
    and not exists (select 1 from public.time_off t where t.staff_id = s.id and t.starts_on <= p_date and p_date <= t.ends_on);
$$;
revoke all on function public.crews_on(date) from public, anon, authenticated;
grant execute on function public.crews_on(date) to service_role;

-- The online booking check (023), now able to use capacity. Identical unless the setting is on.
create or replace function public.self_book_slot(p_lead uuid, p_starts_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_set public.settings%rowtype;
  v_status text;
  v_end timestamptz;
  v_gap interval;
  v_busy int;
  v_crews int;
begin
  select * into v_set from public.settings where id = 1;
  v_end := p_starts_at + make_interval(mins => v_set.booking_slot_minutes);
  v_gap := make_interval(mins => v_set.booking_gap_minutes);

  -- one booking at a time, until this transaction ends
  perform pg_advisory_xact_lock(hashtext('monarch_booking_slots'));

  select status into v_status from public.leads where id = p_lead;
  if v_status is null then raise exception 'LEAD_NOT_FOUND'; end if;
  if v_status <> 'accepted' then raise exception 'LEAD_NOT_READY'; end if;

  v_crews := case when v_set.booking_capacity_enabled
    then public.crews_on((p_starts_at at time zone v_set.timezone)::date)
    else v_set.booking_crews end;

  select count(*) into v_busy from public.job_visits v
  where v.status in ('scheduled', 'on_the_way', 'started')
    and v.starts_at < v_end + v_gap
    and v.ends_at + v_gap > p_starts_at;
  if v_busy >= v_crews then raise exception 'SLOT_TAKEN'; end if;

  return public.create_work_order_core(p_lead, p_starts_at, v_set.booking_slot_minutes, null, false);
end;
$$;

revoke all on function public.self_book_slot(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.self_book_slot(uuid, timestamptz) to service_role;
