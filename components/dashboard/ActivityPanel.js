'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PopupModal from '@/components/PopupModal';
import NotificationPreferences from '@/components/NotificationPreferences';
import { usePushControl, PushChip, PushCard } from '@/components/PushControl';
import { SettingsIcon } from '@/components/icons';
import { useNotificationCenter } from '@/lib/useNotifications';
import { useChatCenter } from '@/lib/useChatInbox';
import { threadHref } from '@/lib/chat';
import '@/components/chat/chat.css';
import { NOTIFICATION_TYPES, TIERS, timeAgo } from '@/lib/notificationTypes';

// One compact row per notification: the title and when on one line, a single line of detail under it.
function Item({ n, onOpen }) {
  const t = NOTIFICATION_TYPES[n.type];
  const done = !!n.resolved_at;
  const unread = !n.read_at && !done;
  const pill = done ? <span className="notif-pill done">Done</span>
    : n.tier === 'action' ? <span className="notif-pill action">Needs action</span>
    : n.tier === 'alert' ? <span className="notif-pill alert">Alert</span> : null;
  return (
    <Link href={n.url || '/dashboard'} className={`notif-item tier-${n.tier} ${unread ? 'unread' : ''} ${done ? 'done' : ''}`} onClick={() => onOpen(n)}>
      <span className="notif-dot" aria-hidden="true" />
      <span className="notif-main">
        <span className="notif-line">
          <span className="notif-title">
            {n.title}
            {t?.grouped && n.repeat_count > 1 && <span className="notif-count"> x{n.repeat_count}</span>}
          </span>
          <span className="notif-time">{timeAgo(n.at)}</span>
        </span>
        {(pill || n.body) && (
          <span className="notif-sub">
            {pill}
            {n.body && <span className="notif-body">{n.body}</span>}
          </span>
        )}
      </span>
    </Link>
  );
}

function ThreadItem({ r }) {
  const asks = r.pending_acks > 0;
  const unread = !r.muted && r.unread > 0;
  return (
    <Link href={threadHref(r)} className={`inbox-item ${unread || asks ? 'unread' : ''}`}>
      <span className="inbox-main">
        <span className="inbox-title">
          {r.label}
          {r.kind === 'lead' && <span className="inbox-pill quiet">Lead</span>}
          {asks && <span className="inbox-pill ask">{r.pending_acks === 1 ? 'Needs your OK' : `${r.pending_acks} need your OK`}</span>}
          {unread && <span className="inbox-pill">{r.unread} new</span>}
          {r.muted && <span className="inbox-pill quiet">Muted</span>}
        </span>
        <span className="inbox-last">{r.last_author ? `${r.last_author}: ` : ''}{r.last_preview || 'No messages yet'}</span>
      </span>
      <span className="inbox-side">{timeAgo(r.last_message_at)}</span>
    </Link>
  );
}

export default function ActivityPanel({ staff, token }) {
  const { items, unread, loaded, hasMore, markRead, markAllRead, loadMore } = useNotificationCenter();
  const chat = useChatCenter();
  const chatUnread = chat.unread || 0;
  const [view, setView] = useState('alerts'); // 'alerts' | 'messages'
  const [picked, setPicked] = useState(false);
  // Old links (#messages) and first load: land on messages when only chats are waiting.
  useEffect(() => {
    if (window.location.hash === '#messages') { setView('messages'); setPicked(true); }
  }, []);
  useEffect(() => {
    if (picked || !loaded || !chat.loaded) return;
    setPicked(true);
    if (chatUnread > 0 && unread === 0) setView('messages');
  }, [picked, loaded, chat.loaded, chatUnread, unread]);
  const pickView = (v) => { setView(v); setPicked(true); window.history.replaceState(null, '', v === 'messages' ? '#messages' : '#alerts'); };
  const push = usePushControl(token);
  const [filter, setFilter] = useState('all');
  const [prefsOpen, setPrefsOpen] = useState(false);

  const shown = items.filter((n) => (filter === 'unread' ? !n.read_at && !n.resolved_at : filter === 'action' ? n.tier === 'action' && !n.resolved_at : true));
  const open = (n) => { if (!n.read_at) markRead([n.id]); };

  return (
    <>
      <div className="notif-head">
        <p className="sub" style={{ margin: 0 }}>Alerts, schedule changes and chats that need you.</p>
        <div className="notif-head-actions">
          <PushChip push={push} />
          {view === 'alerts' && unread > 0 && <button type="button" className="secondary small" onClick={markAllRead}>Mark all read</button>}
          <button type="button" className="secondary small notif-settings-btn" onClick={() => setPrefsOpen(true)} aria-haspopup="dialog" aria-label="Notification settings">
            <SettingsIcon width="16" height="16" aria-hidden="true" /> <span className="notif-settings-label">Settings</span>
          </button>
        </div>
      </div>

      <PushCard push={push} />

      <div className="tabs activity-tabs" role="tablist" aria-label="Activity">
        <button type="button" role="tab" aria-selected={view === 'alerts'} className={view === 'alerts' ? 'on' : ''} onClick={() => pickView('alerts')}>Alerts{unread > 0 ? ` (${unread})` : ''}</button>
        <button type="button" role="tab" aria-selected={view === 'messages'} className={view === 'messages' ? 'on' : ''} onClick={() => pickView('messages')}>Messages{chatUnread > 0 ? ` (${chatUnread})` : ''}</button>
      </div>

      {view === 'messages' && (
        <>
          <p className="muted">Chats on jobs and leads you are part of. Open one to read it and reply.</p>
          {chat.missing && <div className="msg err">Chat is not switched on yet. Run migration 017_staff_messaging.sql in Supabase, then reload.</div>}
          {!chat.missing && !chat.loaded && <p className="muted">Loading...</p>}
          {!chat.missing && chat.loaded && chat.rows.length === 0 && (
            <div className="card"><p className="muted">Nothing here yet. Open a job or lead and use its Chat tab. Once you write in a chat, or someone tags you or asks you to confirm a change, it shows up here.</p></div>
          )}
          <div className="inbox-list">{chat.rows.map((r) => <ThreadItem key={r.thread_id} r={r} />)}</div>
        </>
      )}

      {view === 'alerts' && (
      <div className="card notif-card">
        <div className="tabs" role="tablist" aria-label="Filter notifications">
          {[['all', 'All'], ['unread', `Unread${unread ? ` (${unread})` : ''}`], ['action', TIERS.action.label]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        {!loaded ? <p className="muted">Loading...</p> : shown.length === 0 ? (
          <p className="empty-state">{filter === 'all' ? 'Nothing yet. New leads, schedule changes and job updates will show up here.' : 'Nothing here.'}</p>
        ) : (
          <div className="notif-list">{shown.map((n) => <Item key={n.id} n={n} onOpen={open} />)}</div>
        )}
        {hasMore && <div className="notif-more"><button type="button" className="secondary small" onClick={loadMore}>Show older</button></div>}
      </div>
      )}

      <PopupModal open={prefsOpen} onClose={() => setPrefsOpen(false)} title="What you are notified about">
        <NotificationPreferences staff={staff} />
      </PopupModal>
    </>
  );
}
