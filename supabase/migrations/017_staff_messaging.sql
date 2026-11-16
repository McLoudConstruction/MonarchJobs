-- 017: staff messaging. A chat thread on every job and lead, @mentions, photos, and "Got it" acknowledgments.
-- Run after 001 to 016. Safe to read top to bottom; run it once.
--
-- How it works
--   * One thread per job and one per lead (created the first time someone opens the Chat tab, or when a
--     visit/status event needs somewhere to land). A lead's thread moves onto the job when the lead is booked.
--   * Messages are text or photos written by staff. "System" lines (on the way, started, visit moved ...)
--     are written by the database from the same events that already drive notifications.
--   * A moved visit, a changed gate code and similar changes ask the tech to tap "Got it". The office sees who has.
--   * A message tells people through the existing notification pipeline (bell + Web Push). Nothing new to
--     set up: no cron, no new keys.
--   * Staff only. Customers and adjusters never see any of this.
--
-- Who can see a thread: office and owner see every job and lead thread; a tech sees the threads of jobs
-- they have a visit on. Leads are office and owner only (same as the leads table).

-- --------------------------------------------------------------------- tables
create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('job', 'lead')),  -- direct messages and channels come later
  job_id uuid references public.jobs (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint chat_threads_target check (
    (kind = 'job' and job_id is not null and lead_id is null)
    or (kind = 'lead' and lead_id is not null and job_id is null)
  )
);
create unique index chat_threads_job_idx on public.chat_threads (job_id) where job_id is not null;
create unique index chat_threads_lead_idx on public.chat_threads (lead_id) where lead_id is not null;
create index chat_threads_last_idx on public.chat_threads (last_message_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  author_id uuid references public.staff_users (id) on delete set null,
  kind text not null check (kind in ('text', 'photo', 'system')),
  body text not null default '' check (char_length(body) <= 2000),
  photo_path text,                                   -- in the chat-photos bucket: {thread_id}/{uuid}.jpg
  mentions uuid[] not null default '{}',             -- people tagged with @ (roles are expanded by the app)
  ack_user_ids uuid[] not null default '{}',         -- who has to tap "Got it" (system lines only)
  ack_notif_key text,                                -- the notification closed when they do
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint chat_messages_photo check (kind <> 'photo' or photo_path is not null or deleted_at is not null)
);
create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at);
create index chat_messages_photo_idx on public.chat_messages (photo_path) where photo_path is not null;
create index chat_messages_ack_key_idx on public.chat_messages (thread_id, ack_notif_key) where ack_notif_key is not null;

-- One row per person per thread they follow: how far they have read, and whether it is muted.
-- A row appears when someone writes in a thread, is tagged in it, is asked to acknowledge, or is
-- notified about it. The Inbox lists the threads you follow.
create table public.chat_reads (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references public.staff_users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (thread_id, user_id)
);
create index chat_reads_user_idx on public.chat_reads (user_id);

