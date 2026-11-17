-- 020: direct messages, an Office line for every tech, and the #dispatch channel.
-- Run after 001 to 019. Run it once, before deploying this push.
--
-- Three new kinds of conversation join the job and lead chats (same messages, pictures, @tags, mute and notifications):
--   * dm         two staff members. Only those two can read it (the owner cannot read other people's direct messages).
--   * tech_line  one per technician: that tech, the office and the owner. The tech never has to pick who to write to,
--                and the owner sees one conversation per tech.
--   * channel    everyone on staff. #dispatch is made here.
-- Notifications: a direct message reaches the other person; a tech's Office-line message reaches the office and owner,
-- an office or owner message reaches that tech; a channel message reaches everyone following it (mute with the bell).

-- ------------------------------------------------------------------- tables
alter table public.chat_threads drop constraint chat_threads_kind_check;
alter table public.chat_threads drop constraint chat_threads_target;
alter table public.chat_threads
  add column tech_id uuid references public.staff_users (id) on delete cascade,
  add column user_a uuid references public.staff_users (id) on delete cascade,
  add column user_b uuid references public.staff_users (id) on delete cascade,
  add column channel_key text check (channel_key ~ '^[a-z0-9-]{2,30}$'),
  add column title text check (char_length(title) <= 60);
alter table public.chat_threads add constraint chat_threads_kind_check check (kind in ('job', 'lead', 'dm', 'tech_line', 'channel'));
alter table public.chat_threads add constraint chat_threads_target check (
  case kind
    when 'job' then job_id is not null and lead_id is null and tech_id is null and user_a is null and user_b is null and channel_key is null
    when 'lead' then lead_id is not null and job_id is null and tech_id is null and user_a is null and user_b is null and channel_key is null
    when 'dm' then user_a is not null and user_b is not null and user_a < user_b and job_id is null and lead_id is null and tech_id is null and channel_key is null
    when 'tech_line' then tech_id is not null and job_id is null and lead_id is null and user_a is null and user_b is null and channel_key is null
    when 'channel' then channel_key is not null and title is not null and job_id is null and lead_id is null and tech_id is null and user_a is null and user_b is null
    else false
  end
);
create unique index chat_threads_dm_idx on public.chat_threads (user_a, user_b) where kind = 'dm';
create unique index chat_threads_tech_line_idx on public.chat_threads (tech_id) where kind = 'tech_line';
create unique index chat_threads_channel_idx on public.chat_threads (channel_key) where kind = 'channel';

insert into public.chat_threads (kind, channel_key, title) values ('channel', 'dispatch', 'Dispatch')
on conflict (channel_key) where kind = 'channel' do nothing;

-- ------------------------------------------------------------------- access
create or replace function public.can_access_thread(t uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_threads th
    where th.id = t and (
      (th.job_id is not null and public.can_access_job(th.job_id))
      or (th.lead_id is not null and public.is_office_or_owner())
      or (th.kind = 'dm' and auth.uid() in (th.user_a, th.user_b) and public.current_staff_role() is not null)
      or (th.kind = 'tech_line' and (public.is_office_or_owner() or (auth.uid() = th.tech_id and public.current_staff_role() is not null)))
      or (th.kind = 'channel' and public.current_staff_role() is not null)
    )
  )
$$;

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
      or (th.kind = 'dm' and p_user in (th.user_a, th.user_b))
      or (th.kind = 'tech_line' and (s.role in ('owner', 'office') or p_user = th.tech_id))
      or th.kind = 'channel'
    )
  )
$$;

