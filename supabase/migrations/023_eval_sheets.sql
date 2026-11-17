-- 023: Multi-family carpet evaluation sheets (the paper "Eval Sheet", one per unit).
-- Each sheet is one JSON document (see lib/evalSheet.js): complex, building, unit, bedroom size, additional rooms,
-- add-on services, notes, replacement flag, and the ids of photos of a paper copy. Carpet jobs only (the app hides the tab
-- for other services). Run once in the Supabase SQL Editor.

create table if not exists public.job_eval_sheets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_eval_sheets_job_idx on public.job_eval_sheets (job_id, created_at);
drop trigger if exists job_eval_sheets_touch on public.job_eval_sheets;
create trigger job_eval_sheets_touch before update on public.job_eval_sheets
  for each row execute function public.touch_updated_at();

alter table public.job_eval_sheets enable row level security;

drop policy if exists job_eval_sheets_select on public.job_eval_sheets;
create policy job_eval_sheets_select on public.job_eval_sheets for select
  using (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));

drop policy if exists job_eval_sheets_insert on public.job_eval_sheets;
create policy job_eval_sheets_insert on public.job_eval_sheets for insert
  with check ((public.is_office_or_owner() or public.tech_assigned_to_job(job_id)) and public.job_open(job_id));

drop policy if exists job_eval_sheets_update on public.job_eval_sheets;
create policy job_eval_sheets_update on public.job_eval_sheets for update
  using ((public.is_office_or_owner() or public.tech_assigned_to_job(job_id)) and public.job_open(job_id))
  with check (public.is_office_or_owner() or public.tech_assigned_to_job(job_id));

drop policy if exists job_eval_sheets_delete on public.job_eval_sheets;
create policy job_eval_sheets_delete on public.job_eval_sheets for delete
  using (public.current_staff_role() = 'owner');
