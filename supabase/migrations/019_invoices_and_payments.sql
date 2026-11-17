-- 019: invoices, payments, late interest, return-visit invoicing and the money notifications.
-- Run after 001 to 018. Run it once, before deploying this push.
--
-- How it fits together
--   * An invoice belongs to a job and is built from the job's estimate (what the customer approved: their tier and ticked
--     add-ons, plus any lines added since). It is a draft until it is sent. Once sent it can no longer be edited; it can
--     only receive payments, late interest, or be voided.
--   * Money amounts are whole cents. Lines use the same quantity x unit price as estimate lines, rounded once per line.
--   * Payments are rows (cash, check, Stripe, Square). Refunds are negative rows. The invoice's paid amount, balance and
--     status are worked out by the database every time a payment, line or interest row changes.
--   * Return visits (decided Nov 3):
--       - invoice not paid at all: it is voided (and its pay links are cancelled by the website) and the new invoice
--         bills the full balance;
--       - invoice paid (or part paid): the new invoice lists the whole job and takes off what was already paid, so it is
--         only the difference. Nothing to bill (new total not above what was paid) is refused.
--   * Late interest is applied by the owner, by hand, and only after an invoice is past due.
--   * Everything that changes an invoice goes through the website's server routes (service role) or the functions below,
--     so the functions are not callable from the browser. The browser can read invoices and edit the lines of a draft.

-- ------------------------------------------------------------------- settings
alter table public.settings
  add column if not exists invoice_terms_days int not null default 14 check (invoice_terms_days between 0 and 120),
  add column if not exists invoice_footer text not null default '' check (char_length(invoice_footer) <= 1000),
  add column if not exists late_interest_rate numeric(5, 2) not null default 1.5 check (late_interest_rate between 0 and 100),
  add column if not exists late_interest_commercial_only boolean not null default true,
  add column if not exists auto_invoice text not null default 'draft' check (auto_invoice in ('off', 'draft', 'send')),
  add column if not exists office_can_void boolean not null default false;

-- ------------------------------------------------------------------- tables
create sequence if not exists public.invoice_number_seq start 1001;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number bigint not null unique default nextval('public.invoice_number_seq'),
  job_id uuid not null references public.jobs (id) on delete restrict,
  kind text not null default 'standard' check (kind in ('standard', 'difference')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'partial', 'paid', 'void')),
  replaces_invoice_id uuid references public.invoices (id) on delete set null,
  superseded_by uuid references public.invoices (id) on delete set null,
  -- who it is made out to, copied when the invoice is made so later edits to the customer do not change it
  bill_to_name text not null default '',
  bill_to_email text not null default '',
  bill_to_phone text not null default '',
  po_number text not null default '',
  scope_note text not null default '' check (char_length(scope_note) <= 4000),   -- shown to the customer with the lines
  minimum_charge numeric(10, 2) not null default 0 check (minimum_charge >= 0),
  terms_days int not null default 14 check (terms_days between 0 and 120),
  -- worked out by the database (invoice_refresh); never written by the browser
  credit_cents bigint not null default 0 check (credit_cents >= 0),               -- already paid on earlier invoices of this job
  subtotal_cents bigint not null default 0,
  minimum_adjustment_cents bigint not null default 0,
  total_cents bigint not null default 0,                                          -- lines plus the minimum top-up
  interest_cents bigint not null default 0,
  paid_cents bigint not null default 0,                                           -- payments minus refunds, tips not included
  tip_cents bigint not null default 0,
  balance_cents bigint not null default 0,                                        -- total - credit + interest - paid
  share_token uuid not null unique default gen_random_uuid(),
  issued_at timestamptz,
  due_date date,
  sent_via text check (sent_via in ('delivered', 'manual', 'in_person')),
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text not null default '',
  voided_by uuid references public.staff_users (id) on delete set null,
  disputed_at timestamptz,
  past_due_notified_at timestamptz,
  created_by uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_job_idx on public.invoices (job_id, created_at desc);
