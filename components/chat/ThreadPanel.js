'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import MentionBox from '@/components/job/MentionBox';
import { segments } from '@/lib/sketchComments';
import { CameraIcon } from '@/components/job/photoIcons';
import { prepareImage } from '@/lib/photoUpload';
import { useChatPhotoUrls } from '@/lib/chatPhotos';
import { useChatVoiceUrls } from '@/lib/chatVoice';
import VoiceRecorder from '@/components/chat/VoiceRecorder';
import { useChatDock } from '@/components/chat/ChatDockContext';
import {
  CHAT_PHOTO_BUCKET, MAX_BODY, PAGE_SIZE, cleanBody, personName, mentionPeople, mentionIds, groupByDay, mergeMessages, mergeAcks,
  firstUnreadId, ackState, needsMyAck, canEditMessage, canDeleteMessage, quickRepliesFor, photoPathFor, clockTime, tagIsMe,
  CHAT_VOICE_BUCKET, MAX_PINS, REACTIONS, SEARCH_LIMIT, canPinMessage, isPinned, mergePins, mergeReactions, removeReaction, reactionSummary,
  canSearch, likePattern, highlightParts, snippet, voicePathFor, durationText, previewText, isBareSystemLine,
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
  : /TOO_MANY_PINS/.test(e?.message || '') ? `Up to ${MAX_PINS} messages can be pinned. Unpin one first.`
  : notInstalled(e) ? 'This needs migration 035 (chat extras) run in Supabase first.'
  : (e?.message || 'Could not send.');

export default function ThreadPanel({ kind, refId, staff, compact = false, active = true, fill = false }) {
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
  const [reactions, setReactions] = useState([]);
  const [pinnedRows, setPinnedRows] = useState([]); // pinned messages fetched on opening (may be older than the loaded page)
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState(null); // message id whose reaction choices are showing
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null: nothing searched yet
  const [searching, setSearching] = useState(false);
  const [highlightId, setHighlightId] = useState(null);

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
      setReactions([]); setPinnedRows([]); setPinsOpen(false); setPickerFor(null); setSearchOpen(false); setQuery(''); setResults(null);
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
      // reactions and pins come after the chat is on screen; an older database without migration 035 just has none
      const [rx, pn] = await Promise.all([
        sb.from('chat_reactions').select('message_id,thread_id,user_id,emoji,created_at').eq('thread_id', tid),
        sb.from('chat_messages').select('*').eq('thread_id', tid).not('pinned_at', 'is', null).is('deleted_at', null).order('pinned_at', { ascending: false }).limit(MAX_PINS),
      ]);
      if (!alive) return;
      if (!rx.error) setReactions(rx.data || []);
      if (!pn.error) setPinnedRows(pn.data || []);
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions', filter: `thread_id=eq.${threadId}` },
          (p) => {
            if (p.eventType === 'DELETE') setReactions((cur) => removeReaction(cur, p.old));
            else if (p.new?.message_id) setReactions((cur) => mergeReactions(cur, [p.new]));
          })
        .subscribe();
    } catch { /* polling below still works */ }
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      load(threadId).catch(() => {});
      sb.from('chat_reactions').select('message_id,thread_id,user_id,emoji,created_at').eq('thread_id', threadId).then((r) => { if (!r.error) setReactions(r.data || []); }, () => {});
    };
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
  const voiceUrls = useChatVoiceUrls(messages.filter((m) => m.voice_path && !m.deleted_at).map((m) => m.voice_path));
  const pins = useMemo(() => mergePins(pinnedRows, messages), [pinnedRows, messages]);

  // search runs on the server (so it reaches messages older than the page on screen), a moment after typing stops
  useEffect(() => {
    if (!searchOpen || !threadId) return undefined;
    if (!canSearch(query)) { setResults(null); setSearching(false); return undefined; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data, error: err } = await getSupabase().from('chat_messages').select('*')
        .eq('thread_id', threadId).is('deleted_at', null).neq('kind', 'system').ilike('body', likePattern(query))
        .order('created_at', { ascending: false }).limit(SEARCH_LIMIT);
      if (!alive) return;
      setSearching(false);
      if (err) { setError(friendly(err)); setResults([]); } else setResults(data || []);
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, searchOpen, threadId]);

  // scroll to a message we jumped to and hold a soft highlight on it for a moment
  useEffect(() => {
    if (!highlightId) return undefined;
    const el = listRef.current?.querySelector(`[data-mid="${highlightId}"]`);
    if (el) { stickRef.current = false; el.scrollIntoView({ block: 'center' }); }
    const t = setTimeout(() => setHighlightId(null), 2600);
    return () => clearTimeout(t);
  }, [highlightId, messages.length]);

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

  async function sendVoice({ blob, ext, type, secs }) {
    if (!blob || !threadId || busy) return;
    setBusy(true); setError('');
    try {
      const path = voicePathFor(threadId, newUuid(), ext);
      const { error: upErr } = await getSupabase().storage.from(CHAT_VOICE_BUCKET).upload(path, blob, { contentType: type, upsert: false });
      if (upErr) throw upErr;
      const row = { thread_id: threadId, author_id: staff.id, kind: 'voice', body: '', voice_path: path, voice_secs: secs, mentions: [] };
      const { data, error: err } = await getSupabase().from('chat_messages').insert(row).select('*').single();
      if (err) throw err;
      stickRef.current = true;
      setMessages((cur) => mergeMessages(cur, [data]));
      changed();
    } catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  }

  async function react(m, emoji) {
    setPickerFor(null);
    const mine = { message_id: m.id, thread_id: m.thread_id, user_id: staff.id, emoji };
    const had = reactions.some((r) => r.message_id === m.id && r.user_id === staff.id && r.emoji === emoji);
    setReactions((cur) => (had ? removeReaction(cur, mine) : mergeReactions(cur, [{ ...mine, created_at: new Date().toISOString() }])));
    const { error: err } = await getSupabase().rpc('chat_react', { p_message: m.id, p_emoji: emoji });
    if (err) {
      setReactions((cur) => (had ? mergeReactions(cur, [mine]) : removeReaction(cur, mine)));
      setError(friendly(err));
    }
  }

  async function togglePin(m) {
    const pin = !isPinned(m);
    setError('');
    const { error: err } = await getSupabase().rpc('chat_set_pinned', { p_message: m.id, p_pinned: pin });
    if (err) { setError(friendly(err)); return; }
    const patch = { id: m.id, pinned_at: pin ? new Date().toISOString() : null, pinned_by: pin ? staff.id : null };
    setMessages((cur) => mergeMessages(cur, [patch]));
    setPinnedRows((cur) => (pin ? mergeMessages(cur, [{ ...m, ...patch }]) : cur.filter((x) => x.id !== m.id)));
  }

  // Go to a message, loading everything from it forward first when it is older than the page on screen.
  async function jumpTo(m) {
    setError('');
    if (!messagesRef.current.some((x) => x.id === m.id)) {
      const { data, error: err } = await getSupabase().from('chat_messages').select('*')
        .eq('thread_id', threadId).gte('created_at', m.created_at).order('created_at', { ascending: true }).limit(500);
      if (err) { setError(friendly(err)); return; }
      setHasMore(true);
      setMessages((cur) => mergeMessages(cur, data || []));
    }
    setPinsOpen(false); setSearchOpen(false);
    setHighlightId(null);
    setTimeout(() => setHighlightId(m.id), 30);
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
    setMessages((cur) => mergeMessages(cur, [{ id: m.id, deleted_at: new Date().toISOString(), body: '', photo_path: null, voice_path: null, pinned_at: null, pinned_by: null }]));
    setPinnedRows((cur) => cur.filter((x) => x.id !== m.id));
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
        <span>{isBareSystemLine(m.body) ? m.body : `${who} ${m.body}`}</span><time dateTime={m.created_at}>{clockTime(m.created_at)}</time>
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

  const reactionsFor = (m) => reactionSummary(reactions, m.id, staff.id);

  function renderMessage(m) {
    if (m.kind === 'system') return renderSystem(m);
    const mine = m.author_id === staff.id;
    const deleted = !!m.deleted_at;
    const url = m.photo_path ? photoUrls[m.photo_path] : null;
    return (
      <Fragment key={m.id}>
        {m.id === newId && <div className="chat-new">New</div>}
        <div className={`chat-row ${mine ? 'mine' : 'theirs'}${highlightId === m.id ? ' flash' : ''}`} data-mid={m.id}>
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
                  {m.voice_path && (voiceUrls[m.voice_path]
                    ? <audio className="chat-voice" controls preload="metadata" src={voiceUrls[m.voice_path]} aria-label={`Voice note, ${durationText(m.voice_secs)}`} />
                    : <div className="chat-note">Loading voice note…</div>)}
                  {m.kind === 'voice' && <div className="chat-voice-len">Voice note · {durationText(m.voice_secs)}</div>}
                  {m.body ? <span>{renderBody(m.body)}</span> : null}
                </>
              )}
            </div>
          )}
          {!deleted && reactionsFor(m).length > 0 && (
            <div className="chat-reacts">
              {reactionsFor(m).map((r) => (
                <button key={r.emoji} type="button" className={`chat-react${r.mine ? ' mine' : ''}`} onClick={() => react(m, r.emoji)}
                  title={r.userIds.map((id) => (id === staff.id ? 'You' : nameOf(id))).join(', ')} aria-pressed={r.mine}>
                  <span aria-hidden="true">{r.emoji}</span> {r.count}
                </button>
              ))}
            </div>
          )}
          {pickerFor === m.id && !deleted && (
            <div className="chat-picker" role="group" aria-label="Add a reaction">
              {REACTIONS.map((e) => <button key={e} type="button" onClick={() => react(m, e)} aria-label={`React ${e}`}>{e}</button>)}
            </div>
          )}
          <div className="chat-meta">
            <time dateTime={m.created_at}>{clockTime(m.created_at)}</time>
            {isPinned(m) && <span className="chat-pinned-tag">Pinned</span>}
            {m.edited_at && !deleted && <span>edited</span>}
            {!deleted && editing?.id !== m.id && <button type="button" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}>React</button>}
            {canPinMessage(m) && editing?.id !== m.id && <button type="button" onClick={() => togglePin(m)}>{isPinned(m) ? 'Unpin' : 'Pin'}</button>}
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
    <div className={compact ? 'chat-panel compact' : `card chat-panel${fill ? ' fill' : ''}`} id={compact ? undefined : 'thread'}>
      {compact || fill ? (
        <div className="chat-minihead">
          <button type="button" onClick={() => setSearchOpen((o) => !o)} aria-pressed={searchOpen}>{searchOpen ? 'Close search' : 'Search this chat'}</button>
          <button type="button" onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute notifications' : 'Mute notifications'}</button>
        </div>
      ) : (
        <div className="chat-head">
          <h2>Chat</h2>
          <div className="chat-head-actions">
            <button type="button" className="secondary small" onClick={() => setSearchOpen((o) => !o)} aria-pressed={searchOpen}>{searchOpen ? 'Close search' : 'Search'}</button>
            <button type="button" className="secondary small" onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute' : 'Mute'}</button>
          </div>
        </div>
      )}
      {searchOpen && (
        <div className="chat-search">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search messages in this chat" aria-label="Search messages in this chat" autoFocus maxLength={80} />
          {searching && <div className="chat-note">Searching…</div>}
          {!searching && results && results.length === 0 && <div className="chat-note">No messages match.</div>}
          {!searching && !results && query.trim() && <div className="chat-note">Type at least 2 letters.</div>}
          {results && results.length > 0 && (
            <ul className="chat-results">
              {results.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => jumpTo(m)}>
                    <span className="chat-result-meta">{m.author_id === staff.id ? 'You' : nameOf(m.author_id)} · {new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {clockTime(m.created_at)}</span>
                    <span className="chat-result-text">{highlightParts(snippet(m.body, query), query).map((p, i) => (p.hit ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {pins.length > 0 && (
        <div className="chat-pins">
          <button type="button" className="chat-pins-head" onClick={() => setPinsOpen((o) => !o)} aria-expanded={pinsOpen}>
            <span>Pinned ({pins.length})</span>
            <span className="chat-pins-latest">{pinsOpen ? 'Hide' : previewText(pins[0])}</span>
          </button>
          {pinsOpen && (
            <ul className="chat-pins-list">
              {pins.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => jumpTo(m)}>
                    <span className="chat-result-meta">{m.author_id === staff.id ? 'You' : nameOf(m.author_id)} · {clockTime(m.created_at)}</span>
                    <span className="chat-result-text">{previewText(m)}</span>
                  </button>
                  <button type="button" className="chat-unpin" onClick={() => togglePin(m)} aria-label="Unpin this message">Unpin</button>
                </li>
              ))}
            </ul>
          )}
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
          <VoiceRecorder disabled={busy} onRecorded={sendVoice} onError={(msg) => setError(msg)} />
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
