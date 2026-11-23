-- 049: Time off requests and on-call swap requests from the team (Nov 23).
--   Anyone can ask for time off, and ask for someone to cover their on-call time. The owner and office are told; time off
--   can be approved by the owner or office (it then goes on the Time off calendar), swaps by the owner only (it then goes on the
--   on-call calendar as a swap). The person who asked is told the result in calm wording. Nothing here messages customers.
-- Safe to run more than once. Run in the Supabase SQL Editor after 048, before deploying.

-- ---------------------------------------------------------------- time off requests
create table if not exists public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text not null default '' check (char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references public.staff_users(id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 200),
  created_at timestamptz not null default now(),
  constraint time_off_requests_range check (ends_on >= starts_on and ends_on - starts_on < 120)
);
create index if not exists time_off_requests_staff_idx on public.time_off_requests (staff_id, created_at desc);
create index if not exists time_off_requests_pending_idx on public.time_off_requests (created_at) where status = 'pending';
alter table public.time_off_requests enable row level security;
drop policy if exists time_off_requests_select on public.time_off_requests;
create policy time_off_requests_select on public.time_off_requests for select using (staff_id = auth.uid() or public.is_office_or_owner());
drop policy if exists time_off_requests_insert on public.time_off_requests;
create policy time_off_requests_insert on public.time_off_requests for insert
  with check (public.is_staff() and staff_id = auth.uid() and status = 'pending');
drop policy if exists time_off_requests_delete on public.time_off_requests;
create policy time_off_requests_delete on public.time_off_requests for delete using (staff_id = auth.uid() and status = 'pending');

create or replace function public.trg_time_off_request_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.notify_users(
      array_remove(public.notif_office_owner(), new.staff_id), 'time_off_request', 'action', 'Time off request',
      concat_ws(' · ', coalesce((select nullif(btrim(full_name), '') from public.staff_users where id = new.staff_id), 'A team member'),
        case when new.starts_on = new.ends_on then to_char(new.starts_on, 'FMMon FMDD') else to_char(new.starts_on, 'FMMon FMDD') || ' to ' || to_char(new.ends_on, 'FMMon FMDD') end,
        nullif(btrim(new.note), '')),
      '/schedule#timeoff', null, null, 'torq:' || new.id);
  exception when others then
    raise warning 'time off request notice failed: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists time_off_requests_notify on public.time_off_requests;
create trigger time_off_requests_notify after insert on public.time_off_requests
  for each row execute function public.trg_time_off_request_insert();

-- office or owner: approve (adds it to the Time off calendar) or decline
create or replace function public.time_off_decide(p_id uuid, p_approve boolean, p_note text default '')
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r public.time_off_requests%rowtype;
begin
  if not public.is_office_or_owner() then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.time_off_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  if p_approve then
    insert into public.time_off (staff_id, starts_on, ends_on, note, created_by) values (r.staff_id, r.starts_on, r.ends_on, r.note, auth.uid());
  end if;
  update public.time_off_requests set status = case when p_approve then 'approved' else 'declined' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = left(coalesce(p_note, ''), 200) where id = p_id;
  perform public.notif_resolve('torq:' || p_id);
  perform public.notify_users(array[r.staff_id], 'time_off_decided', 'info',
    case when p_approve then 'Time off approved' else 'Time off not approved' end,
    concat_ws(' · ', case when r.starts_on = r.ends_on then to_char(r.starts_on, 'FMMon FMDD') else to_char(r.starts_on, 'FMMon FMDD') || ' to ' || to_char(r.ends_on, 'FMMon FMDD') end,
      nullif(btrim(left(coalesce(p_note, ''), 200)), '')),
    '/timeclock#timeoff', null, null, 'torq:' || p_id || ':done');
  return true;
