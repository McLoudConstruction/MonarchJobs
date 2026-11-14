'use client';

import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import WaitingActions from '@/components/job/WaitingActions';
import WaitingPhotos from '@/components/job/WaitingPhotos';
import { useQueueStats, kick } from '@/lib/offlineClient';

// Everything saved on this phone that has not reached the server yet.
function QueueInner() {
  const s = useQueueStats();
  return (
    <>
      <h1>Waiting to upload</h1>
      <p className="sub">Pictures taken on this phone stay here until the server has confirmed each one.</p>
      <div className="card">
        <p>
          {s.pending + s.blocked + s.ops + s.opsBlocked === 0 ? 'Nothing is waiting. Everything has been uploaded.' : `${s.pending} picture${s.pending === 1 ? '' : 's'} and ${s.ops} tap${s.ops === 1 ? '' : 's'} or note${s.ops === 1 ? '' : 's'} waiting, ${s.blocked + s.opsBlocked} need attention.`}
          {!s.online && ' You are offline.'}
        </p>
        <button className="primary" onClick={() => kick({ force: true })} disabled={!s.online}>Upload now</button>{' '}
        <Link href="/dashboard"><button type="button" className="secondary">Back</button></Link>
      </div>
      <WaitingActions />
      <WaitingPhotos jobId={null} />
    </>
  );
}

export default function QueuePage() {
  return <AuthGate>{() => <QueueInner />}</AuthGate>;
}
