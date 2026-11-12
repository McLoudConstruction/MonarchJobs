'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import PushControl from '@/components/PushControl';
import { getSupabase } from '@/lib/supabaseClient';
import { useNotificationCenter } from '@/lib/useNotifications';
import { NOTIFICATION_TYPES, TIERS, groupedTypesForRole, isTypeEnabled, timeAgo } from '@/lib/notificationTypes';

function Item({ n, onOpen }) {
  const t = NOTIFICATION_TYPES[n.type];
  const done = !!n.resolved_at;
  const unread = !n.read_at && !done;
  return (
    <Link href={n.url || '/dashboard'} className={`notif-item tier-${n.tier} ${unread ? 'unread' : ''} ${done ? 'done' : ''}`} onClick={() => onOpen(n)}>
      <span className="notif-dot" aria-hidden="true" />
      <span className="notif-main">
        <span className="notif-title">
          {n.title}
          {t?.grouped && n.repeat_count > 1 && <span className="notif-count"> x{n.repeat_count}</span>}
        </span>
        {n.body && <span className="notif-body">{n.body}</span>}
        <span className="notif-meta">
          {done ? <span className="notif-pill done">Done</span> : n.tier === 'action' ? <span className="notif-pill action">Needs action</span> : n.tier === 'alert' ? <span className="notif-pill alert">Alert</span> : null}
          <span>{timeAgo(n.at)}</span>
        </span>
      </span>
    </Link>
  );
}

function Preferences({ staff }) {
  const [prefs, setPrefs] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getSupabase().from('notification_preferences').select('type,enabled').eq('user_id', staff.id)
      .then(({ data, error }) => {
        if (error) { setErr(error.message); return; }
        setPrefs(Object.fromEntries((data || []).map((r) => [r.type, r.enabled])));
      });
  }, [staff.id]);

  async function toggle(type, enabled) {
    setErr('');
    setPrefs((p) => ({ ...p, [type]: enabled }));
    const { error } = await getSupabase().from('notification_preferences')
      .upsert({ user_id: staff.id, type, enabled }, { onConflict: 'user_id,type' });
    if (error) { setErr(error.message); setPrefs((p) => ({ ...p, [type]: !enabled })); }
  }

  const groups = groupedTypesForRole(staff.role);
  return (
    <div className="card">
      <h3>What you are notified about</h3>
      <p className="hint">Turn off anything you do not want. This applies to the bell and to push on every phone.</p>
      {err && <div className="msg err">{err}</div>}
      {!prefs ? <p className="muted">Loading...</p> : groups.map((g) => (
        <div key={g.group} className="notif-pref-group">
          <div className="notif-pref-heading">{g.group}</div>
          {g.types.map((t) => (
            <label key={t.key} className="notif-pref-row">
              <input type="checkbox" checked={isTypeEnabled(prefs, t.key)} onChange={(e) => toggle(t.key, e.target.checked)} />
              <span><strong>{t.label}</strong><small>{t.hint}</small></span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function Inner({ staff, token }) {
  const { items, unread, loaded, hasMore, markRead, markAllRead, loadMore } = useNotificationCenter();
  const [filter, setFilter] = useState('all');

  const shown = items.filter((n) => (filter === 'unread' ? !n.read_at && !n.resolved_at : filter === 'action' ? n.tier === 'action' && !n.resolved_at : true));
  const open = (n) => { if (!n.read_at) markRead([n.id]); };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Notifications</h1>
        {unread > 0 && <button type="button" className="secondary small" onClick={markAllRead}>Mark all read</button>}
      </div>

      <PushControl token={token} />

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

      <Preferences staff={staff} />
    </>
  );
}

export default function NotificationsPage() {
  return <AuthGate>{({ staff, token }) => <Inner staff={staff} token={token} />}</AuthGate>;
}
