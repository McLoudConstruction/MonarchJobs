'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';
import { useChatCenter } from '@/lib/useChatInbox';
import { useIsMobile } from '@/lib/useIsMobile';
import { ChatIcon } from '@/components/icons';
import ThreadPanel from '@/components/chat/ThreadPanel';
import { ChatDockContext } from '@/components/chat/ChatDockContext';
import {
  rowDisplay, orderRows, filterRows, peopleForPicker, openWindow, closeWindow, minimizeWindow, fitWindows, maxExpandedFor,
  serializeDock, parseDock, bubbleHidden, badgeText,
} from '@/lib/chatDock';
import { threadHref } from '@/lib/chat';
import { timeAgo } from '@/lib/notificationTypes';
import './chatdock.css';

const STORE_KEY = 'mj-chat-dock';
const changed = () => { try { window.dispatchEvent(new Event('chat-changed')); } catch { /* not in a browser */ } };

// The chat popup for staff. Desktop: a launcher at the lower right opens a conversation list, and each conversation
// opens in a window beside it (up to 3). Phones: a half-height sheet that goes full screen on expand or when the
// keyboard opens. Mounted once in the app shell; the rest of the app talks to it through useChatDock().
export function ChatDockProvider({ staff, children }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const mobile = useIsMobile();
  const { rows, unread, missing, loaded, refresh } = useChatCenter();

  const [panel, setPanel] = useState(false);
  const [windows, setWindows] = useState([]);
  const [pageThread, setPageThread] = useState(null);
  const [width, setWidth] = useState(1280);
  const [restored, setRestored] = useState(false);
  // phone sheet: null (closed) | { view: 'list' | 'thread' | 'new', thread?: {threadId,title,href}, full: boolean }
  const [sheet, setSheet] = useState(null);
  const [notice, setNotice] = useState('');
  const maxOpen = maxExpandedFor(width);

  // the standing conversations (Office line, #dispatch) exist as soon as someone signs in
  const ensured = useRef('');
  useEffect(() => {
    if (!staff?.id || missing || ensured.current === staff.id) return;
    ensured.current = staff.id;
    getSupabase().rpc('chat_ensure_standing').then(({ error }) => { if (!error) refresh(); }, () => {});
  }, [staff?.id, missing, refresh]);

  // open windows stay open as you move around the app (this tab only)
  useEffect(() => {
    try { const d = parseDock(sessionStorage.getItem(STORE_KEY) || ''); setPanel(d.panel); setWindows(d.windows); } catch { /* private mode */ }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(STORE_KEY, serializeDock({ panel, windows })); } catch { /* private mode */ }
  }, [panel, windows, restored]);
  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  useEffect(() => { setWindows((w) => fitWindows(w, maxOpen)); }, [maxOpen]);

  const titleFor = useCallback((threadId, fallback) => rows.find((r) => r.thread_id === threadId)?.label || fallback || 'Chat', [rows]);

  const openThread = useCallback((t) => {
    if (!t?.threadId) return;
    const title = titleFor(t.threadId, t.title);
    const href = t.href || threadHref({ thread_id: t.threadId, ...(rows.find((r) => r.thread_id === t.threadId) || {}) });
    if (mobile) { setSheet({ view: 'thread', thread: { threadId: t.threadId, title, href }, full: false }); return; }
    setWindows((w) => openWindow(w, { threadId: t.threadId, title, href }, maxOpen));
  }, [mobile, rows, maxOpen, titleFor]);

  const openList = useCallback(() => { if (mobile) setSheet({ view: 'list', full: false }); else setPanel(true); }, [mobile]);

  const fail = (e) => { setNotice(e?.message || 'Could not open that chat.'); setTimeout(() => setNotice(''), 5000); };
  const openJob = useCallback(async (jobId, title) => {
    const { data, error } = await getSupabase().rpc('chat_thread_for_job', { p_job: jobId });
    if (error || !data) { fail(error); return; }
    openThread({ threadId: data, title: title || 'Job chat', href: `/jobs/${jobId}#thread` });
    changed();
  }, [openThread]);
  const openPerson = useCallback(async (userId, { action = 'dm', title } = {}) => {
    const sb = getSupabase();
    const { data, error } = action === 'tech_line' ? await sb.rpc('chat_thread_for_tech_line', { p_tech: userId }) : await sb.rpc('chat_thread_for_dm', { p_other: userId });
    if (error || !data) { fail(error); return; }
    openThread({ threadId: data, title });
    changed();
  }, [openThread]);

  const value = useMemo(() => ({ openList, openThread, openJob, openPerson, registerPageThread: setPageThread, pageThread }), [openList, openThread, openJob, openPerson, pageThread]);

  const closeAll = () => { setPanel(false); setSheet(null); };
  // leaving for a page where the full chat is showing closes the phone sheet
  useEffect(() => { setSheet(null); }, [pathname]);

  const showUI = !missing && !!staff?.id;
  return (
    <ChatDockContext.Provider value={value}>
      {children}
      {showUI && !mobile && (
        <DesktopDock
          staff={staff} rows={rows} unread={unread} loaded={loaded} panel={panel} setPanel={setPanel}
          windows={windows.filter((w) => w.threadId !== pageThread)} setWindows={setWindows} maxOpen={maxOpen}
          openThread={openThread} openPerson={openPerson} router={router}
        />
      )}
      {showUI && mobile && (
        <PhoneDock
          staff={staff} rows={rows} unread={unread} loaded={loaded} sheet={sheet} setSheet={setSheet} pathname={pathname}
          openThread={openThread} openPerson={openPerson} router={router} closeAll={closeAll}
        />
      )}
      {notice && <div className="chatdock-toast" role="alert">{notice}</div>}
    </ChatDockContext.Provider>
  );
}