end $$;
revoke all on function public.time_off_decide(uuid, boolean, text) from public, anon;
grant execute on function public.time_off_decide(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------- on-call swap requests
create table if not exists public.oncall_swap_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.staff_users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cover_id uuid references public.staff_users(id) on delete set null,   -- who they suggest, if anyone
  note text not null default '' check (char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references public.staff_users(id) on delete set null,
  decided_at timestamptz,
  covered_by uuid references public.staff_users(id) on delete set null, -- who the owner picked
  decision_note text not null default '' check (char_length(decision_note) <= 200),
  created_at timestamptz not null default now(),
  constraint oncall_swap_range check (ends_at > starts_at and ends_at - starts_at <= interval '60 days')
);
create index if not exists oncall_swap_requests_staff_idx on public.oncall_swap_requests (requester_id, created_at desc);
create index if not exists oncall_swap_requests_pending_idx on public.oncall_swap_requests (created_at) where status = 'pending';
alter table public.oncall_swap_requests enable row level security;
drop policy if exists oncall_swap_requests_select on public.oncall_swap_requests;
create policy oncall_swap_requests_select on public.oncall_swap_requests for select using (requester_id = auth.uid() or public.is_office_or_owner());
drop policy if exists oncall_swap_requests_insert on public.oncall_swap_requests;
create policy oncall_swap_requests_insert on public.oncall_swap_requests for insert
  with check (public.is_staff() and requester_id = auth.uid() and status = 'pending');
drop policy if exists oncall_swap_requests_delete on public.oncall_swap_requests;
create policy oncall_swap_requests_delete on public.oncall_swap_requests for delete using (requester_id = auth.uid() and status = 'pending');

create or replace function public.trg_swap_request_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ends_at <= now() then raise exception 'SWAP_IN_PAST'; end if;
  return new;
end $$;
drop trigger if exists oncall_swap_requests_check on public.oncall_swap_requests;
create trigger oncall_swap_requests_check before insert on public.oncall_swap_requests
  for each row execute function public.trg_swap_request_insert();

create or replace function public.trg_swap_request_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tz text := public.notif_tz();
begin
  begin
    perform public.notify_users(
      array_remove(public.notif_owners(), new.requester_id), 'oncall_swap_request', 'action', 'On-call swap request',
      concat_ws(' · ', coalesce((select nullif(btrim(full_name), '') from public.staff_users where id = new.requester_id), 'A team member'),
        to_char(new.starts_at at time zone v_tz, 'FMMon FMDD FMHH12:MI AM') || ' to ' || to_char(new.ends_at at time zone v_tz, 'FMMon FMDD FMHH12:MI AM'),
        (select 'suggests ' || nullif(btrim(full_name), '') from public.staff_users where id = new.cover_id),
        nullif(btrim(new.note), '')),
      '/settings#oncall', null, null, 'swrq:' || new.id);
  exception when others then
    raise warning 'swap request notice failed: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists oncall_swap_requests_notify on public.oncall_swap_requests;
create trigger oncall_swap_requests_notify after insert on public.oncall_swap_requests
  for each row execute function public.trg_swap_request_notify();

-- owner: approve with someone to cover (it goes on the on-call calendar as a swap) or decline
create or replace function public.oncall_swap_decide(p_id uuid, p_approve boolean, p_cover uuid default null, p_note text default '')
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r public.oncall_swap_requests%rowtype;
  v_cover uuid;
  v_tz text := public.notif_tz();
  v_when text;
begin
  if public.current_staff_role() is distinct from 'owner' then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.oncall_swap_requests where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  v_when := to_char(r.starts_at at time zone v_tz, 'FMMon FMDD FMHH12:MI AM') || ' to ' || to_char(r.ends_at at time zone v_tz, 'FMMon FMDD FMHH12:MI AM');
  if p_approve then
    v_cover := coalesce(p_cover, r.cover_id);
    if v_cover is null then raise exception 'NEEDS_COVER'; end if;
    if v_cover = r.requester_id or not exists (select 1 from public.staff_users where id = v_cover and active) then raise exception 'BAD_COVER'; end if;
    insert into public.oncall_overrides (staff_id, starts_at, ends_at, note, created_by) values (v_cover, r.starts_at, r.ends_at, 'Swap for a request', auth.uid());
  end if;
  update public.oncall_swap_requests set status = case when p_approve then 'approved' else 'declined' end, decided_by = auth.uid(), decided_at = now(),
    covered_by = v_cover, decision_note = left(coalesce(p_note, ''), 200) where id = p_id;
  perform public.notif_resolve('swrq:' || p_id);
  perform public.notify_users(array[r.requester_id], 'oncall_swap_decided', 'info',
    case when p_approve then 'On-call swap approved' else 'On-call swap not approved' end,
    concat_ws(' · ', v_when, case when p_approve then (select 'Covered by ' || nullif(btrim(full_name), '') from public.staff_users where id = v_cover) end, nullif(btrim(left(coalesce(p_note, ''), 200)), '')),
    '/timeclock#oncall', null, null, 'swrq:' || p_id || ':done');
  if p_approve then
    perform public.notify_users(array[v_cover], 'oncall_swap_decided', 'info', 'You are covering on call', v_when, '/timeclock#oncall', null, null, 'swrq:' || p_id || ':cover');
  end if;
  return true;
end $$;
revoke all on function public.oncall_swap_decide(uuid, boolean, uuid, text) from public, anon;
grant execute on function public.oncall_swap_decide(uuid, boolean, uuid, text) to authenticated;
