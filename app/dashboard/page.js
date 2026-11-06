'use client';

import AuthGate from '@/components/AuthGate';

export default function DashboardPage() {
  return (
    <AuthGate>
      {({ staff }) => (
        <>
          <h1>Dashboard</h1>
          <p className="sub">Welcome{staff.full_name ? `, ${staff.full_name}` : ''}.</p>
          <div className="card">
            <h2>Build status</h2>
            <p className="hint">The foundation is in place. Jobs, scheduling and invoicing arrive in the next phases.</p>
            <ul className="phases">
              <li><strong>Phase 0 (done):</strong> sign in, roles, settings, Stripe and Square connections</li>
              <li><strong>Phase 1:</strong> leads, quotes, booking, dispatch, job record, invoices, payments, notifications</li>
              <li><strong>Phase 2:</strong> sketch, photos, signatures, equipment, checklist</li>
              <li><strong>Phase 3:</strong> moisture maps, dry logs, return-visit invoicing, daily burn</li>
              <li><strong>Phase 4:</strong> rebooking outreach, reviews, late interest</li>
            </ul>
          </div>
        </>
      )}
    </AuthGate>
  );
}
