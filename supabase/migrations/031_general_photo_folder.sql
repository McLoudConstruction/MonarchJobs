-- 031: a "General" photo folder on every job (photos that belong to the job but not to Before, During, After or Damage).
-- Run after 030. Run it once, before deploying this push. Photos already on jobs are untouched.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.job_photos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%before%'
  loop
    execute format('alter table public.job_photos drop constraint %I', c);
  end loop;
  alter table public.job_photos add constraint job_photos_kind_check
    check (kind in ('before', 'during', 'after', 'damage', 'general', 'other'));
end $$;
