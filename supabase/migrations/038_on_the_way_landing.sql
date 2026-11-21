-- "On the way" customer text and landing page (Priority 3). Run after 037. Safe to run twice.
-- Each visit gets a secret token for its customer status page (/v/<token>). The page shows no staff names.
alter table public.job_visits add column if not exists share_token uuid not null default gen_random_uuid();
create unique index if not exists job_visits_share_token_idx on public.job_visits (share_token);

-- Owner switch: text and email the customer when the team taps On the way (on by default).
alter table public.settings add column if not exists ontheway_auto boolean not null default true;

-- A signed-in browser must not change a visit's token.
create or replace function public.job_visits_token_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and new.share_token <> old.share_token then
    raise exception 'That field cannot be changed from here.';
  end if;
  return new;
end $$;
drop trigger if exists job_visits_token_guard on public.job_visits;
create trigger job_visits_token_guard before update on public.job_visits
  for each row execute function public.job_visits_token_guard();
