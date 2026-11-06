'use client';

import { useAuth } from '@/lib/useAuth';
import AppShell from '@/components/AppShell';
import SetupNotice from '@/components/SetupNotice';

// Constants so the hook's dependency does not change on every render.
const OWNER_ONLY = ['owner'];
const OFFICE_ONLY = ['owner', 'office'];

// Wraps a page: handles loading, pending-approval and role checks, then renders children
// with the shell. children is a function receiving { staff, token }.
export default function AuthGate({ ownerOnly = false, officeOnly = false, children }) {
  const auth = useAuth({ requireRole: ownerOnly ? OWNER_ONLY : officeOnly ? OFFICE_ONLY : undefined });

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
        <div className="card"><h2>Not allowed</h2><p className="hint">Your role does not have access to this page.</p></div>
      </AppShell>
    );
  }

  return (
    <AppShell staff={auth.staff} signOut={auth.signOut}>
      {children({ staff: auth.staff, token: auth.token })}
    </AppShell>
  );
}
