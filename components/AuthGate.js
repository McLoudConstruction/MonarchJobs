'use client';

import { useAuth } from '@/lib/useAuth';
import AppShell from '@/components/AppShell';
import SetupNotice from '@/components/SetupNotice';

const OWNER_ONLY = ['owner'];

// Wraps a page: handles loading, pending-approval and role checks, then renders children
// with the shell. children is a function receiving { staff, token }.
export default function AuthGate({ ownerOnly = false, children }) {
  const auth = useAuth({ requireRole: ownerOnly ? OWNER_ONLY : undefined });

  if (auth.loading) return <div className="center-wrap"><p>Loading...</p></div>;

  if (auth.error === 'config') return <SetupNotice />;

  if (auth.error === 'pending') {
    return (
      <div className="center-wrap">
        <div className="card">
          <h2>Waiting for approval</h2>
          <p className="hint">Your account exists but has not been activated. Ask the owner to activate it in Settings.</p>
          <button className="secondary" onClick={auth.signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  if (auth.error === 'forbidden') {
    return (
      <AppShell staff={auth.staff} signOut={auth.signOut}>
        <div className="card"><h2>Not allowed</h2><p className="hint">Only the owner can open this page.</p></div>
      </AppShell>
    );
  }

  return (
    <AppShell staff={auth.staff} signOut={auth.signOut}>
      {children({ staff: auth.staff, token: auth.token })}
    </AppShell>
  );
}
