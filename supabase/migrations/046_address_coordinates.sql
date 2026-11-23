-- 046: Push 2A, map and route order (Nov 23).
-- Saved addresses get map coordinates the first time they are shown on the schedule map, looked up once by the site.
-- Changing the street, city, state or ZIP clears them so the address is looked up again. Safe to run more than once.
-- Run in the Supabase SQL Editor after 045, before deploying.

alter table public.addresses
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz,
  add column if not exists geocode_status text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'addresses_geocode_chk') then
    alter table public.addresses add constraint addresses_geocode_chk
      check (geocode_status is null or geocode_status in ('ok', 'failed'));
  end if;
end $$;

create or replace function public.addresses_reset_coords()
returns trigger language plpgsql as $$
begin
  if (new.street, new.unit, new.city, new.state, new.zip) is distinct from (old.street, old.unit, old.city, old.state, old.zip)
     and (new.lat, new.lng, new.geocode_status) is not distinct from (old.lat, old.lng, old.geocode_status) then
    new.lat := null; new.lng := null; new.geocoded_at := null; new.geocode_status := null;
  end if;
  return new;
end $$;
drop trigger if exists addresses_reset_coords on public.addresses;
create trigger addresses_reset_coords before update on public.addresses
  for each row execute function public.addresses_reset_coords();