create index invoices_status_idx on public.invoices (status);
create index invoices_due_idx on public.invoices (due_date) where status in ('sent', 'partial');
create trigger invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  estimate_line_id uuid references public.estimate_lines (id) on delete set null,
  description text not null check (btrim(description) <> ''),
  unit text not null default 'each' check (unit in ('sqft', 'room', 'flat', 'hour', 'each')),
  quantity numeric(12, 3) not null default 1 check (quantity >= 0),
  unit_price numeric(10, 2) not null,                                             -- negative for a discount line
  is_custom boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, sort_order);

-- Pictures sent with the invoice (usually the before and after of each room).
create table public.invoice_photos (
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  photo_id uuid not null references public.job_photos (id) on delete cascade,
  sort_order int not null default 0,
  primary key (invoice_id, photo_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  method text not null check (method in ('stripe', 'square', 'cash', 'check', 'other')),
  amount_cents bigint not null check (amount_cents <> 0),                         -- negative for a refund
  tip_cents bigint not null default 0 check (tip_cents >= 0),
  processor_ref text,                                                             -- the processor's payment / refund id
  reference text not null default '' check (char_length(reference) <= 80),        -- check number and the like
  note text not null default '' check (char_length(note) <= 500),
  refund_of uuid references public.payments (id) on delete set null,
  received_at timestamptz not null default now(),
  recorded_by uuid references public.staff_users (id) on delete set null,         -- null when a processor reported it
  created_at timestamptz not null default now()
);
create index payments_invoice_idx on public.payments (invoice_id, received_at);
create index payments_received_idx on public.payments (received_at);
create unique index payments_processor_ref_idx on public.payments (method, processor_ref) where processor_ref is not null;

create table public.invoice_interest (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  rate_percent numeric(5, 2) not null check (rate_percent > 0 and rate_percent <= 100),   -- per month
  months int not null check (months between 1 and 36),
  base_cents bigint not null check (base_cents > 0),
  amount_cents bigint not null check (amount_cents > 0),
  note text not null default '' check (char_length(note) <= 300),
  applied_by uuid references public.staff_users (id) on delete set null,
  applied_at timestamptz not null default now(),
  waived_at timestamptz,
  waived_by uuid references public.staff_users (id) on delete set null
);
create index invoice_interest_invoice_idx on public.invoice_interest (invoice_id);

-- Card and payment-link sessions made at Stripe and Square for an invoice. Kept so they can be cancelled when the
-- invoice is voided or paid. Written only by the website.
create table public.invoice_pay_links (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'square')),
  ref text not null,                      -- Stripe checkout session id, or Square payment link id
  order_ref text,                         -- Square order id (how a Square payment is matched back)
  url text not null,
  amount_cents bigint not null,
  created_by uuid references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz
);
create index invoice_pay_links_invoice_idx on public.invoice_pay_links (invoice_id);
create index invoice_pay_links_order_idx on public.invoice_pay_links (order_ref) where order_ref is not null;
create index invoice_pay_links_ref_idx on public.invoice_pay_links (ref);

