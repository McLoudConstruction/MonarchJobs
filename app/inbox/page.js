'use client';

import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { useChatCenter } from '@/lib/useChatInbox';
import { threadHref } from '@/lib/chat';
import { timeAgo } from '@/lib/notificationTypes';
import '@/components/chat/chat.css';

function Item({ r }) {
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

function Inner() {
  const { rows, loaded, missing } = useChatCenter();
  return (
    <>
      <h1>Inbox</h1>
      <p className="muted">Chats on jobs and leads you are part of. Open one to read it and reply. Staff only.</p>
      {missing && <div className="msg err">Chat is not switched on yet. Run migration 017_staff_messaging.sql in Supabase, then reload.</div>}
      {!missing && !loaded && <p className="muted">Loading…</p>}
      {!missing && loaded && rows.length === 0 && (
        <div className="card">
          <p className="muted">Nothing here yet. Open a job or lead and use its Chat tab. Once you write in a chat, or someone tags you or asks you to confirm a change, it shows up here.</p>
        </div>
      )}
      <div className="inbox-list">
        {rows.map((r) => <Item key={r.thread_id} r={r} />)}
      </div>
    </>
  );
}

export default function InboxPage() {
  return <AuthGate>{() => <Inner />}</AuthGate>;
}
