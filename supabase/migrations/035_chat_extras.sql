-- Chat extras (Priority 1): pinned messages, reactions, voice notes. Search inside a chat needs no database change.
-- Run after 034. Safe to run twice.
--
--   Pins        a pinned message shows at the top of its conversation for everyone in it (at most 10 per conversation).
--   Reactions   one small tap on a message from a short, fixed set. No notification: reactions are quiet by design.
--   Voice notes a recording up to 2 minutes, kept in its own private bucket, played back inside the chat.

-- ------------------------------------------------------------------- messages: voice and pins
alter table public.chat_messages add column if not exists voice_path text;      -- in the chat-voice bucket: {thread_id}/{uuid}.{ext}
alter table public.chat_messages add column if not exists voice_secs int;
alter table public.chat_messages add column if not exists pinned_at timestamptz;
alter table public.chat_messages add column if not exists pinned_by uuid references public.staff_users (id) on delete set null;

-- the kind list gains 'voice' (find the old check by what it lists, whatever it was named)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.chat_messages'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%system%' and pg_get_constraintdef(oid) like '%photo%' and pg_get_constraintdef(oid) not like '%photo_path%'
  loop
    execute format('alter table public.chat_messages drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'photo', 'voice', 'system'));

alter table public.chat_messages drop constraint if exists chat_messages_voice;
alter table public.chat_messages add constraint chat_messages_voice
  check (kind <> 'voice' or (voice_path is not null and voice_secs between 1 and 120) or deleted_at is not null);

create index if not exists chat_messages_pinned_idx on public.chat_messages (thread_id, pinned_at desc) where pinned_at is not null;

-- people write their own text, photo and voice messages
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages for insert
  with check (
    author_id = auth.uid()
    and kind in ('text', 'photo', 'voice')
    and (kind <> 'text' or btrim(body) <> '')
    and public.can_access_thread(thread_id)
    and (photo_path is null or photo_path like thread_id::text || '/%')
    and (voice_path is null or voice_path like thread_id::text || '/%')
  );
grant insert (voice_path, voice_secs) on public.chat_messages to authenticated;
-- pinning goes through chat_set_pinned below, so pinned_at / pinned_by are not granted to the table

-- ------------------------------------------------------------------- storage: voice notes
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-voice', 'chat-voice', false, 5242880,
        array['audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/mpeg', 'audio/wav'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.chat_voice_can_read(object_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_messages m
    where m.voice_path = object_name and m.deleted_at is null and public.can_access_thread(m.thread_id)
  )
$$;

drop policy if exists chat_voice_files_select on storage.objects;
drop policy if exists chat_voice_files_insert on storage.objects;
create policy chat_voice_files_select on storage.objects for select
  using (bucket_id = 'chat-voice' and public.chat_voice_can_read(name));
create policy chat_voice_files_insert on storage.objects for insert
  with check (bucket_id = 'chat-voice' and public.chat_file_can_add(name));

-- ------------------------------------------------------------------- pins
-- Anyone in the conversation may pin or unpin. At most 10 pinned at a time; system lines and deleted messages cannot be pinned.
create or replace function public.chat_set_pinned(p_message uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.chat_messages%rowtype;
begin
  select * into m from public.chat_messages where id = p_message;
  if m.id is null or auth.uid() is null or not public.can_access_thread(m.thread_id) then raise exception 'NOT_ALLOWED'; end if;
  if p_pinned then
    if m.kind = 'system' or m.deleted_at is not null then raise exception 'NOT_ALLOWED'; end if;
    if m.pinned_at is not null then return; end if;
    if (select count(*) from public.chat_messages x where x.thread_id = m.thread_id and x.pinned_at is not null and x.deleted_at is null) >= 10 then
      raise exception 'TOO_MANY_PINS';
    end if;
    update public.chat_messages set pinned_at = now(), pinned_by = auth.uid() where id = p_message;
  else
    update public.chat_messages set pinned_at = null, pinned_by = null where id = p_message;
  end if;
end $$;

-- A deleted message is no longer pinned, and a deleted voice note loses its link to the recording (as a photo does).
create or replace function public.trg_chat_message_unpin_deleted()
returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null then
    new.pinned_at := null;
    new.pinned_by := null;
    new.voice_path := null;
  end if;
  return new;
end $$;
drop trigger if exists chat_messages_unpin_deleted on public.chat_messages;
create trigger chat_messages_unpin_deleted before update on public.chat_messages
  for each row execute function public.trg_chat_message_unpin_deleted();

-- ------------------------------------------------------------------- reactions
create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references public.staff_users (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '✅', '👀', '🙏', '😊')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists chat_reactions_thread_idx on public.chat_reactions (thread_id);
alter table public.chat_reactions replica identity full; -- so a removed reaction can still be matched to its conversation live

alter table public.chat_reactions enable row level security;
drop policy if exists chat_reactions_select on public.chat_reactions;
create policy chat_reactions_select on public.chat_reactions for select using (public.can_access_thread(thread_id));
revoke all on public.chat_reactions from anon, authenticated;
grant select on public.chat_reactions to authenticated;

-- Tap a reaction to add it, tap again to take it back. Returns true when it is now on.
create or replace function public.chat_react(p_message uuid, p_emoji text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  m public.chat_messages%rowtype;
begin
  select * into m from public.chat_messages where id = p_message;
  if m.id is null or auth.uid() is null or not public.can_access_thread(m.thread_id) or m.kind = 'system' or m.deleted_at is not null then
    raise exception 'NOT_ALLOWED';
  end if;
  if exists (select 1 from public.chat_reactions where message_id = p_message and user_id = auth.uid() and emoji = p_emoji) then
    delete from public.chat_reactions where message_id = p_message and user_id = auth.uid() and emoji = p_emoji;
    return false;
  end if;
  insert into public.chat_reactions (message_id, thread_id, user_id, emoji) values (p_message, m.thread_id, auth.uid(), p_emoji);
  return true;
end $$;

revoke all on function public.chat_set_pinned(uuid, boolean), public.chat_react(uuid, text) from public, anon;
grant execute on function public.chat_set_pinned(uuid, boolean), public.chat_react(uuid, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.chat_reactions;
exception when others then
  raise notice 'Could not add chat_reactions to the realtime publication (%). Reactions still refresh every minute and when the app is opened.', sqlerrm;
end $$;

-- ------------------------------------------------------------------- voice notes in the Inbox and in notifications
create or replace function public.chat_voice_preview(p_secs int)
returns text language sql immutable as $$
  select 'Voice note (' || (coalesce(p_secs, 0) / 60) || ':' || lpad((coalesce(p_secs, 0) % 60)::text, 2, '0') || ')'
$$;

create or replace function public.chat_inbox()
returns table (
  thread_id uuid, kind text, job_id uuid, lead_id uuid, label text, last_message_at timestamptz,
  last_preview text, last_author text, unread int, pending_acks int, muted boolean,
  peer_id uuid, channel_key text
)
language sql stable security definer set search_path = public as $$
  select
    th.id, th.kind, th.job_id, th.lead_id,
    case th.kind
      when 'dm' then (select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) from public.staff_users p
                      where p.id = case when th.user_a = auth.uid() then th.user_b else th.user_a end)
      when 'tech_line' then case when th.tech_id = auth.uid() then 'Office'
                            else (select coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1)) from public.staff_users p where p.id = th.tech_id) end
      when 'channel' then '#' || th.channel_key
      else public.chat_thread_label(th.id)
    end,
    th.last_message_at,
    lm.preview, lm.author,
    (select count(*) from public.chat_messages m
      where m.thread_id = th.id and m.kind in ('text', 'photo', 'voice') and m.deleted_at is null
        and m.author_id is distinct from auth.uid() and m.created_at > r.last_read_at)::int,
    (select count(*) from public.chat_messages m
      where m.thread_id = th.id and m.kind = 'system' and auth.uid() = any (m.ack_user_ids)
        and m.created_at > now() - interval '14 days'
        and not exists (select 1 from public.chat_acks a where a.message_id = m.id and a.user_id = auth.uid()))::int,
    r.muted,
    case th.kind when 'dm' then case when th.user_a = auth.uid() then th.user_b else th.user_a end
                 when 'tech_line' then th.tech_id end,
    th.channel_key
  from public.chat_reads r
  join public.chat_threads th on th.id = r.thread_id
  left join lateral (
    select
      case when m.deleted_at is not null then 'Message deleted'
           when m.kind = 'photo' then coalesce(nullif(btrim(m.body), ''), 'Sent a photo')
           when m.kind = 'voice' then public.chat_voice_preview(m.voice_secs)
           else left(m.body, 120) end as preview,
      coalesce(nullif(btrim(s.full_name), ''), split_part(s.email, '@', 1), 'Someone') as author
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

-- The notification trigger is the one from 020 with one change: a voice note reads "Voice note (0:12)".
create or replace function public.trg_chat_message_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_url text;
  v_name text;
  v_role public.staff_role;
  v_kind text;
  v_job uuid;
  v_lead uuid;
  v_tech uuid;
  v_ua uuid;
  v_ub uuid;
  v_preview text;
  v_title text;
  v_recipients uuid[];
begin
  select kind, job_id, lead_id, tech_id, user_a, user_b into v_kind, v_job, v_lead, v_tech, v_ua, v_ub
  from public.chat_threads where id = new.thread_id;
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
  v_preview := case when new.kind = 'photo' then coalesce(nullif(btrim(left(new.body, 140)), ''), 'Sent a photo')
                    when new.kind = 'voice' then public.chat_voice_preview(new.voice_secs)
                    else left(new.body, 140) end;
  v_title := case when v_kind = 'dm' then v_name else v_name || ' · ' || v_label end;

  -- who hears about a plain message: everyone following the thread (unless muted), plus
  --   job / lead: a tech's message also reaches the office and owner, an office message the techs on the job
  --   dm:         the other person
  --   tech_line:  a tech's message reaches the office and owner, anyone else's reaches that tech
  --   channel:    followers only
  v_recipients := coalesce((select array_agg(r.user_id) from public.chat_reads r
                            where r.thread_id = new.thread_id and not r.muted), '{}');
  if v_kind in ('job', 'lead') then
    if v_role = 'tech' then
      v_recipients := v_recipients || public.notif_office_owner();
    elsif v_job is not null then
      v_recipients := v_recipients || public.notif_job_techs(v_job);
    end if;
  elsif v_kind = 'dm' then
    v_recipients := v_recipients || array[case when new.author_id = v_ua then v_ub else v_ua end];
  elsif v_kind = 'tech_line' then
    if new.author_id = v_tech then
      v_recipients := v_recipients || public.notif_office_owner();
    else
      v_recipients := v_recipients || array[v_tech];
    end if;
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
      v_recipients, 'chat_message', 'info', v_title,
      v_preview, v_url, v_job, v_lead,
      'chat:' || new.thread_id || ':msg', 'update', interval '1 minute');
  end if;
  return new;
end $$;
