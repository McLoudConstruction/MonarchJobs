-- 027: more than one team member on a visit.
--
-- A crew is a set of job_visits rows with the same time, one per person, tied together by crew_id (the id of the lead's row).
-- Each person keeps their own row, so their own schedule, status buttons, job clock and double-booking check work as before.
-- A visit with nobody added has crew_id null and is unchanged.
--
--   * job_visits.crew_id: the lead's visit id, set on every row of a crew (including the lead's).
--   * add_job_visit(): now also takes the extra team members and adds all the rows in one step.
-- Safe to run more than once.

alter table public.job_visits add column if not exists crew_id uuid;
create index if not exists job_visits_crew_idx on public.job_visits (crew_id) where crew_id is not null;

drop function if exists public.add_job_visit(uuid, uuid, timestamptz, int, text, text, uuid);

create or replace function public.add_job_visit(
  p_job uuid,
  p_tech uuid,
  p_starts_at timestamptz,
  p_duration_minutes int,
  p_reason text default '',
  p_reason_note text default '',
  p_goback_tech uuid default null,
  p_extra_techs uuid[] default '{}'
)
returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_extra uuid;
begin
  if not public.is_office_or_owner() then
    raise exception 'NOT_ALLOWED: only the office and owner can add visits';
  end if;
  if p_goback_tech is not null and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'GOBACK_NEEDS_REASON: a go-back needs a reason';
  end if;
  v_id := gen_random_uuid();
  insert into public.job_visits (id, job_id, tech_id, starts_at, duration_minutes, created_by, reason, reason_note, crew_id)
  values (v_id, p_job, p_tech, p_starts_at, p_duration_minutes, auth.uid(), coalesce(p_reason, ''), coalesce(p_reason_note, ''),
          case when coalesce(array_length(p_extra_techs, 1), 0) > 0 then v_id end);
  for v_extra in select distinct x from unnest(coalesce(p_extra_techs, '{}')) as x where x is not null and x is distinct from p_tech loop
    insert into public.job_visits (job_id, tech_id, starts_at, duration_minutes, created_by, reason, reason_note, crew_id)
    values (p_job, v_extra, p_starts_at, p_duration_minutes, auth.uid(), coalesce(p_reason, ''), coalesce(p_reason_note, ''), v_id);
  end loop;
  if p_goback_tech is not null then
    insert into public.job_gobacks (job_id, visit_id, tech_id, reason, reason_note, logged_by)
    values (p_job, v_id, p_goback_tech, p_reason, coalesce(p_reason_note, ''), auth.uid());
  end if;
  return v_id;
end;
$$;
revoke all on function public.add_job_visit(uuid, uuid, timestamptz, int, text, text, uuid, uuid[]) from public;
grant execute on function public.add_job_visit(uuid, uuid, timestamptz, int, text, text, uuid, uuid[]) to authenticated;
