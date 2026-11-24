-- 052: e-sign links for the work authorization, and the certificate of completion. Run after 051.
-- The certificate is one more kind of Day 1 step row; it follows the same rule as the authorization (a name and signature,
-- or "customer not present"). A sign request is the secret link the customer opens to sign on their own phone.

alter table public.job_water_steps drop constraint if exists job_water_steps_kind_check;
alter table public.job_water_steps add constraint job_water_steps_kind_check
  check (kind in ('safety', 'authorization', 'walkthrough', 'certificate'));

create or replace function public.job_water_step_guard()
returns trigger language plpgsql as $$
begin
  new.done_at := now();
  if new.kind in ('authorization', 'certificate') then
    if new.customer_absent then
      new.signature_png := null;
      new.signer_name := null;
    elsif new.signature_png is null or btrim(coalesce(new.signer_name, '')) = '' then
      raise exception 'AUTHORIZATION_NEEDS_SIGNATURE';
    end if;
  else
    new.customer_absent := false;
    new.signature_png := null;
    new.signer_name := null;
  end if;
  return new;
end;
$$;

create table if not exists public.job_sign_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('authorization', 'certificate')),
  token uuid not null default gen_random_uuid(),
  sent_to text not null default '',                 -- who it was texted or emailed to, for the history
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  signed_at timestamptz,
  step_id uuid references public.job_water_steps (id) on delete set null
);
create unique index if not exists job_sign_requests_token_idx on public.job_sign_requests (token);
create index if not exists job_sign_requests_job_idx on public.job_sign_requests (job_id, kind, created_at desc);

alter table public.job_sign_requests enable row level security;
create policy job_sign_requests_select on public.job_sign_requests for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));
-- rows are made and closed by the server (service role); no insert or update policy for staff