create table public.chat_acks (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.staff_users (id) on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ------------------------------------------------------------------- access
-- True when the signed-in person may see this thread.
create or replace function public.can_access_thread(t uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_threads th
    where th.id = t and (
      (th.job_id is not null and public.can_access_job(th.job_id))
      or (th.lead_id is not null and public.is_office_or_owner())
    )
  )
$$;

-- Same question for any person (used to decide who may be tagged or notified).
create or replace function public.staff_in_thread(p_user uuid, p_thread uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.chat_threads th
    join public.staff_users s on s.id = p_user and s.active
    where th.id = p_thread and (
      (th.job_id is not null and (
        s.role in ('owner', 'office')
        or exists (select 1 from public.job_visits v where v.job_id = th.job_id and v.tech_id = p_user)
      ))
      or (th.lead_id is not null and s.role in ('owner', 'office'))
    )
  )
$$;

-- ------------------------------------------------------------------------ RLS
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;
alter table public.chat_acks enable row level security;

create policy chat_threads_select on public.chat_threads for select using (public.can_access_thread(id));

create policy chat_messages_select on public.chat_messages for select using (public.can_access_thread(thread_id));
-- Staff write their own text and photo messages. System lines come only from the functions below.
create policy chat_messages_insert on public.chat_messages for insert
  with check (
    author_id = auth.uid()
    and kind in ('text', 'photo')
    and (kind <> 'text' or btrim(body) <> '')
    and public.can_access_thread(thread_id)
    and (photo_path is null or photo_path like thread_id::text || '/%')
  );
-- Edit or delete your own; the owner may delete anyone's. System lines cannot be changed.
create policy chat_messages_update on public.chat_messages for update
  using (kind <> 'system' and public.can_access_thread(thread_id)
         and (author_id = auth.uid() or public.current_staff_role() = 'owner'))
  with check (kind <> 'system' and public.can_access_thread(thread_id));

create policy chat_reads_select on public.chat_reads for select using (user_id = auth.uid());

create policy chat_acks_select on public.chat_acks for select
  using (exists (select 1 from public.chat_messages m where m.id = message_id and public.can_access_thread(m.thread_id)));

revoke all on public.chat_threads, public.chat_messages, public.chat_reads, public.chat_acks from anon, authenticated;
grant select on public.chat_threads, public.chat_reads, public.chat_acks to authenticated;
grant select on public.chat_messages to authenticated;
grant insert (thread_id, author_id, kind, body, photo_path, mentions) on public.chat_messages to authenticated;
grant update (body, mentions, deleted_at) on public.chat_messages to authenticated;

-- Live updates: the browser listens for new messages and acknowledgments (RLS applies).
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
  alter publication supabase_realtime add table public.chat_acks;
exception when others then
  raise notice 'Could not add chat tables to the realtime publication (%). Chat still refreshes every minute and when the app is opened.', sqlerrm;
end $$;

-- ------------------------------------------------------------------- storage
-- Private bucket for chat pictures: {thread_id}/{uuid}.jpg. A person may add a file to a thread they
-- can see, and read a file whose message they can see. No overwrite, no delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-photos', 'chat-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.chat_file_can_add(object_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  folder text := split_part(object_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.can_access_thread(folder::uuid);
end $$;

-- Reading goes by the message, so a picture stays readable after a lead's thread moves onto its job.
create or replace function public.chat_file_can_read(object_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_messages m
    where m.photo_path = object_name and m.deleted_at is null and public.can_access_thread(m.thread_id)
  )
$$;

drop policy if exists chat_photo_files_select on storage.objects;
drop policy if exists chat_photo_files_insert on storage.objects;
create policy chat_photo_files_select on storage.objects for select
  using (bucket_id = 'chat-photos' and public.chat_file_can_read(name));
create policy chat_photo_files_insert on storage.objects for insert
  with check (bucket_id = 'chat-photos' and public.chat_file_can_add(name));

-- ------------------------------------------------------------------- helpers
-- Makes people follow a thread (so it shows in their Inbox). Existing followers are left alone.
create or replace function public.chat_follow(p_thread uuid, p_users uuid[], p_seen_before timestamptz)
returns void
language sql security definer set search_path = public as $$
  insert into public.chat_reads (thread_id, user_id, last_read_at)
  select p_thread, u, p_seen_before
  from unnest(coalesce(p_users, '{}'::uuid[])) as u
  where u is not null and exists (select 1 from public.staff_users s where s.id = u and s.active)
  on conflict (thread_id, user_id) do nothing
$$;

-- Where a thread lives in the app, and what to call it.
create or replace function public.chat_thread_label(p_thread uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when th.job_id is not null then coalesce(public.notif_job_label(th.job_id), 'a job')
    else coalesce((select nullif(btrim(l.name), '') from public.leads l where l.id = th.lead_id), 'a lead')
  end
  from public.chat_threads th where th.id = p_thread
$$;

create or replace function public.chat_thread_url(p_thread uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case when th.job_id is not null then '/jobs/' || th.job_id || '#thread' else '/leads/' || th.lead_id || '#thread' end
  from public.chat_threads th where th.id = p_thread
$$;

-- The thread for a job, created if there is none yet.
create or replace function public.chat_thread_for_job(p_job uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
begin
  if not public.can_access_job(p_job) then raise exception 'NOT_ALLOWED'; end if;
  select id into v from public.chat_threads where job_id = p_job;
  if v is null then
    insert into public.chat_threads (kind, job_id) values ('job', p_job)
    on conflict (job_id) where job_id is not null do nothing
    returning id into v;
    if v is null then select id into v from public.chat_threads where job_id = p_job; end if;
  end if;
  return v;
end $$;

-- The thread for a lead. A lead that has become a job uses the job's thread.
create or replace function public.chat_thread_for_lead(p_lead uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  v_job uuid;
begin
  if not public.is_office_or_owner() then raise exception 'NOT_ALLOWED'; end if;
  select job_id into v_job from public.leads where id = p_lead;
  if v_job is not null then return public.chat_thread_for_job(v_job); end if;
  select id into v from public.chat_threads where lead_id = p_lead;
  if v is null then
    insert into public.chat_threads (kind, lead_id) values ('lead', p_lead)
    on conflict (lead_id) where lead_id is not null do nothing
    returning id into v;
    if v is null then select id into v from public.chat_threads where lead_id = p_lead; end if;
  end if;
  return v;
end $$;

-- A line written by the system into a job's thread. Used by the triggers below.
--   p_ack      people who must tap "Got it"
--   p_key      the notification those people already have for this change (closed when they tap)
--   p_dedupe   skip when the same key was already logged this many minutes ago
create or replace function public.chat_job_system_message(
  p_job uuid, p_actor uuid, p_body text,
  p_ack uuid[] default '{}', p_key text default null, p_dedupe int default 0
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
begin
  select id into v from public.chat_threads where job_id = p_job;
  if v is null then
    insert into public.chat_threads (kind, job_id) values ('job', p_job)
    on conflict (job_id) where job_id is not null do nothing
    returning id into v;
    if v is null then select id into v from public.chat_threads where job_id = p_job; end if;
  end if;
  if p_dedupe > 0 and p_key is not null and exists (
    select 1 from public.chat_messages
    where thread_id = v and ack_notif_key = p_key and created_at > now() - make_interval(mins => p_dedupe)
  ) then
    return;
  end if;
  insert into public.chat_messages (thread_id, author_id, kind, body, ack_user_ids, ack_notif_key)
  values (v, p_actor, 'system', left(p_body, 400), coalesce(p_ack, '{}'), p_key);
end $$;

-- --------------------------------------------------------- the person's own actions
-- Marks a thread read, and closes the bell items it produced.
create or replace function public.chat_mark_read(p_thread uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access_thread(p_thread) then return; end if;
  insert into public.chat_reads (thread_id, user_id, last_read_at) values (p_thread, auth.uid(), now())
  on conflict (thread_id, user_id) do update set last_read_at = now();
  update public.notifications set
    read_at = coalesce(read_at, now()),
    resolved_at = case when type = 'chat_mention' then coalesce(resolved_at, now()) else resolved_at end
  where user_id = auth.uid()
    and dedupe_key in ('chat:' || p_thread || ':msg', 'chat:' || p_thread || ':mention')
    and (read_at is null or (type = 'chat_mention' and resolved_at is null));
end $$;

create or replace function public.chat_set_muted(p_thread uuid, p_muted boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_access_thread(p_thread) then return; end if;
  insert into public.chat_reads (thread_id, user_id, last_read_at, muted) values (p_thread, auth.uid(), now(), p_muted)
  on conflict (thread_id, user_id) do update set muted = p_muted;
end $$;

-- "Got it". Only someone who was asked can tap it. It also covers every earlier change in the same
-- thread that was waiting on them, so a visit moved twice needs one tap, not two.
create or replace function public.chat_ack(p_message uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.chat_messages%rowtype;
begin
  select * into m from public.chat_messages where id = p_message;
  if m.id is null or auth.uid() is null or not public.can_access_thread(m.thread_id)
     or not (auth.uid() = any (m.ack_user_ids)) then
    raise exception 'NOT_ALLOWED';
  end if;
  insert into public.chat_acks (message_id, user_id)
  select s.id, auth.uid() from public.chat_messages s
  where s.thread_id = m.thread_id and s.kind = 'system' and s.created_at <= m.created_at
    and auth.uid() = any (s.ack_user_ids)
  on conflict do nothing;
  update public.notifications set read_at = coalesce(read_at, now()), resolved_at = coalesce(resolved_at, now())
  where user_id = auth.uid()
    and dedupe_key in (
      select s.ack_notif_key from public.chat_messages s
      where s.thread_id = m.thread_id and s.kind = 'system' and s.created_at <= m.created_at
        and auth.uid() = any (s.ack_user_ids) and s.ack_notif_key is not null
    );
end $$;

-- The Inbox: every thread you follow, newest first, with what is waiting on you.
create or replace function public.chat_inbox()
returns table (
  thread_id uuid, kind text, job_id uuid, lead_id uuid, label text, last_message_at timestamptz,
  last_preview text, last_author text, unread int, pending_acks int, muted boolean
)
language sql stable security definer set search_path = public as $$
  select
    th.id, th.kind, th.job_id, th.lead_id,
    public.chat_thread_label(th.id),
    th.last_message_at,
    lm.preview, lm.author,
    (select count(*) from public.chat_messages m
      where m.thread_id = th.id and m.kind in ('text', 'photo') and m.deleted_at is null
        and m.author_id is distinct from auth.uid() and m.created_at > r.last_read_at)::int,
    (select count(*) from public.chat_messages m
      where m.thread_id = th.id and m.kind = 'system' and auth.uid() = any (m.ack_user_ids)
        and m.created_at > now() - interval '14 days'
        and not exists (select 1 from public.chat_acks a where a.message_id = m.id and a.user_id = auth.uid()))::int,
    r.muted
  from public.chat_reads r
  join public.chat_threads th on th.id = r.thread_id
  left join lateral (
    select
      case when m.deleted_at is not null then 'Message deleted'
           when m.kind = 'photo' then coalesce(nullif(btrim(m.body), ''), 'Sent a photo')
           else left(m.body, 120) end as preview,
      coalesce(nullif(btrim(s.full_name), ''), s.email, 'Someone') as author
    from public.chat_messages m
    left join public.staff_users s on s.id = m.author_id
    where m.thread_id = th.id
    order by m.created_at desc limit 1
  ) lm on true
  where r.user_id = auth.uid() and public.can_access_thread(th.id)
  order by th.last_message_at desc
$$;
revoke all on function public.chat_inbox() from public, anon;
grant execute on function public.chat_inbox() to authenticated;
revoke all on function public.chat_thread_for_job(uuid), public.chat_thread_for_lead(uuid), public.chat_mark_read(uuid),
  public.chat_set_muted(uuid, boolean), public.chat_ack(uuid) from public, anon;
grant execute on function public.chat_thread_for_job(uuid), public.chat_thread_for_lead(uuid), public.chat_mark_read(uuid),
  public.chat_set_muted(uuid, boolean), public.chat_ack(uuid) to authenticated;
-- Internal helpers are for the database only.
revoke all on function public.chat_follow(uuid, uuid[], timestamptz), public.chat_job_system_message(uuid, uuid, text, uuid[], text, int),
  public.chat_thread_label(uuid), public.chat_thread_url(uuid), public.staff_in_thread(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------- triggers: messages
create or replace function public.trg_chat_message_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- only people who are in the thread can be tagged, and nobody tags themselves
    new.mentions := coalesce((
      select array_agg(distinct u) from unnest(new.mentions) as u
      where u is distinct from new.author_id and public.staff_in_thread(u, new.thread_id)
    ), '{}');
    return new;
  end if;

  -- update: a deleted message stays deleted and loses its content
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at; new.body := old.body; new.mentions := old.mentions;
    return new;
  end if;
  if new.deleted_at is not null then
    new.body := ''; new.mentions := '{}'; new.photo_path := null;
    return new;
  end if;
  if new.body is distinct from old.body then
    if old.kind = 'text' and btrim(new.body) = '' then raise exception 'EMPTY_MESSAGE'; end if;
    new.edited_at := now();
    new.mentions := coalesce((
      select array_agg(distinct u) from unnest(new.mentions) as u
      where u is distinct from old.author_id and public.staff_in_thread(u, old.thread_id)
    ), '{}');
  else
    new.mentions := old.mentions;
  end if;
  return new;
end $$;
create trigger chat_messages_before before insert or update on public.chat_messages
  for each row execute function public.trg_chat_message_before();

create or replace function public.trg_chat_message_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_url text;
  v_name text;
  v_role public.staff_role;
  v_job uuid;
  v_lead uuid;
  v_preview text;
  v_recipients uuid[];
begin
  select job_id, lead_id into v_job, v_lead from public.chat_threads where id = new.thread_id;
  update public.chat_threads set last_message_at = new.created_at where id = new.thread_id;

  -- the writer follows their own thread
  if new.author_id is not null and new.kind <> 'system' then
    insert into public.chat_reads (thread_id, user_id, last_read_at) values (new.thread_id, new.author_id, new.created_at)
    on conflict (thread_id, user_id) do update set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at);
  end if;

  -- a system line only puts the people it asks to acknowledge into the Inbox; the bell already told them
  if new.kind = 'system' then
    perform public.chat_follow(new.thread_id, new.ack_user_ids, new.created_at - interval '1 millisecond');
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email), role into v_name, v_role
  from public.staff_users where id = new.author_id;
  v_name := coalesce(v_name, 'Someone');
  v_label := public.chat_thread_label(new.thread_id);
  v_url := public.chat_thread_url(new.thread_id);
  v_preview := case when new.kind = 'photo' then coalesce(nullif(btrim(left(new.body, 140)), ''), 'Sent a photo') else left(new.body, 140) end;

  -- who hears about a plain message: everyone following the thread (unless muted); a tech's message also
  -- reaches the office and owner, an office message also reaches the techs on the job
  v_recipients := coalesce((select array_agg(r.user_id) from public.chat_reads r
                            where r.thread_id = new.thread_id and not r.muted), '{}');
  if v_role = 'tech' then
    v_recipients := v_recipients || public.notif_office_owner();
  elsif v_job is not null then
    v_recipients := v_recipients || public.notif_job_techs(v_job);
  end if;
  v_recipients := coalesce((
    select array_agg(distinct u) from unnest(v_recipients) as u
    where u is distinct from new.author_id
      and u <> all (new.mentions)
      and public.staff_in_thread(u, new.thread_id)
      and not exists (select 1 from public.chat_reads r where r.thread_id = new.thread_id and r.user_id = u and r.muted)
  ), '{}');

  perform public.chat_follow(new.thread_id, new.mentions || v_recipients, new.created_at - interval '1 millisecond');

  if cardinality(new.mentions) > 0 then
    perform public.notify_users(
      new.mentions, 'chat_mention', 'action', v_name || ' mentioned you',
      v_label || E'\n' || v_preview, v_url, v_job, v_lead,
      'chat:' || new.thread_id || ':mention', 'update', interval '0');
  end if;
  if cardinality(v_recipients) > 0 then
    perform public.notify_users(
      v_recipients, 'chat_message', 'info', v_name || ' · ' || v_label,
      v_preview, v_url, v_job, v_lead,
      'chat:' || new.thread_id || ':msg', 'update', interval '1 minute');
  end if;
  return new;
end $$;
create trigger chat_messages_after after insert on public.chat_messages
  for each row execute function public.trg_chat_message_after();

-- ---------------------------------------------- triggers: the job's own events
-- Status buttons and scope changes show up in the thread as plain lines.
create or replace function public.trg_chat_job_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.job_id is null then return new; end if;

  if new.kind = 'visit_on_the_way' then
    perform public.chat_job_system_message(new.job_id, new.actor_id,
      'is on the way' || coalesce(' (about ' || nullif(new.details ->> 'minutes', '') || ' min out)', ''));
  elsif new.kind = 'visit_started' then
    perform public.chat_job_system_message(new.job_id, new.actor_id, 'started the job');
  elsif new.kind = 'visit_finished' then
    perform public.chat_job_system_message(new.job_id, new.actor_id,
      case when (new.details -> 'job_completed') = 'true'::jsonb then 'finished the last visit: job completed' else 'finished the visit' end);
  elsif new.kind in ('estimate_line_added', 'estimate_line_changed', 'estimate_line_removed') then
    perform public.chat_job_system_message(new.job_id, new.actor_id, 'changed the estimate', '{}', 'job:' || new.job_id || ':scope', 10);
  end if;
  return new;
end $$;
create trigger job_events_chat after insert on public.job_events
  for each row execute function public.trg_chat_job_event();

-- ------------------------------------------------ triggers: changes a tech must see
-- Visit assigned, moved, taken away or cancelled. The tech is asked to tap "Got it".
create or replace function public.trg_chat_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new_name text;
  v_old_name text;
begin
  select coalesce(nullif(btrim(full_name), ''), email) into v_new_name from public.staff_users where id = new.tech_id;

  if tg_op = 'INSERT' then
    if new.tech_id is not null and new.status = 'scheduled' then
      perform public.chat_job_system_message(new.job_id, auth.uid(),
        'scheduled a visit for ' || coalesce(v_new_name, 'a tech') || ': ' || public.notif_fmt_time(new.starts_at),
        array_remove(array[new.tech_id], auth.uid()), 'visit:' || new.id || ':assigned');
    end if;
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into v_old_name from public.staff_users where id = old.tech_id;

  if new.tech_id is distinct from old.tech_id then
    if new.tech_id is not null and new.status = 'scheduled' then
      perform public.chat_job_system_message(new.job_id, auth.uid(),
        'gave the visit to ' || coalesce(v_new_name, 'a tech') || ': ' || public.notif_fmt_time(new.starts_at),
        array_remove(array[new.tech_id], auth.uid()), 'visit:' || new.id || ':assigned');
    end if;
    if old.tech_id is not null and old.status in ('scheduled', 'on_the_way') then
      perform public.chat_job_system_message(new.job_id, auth.uid(),
        'took ' || coalesce(v_old_name, 'a tech') || ' off the visit on ' || public.notif_fmt_time(old.starts_at),
        array_remove(array[old.tech_id], auth.uid()), 'visit:' || new.id || ':changed:' || old.tech_id);
    end if;
  elsif new.tech_id is not null and new.status = 'scheduled'
        and (new.starts_at, new.duration_minutes) is distinct from (old.starts_at, old.duration_minutes) then
    perform public.chat_job_system_message(new.job_id, auth.uid(),
      'moved ' || coalesce(v_new_name, 'the') || '''s visit to ' || public.notif_fmt_time(new.starts_at)
        || ' (was ' || public.notif_fmt_time(old.starts_at) || ')',
      array_remove(array[new.tech_id], auth.uid()), 'visit:' || new.id || ':changed:' || new.tech_id);
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' and new.tech_id is not null then
    perform public.chat_job_system_message(new.job_id, auth.uid(),
      'cancelled the visit on ' || public.notif_fmt_time(new.starts_at),
      array_remove(array[new.tech_id], auth.uid()), 'visit:' || new.id || ':changed:' || new.tech_id);
  end if;
  return new;
end $$;
create trigger job_visits_chat after insert or update on public.job_visits
  for each row execute function public.trg_chat_visit();

-- Job warning or address changed, and the address's gate code, warnings, access notes or street.
-- The new values are never written into the thread (gate codes stay in the app); the line only says what changed.
create or replace function public.trg_chat_job_info()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_changed text[] := '{}';
begin
  if new.warning is distinct from old.warning then v_changed := array_append(v_changed, 'warning'); end if;
  if new.address_id is distinct from old.address_id then v_changed := array_append(v_changed, 'address'); end if;
  if cardinality(v_changed) > 0 then
    perform public.chat_job_system_message(new.id, auth.uid(),
      'changed the ' || array_to_string(v_changed, ' and '),
      array_remove(public.notif_job_techs(new.id), auth.uid()), 'job:' || new.id || ':info', 10);
  end if;
  return new;
end $$;
create trigger jobs_chat after update of warning, address_id on public.jobs
  for each row execute function public.trg_chat_job_info();

create or replace function public.trg_chat_address_info()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_changed text[] := '{}';
  r record;
begin
  if new.gate_code is distinct from old.gate_code then v_changed := array_append(v_changed, 'gate code'); end if;
  if new.warnings is distinct from old.warnings then v_changed := array_append(v_changed, 'warnings'); end if;
  if new.access_notes is distinct from old.access_notes then v_changed := array_append(v_changed, 'access notes'); end if;
  if (new.street, new.unit, new.city, new.zip) is distinct from (old.street, old.unit, old.city, old.zip) then
    v_changed := array_append(v_changed, 'address');
  end if;
  if cardinality(v_changed) = 0 then return new; end if;
  for r in select id from public.jobs where address_id = new.id and status not in ('closed', 'cancelled') loop
    perform public.chat_job_system_message(r.id, auth.uid(),
      'changed the ' || array_to_string(v_changed, ', '),
      array_remove(public.notif_job_techs(r.id), auth.uid()), 'job:' || r.id || ':info', 10);
  end loop;
  return new;
end $$;
create trigger addresses_chat after update on public.addresses
  for each row execute function public.trg_chat_address_info();

-- ------------------------------------------------------ lead becomes a job
-- The lead's conversation carries over onto the job.
create or replace function public.trg_chat_lead_booked()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lead_thread uuid;
  v_job_thread uuid;
begin
  if new.job_id is null or new.job_id is not distinct from old.job_id then return new; end if;
  select id into v_lead_thread from public.chat_threads where lead_id = new.id;
  if v_lead_thread is null then return new; end if;
  select id into v_job_thread from public.chat_threads where job_id = new.job_id;

  if v_job_thread is null then
    update public.chat_threads set kind = 'job', job_id = new.job_id, lead_id = null where id = v_lead_thread;
  else
    update public.chat_messages set thread_id = v_job_thread where thread_id = v_lead_thread;
    insert into public.chat_reads (thread_id, user_id, last_read_at, muted)
    select v_job_thread, user_id, last_read_at, muted from public.chat_reads where thread_id = v_lead_thread
    on conflict (thread_id, user_id) do update set last_read_at = least(public.chat_reads.last_read_at, excluded.last_read_at);
    update public.chat_threads t set last_message_at = greatest(t.last_message_at, (select last_message_at from public.chat_threads where id = v_lead_thread))
      where t.id = v_job_thread;
    delete from public.chat_threads where id = v_lead_thread;
  end if;
  return new;
end $$;
create trigger leads_chat_booked after update of job_id on public.leads
  for each row execute function public.trg_chat_lead_booked();