-- ------------------------------------------------------------------- names and links
-- A neutral name, the same for everyone (used in notifications). The Inbox shows a name made for the reader instead.
create or replace function public.chat_thread_label(p_thread uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case th.kind
    when 'job' then coalesce(public.notif_job_label(th.job_id), 'a job')
    when 'lead' then coalesce((select nullif(btrim(l.name), '') from public.leads l where l.id = th.lead_id), 'a lead')
    when 'dm' then 'Direct message'
    when 'tech_line' then 'Office line'
    else '#' || th.channel_key
  end
  from public.chat_threads th where th.id = p_thread
$$;

create or replace function public.chat_thread_url(p_thread uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when th.job_id is not null then '/jobs/' || th.job_id || '#thread'
    when th.lead_id is not null then '/leads/' || th.lead_id || '#thread'
    else '/messages/' || th.id
  end
  from public.chat_threads th where th.id = p_thread
$$;

-- ------------------------------------------------------------------- finding or starting a conversation
create or replace function public.chat_thread_for_dm(p_other uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; v_a uuid; v_b uuid;
begin
  if auth.uid() is null or public.current_staff_role() is null then raise exception 'NOT_ALLOWED'; end if;
  if p_other is null or p_other = auth.uid() then raise exception 'BAD_PERSON: choose someone else'; end if;
  if not exists (select 1 from public.staff_users where id = p_other and active) then raise exception 'BAD_PERSON: that person is not active'; end if;
  v_a := least(auth.uid(), p_other); v_b := greatest(auth.uid(), p_other);
  select id into v from public.chat_threads where kind = 'dm' and user_a = v_a and user_b = v_b;
  if v is null then
    insert into public.chat_threads (kind, user_a, user_b) values ('dm', v_a, v_b)
    on conflict (user_a, user_b) where kind = 'dm' do nothing returning id into v;
    if v is null then select id into v from public.chat_threads where kind = 'dm' and user_a = v_a and user_b = v_b; end if;
  end if;
  return v;
end $$;

-- A tech calls it with no argument (their own Office line). The office and owner pass the tech.
create or replace function public.chat_thread_for_tech_line(p_tech uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; v_tech uuid; v_role public.staff_role := public.current_staff_role();
begin
  if v_role is null then raise exception 'NOT_ALLOWED'; end if;
  v_tech := case when v_role = 'tech' then auth.uid() else p_tech end;
  if v_tech is null or not exists (select 1 from public.staff_users where id = v_tech and active and role = 'tech') then
    raise exception 'BAD_PERSON: choose a technician';
  end if;
  select id into v from public.chat_threads where kind = 'tech_line' and tech_id = v_tech;
  if v is null then
    insert into public.chat_threads (kind, tech_id) values ('tech_line', v_tech)
    on conflict (tech_id) where kind = 'tech_line' do nothing returning id into v;
    if v is null then select id into v from public.chat_threads where kind = 'tech_line' and tech_id = v_tech; end if;
  end if;
  return v;
end $$;

-- Called when the app opens: puts #dispatch (and a tech's own Office line) in the person's list, so a tech always has
-- someone to write to even before anything was said. Safe to call every time.
create or replace function public.chat_ensure_standing()
returns void
language plpgsql security definer set search_path = public as $$
declare v_role public.staff_role := public.current_staff_role(); v uuid;
begin
  if auth.uid() is null or v_role is null then return; end if;
  insert into public.chat_reads (thread_id, user_id, last_read_at)
  select id, auth.uid(), now() from public.chat_threads where kind = 'channel' and channel_key = 'dispatch'
  on conflict (thread_id, user_id) do nothing;
  if v_role = 'tech' then
    v := public.chat_thread_for_tech_line(null);
    insert into public.chat_reads (thread_id, user_id, last_read_at) values (v, auth.uid(), now()) on conflict (thread_id, user_id) do nothing;
  end if;
end $$;

-- ------------------------------------------------------------------- the Inbox (adds names made for the reader)
drop function public.chat_inbox();
create function public.chat_inbox()
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
      where m.thread_id = th.id and m.kind in ('text', 'photo') and m.deleted_at is null
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

revoke all on function public.chat_inbox(), public.chat_thread_for_dm(uuid), public.chat_thread_for_tech_line(uuid), public.chat_ensure_standing() from public, anon;
grant execute on function public.chat_inbox(), public.chat_thread_for_dm(uuid), public.chat_thread_for_tech_line(uuid), public.chat_ensure_standing() to authenticated;

-- ------------------------------------------------------------------- who hears about a message
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
  v_preview := case when new.kind = 'photo' then coalesce(nullif(btrim(left(new.body, 140)), ''), 'Sent a photo') else left(new.body, 140) end;
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
