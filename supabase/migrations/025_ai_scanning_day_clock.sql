-- 025: AI scanning keys and log, and the day clock (shifts and breaks).
-- Run after 024. Run it once, before deploying this push.
--
--   * integration_credentials may now hold 'anthropic' (Claude) and 'openai' (ChatGPT) keys, entered on Settings > Integrations.
--   * ai_scan_log: one row per scan (who, what kind, which provider, worked or not). No pictures, no scanned text. The owner sees a
--     monthly count next to the keys.
--   * shifts: one row per stretch someone was clocked in for the day. shift_breaks: breaks inside a shift (lunch, a break).
--     The website writes them (service role); a tech can read their own, office and owner read everyone's.
--   * shift_edit_requests: a tech asks to change a shift or a break, or to add a shift they forgot to clock. Nothing changes until
--     the owner approves. The owner is notified; the tech is told the decision.
--   Whether the day clock and the job clock agree (job time with no shift, more job time than shift time, ...) is worked out on
--   screen from these tables and job_clock_sessions (024); nothing about it is stored.

-- ------------------------------------------------------------------- AI keys
alter table public.integration_credentials drop constraint if exists integration_credentials_provider_check;
alter table public.integration_credentials add constraint integration_credentials_provider_check
  check (provider in ('stripe', 'square', 'google_maps', 'twilio', 'resend', 'anthropic', 'openai'));

create table public.ai_scan_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff_users (id) on delete set null,
  kind text not null check (char_length(kind) <= 40),
  provider text not null check (provider in ('anthropic', 'openai')),
  ok boolean not null,
  error text not null default '' check (char_length(error) <= 300),
  created_at timestamptz not null default now()
);
create index ai_scan_log_created_idx on public.ai_scan_log (created_at desc);
alter table public.ai_scan_log enable row level security;
create policy ai_scan_log_select on public.ai_scan_log for select using (public.is_office_or_owner());
-- written by the website (service role) only

-- ------------------------------------------------------------------- the day clock
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  source text not null default 'self' check (source in ('self', 'office', 'approved')),   -- clocked by the person, added or fixed by the owner, or added by an approved request
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text not null default '' check (char_length(void_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_range check (ended_at is null or ended_at > started_at)
);
create index shifts_staff_idx on public.shifts (staff_id, started_at desc);
create index shifts_started_idx on public.shifts (started_at desc);
-- one running shift per person
create unique index shifts_one_open on public.shifts (staff_id) where ended_at is null and voided_at is null;
create trigger shifts_touch before update on public.shifts for each row execute function public.touch_updated_at();

create table public.shift_breaks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  staff_id uuid not null references public.staff_users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  edited_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_breaks_range check (ended_at is null or ended_at > started_at)
);
create index shift_breaks_shift_idx on public.shift_breaks (shift_id, started_at);
create unique index shift_breaks_one_open on public.shift_breaks (shift_id) where ended_at is null and voided_at is null;
create trigger shift_breaks_touch before update on public.shift_breaks for each row execute function public.touch_updated_at();

alter table public.shifts enable row level security;
alter table public.shift_breaks enable row level security;
create policy shifts_select on public.shifts for select using (public.is_office_or_owner() or staff_id = auth.uid());
create policy shift_breaks_select on public.shift_breaks for select using (public.is_office_or_owner() or staff_id = auth.uid());
-- no insert / update / delete policies: the website writes these with the service role

-- ------------------------------------------------------------------- revision requests
create table public.shift_edit_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.staff_users (id) on delete cascade,
  target text not null check (target in ('shift', 'break', 'add')),     -- change a shift, change a break, or add a shift that was never clocked
  shift_id uuid references public.shifts (id) on delete cascade,
  break_id uuid references public.shift_breaks (id) on delete cascade,
  old_started_at timestamptz,
  old_ended_at timestamptz,
  new_started_at timestamptz not null,
  new_ended_at timestamptz not null,
  reason text not null check (btrim(reason) <> '' and char_length(reason) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.staff_users (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 300),
  created_at timestamptz not null default now(),
  constraint shift_edit_range check (new_ended_at > new_started_at),
  constraint shift_edit_target check (
    (target = 'shift' and shift_id is not null and break_id is null)
    or (target = 'break' and break_id is not null)
    or (target = 'add' and shift_id is null and break_id is null)
  )
);
create index shift_edit_requests_status_idx on public.shift_edit_requests (status, created_at desc);
create index shift_edit_requests_person_idx on public.shift_edit_requests (requested_by, created_at desc);
-- one open request per shift and per break
create unique index shift_edit_requests_one_pending_shift on public.shift_edit_requests (shift_id) where status = 'pending' and target = 'shift';
create unique index shift_edit_requests_one_pending_break on public.shift_edit_requests (break_id) where status = 'pending' and target = 'break';

alter table public.shift_edit_requests enable row level security;
create policy shift_edit_requests_select on public.shift_edit_requests for select using (public.is_office_or_owner() or requested_by = auth.uid());
-- no write policies: requests and decisions go through the website

-- ------------------------------------------------------------------- notifications
create or replace function public.trg_notify_shift_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_who text;
  v_what text;
begin
  select coalesce(nullif(btrim(full_name), ''), email) into v_who from public.staff_users where id = new.requested_by;
  v_what := case new.target when 'add' then 'add a missed shift' when 'break' then 'change a break' else 'change a shift' end;
  if tg_op = 'INSERT' then
    perform public.notify_users(
      public.notif_owners(), 'shift_edit_request', 'action',
      'Time clock change to approve: ' || coalesce(v_who, 'someone'),
      concat_ws(' · ', 'Asks to ' || v_what, left(btrim(new.reason), 120)),
      '/dashboard?tab=timeclock', null, null, 'shiftedit:' || new.id);
  elsif tg_op = 'UPDATE' and new.status <> 'pending' and old.status = 'pending' then
    perform public.notif_resolve('shiftedit:' || new.id);
    perform public.notify_users(
      array[new.requested_by], 'shift_edit_decided', 'info',
      case when new.status = 'approved' then 'Time clock change approved' else 'Time clock change not approved' end,
      concat_ws(' · ', 'You asked to ' || v_what, nullif(left(btrim(new.decision_note), 120), '')),
      '/dashboard', null, null, 'shiftedit:' || new.id || ':decided');
  end if;
  return new;
end;
$$;
create trigger shift_edit_requests_notify after insert or update of status on public.shift_edit_requests
  for each row execute function public.trg_notify_shift_edit();