// ---- shared pieces ---------------------------------------------------------------

function Avatar({ d, kind }) {
  return <span className={`cd-avatar k-${kind}`} aria-hidden="true">{d.initial}</span>;
}

function ConversationList({ staff, rows, loaded, onOpen, onNew, autoFocusSearch }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('all');
  const shown = useMemo(() => filterRows(orderRows(rows, staff.role), { query, mode }), [rows, staff.role, query, mode]);
  return (
    <div className="cd-list-wrap">
      <div className="cd-searchrow">
        <input className="cd-search" type="search" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={autoFocusSearch} aria-label="Search chats" />
        <button type="button" className="cd-new" onClick={onNew}>New</button>
      </div>
      <div className="cd-tabs" role="tablist">
        {[['all', 'All'], ['unread', 'Unread'], ['people', 'People'], ['jobs', 'Jobs']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      <div className="cd-rows">
        {!loaded && <p className="cd-empty">Loading…</p>}
        {loaded && shown.length === 0 && <p className="cd-empty">{rows.length === 0 ? 'No chats yet. Tap New to message someone.' : 'Nothing matches.'}</p>}
        {shown.map((r) => {
          const d = rowDisplay(r, staff.role);
          const n = r.muted ? 0 : r.unread || 0;
          const asks = r.pending_acks > 0;
          return (
            <button key={r.thread_id} type="button" className={`cd-row${n > 0 || asks ? ' unread' : ''}`} onClick={() => onOpen(r)}>
              <Avatar d={d} kind={r.kind} />
              <span className="cd-row-main">
                <span className="cd-row-title">{d.title}{r.muted && <em>Muted</em>}{asks && <b className="cd-ask">Needs OK</b>}</span>
                <span className="cd-row-last">{r.last_preview ? `${r.last_author ? `${r.last_author}: ` : ''}${r.last_preview}` : d.sub}</span>
              </span>
              <span className="cd-row-side">
                <span>{r.last_message_at ? timeAgo(r.last_message_at) : ''}</span>
                {n > 0 && <span className="cd-badge">{badgeText(n)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Everyone on staff. Office and owner reach a tech through the tech's shared Office line; "Private" opens a direct message.
function NewMessage({ staff, onPick, onBack }) {
  const [people, setPeople] = useState(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    getSupabase().from('staff_users').select('id,full_name,email,role,active').eq('active', true).then(({ data }) => { if (live) setPeople(peopleForPicker(data || [], staff)); }, () => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [staff]);
  const shown = (people || []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="cd-list-wrap">
      <div className="cd-searchrow">
        <button type="button" className="cd-back" onClick={onBack} aria-label="Back to chats">‹</button>
        <input className="cd-search" type="search" placeholder="Who do you want to message?" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus aria-label="Find a person" />
      </div>
      <div className="cd-rows">
        {people === null && <p className="cd-empty">Loading…</p>}
        {people && shown.length === 0 && <p className="cd-empty">No one found.</p>}
        {shown.map((p) => (
          <div key={p.id} className="cd-row person">
            <button type="button" className="cd-person-main" onClick={() => onPick(p, p.action)}>
              <span className="cd-avatar k-dm" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
              <span className="cd-row-main">
                <span className="cd-row-title">{p.name}</span>
                <span className="cd-row-last">{p.role === 'tech' ? (p.canPrivate ? 'Technician · Office line' : 'Technician') : p.role === 'owner' ? 'Owner' : 'Office'}</span>
              </span>
            </button>
            {p.canPrivate && <button type="button" className="cd-private" onClick={() => onPick(p, 'dm')}>Private</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- desktop ---------------------------------------------------------------------

function DesktopDock({ staff, rows, unread, loaded, panel, setPanel, windows, setWindows, maxOpen, openThread, openPerson, router }) {
  const [view, setView] = useState('list');
  const open = windows.filter((w) => !w.minimized);
  const tabs = windows.filter((w) => w.minimized);
  const base = panel ? 20 + 340 + 12 : 20 + 56 + 12;
  const go = (w) => { router.push(w.href || `/messages/${w.threadId}`); setWindows((x) => closeWindow(x, w.threadId)); };

  return (
    <div className="chatdock desktop-only" data-testid="chat-dock">
      {open.map((w, i) => (
        <section key={w.threadId} className="cd-window" style={{ right: base + (open.length - 1 - i) * (340 + 12) }} aria-label={`Chat with ${w.title}`}>
          <header className="cd-head cd-head-click" title="Click to minimize" onClick={(e) => { if (!e.target.closest('button')) setWindows((x) => minimizeWindow(x, w.threadId)); }}>
            <span className="cd-head-title">{w.title}</span>
            <button type="button" aria-label="Open full page" title="Open full page" onClick={() => go(w)}>⤢</button>
            <button type="button" aria-label="Minimize" title="Minimize" onClick={() => setWindows((x) => minimizeWindow(x, w.threadId))}>–</button>
            <button type="button" aria-label="Close" title="Close" onClick={() => setWindows((x) => closeWindow(x, w.threadId))}>×</button>
          </header>
          <ThreadPanel kind="thread" refId={w.threadId} staff={staff} compact active />
        </section>
      ))}

      {tabs.length > 0 && (
        <div className="cd-tabcol" style={{ right: 20 }}>
          {tabs.map((w) => {
            const r = rows.find((x) => x.thread_id === w.threadId);
            const n = r && !r.muted ? r.unread || 0 : 0;
            return (
              <span key={w.threadId} className="cd-tab">
                <button type="button" className="cd-tab-open" onClick={() => openThread(w)} title={w.title}>{w.title}{n > 0 && <span className="cd-badge">{badgeText(n)}</span>}</button>
                <button type="button" className="cd-tab-x" aria-label={`Close ${w.title}`} onClick={() => setWindows((x) => closeWindow(x, w.threadId))}>×</button>
              </span>
            );
          })}
        </div>
      )}

      {panel ? (
        <section className="cd-panel" aria-label="Chats">
          <header className="cd-head cd-head-click" title="Click to close" onClick={(e) => { if (!e.target.closest('button')) { setPanel(false); setView('list'); } }}>
            <span className="cd-head-title">Chats</span>
            <button type="button" aria-label="New message" title="New message" onClick={() => setView('new')}>＋</button>
            <button type="button" aria-label="Close chats" title="Close" onClick={() => { setPanel(false); setView('list'); }}>×</button>
          </header>
          {view === 'new' ? (
            <NewMessage staff={staff} onBack={() => setView('list')} onPick={(p, action) => { openPerson(p.id, { action, title: action === 'tech_line' ? p.name : p.name }); setView('list'); }} />
          ) : (
            <ConversationList staff={staff} rows={rows} loaded={loaded} onOpen={(r) => openThread({ threadId: r.thread_id, title: r.label })} onNew={() => setView('new')} />
          )}
        </section>
      ) : (
        <button type="button" className="cd-launcher" aria-label={`Chats${unread ? `, ${unread} waiting` : ''}`} onClick={() => setPanel(true)}>
          <ChatIcon />
          {unread > 0 && <span className="cd-badge launcher">{badgeText(unread)}</span>}
        </button>
      )}
    </div>
  );
}

// ---- phone -----------------------------------------------------------------------

function PhoneDock({ staff, rows, unread, loaded, sheet, setSheet, pathname, openThread, openPerson, router, closeAll }) {
  const ref = useRef(null);
  const hidden = bubbleHidden(pathname);
  const full = !!sheet?.full;

  // the keyboard coming up needs the room: go full screen
  useEffect(() => {
    if (!sheet || sheet.view !== 'thread') return undefined;
    const el = ref.current;
    const grow = () => setSheet((s) => (s && !s.full ? { ...s, full: true } : s));
    const onFocus = (e) => { if (e.target?.matches?.('textarea, input[type="text"], input:not([type])')) grow(); };
    el?.addEventListener('focusin', onFocus);
    const vv = window.visualViewport;
    const onResize = () => { if (vv && vv.height < window.innerHeight * 0.75) grow(); };
    vv?.addEventListener('resize', onResize);
    return () => { el?.removeEventListener('focusin', onFocus); vv?.removeEventListener('resize', onResize); };
  }, [sheet?.view, sheet?.thread?.threadId, setSheet]);

  // hold the page still behind a full-screen sheet
  useEffect(() => {
    if (!full) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [full]);

  return (
    <div className="chatdock mobile-only">
      {!sheet && !hidden && (
        <button type="button" className="cd-bubble" aria-label={`Chats${unread ? `, ${unread} waiting` : ''}`} onClick={() => setSheet({ view: 'list', full: false })}>
          <ChatIcon />
          {unread > 0 && <span className="cd-badge launcher">{badgeText(unread)}</span>}
        </button>
      )}
      {sheet && (
        <>
          <div className="cd-scrim" role="presentation" onClick={closeAll} />
          <section ref={ref} className={`cd-sheet${full ? ' full' : ''}`} aria-label="Chat">
            <div className="cd-grab" aria-hidden="true" />
            <header className="cd-head">
              {sheet.view !== 'list' && <button type="button" className="cd-back" aria-label="Back to chats" onClick={() => setSheet({ view: 'list', full })}>‹</button>}
              <span className="cd-head-title">{sheet.view === 'thread' ? sheet.thread.title : sheet.view === 'new' ? 'New message' : 'Chats'}</span>
              {sheet.view === 'list' && <button type="button" aria-label="New message" onClick={() => setSheet({ view: 'new', full })}>＋</button>}
              {sheet.view === 'thread' && (
                <button type="button" aria-label="Open full page" onClick={() => { const t = sheet.thread; closeAll(); router.push(t.href || `/messages/${t.threadId}`); }}>⤢</button>
              )}
              <button type="button" aria-label={full ? 'Shrink' : 'Expand'} onClick={() => setSheet({ ...sheet, full: !full })}>{full ? '⌄' : '⌃'}</button>
              <button type="button" aria-label="Close" onClick={closeAll}>×</button>
            </header>
            {sheet.view === 'list' && <ConversationList staff={staff} rows={rows} loaded={loaded} onOpen={(r) => openThread({ threadId: r.thread_id, title: r.label })} onNew={() => setSheet({ view: 'new', full })} />}
            {sheet.view === 'new' && <NewMessage staff={staff} onBack={() => setSheet({ view: 'list', full })} onPick={(p, action) => openPerson(p.id, { action, title: p.name })} />}
            {sheet.view === 'thread' && <ThreadPanel key={sheet.thread.threadId} kind="thread" refId={sheet.thread.threadId} staff={staff} compact active />}
          </section>
        </>
      )}
    </div>
  );
}