-- ------------------------------------------------------------------- helpers
create or replace function public.invoice_job(i uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select job_id from public.invoices where id = i
$$;

create or replace function public.invoice_is_draft(i uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invoices where id = i and issued_at is null and voided_at is null)
$$;

create or replace function public.invoice_label(i uuid)
returns text language sql stable security definer set search_path = public as $$
  select '#' || j.job_number || ' ' || c.display_name
  from public.invoices v join public.jobs j on j.id = v.job_id join public.customers c on c.id = j.customer_id
  where v.id = i
$$;

create or replace function public.money_text(c bigint)
returns text language sql immutable as $$
  select case when c < 0 then '-' else '' end || '$' || trim(to_char(abs(c) / 100.0, 'FM999,999,990.00'))
$$;

-- ------------------------------------------------------------------- totals and status
-- Works out everything that is derived: line totals, the job minimum, interest, payments, balance and status.
create or replace function public.invoice_refresh(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  i public.invoices%rowtype;
  v_sub bigint;
  v_min bigint;
  v_int bigint;
  v_paid bigint;
  v_tips bigint;
  v_bal bigint;
  v_status text;
begin
  select * into i from public.invoices where id = p_id;
  if not found then return; end if;

  select coalesce(sum(round(quantity * unit_price * 100)), 0)::bigint into v_sub from public.invoice_lines where invoice_id = p_id;
  v_min := case when v_sub > 0 and v_sub < round(i.minimum_charge * 100) then round(i.minimum_charge * 100)::bigint - v_sub else 0 end;
  select coalesce(sum(amount_cents), 0)::bigint into v_int from public.invoice_interest where invoice_id = p_id and waived_at is null;
  select coalesce(sum(amount_cents), 0)::bigint, coalesce(sum(tip_cents), 0)::bigint into v_paid, v_tips from public.payments where invoice_id = p_id;
  v_bal := v_sub + v_min - i.credit_cents + v_int - v_paid;

  v_status := case
    when i.voided_at is not null then 'void'
    when i.issued_at is null then 'draft'
    when v_bal <= 0 then 'paid'
    when v_paid > 0 then 'partial'
    else 'sent' end;

  update public.invoices set
    subtotal_cents = v_sub, minimum_adjustment_cents = v_min, total_cents = v_sub + v_min, interest_cents = v_int,
    paid_cents = v_paid, tip_cents = v_tips, balance_cents = v_bal, status = v_status,
    paid_at = case when v_status = 'paid' then coalesce(paid_at, now()) else null end
  where id = p_id;
end;
$$;

create or replace function public.trg_invoice_child_refresh()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := coalesce(new.invoice_id, old.invoice_id);
  perform public.invoice_refresh(v_id);
  return coalesce(new, old);
end;
$$;
create trigger invoice_lines_refresh after insert or update or delete on public.invoice_lines
  for each row execute function public.trg_invoice_child_refresh();
create trigger invoice_interest_refresh after insert or update or delete on public.invoice_interest
  for each row execute function public.trg_invoice_child_refresh();
create trigger payments_refresh after insert or update or delete on public.payments
  for each row execute function public.trg_invoice_child_refresh();

-- Lines and pictures can only change while the invoice is a draft: after it is sent the customer has seen it.
create or replace function public.trg_invoice_child_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := coalesce(new.invoice_id, old.invoice_id);
  if not public.invoice_is_draft(v_id) then
    raise exception 'INVOICE_LOCKED: a sent invoice cannot be edited' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function public.trg_invoice_child_guard();
create trigger invoice_photos_guard before insert or update or delete on public.invoice_photos
  for each row execute function public.trg_invoice_child_guard();

-- What the customer was sent does not change under them.
create or replace function public.trg_invoice_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.issued_at is not null and (
       (new.job_id, new.kind, new.bill_to_name, new.bill_to_email, new.bill_to_phone, new.po_number, new.scope_note, new.minimum_charge, new.credit_cents, new.invoice_number)
       is distinct from
       (old.job_id, old.kind, old.bill_to_name, old.bill_to_email, old.bill_to_phone, old.po_number, old.scope_note, old.minimum_charge, old.credit_cents, old.invoice_number)
     ) then
    raise exception 'INVOICE_LOCKED: a sent invoice cannot be edited' using errcode = 'P0001';
  end if;
  if old.issued_at is not null and new.issued_at is distinct from old.issued_at then
    raise exception 'INVOICE_LOCKED: a sent invoice cannot be edited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger invoices_guard before update on public.invoices
  for each row execute function public.trg_invoice_guard();

-- ------------------------------------------------------------------- building an invoice from the estimate
-- The lines the customer approved: included lines, the tier they picked, and add-ons they ticked.
create or replace function public.estimate_effective_total_cents(p_job uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare
  e public.estimates%rowtype;
  v_sub bigint;
begin
  select * into e from public.estimates where job_id = p_job;
  if not found then return 0; end if;
  select coalesce(sum(round(l.quantity * l.unit_price * 100)), 0)::bigint into v_sub
  from public.estimate_lines l
  where l.estimate_id = e.id
    and ((l.optional and l.accepted) or (not l.optional and (l.tier is null or l.tier = e.chosen_tier)));
  return v_sub + case when v_sub > 0 and v_sub < round(e.minimum_charge * 100) then round(e.minimum_charge * 100)::bigint - v_sub else 0 end;
end;
$$;

create or replace function public.invoice_copy_lines(p_invoice uuid, p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.estimates%rowtype;
begin
  select * into e from public.estimates where job_id = p_job;
  if not found then return; end if;
  insert into public.invoice_lines (invoice_id, estimate_line_id, description, unit, quantity, unit_price, is_custom, sort_order)
  select p_invoice, l.id, l.description, l.unit, l.quantity, l.unit_price, l.is_custom,
         row_number() over (order by l.sort_order, l.created_at)
  from public.estimate_lines l
  where l.estimate_id = e.id
    and ((l.optional and l.accepted) or (not l.optional and (l.tier is null or l.tier = e.chosen_tier)));
end;
$$;

-- Makes the invoice for a job (or returns the one that is already waiting). See the notes at the top for the return-visit
-- rules. p_auto is true when the job finishing made it (the office is then told it is ready).
create or replace function public.create_job_invoice(p_job uuid, p_actor uuid default null, p_auto boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  j public.jobs%rowtype;
  e public.estimates%rowtype;
  s public.settings%rowtype;
  live public.invoices%rowtype;
  v_credit bigint;
  v_new_total bigint;
  v_id uuid;
  v_kind text := 'standard';
  v_name text; v_email text; v_phone text;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  select * into s from public.settings where id = 1;

  -- the latest invoice that is still in play
  select * into live from public.invoices
    where job_id = p_job and voided_at is null and superseded_by is null order by created_at desc limit 1;

  if found and live.issued_at is null then
    return live.id; -- a draft is already waiting
  end if;

  select * into e from public.estimates where job_id = p_job;
  v_new_total := public.estimate_effective_total_cents(p_job);

  -- what was already paid on earlier invoices of this job (refunds already taken off)
  select coalesce(sum(p.amount_cents), 0)::bigint into v_credit
  from public.payments p join public.invoices i on i.id = p.invoice_id where i.job_id = p_job;

  if live.id is not null then
    if live.total_cents = v_new_total and live.credit_cents + live.paid_cents = v_credit then
      return live.id; -- nothing changed since it was sent
    end if;
    if v_credit > 0 then
      if v_new_total <= v_credit then
        raise exception 'NOTHING_TO_BILL: the job total is not more than what was already paid';
      end if;
      v_kind := 'difference';
    end if;
  elsif v_credit > 0 then
    -- earlier invoices all gone but money was paid on them
    if v_new_total <= v_credit then raise exception 'NOTHING_TO_BILL: the job total is not more than what was already paid'; end if;
    v_kind := 'difference';
  end if;

  select coalesce(nullif(btrim(c.name), ''), cu.display_name), coalesce(nullif(btrim(c.email), ''), cu.email), coalesce(nullif(btrim(c.phone), ''), cu.phone)
    into v_name, v_email, v_phone
  from public.customers cu left join public.contacts c on c.id = j.billing_contact_id
  where cu.id = j.customer_id;

  insert into public.invoices (job_id, kind, replaces_invoice_id, bill_to_name, bill_to_email, bill_to_phone, po_number,
                               scope_note, minimum_charge, terms_days, credit_cents, created_by)
  values (p_job, v_kind, live.id, coalesce(v_name, ''), coalesce(v_email, ''), coalesce(v_phone, ''), j.po_number,
          j.customer_notes, coalesce(e.minimum_charge, 0), s.invoice_terms_days, v_credit, p_actor)
  returning id into v_id;

  perform public.invoice_copy_lines(v_id, p_job);

  -- unpaid invoice that the new one replaces: void it. Anything with money on it is just marked as replaced.
  if live.id is not null then
    if live.paid_cents = 0 and not exists (select 1 from public.payments where invoice_id = live.id) then
      update public.invoices set voided_at = now(), void_reason = 'Replaced by invoice #' || (select invoice_number from public.invoices where id = v_id) || ' after a return visit',
        voided_by = p_actor, superseded_by = v_id where id = live.id;
      perform public.invoice_refresh(live.id);
    else
      update public.invoices set superseded_by = v_id where id = live.id;
    end if;
  end if;

  -- before and after pictures that were taken as a pair (up to 8 pairs)
  insert into public.invoice_photos (invoice_id, photo_id, sort_order)
  select v_id, x.pid, x.n * 2 + x.side
  from (
    select a.pair_of as pid, (row_number() over (order by a.taken_at) - 1)::int as n, 0 as side
    from public.job_photos a join public.job_photos b on b.id = a.pair_of
    where a.job_id = p_job and a.kind = 'after' and a.archived_at is null and b.archived_at is null
    union all
    select a.id, (row_number() over (order by a.taken_at) - 1)::int, 1
    from public.job_photos a join public.job_photos b on b.id = a.pair_of
    where a.job_id = p_job and a.kind = 'after' and a.archived_at is null and b.archived_at is null
  ) x
  where x.n < 8
  on conflict do nothing;

  perform public.invoice_refresh(v_id);

  if v_kind = 'difference' and (select balance_cents from public.invoices where id = v_id) <= 0 then
    raise exception 'NOTHING_TO_BILL: the job total is not more than what was already paid';
  end if;

  insert into public.job_events (job_id, actor_id, kind, details)
  values (p_job, p_actor, 'invoice_created', jsonb_build_object('invoice_id', v_id, 'invoice_number', (select invoice_number from public.invoices where id = v_id), 'kind', v_kind, 'auto', p_auto));

  if p_auto then
    perform public.notify_users(
      public.notif_office_owner(), 'invoice_ready', 'action',
      'Invoice ready to send: ' || public.notif_job_label(p_job),
      public.money_text((select balance_cents from public.invoices where id = v_id)) || ' · review and send it.',
      '/jobs/' || p_job || '#invoice', p_job, null, 'invoice:' || v_id || ':ready');
  end if;
  return v_id;
end;
$$;

-- Starts a draft over from the estimate (for when lines were changed after the draft was made).
create or replace function public.invoice_refresh_from_estimate(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype; e public.estimates%rowtype;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if i.issued_at is not null or i.voided_at is not null then raise exception 'INVOICE_LOCKED: a sent invoice cannot be edited'; end if;
  select * into e from public.estimates where job_id = i.job_id;
  delete from public.invoice_lines where invoice_id = p_invoice;
  perform public.invoice_copy_lines(p_invoice, i.job_id);
  update public.invoices set minimum_charge = coalesce(e.minimum_charge, 0) where id = p_invoice;
  perform public.invoice_refresh(p_invoice);
end;
$$;

-- ------------------------------------------------------------------- sending, voiding, interest
-- Marks a draft as sent. p_via: delivered (text or email went out), manual (the office handed it over), in_person (a tech
-- took payment on site). Sending again is harmless.
create or replace function public.invoice_issue(p_invoice uuid, p_via text, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype; v_tz text; v_today date;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if i.voided_at is not null then raise exception 'INVOICE_VOID: this invoice was voided'; end if;
  if i.issued_at is not null then return; end if;
  if i.balance_cents <= 0 then raise exception 'INVOICE_EMPTY: there is nothing to bill on this invoice'; end if;
  v_today := (now() at time zone public.notif_tz())::date;
  update public.invoices set issued_at = now(), due_date = v_today + i.terms_days, sent_via = p_via where id = p_invoice;
  perform public.invoice_refresh(p_invoice);
  insert into public.job_events (job_id, actor_id, kind, details)
  values (i.job_id, p_actor, 'invoice_sent', jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'via', p_via, 'total_cents', i.balance_cents));
end;
$$;

create or replace function public.invoice_void(p_invoice uuid, p_reason text, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if i.voided_at is not null then return; end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice) then
    raise exception 'HAS_PAYMENTS: an invoice with payments on it cannot be voided';
  end if;
  update public.invoices set voided_at = now(), void_reason = left(coalesce(p_reason, ''), 300), voided_by = p_actor where id = p_invoice;
  perform public.invoice_refresh(p_invoice);
  perform public.notif_resolve('invoice:' || p_invoice || ':ready');
  perform public.notif_resolve('invoice:' || p_invoice || ':pastdue');
  insert into public.job_events (job_id, actor_id, kind, details)
  values (i.job_id, p_actor, 'invoice_voided', jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'reason', left(coalesce(p_reason, ''), 300)));
end;
$$;

-- Late interest, applied by hand. Simple interest per month on what is still unpaid (earlier interest is not charged
-- interest on). Only once the invoice is past its due date.
create or replace function public.invoice_apply_interest(p_invoice uuid, p_rate numeric, p_months int, p_note text default '', p_actor uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype; v_base bigint; v_amt bigint; v_today date;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if i.status not in ('sent', 'partial') then raise exception 'NOT_OPEN: interest can only be added to an open invoice'; end if;
  v_today := (now() at time zone public.notif_tz())::date;
  if i.due_date is null or i.due_date >= v_today then raise exception 'NOT_PAST_DUE: interest can only be added once the invoice is past due'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 100 then raise exception 'BAD_RATE: enter a rate above 0'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'BAD_MONTHS: enter 1 to 36 months'; end if;
  v_base := i.total_cents - i.credit_cents - i.paid_cents;
  if v_base <= 0 then raise exception 'NOT_OPEN: nothing is owed on this invoice'; end if;
  v_amt := round(v_base * p_rate / 100 * p_months)::bigint;
  if v_amt < 1 then raise exception 'BAD_RATE: that rate comes to less than a cent'; end if;
  insert into public.invoice_interest (invoice_id, rate_percent, months, base_cents, amount_cents, note, applied_by)
  values (p_invoice, p_rate, p_months, v_base, v_amt, left(coalesce(p_note, ''), 300), p_actor);
  insert into public.job_events (job_id, actor_id, kind, details)
  values (i.job_id, p_actor, 'interest_applied', jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'rate', p_rate, 'months', p_months, 'amount_cents', v_amt));
  return v_amt;
end;
$$;

create or replace function public.invoice_waive_interest(p_interest uuid, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.invoice_interest%rowtype; i public.invoices%rowtype;
begin
  select * into r from public.invoice_interest where id = p_interest for update;
  if not found then raise exception 'INTEREST_NOT_FOUND'; end if;
  if r.waived_at is not null then return; end if;
  update public.invoice_interest set waived_at = now(), waived_by = p_actor where id = p_interest;
  select * into i from public.invoices where id = r.invoice_id;
  insert into public.job_events (job_id, actor_id, kind, details)
  values (i.job_id, p_actor, 'interest_waived', jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'amount_cents', r.amount_cents));
end;
$$;

-- ------------------------------------------------------------------- payments
-- One place every payment goes through (staff cash and check, and Stripe and Square reports). A payment the processor has
-- already told us about is ignored the second time (returns null).
create or replace function public.record_payment(
  p_invoice uuid, p_method text, p_amount bigint, p_tip bigint default 0,
  p_processor_ref text default null, p_reference text default '', p_note text default '',
  p_actor uuid default null, p_received timestamptz default null, p_refund_of uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype; v_id uuid; v_ref text := nullif(btrim(coalesce(p_processor_ref, '')), '');
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if i.issued_at is null and i.voided_at is null and p_refund_of is null and p_method in ('cash', 'check', 'other') and p_actor is not null then
    -- a payment taken before the invoice went out: the invoice goes out now, in person
    perform public.invoice_issue(p_invoice, 'in_person', p_actor);
  end if;
  if p_amount is null or p_amount = 0 then raise exception 'BAD_AMOUNT: enter an amount'; end if;
  if p_refund_of is null and p_amount < 0 then raise exception 'BAD_AMOUNT: a payment must be more than zero'; end if;
  if p_refund_of is not null and p_amount > 0 then raise exception 'BAD_AMOUNT: a refund must be a negative amount'; end if;
  if coalesce(p_tip, 0) < 0 then raise exception 'BAD_AMOUNT: a tip cannot be negative'; end if;

  insert into public.payments (invoice_id, method, amount_cents, tip_cents, processor_ref, reference, note, refund_of, received_at, recorded_by)
  values (p_invoice, p_method, p_amount, coalesce(p_tip, 0), v_ref, left(coalesce(p_reference, ''), 80), left(coalesce(p_note, ''), 500), p_refund_of, coalesce(p_received, now()), p_actor)
  on conflict (method, processor_ref) where processor_ref is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  insert into public.job_events (job_id, actor_id, kind, details)
  values (i.job_id, p_actor, case when p_amount < 0 then 'refund_recorded' else 'payment_recorded' end,
          jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'method', p_method, 'amount_cents', p_amount, 'tip_cents', coalesce(p_tip, 0)));

  perform public.invoice_refresh(p_invoice);
  if (select status from public.invoices where id = p_invoice) = 'paid' then
    perform public.notif_resolve('invoice:' || p_invoice || ':pastdue');
  end if;

  -- owner only; the person who took the payment is not told about their own action
  if p_amount < 0 then
    perform public.notify_users(array_remove(public.notif_owners(), p_actor), 'payment_problem', 'alert',
      'Refund: ' || public.invoice_label(p_invoice),
      public.money_text(-p_amount) || ' refunded on invoice #' || i.invoice_number || '.',
      '/jobs/' || i.job_id || '#invoice', i.job_id);
  elsif i.voided_at is not null then
    perform public.notify_users(array_remove(public.notif_owners(), p_actor), 'payment_problem', 'alert',
      'Payment on a voided invoice: ' || public.invoice_label(p_invoice),
      public.money_text(p_amount + coalesce(p_tip, 0)) || ' was paid on voided invoice #' || i.invoice_number || '. Check it.',
      '/jobs/' || i.job_id || '#invoice', i.job_id);
  else
    perform public.notify_users(array_remove(public.notif_owners(), p_actor), 'payment_received', 'info',
      'Payment received: ' || public.invoice_label(p_invoice),
      public.money_text(p_amount + coalesce(p_tip, 0)) || ' by ' || case p_method when 'stripe' then 'card' when 'square' then 'online (Square)' else p_method end
        || case when coalesce(p_tip, 0) > 0 then ' (includes ' || public.money_text(p_tip) || ' tip)' else '' end,
      '/jobs/' || i.job_id || '#invoice', i.job_id);
  end if;
  return v_id;
end;
$$;

-- A payment that failed, or a dispute: tell the owner. Called by the webhook handlers.
create or replace function public.invoice_money_alert(p_invoice uuid, p_title text, p_body text, p_dispute boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare i public.invoices%rowtype;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found then return; end if;
  if p_dispute then update public.invoices set disputed_at = coalesce(disputed_at, now()) where id = p_invoice; end if;
  perform public.notify_users(public.notif_owners(), 'payment_problem', 'alert', p_title || ': ' || public.invoice_label(p_invoice), p_body,
    '/jobs/' || i.job_id || '#invoice', i.job_id);
end;
$$;

-- ------------------------------------------------------------------- reopening a job for a return visit
create or replace function public.reopen_job(p_job uuid, p_reason text default '', p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.jobs%rowtype;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status not in ('completed', 'closed') then raise exception 'NOT_FINISHED: only a finished job can be reopened'; end if;
  update public.jobs set status = 'booked', completed_at = null where id = p_job;
  insert into public.job_events (job_id, actor_id, kind, details)
  values (p_job, p_actor, 'job_reopened', jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)));
end;
$$;

-- ------------------------------------------------------------------- triggers: notifications and auto-invoice
-- The invoice going out, being opened by the customer, and getting paid.
create or replace function public.trg_notify_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  v_label := public.notif_job_label(new.job_id);
  if old.issued_at is null and new.issued_at is not null then
    perform public.notif_resolve('invoice:' || new.id || ':ready');
    perform public.notif_resolve('job:' || new.job_id || ':completed'); -- the finished job was waiting on its invoice
    perform public.notify_users(array_remove(public.notif_owners(), auth.uid()), 'invoice_sent', 'info',
      'Invoice sent: ' || v_label, 'Invoice #' || new.invoice_number || ' · ' || public.money_text(new.balance_cents) || ' · due ' || to_char(new.due_date, 'Mon FMDD'),
      '/jobs/' || new.job_id || '#invoice', new.job_id, null, 'invoice:' || new.id || ':sent', 'skip');
  end if;
  if old.first_viewed_at is null and new.first_viewed_at is not null and new.voided_at is null then
    perform public.notify_users(public.notif_owners(), 'invoice_viewed', 'info',
      'Invoice viewed: ' || v_label, 'The customer opened invoice #' || new.invoice_number || '.',
      '/jobs/' || new.job_id || '#invoice', new.job_id, null, 'invoice:' || new.id || ':viewed', 'skip');
  end if;
  if new.status = 'paid' and old.status is distinct from 'paid' then
    perform public.notif_resolve('invoice:' || new.id || ':pastdue');
  end if;
  return new;
end;
$$;
create trigger invoices_notify after update on public.invoices
  for each row execute function public.trg_notify_invoice();

-- The job's last visit finished: make the invoice (a draft the office reviews, or per the setting). Never blocks the job.
create or replace function public.trg_invoice_on_job_complete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and coalesce((select auto_invoice from public.settings where id = 1), 'draft') <> 'off' then
    begin
      perform public.create_job_invoice(new.id, null, true);
    exception when others then
      raise warning 'invoice for job % was not made: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
create trigger jobs_invoice_on_complete after update of status on public.jobs
  for each row execute function public.trg_invoice_on_job_complete();

-- Past due, once a day.
create or replace function public.notify_past_due_invoices()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_today date := (now() at time zone public.notif_tz())::date;
begin
  for r in
    select id, invoice_number, job_id, balance_cents, due_date from public.invoices
    where status in ('sent', 'partial') and due_date < v_today and balance_cents > 0 and past_due_notified_at is null
  loop
    perform public.notify_users(public.notif_owners(), 'invoice_past_due', 'action',
      'Invoice past due: ' || public.notif_job_label(r.job_id),
      'Invoice #' || r.invoice_number || ' · ' || public.money_text(r.balance_cents) || ' · was due ' || to_char(r.due_date, 'Mon FMDD'),
      '/jobs/' || r.job_id || '#invoice', r.job_id, null, 'invoice:' || r.id || ':pastdue');
    update public.invoices set past_due_notified_at = now() where id = r.id;
  end loop;
end;
$$;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('daily-past-due-invoices', '0 14 * * *', 'select public.notify_past_due_invoices()');
exception when others then
  raise notice 'pg_cron could not be set up (%). Enable it in Database > Extensions and run this block again: past-due alerts will not run until then.', sqlerrm;
end $$;

-- ------------------------------------------------------------------- access
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_photos enable row level security;
alter table public.payments enable row level security;
alter table public.invoice_interest enable row level security;
alter table public.invoice_pay_links enable row level security;

-- Office and owner read everything; a tech reads the invoices and payments of jobs they are on (to take payment).
create policy invoices_select on public.invoices for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
create policy invoice_lines_select on public.invoice_lines for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(public.invoice_job(invoice_id)));
create policy invoice_photos_select on public.invoice_photos for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(public.invoice_job(invoice_id)));
create policy payments_select on public.payments for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(public.invoice_job(invoice_id)));
create policy invoice_interest_select on public.invoice_interest for select using (public.is_office_or_owner());

-- Only the lines and pictures of a draft can be changed from the browser, and only by office and owner (the guard
-- triggers above refuse anything else). The invoice itself is changed only by the website's server routes.
create policy invoice_lines_insert on public.invoice_lines for insert with check (public.is_office_or_owner());
create policy invoice_lines_update on public.invoice_lines for update using (public.is_office_or_owner()) with check (public.is_office_or_owner());
create policy invoice_lines_delete on public.invoice_lines for delete using (public.is_office_or_owner());
create policy invoice_photos_insert on public.invoice_photos for insert with check (public.is_office_or_owner());
create policy invoice_photos_delete on public.invoice_photos for delete using (public.is_office_or_owner());
-- invoice_pay_links: no policies, so the browser cannot read it. The website uses the service role.

-- The functions change money, so they are not callable from the browser.
do $$
declare f text;
begin
  foreach f in array array[
    'invoice_refresh(uuid)', 'create_job_invoice(uuid,uuid,boolean)', 'invoice_refresh_from_estimate(uuid)',
    'invoice_issue(uuid,text,uuid)', 'invoice_void(uuid,text,uuid)', 'invoice_apply_interest(uuid,numeric,integer,text,uuid)',
    'invoice_waive_interest(uuid,uuid)',
    'record_payment(uuid,text,bigint,bigint,text,text,text,uuid,timestamptz,uuid)', 'invoice_money_alert(uuid,text,text,boolean)',
    'reopen_job(uuid,text,uuid)', 'notify_past_due_invoices()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
