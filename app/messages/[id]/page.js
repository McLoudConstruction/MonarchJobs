'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import Breadcrumb from '@/components/Breadcrumb';
import ThreadPanel from '@/components/chat/ThreadPanel';
import { useChatCenter } from '@/lib/useChatInbox';
import { rowDisplay } from '@/lib/chatDock';

// The full-size page for a direct message, a tech's Office line or a channel. (Job and lead chats are on their Chat tab.)
export default function MessagePage() {
  return <AuthGate>{({ staff }) => <Inner staff={staff} />}</AuthGate>;
}

function Inner({ staff }) {
  const { id } = useParams();
  const { rows, loaded } = useChatCenter();
  const row = rows.find((r) => r.thread_id === id);
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);
  // a job or lead chat opened by its id belongs on its own tab
  const home = row?.job_id ? `/jobs/${row.job_id}#thread` : row?.lead_id ? `/leads/${row.lead_id}#thread` : null;
  const d = row ? rowDisplay(row, staff.role) : null;

  return (
    <>
      <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Messages', href: '/activity#messages' }, { label: d?.title || 'Chat' }]} />
      <h1>{d?.title || 'Chat'}</h1>
      {d && <p className="muted" style={{ marginTop: -6 }}>{d.sub}</p>}
      {home && <p><Link href={home}>This chat is on its {row.job_id ? 'job' : 'lead'} page — open it there.</Link></p>}
      {!home && <div className="chat-page"><ThreadPanel kind="thread" refId={id} staff={staff} /></div>}
      {loaded && !row && waited && <p className="muted">If this chat does not open, you may not have access to it.</p>}
    </>
  );
}
