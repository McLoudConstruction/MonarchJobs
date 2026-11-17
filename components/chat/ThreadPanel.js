'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import MentionBox from '@/components/job/MentionBox';
import { segments } from '@/lib/sketchComments';
import { CameraIcon } from '@/components/job/photoIcons';
import { prepareImage } from '@/lib/photoUpload';
import { useChatPhotoUrls } from '@/lib/chatPhotos';
import { useChatDock } from '@/components/chat/ChatDockContext';
import {
  CHAT_PHOTO_BUCKET, MAX_BODY, PAGE_SIZE, cleanBody, personName, mentionPeople, mentionIds, groupByDay, mergeMessages, mergeAcks,
  firstUnreadId, ackState, needsMyAck, canEditMessage, canDeleteMessage, quickRepliesFor, photoPathFor, clockTime, tagIsMe,
} from '@/lib/chat';
import './chat.css';

// The chat on a job or a lead: messages, pictures, @tags, and "Got it" on changes the tech has to know about.
// Staff only. `kind` is 'job', 'lead' or 'thread'; `refId` is that job's, lead's or conversation's id.
// `compact` is the small popup / sheet version (no card, no heading). `active` false (a minimized window) keeps it from
// marking messages read.

// A missing function means migration 017 has not been run yet.
const notInstalled = (err) => !!err && (err.code === 'PGRST202' || err.code === '42883' || err.code === '42P01' || /could not find the function|does not exist|schema cache/i.test(err.message || ''));
const changed = () => { try { window.dispatchEvent(new Event('chat-changed')); } catch { /* not in a browser */ } };
const newUuid = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
const friendly = (e) => (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|network|load failed/i.test(e?.message || '')
  ? 'No signal. Your message was not sent.'
  : (e?.message || 'Could not send.');

export default function ThreadPanel({ kind, refId, staff, compact = false, active = true }) {
  const dock = useChatDock();
  const [state, setState] = useState('loading'); // loading | ready | missing | error
  const [error, setError] = useState('');
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [acks, setAcks] = useState([]);
  const [people, setPeople] = useState([]);
  const [lastRead, setLastRead] = useState(null); // as it was when the chat opened, for the "New" line
  const [muted, setMuted] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ackBusy, setAckBusy] = useState(null);
  const [editing, setEditing] = useState(null); // { id, text }

  const listRef = useRef(null);
  const fileRef = useRef(null);
  const stickRef = useRef(true); // keep the view at the bottom while the person is at the bottom

  const messagesRef = useRef([]);
  messagesRef.current = messages;

  // ---- loading -----------------------------------------------------------
  const load = useCallback(async (tid, { older = false } = {}) => {
    const sb = getSupabase();
    let q = sb.from('chat_messages').select('*').eq('thread_id', tid).order('created_at', { ascending: false }).limit(PAGE_SIZE);
    if (older) {
      const oldest = messagesRef.current[0]?.created_at;
      if (oldest) q = q.lt('created_at', oldest);
    }
    const { data, error: err } = await q;
    if (err) throw err;
    const rows = (data || []).slice().reverse();
    if (older || messagesRef.current.length === 0) setHasMore((data || []).length === PAGE_SIZE);
    setMessages((cur) => mergeMessages(cur, rows));
    const ids = rows.filter((r) => r.ack_user_ids?.length).map((r) => r.id);
    if (ids.length) {
      const { data: a } = await sb.from('chat_acks').select('message_id,user_id,acked_at').in('message_id', ids);
      setAcks((cur) => mergeAcks(cur, a || []));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setState('loading'); setError(''); setMessages([]); setAcks([]); setThreadId(null);
      const sb = getSupabase();
      const [t, ppl] = await Promise.all([
        kind === 'thread' ? Promise.resolve({ data: refId, error: null })
          : kind === 'job' ? sb.rpc('chat_thread_for_job', { p_job: refId }) : sb.rpc('chat_thread_for_lead', { p_lead: refId }),
        sb.from('staff_users').select('id,full_name,email,role,active'),
      ]);
      if (!alive) return;
      if (t.error) { setState(notInstalled(t.error) ? 'missing' : 'error'); setError(t.error.message); return; }
      setPeople(ppl.data || []);
      const tid = t.data;
      const { data: rd } = await sb.from('chat_reads').select('last_read_at,muted').eq('thread_id', tid).eq('user_id', staff.id).maybeSingle();
      if (!alive) return;
      setLastRead(rd?.last_read_at ?? null);
      setMuted(!!rd?.muted);
      try { await load(tid); } catch (e) { if (alive) { setState('error'); setError(e.message || 'Could not load the chat.'); } return; }
      if (!alive) return;
      setThreadId(tid);
      stickRef.current = true;
      setState('ready');
    })();
    return () => { alive = false; };
  }, [kind, refId, staff.id, load]);

  // new messages and "Got it" taps arrive live; refresh also when the app returns to the foreground
  useEffect(() => {
    if (!threadId) return undefined;
    const sb = getSupabase();
    let channel = null;
    try {
      channel = sb.channel(`chat-${threadId}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` },
          (p) => { if (p.new?.id) setMessages((cur) => mergeMessages(cur, [p.new])); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_acks' },
          (p) => { if (p.new?.message_id) setAcks((cur) => mergeAcks(cur, [p.new])); })
        .subscribe();
    } catch { /* polling below still works */ }
    const refresh = () => { if (document.visibilityState === 'visible') load(threadId).catch(() => {}); };
    const poll = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      if (channel) sb.removeChannel(channel);
    };
  }, [threadId, load]);

  // a full-size chat on a job, lead or page tells the popup, so the same conversation is not also open in a window
  const { registerPageThread } = dock;
  useEffect(() => {
    if (compact || !threadId) return undefined;
    registerPageThread(threadId);
    return () => registerPageThread(null);
  }, [compact, threadId, registerPageThread]);

  // reading the chat clears its bell items and badge (only while it is actually open on screen)
  useEffect(() => {
    if (!threadId || state !== 'ready' || !active) return undefined;
    const t = setTimeout(() => {
      if (document.visibilityState === 'visible') getSupabase().rpc('chat_mark_read', { p_thread: threadId }).then(changed, () => {});
    }, 700);
    return () => clearTimeout(t);
  }, [threadId, state, messages.length, active]);

  // stay at the bottom for new messages, unless the person has scrolled up to read older ones
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    if (stickRef.current || last?.author_id === staff.id) el.scrollTop = el.scrollHeight;
  }, [messages, state, staff.id]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ---- derived ------------------------------------------------------------
  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const nameOf = (id) => (id && byId[id] ? personName(byId[id]) : 'Someone');
  const everyone = useMemo(() => mentionPeople(people, null), [people]);
  const mentionable = useMemo(() => mentionPeople(people, staff.id), [people, staff.id]);
  const groups = useMemo(() => groupByDay(messages), [messages]);
  const newId = useMemo(() => firstUnreadId(messages, lastRead, staff.id), [messages, lastRead, staff.id]);
  const photoUrls = useChatPhotoUrls(messages.filter((m) => m.photo_path && !m.deleted_at).map((m) => m.photo_path));

  // ---- actions --------------------------------------------------------------
  async function post(raw, photoPath = null) {
    const body = cleanBody(raw);
    if (!body && !photoPath) return false;
    const row = { thread_id: threadId, author_id: staff.id, kind: photoPath ? 'photo' : 'text', body, mentions: mentionIds(body, people, staff.id) };
    if (photoPath) row.photo_path = photoPath;
    const { data, error: err } = await getSupabase().from('chat_messages').insert(row).select('*').single();
    if (err) throw err;
    stickRef.current = true;
    setMessages((cur) => mergeMessages(cur, [data]));
    changed();
    return true;
  }

  async function send(raw, fromComposer = false) {
    if (!threadId || busy) return;
    setBusy(true); setError('');
    try {
      if (await post(raw) && fromComposer) setText('');
    } catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  }

  async function sendPhoto(file) {
    if (!file || !threadId || busy) return;
    setBusy(true); setError('');
    try {
      const prepared = await prepareImage(file);
      const path = photoPathFor(threadId, newUuid());
      const { error: upErr } = await getSupabase().storage.from(CHAT_PHOTO_BUCKET).upload(path, prepared.fullBlob, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw upErr;
      if (await post(text, path)) setText('');
    } catch (e) { setError(friendly(e)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function saveEdit() {
    if (!editing) return;
    const body = cleanBody(editing.text);
    if (!body) return;
    setBusy(true); setError('');
    try {
      const { error: err } = await getSupabase().from('chat_messages').update({ body, mentions: mentionIds(body, people, staff.id) }).eq('id', editing.id);
      if (err) throw err;
      setMessages((cur) => mergeMessages(cur, [{ id: editing.id, body, edited_at: new Date().toISOString() }]));
      setEditing(null);
    } catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  }

  async function remove(m) {
    if (!window.confirm('Delete this message for everyone?')) return;
    setError('');
    const { error: err } = await getSupabase().from('chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', m.id);
    if (err) { setError(friendly(err)); return; }
    setMessages((cur) => mergeMessages(cur, [{ id: m.id, deleted_at: new Date().toISOString(), body: '', photo_path: null }]));
    changed();
  }

  async function gotIt(m) {
    setAckBusy(m.id); setError('');
    const { error: err } = await getSupabase().rpc('chat_ack', { p_message: m.id });
    if (err) setError(friendly(err));
    else {
      setAcks((cur) => mergeAcks(cur, [{ message_id: m.id, user_id: staff.id, acked_at: new Date().toISOString() }]));
      load(threadId).catch(() => {}); // an earlier change waiting on the same person is closed too
      changed();
    }
    setAckBusy(null);
  }

  async function toggleMute() {
    const next = !muted;
    setMuted(next);
    const { error: err } = await getSupabase().rpc('chat_set_muted', { p_thread: threadId, p_muted: next });
    if (err) { setMuted(!next); setError(friendly(err)); } else changed();
  }

  async function loadOlder() {
    try { await load(threadId, { older: true }); } catch (e) { setError(friendly(e)); }
  }

  // ---- pieces ----------------------------------------------------------------
  const renderBody = (body) => segments(body, everyone).map((seg, i) => (seg.tag
    ? <span key={i} className={`chat-tag ${tagIsMe(seg.tag.id, staff) ? 'me' : ''}`}>{seg.s}</span>
    : <span key={i}>{seg.s}</span>));

  function renderSystem(m) {
    const asks = (m.ack_user_ids || []).length > 0;
    const st = ackState(m, acks);
    const mineWaiting = needsMyAck(m, acks, staff.id);
    const who = m.author_id === staff.id ? 'You' : nameOf(m.author_id);
    return (
      <div key={m.id} className={`chat-sys ${mineWaiting ? 'ask' : ''}`}>
        <span>{who} {m.body}</span><time dateTime={m.created_at}>{clockTime(m.created_at)}</time>
        {asks && (
          <div className="chat-ack">
            {mineWaiting && <button type="button" disabled={ackBusy === m.id} onClick={() => gotIt(m)}>Got it</button>}
            {st.done.map((d) => <span key={d.user_id} className="done">✓ {d.user_id === staff.id ? 'You' : nameOf(d.user_id)} got it · {clockTime(d.at)}</span>)}
            {st.waiting.filter((id) => id !== staff.id).map((id) => <span key={id} className="wait">Waiting on {nameOf(id)}</span>)}
          </div>
        )}
      </div>
    );
  }

  function renderMessage(m) {
    if (m.kind === 'system') return renderSystem(m);
    const mine = m.author_id === staff.id;
    const deleted = !!m.deleted_at;
    const url = m.photo_path ? photoUrls[m.photo_path] : null;
    return (
      <Fragment key={m.id}>
        {m.id === newId && <div className="chat-new">New</div>}
        <div className={`chat-row ${mine ? 'mine' : 'theirs'}`}>
          {!mine && <div className="chat-who">{nameOf(m.author_id)}</div>}
          {editing?.id === m.id ? (
            <div className="chat-edit">
              <MentionBox people={mentionable} value={editing.text} onChange={(v) => setEditing({ id: m.id, text: v })} onSubmit={saveEdit} rows={3} maxLength={MAX_BODY} autoFocus />
              <div className="chat-meta">
                <button type="button" disabled={busy || !cleanBody(editing.text)} onClick={saveEdit}>Save</button>
                <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className={`chat-bubble ${deleted ? 'deleted' : ''}`}>
              {deleted ? 'Message deleted' : (
                <>
                  {m.photo_path && (url
                    ? <a href={url} target="_blank" rel="noreferrer"><img className="chat-photo" src={url} alt="Picture sent in the chat" /></a>
                    : <div className="chat-note">Loading picture…</div>)}
                  {m.body ? <span>{renderBody(m.body)}</span> : null}
                </>
              )}
            </div>
          )}
          <div className="chat-meta">
            <time dateTime={m.created_at}>{clockTime(m.created_at)}</time>
            {m.edited_at && !deleted && <span>edited</span>}
            {canEditMessage(m, staff.id) && editing?.id !== m.id && <button type="button" onClick={() => setEditing({ id: m.id, text: m.body })}>Edit</button>}
            {canDeleteMessage(m, staff.id, staff.role) && editing?.id !== m.id && <button type="button" onClick={() => remove(m)}>Delete</button>}
          </div>
        </div>
      </Fragment>
    );
  }

  // ---- render ----------------------------------------------------------------
  const Shell = compact ? 'div' : 'div';
  if (state === 'loading') return <Shell className={compact ? 'chat-panel compact' : 'card'}><p className="muted" style={{ padding: compact ? 12 : 0 }}>Loading chat…</p></Shell>;
  if (state === 'missing') {
    return (
      <div className={compact ? 'chat-panel compact' : 'card'} style={compact ? { padding: 12 } : undefined}>
        {!compact && <h2>Chat</h2>}
        <p className="muted">Chat is not switched on yet. Run migrations 017 and 020 (staff messaging and direct messages) in Supabase, then reload.</p>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className={compact ? 'chat-panel compact' : 'card'} style={compact ? { padding: 12 } : undefined}>
        {!compact && <h2>Chat</h2>}
        <div className="msg err" role="alert">{error || 'Could not open the chat.'}</div>
        <button type="button" className="secondary" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }

  return (
    <div className={compact ? 'chat-panel compact' : 'card chat-panel'} id={compact ? undefined : 'thread'}>
      {compact ? (
        <div className="chat-minihead"><button type="button" onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute notifications' : 'Mute notifications'}</button></div>
      ) : (
        <div className="chat-head">
          <h2>Chat</h2>
          <button type="button" className="secondary small" onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute' : 'Mute'}</button>
        </div>
      )}
      <div className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite">
        {hasMore && <button type="button" className="secondary small chat-more" onClick={loadOlder}>Show earlier messages</button>}
        {messages.length === 0 && (
          <div className="chat-empty">
            No messages yet. {kind === 'job' ? 'Write to the crew on this job' : kind === 'lead' ? 'Write to the office about this lead' : 'Say hello'}, or type @ to tag someone.
          </div>
        )}
        {groups.map((g) => (
          <Fragment key={g.key}>
            <div className="chat-day">{g.label}</div>
            {g.items.map(renderMessage)}
          </Fragment>
        ))}
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
      <div className="chat-composer">
        <div className="chat-quick" aria-label="Quick replies">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => sendPhoto(e.target.files?.[0])} />
          <button type="button" className="secondary chat-quick-photo" aria-label="Send a picture" title="Send a picture" disabled={busy} onClick={() => fileRef.current?.click()}><CameraIcon size={16} /></button>
          {quickRepliesFor(staff.role).map((q) => (
            <button key={q} type="button" className="secondary" disabled={busy} onClick={() => send(q)}>{q}</button>
          ))}
        </div>
        <div className="chat-compose-row">
          <MentionBox people={mentionable} value={text} onChange={setText} onSubmit={() => send(text, true)} rows={2} maxLength={MAX_BODY} placeholder="Message. Type @ to tag someone" />
          <button type="button" className="send" disabled={busy || !cleanBody(text)} onClick={() => send(text, true)}>Send</button>
        </div>
        {!compact && <div className="chat-note">Staff only. Customers and adjusters never see this chat.</div>}
      </div>
    </div>
  );
}
