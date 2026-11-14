-- 016: job services (carpet / extraction / mitigation / remediation) and equipment condition notes.
-- Run once, after 001 to 015.
--
-- jobs.service says which kind of work a job is, so the app can show only the tools that belong to it. It is copied from the
-- lead when the work order is created. `job_type` (the older three-way field) is kept in step, because older code and the
-- reminder rules still read it. A job with no service (service is null, for example an "other" job) shows every tool.

alter table public.jobs add column if not exists service text
  check (service in ('carpet', 'extraction', 'mitigation', 'remediation'));

-- Existing jobs: floor cleaning is carpet; water jobs take the type their lead was booked as, and mitigation when there is
-- no lead or no type (mitigation shows every restoration tool, so nothing already on the job disappears).
update public.jobs j set service = case
  when j.job_type = 'floor_cleaning' then 'carpet'
  when j.job_type = 'water_restoration' then coalesce(
    (select l.restoration_type from public.leads l where l.id = j.lead_id and l.restoration_type is not null), 'mitigation')
  else null
end
where j.service is null;

-- New jobs: take the service from the lead the job is made from (create_work_order does not need to change).
-- Whenever a service is set, job_type follows it.
create or replace function public.jobs_sync_service()
returns trigger
language plpgsql
as $$
declare
  v_type text;
  v_kind text;
begin
  if new.service is null and new.lead_id is not null then
    select l.restoration_type, l.job_type into v_type, v_kind from public.leads l where l.id = new.lead_id;
    new.service := case
      when v_type is not null then v_type
      when v_kind = 'floor_cleaning' then 'carpet'
      when v_kind = 'water_restoration' then 'mitigation'
      else null
    end;
  end if;
  if new.service is not null then
    new.job_type := case when new.service = 'carpet' then 'floor_cleaning' else 'water_restoration' end;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_sync_service on public.jobs;
create trigger jobs_sync_service before insert or update of service on public.jobs
  for each row execute function public.jobs_sync_service();

-- ===================================================== equipment condition notes
-- A dated note on a machine: damaged, not working right, or just a note. Open until someone marks it fixed.
-- Carpet and extraction gear is not placed on a sketch or scanned out and back, so this is how it is tracked.
create table if not exists public.equipment_notes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.equipment_assets (id) on delete cascade,
  kind text not null default 'note' check (kind in ('damage', 'not_working', 'note')),
  note text not null default '' check (length(note) <= 500),
  job_id uuid references public.jobs (id) on delete set null,       -- the job it happened on, when known
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.staff_users (id) on delete set null
);
create index if not exists equipment_notes_asset_idx on public.equipment_notes (asset_id, created_at desc);
create index if not exists equipment_notes_open_idx on public.equipment_notes (asset_id) where resolved_at is null and kind <> 'note';

alter table public.equipment_notes enable row level security;
drop policy if exists equipment_notes_select on public.equipment_notes;
drop policy if exists equipment_notes_insert on public.equipment_notes;
drop policy if exists equipment_notes_update on public.equipment_notes;
create policy equipment_notes_select on public.equipment_notes for select using (public.is_staff());
create policy equipment_notes_insert on public.equipment_notes for insert
  with check (public.is_staff() and created_by = auth.uid());
-- any staff member can mark a problem fixed; nothing is deleted
create policy equipment_notes_update on public.equipment_notes for update
  using (public.is_staff()) with check (public.is_staff());
