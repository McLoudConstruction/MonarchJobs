-- Photos: voice captions and customer share links (Priority 2). Run after 036. Safe to run twice.

-- ------------------------------------------------------------------ voice captions
-- A spoken note on a photo, for the team. It is never shown on a customer page.
alter table public.job_photos
  add column if not exists voice_path text,
  add column if not exists voice_secs int;
alter table public.job_photos drop constraint if exists job_photos_voice_ok;
alter table public.job_photos add constraint job_photos_voice_ok check (
  (voice_path is null and voice_secs is null)
  or (voice_path is not null and voice_secs is not null and voice_secs between 1 and 120 and voice_path like job_id::text || '/%')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-voice', 'photo-voice', false, 5242880, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists photo_voice_files_select on storage.objects;
drop policy if exists photo_voice_files_insert on storage.objects;
create policy photo_voice_files_select on storage.objects for select
  using (bucket_id = 'photo-voice' and public.job_file_access(name));
create policy photo_voice_files_insert on storage.objects for insert
  with check (bucket_id = 'photo-voice' and public.job_file_access(name));

-- ------------------------------------------------------------------ customer share links
-- A link to a hand-picked set of photos. The secret token is the access. It can expire and the office can switch it off.
-- The public page reads through the server (service role) and returns only the picture, its caption and its day.
create table if not exists public.photo_shares (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  title text not null default '' check (char_length(title) <= 120),
  photo_ids uuid[] not null check (cardinality(photo_ids) between 1 and 60),
  show_captions boolean not null default true,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz,
  created_by uuid default auth.uid() references public.staff_users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists photo_shares_job_idx on public.photo_shares (job_id, created_at desc);
alter table public.photo_shares enable row level security;

drop policy if exists photo_shares_select on public.photo_shares;
drop policy if exists photo_shares_insert on public.photo_shares;
drop policy if exists photo_shares_update on public.photo_shares;
create policy photo_shares_select on public.photo_shares for select using (public.is_office_or_owner());
create policy photo_shares_insert on public.photo_shares for insert
  with check (public.is_office_or_owner() and created_by = auth.uid()
              and not exists (select 1 from unnest(photo_ids) pid where not exists (select 1 from public.job_photos p where p.id = pid and p.job_id = photo_shares.job_id)));
-- the office may switch a link off, turn captions on or off, or change the expiry; nothing else
create policy photo_shares_update on public.photo_shares for update
  using (public.is_office_or_owner()) with check (public.is_office_or_owner());
-- no delete policy: a link is switched off, never removed

create or replace function public.photo_shares_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.job_id <> old.job_id or new.token <> old.token or new.photo_ids <> old.photo_ids
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at
       or new.view_count <> old.view_count or new.last_viewed_at is distinct from old.last_viewed_at then
      raise exception 'Those fields cannot be changed from here.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists photo_shares_guard on public.photo_shares;
create trigger photo_shares_guard before update on public.photo_shares
  for each row execute function public.photo_shares_guard();
