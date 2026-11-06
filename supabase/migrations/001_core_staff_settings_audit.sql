-- 001: staff users and roles, business settings, audit log.
-- Run in the Supabase SQL Editor (or `supabase db push`). Safe to run once.

create type public.staff_role as enum ('owner', 'office', 'tech');

create table public.staff_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.staff_role not null default 'tech',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One-row business settings (single tenant).
create table public.settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default '',
  phone text not null default '',
  email text not null default '',
  timezone text not null default 'America/Chicago',
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

-- Role helpers. SECURITY DEFINER so policies can read staff_users without recursion.
create or replace function public.current_staff_role()
returns public.staff_role
language sql stable security definer set search_path = public as $$
  select role from public.staff_users where id = auth.uid() and active
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_users where id = auth.uid() and active)
$$;

-- The first account created becomes the active owner. Later accounts are created
-- inactive as a "tech"; the owner activates them and sets their role in Settings > Users.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.staff_users) then
    insert into public.staff_users (id, email, full_name, role, active)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'owner', true);
  else
    insert into public.staff_users (id, email, full_name, role, active)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'tech', false);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger staff_users_touch before update on public.staff_users
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- Row level security
alter table public.staff_users enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

create policy staff_users_select on public.staff_users
  for select using (id = auth.uid() or public.is_staff());
create policy staff_users_owner_update on public.staff_users
  for update using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');
create policy staff_users_owner_delete on public.staff_users
  for delete using (public.current_staff_role() = 'owner' and id <> auth.uid());

create policy settings_select on public.settings
  for select using (public.is_staff());
create policy settings_owner_update on public.settings
  for update using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');

-- Audit log: owner can read. Writes happen only from server code (service role).
create policy audit_log_owner_select on public.audit_log
  for select using (public.current_staff_role() = 'owner');
