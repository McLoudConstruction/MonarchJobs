-- 024: job clock, time-change requests, price list time rates, and a color for each person.
-- Run after 001 to 023. Run it once, before deploying this push.
--
--   * job_clock_sessions: one row per stretch of time someone had the clock running on a job. Restoration jobs start it at
--     "On the way" (travel counts as job hours); carpet jobs start it at "Start job"; "Finish job" stops it; a tech may also clock
--     out and back in (lunch). There is no money in this table, so a tech can see their own entries. The website writes it (service
--     role); nobody changes it straight from a browser.
--   * Each finished session also becomes one row in job_time_entries (the owner's costing ledger, owner only), at the person's
--     hourly cost when the clock stopped. job_time_entries.clock_session_id ties the two together.
--   * job_time_edit_requests: a tech asks to change a finished session's start or end. Nothing changes until the owner approves.
--     The owner is notified; the tech is told the decision.
--   * price_items.minutes_per_unit: how long one unit of that item takes (minutes per sq ft, per room, per flat item...). The
--     allotted time of a job is worked out from its estimate lines and these rates.
--   * staff_users.color: one of the 12 palette keys in lib/userColors.js. Everyone gets one (existing people now, new people when added).

-- ------------------------------------------------------------------- price list time rate
alter table public.price_items
  add column if not exists minutes_per_unit numeric(8, 2) check (minutes_per_unit is null or (minutes_per_unit >= 0 and minutes_per_unit <= 100000));

-- ------------------------------------------------------------------- a color for each person
alter table public.staff_users
  add column if not exists color text not null default '' check (color in ('', 'red', 'orange', 'gold', 'lime', 'green', 'teal', 'sky', 'blue', 'purple', 'magenta', 'rose', 'slate'));

-- Everyone who exists now gets a color (in the order they were added, most different colors first), and each new person gets the
-- first color nobody else has. The owner can change any of them; a person can change their own (set_my_color below).
with ranked as (
  select id, row_number() over (order by created_at, id) as rn from public.staff_users where color = ''
)
update public.staff_users s
set color = (array['blue', 'orange', 'green', 'purple', 'red', 'teal', 'gold', 'magenta', 'sky', 'lime', 'rose', 'slate'])[((r.rn - 1) % 12)::int + 1]
from ranked r where s.id = r.id;

create or replace function public.staff_default_color()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.color, '') = '' then
    new.color := coalesce((
      select k from unnest(array['blue', 'orange', 'green', 'purple', 'red', 'teal', 'gold', 'magenta', 'sky', 'lime', 'rose', 'slate']) with ordinality as t(k, i)
      where k not in (select color from public.staff_users where color <> '')
      order by i limit 1
    ), 'blue');
  end if;
  return new;
end;
$$;
drop trigger if exists staff_users_default_color on public.staff_users;
create trigger staff_users_default_color before insert on public.staff_users
  for each row execute function public.staff_default_color();

