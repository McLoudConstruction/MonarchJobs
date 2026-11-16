'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import PopupModal from '@/components/PopupModal';
import NotificationPreferences from '@/components/NotificationPreferences';
import { usePushControl, PushChip, PushCard } from '@/components/PushControl';
import { SettingsIcon } from '@/components/icons';
import { useNotificationCenter } from '@/lib/useNotifications';
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

function Inner({ staff, token }) {
  const { items, unread, loaded, hasMore, markRead, markAllRead, loadMore } = useNotificationCenter();
  const push = usePushControl(token);
  const [filter, setFilter] = useState('all');
  const [prefsOpen, setPrefsOpen] = useState(false);

  const shown = items.filter((n) => (filter === 'unread' ? !n.read_at && !n.resolved_at : filter === 'action' ? n.tier === 'action' && !n.resolved_at : true));
  const open = (n) => { if (!n.read_at) markRead([n.id]); };

  return (
    <>
      <div className="notif-head">
        <h1>Notifications</h1>
        <div className="notif-head-actions">
          <PushChip push={push} />
          {unread > 0 && <button type="button" className="secondary small" onClick={markAllRead}>Mark all read</button>}
          <button type="button" className="secondary small notif-settings-btn" onClick={() => setPrefsOpen(true)} aria-haspopup="dialog" aria-label="Notification settings">
            <SettingsIcon width="16" height="16" aria-hidden="true" /> <span className="notif-settings-label">Settings</span>
          </button>
        </div>
      </div>

      <PushCard push={push} />

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

      <PopupModal open={prefsOpen} onClose={() => setPrefsOpen(false)} title="What you are notified about">
        <NotificationPreferences staff={staff} />
      </PopupModal>
    </>
  );
}

export default function NotificationsPage() {
  return <AuthGate>{({ staff, token }) => <Inner staff={staff} token={token} />}</AuthGate>;
}
