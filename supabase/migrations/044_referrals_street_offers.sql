-- 044: Push 1C (Nov 22).
--   #21 Referral program: each customer has a share code; a friend who uses the link becomes a lead tagged "referral";
--       the owner sees who referred whom and marks the reward paid. Off until the owner turns it on.
--   #35 "On your street" offers: after a finish, the owner previews past customers on the same street and approves one
--       batch. Nothing is sent without the owner tapping Send. Off until the owner turns it on.
-- Safe to run more than once. Run in the Supabase SQL Editor after 043, before deploying.

-- ============================================================ settings
alter table public.settings
  add column if not exists referral_enabled boolean not null default false,
  add column if not exists referral_reward_text text not null default '',
  add column if not exists street_offers_enabled boolean not null default false,
  add column if not exists street_offer_text text not null default '',
  add column if not exists street_offer_max int not null default 10,
  add column if not exists street_offer_quiet_days int not null default 60;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settings_referral_text_chk') then
    alter table public.settings add constraint settings_referral_text_chk check (char_length(referral_reward_text) <= 160);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_street_offer_chk') then
    alter table public.settings add constraint settings_street_offer_chk
      check (char_length(street_offer_text) <= 300 and street_offer_max between 1 and 50 and street_offer_quiet_days between 0 and 730);
  end if;
end $$;

-- ============================================================ referrals
alter table public.customers add column if not exists referral_code text;
create unique index if not exists customers_referral_code_uidx on public.customers (referral_code) where referral_code is not null;

alter table public.leads add column if not exists referred_by uuid references public.customers (id) on delete set null;
create index if not exists leads_referred_by_idx on public.leads (referred_by) where referred_by is not null;

-- One row per friend who used a link and counts toward a reward. Friends who are the referrer or already customers
-- get a lead tagged "referral" but no row here. Rows are written by the site (service role); the owner marks them paid.
create table if not exists public.referrals (
  id bigint generated always as identity primary key,
  lead_id uuid not null unique references public.leads (id) on delete cascade,
  referrer_id uuid not null references public.customers (id) on delete cascade,
  voided boolean not null default false,
  paid_at timestamptz,
  paid_note text not null default '',
  created_at timestamptz not null default now(),
  constraint referrals_note_chk check (char_length(paid_note) <= 300)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id, created_at desc);
alter table public.referrals enable row level security;
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals for select using (public.is_office_or_owner());
drop policy if exists referrals_update on public.referrals;
create policy referrals_update on public.referrals for update
  using (public.current_staff_role() = 'owner') with check (public.current_staff_role() = 'owner');

-- ============================================================ street offers are logged with the other reminders
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.outreach_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.outreach_log drop constraint %I', c.conname);
  end loop;
  alter table public.outreach_log add constraint outreach_log_kind_check
    check (kind in ('rebook', 'plan_offer', 'plan_reminder', 'street_offer'));
end $$;