-- Anyone may set their own color; the owner can set anyone's (the existing owner update policy). Only the color changes here.
create or replace function public.set_my_color(p_color text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'NOT_ALLOWED: sign in first';
  end if;
  if coalesce(p_color, '') not in ('', 'red', 'orange', 'gold', 'lime', 'green', 'teal', 'sky', 'blue', 'purple', 'magenta', 'rose', 'slate') then
    raise exception 'BAD_COLOR: pick one of the colors in the list';
  end if;
  update public.staff_users set color = coalesce(p_color, '') where id = auth.uid();
end;
$$;
revoke all on function public.set_my_color(text) from public;
grant execute on function public.set_my_color(text) to authenticated;

-- ------------------------------------------------------------------- the clock
create table public.job_clock_sessions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  visit_id uuid references public.job_visits (id) on delete set null,
  staff_id uuid not null references public.staff_users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  arrived_at timestamptz,                 -- restoration: when "Start job" was tapped after "On the way" (the time before it was travel)
  source text not null default 'visit' check (source in ('visit', 'manual', 'office')),   -- visit button, clock in/out button, or office
  edited_at timestamptz,                  -- set when the owner approved a change (or fixed it directly)
  voided_at timestamptz,
  void_reason text not null default '' check (char_length(void_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_clock_range check (ended_at is null or ended_at > started_at)
);
create index job_clock_sessions_job_idx on public.job_clock_sessions (job_id, started_at);
create index job_clock_sessions_staff_idx on public.job_clock_sessions (staff_id, started_at desc);
-- one running clock per person per job
create unique index job_clock_sessions_one_open on public.job_clock_sessions (job_id, staff_id) where ended_at is null and voided_at is null;
create trigger job_clock_sessions_touch before update on public.job_clock_sessions
  for each row execute function public.touch_updated_at();

alter table public.job_clock_sessions enable row level security;
create policy job_clock_sessions_select on public.job_clock_sessions for select
  using (public.is_office_or_owner() or staff_id = auth.uid());
-- no insert / update / delete policy: the website writes sessions with the service role

-- the ledger entry for a session (owner only table, see 021)
alter table public.job_time_entries
  add column if not exists clock_session_id uuid unique references public.job_clock_sessions (id) on delete set null;

-- ------------------------------------------------------------------- change requests
create table public.job_time_edit_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.job_clock_sessions (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  requested_by uuid not null references public.staff_users (id) on delete cascade,
  old_started_at timestamptz not null,
  old_ended_at timestamptz not null,
  new_started_at timestamptz not null,
  new_ended_at timestamptz not null,
  reason text not null check (btrim(reason) <> '' and char_length(reason) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.staff_users (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 300),
  created_at timestamptz not null default now(),
  constraint job_time_edit_range check (new_ended_at > new_started_at)
);
create index job_time_edit_requests_status_idx on public.job_time_edit_requests (status, created_at desc);
create index job_time_edit_requests_job_idx on public.job_time_edit_requests (job_id);
-- one open request per entry
create unique index job_time_edit_requests_one_pending on public.job_time_edit_requests (session_id) where status = 'pending';

alter table public.job_time_edit_requests enable row level security;
create policy job_time_edit_requests_select on public.job_time_edit_requests for select
  using (public.is_office_or_owner() or requested_by = auth.uid());
-- no write policies: requests and decisions go through the website

-- ------------------------------------------------------------------- notifications
-- The owner is told a change is waiting (it clears itself when decided); the tech is told the decision.
create or replace function public.trg_notify_time_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_who text;
  v_job text;
begin
  select coalesce(nullif(btrim(full_name), ''), email) into v_who from public.staff_users where id = new.requested_by;
  v_job := public.notif_job_label(new.job_id);
  if tg_op = 'INSERT' then
    perform public.notify_users(
      public.notif_owners(), 'time_edit_request', 'action',
      'Time change to approve: ' || coalesce(v_who, 'a tech'),
      concat_ws(' · ', v_job, left(btrim(new.reason), 120)),
      '/dashboard?tab=overview#time-requests', new.job_id, null, 'timeedit:' || new.id);
  elsif tg_op = 'UPDATE' and new.status <> 'pending' and old.status = 'pending' then
    perform public.notif_resolve('timeedit:' || new.id);
    perform public.notify_users(
      array[new.requested_by], 'time_edit_decided', 'info',
      case when new.status = 'approved' then 'Time change approved' else 'Time change not approved' end,
      concat_ws(' · ', v_job, nullif(left(btrim(new.decision_note), 120), '')),
      '/jobs/' || new.job_id, new.job_id, null, 'timeedit:' || new.id || ':decided');
  end if;
  return new;
end;
$$;
create trigger job_time_edit_requests_notify after insert or update of status on public.job_time_edit_requests
  for each row execute function public.trg_notify_time_edit();
