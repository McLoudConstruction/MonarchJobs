'use client';

import AuthGate from '@/components/AuthGate';
import BusinessSection from '@/components/settings/BusinessSection';
import UsersSection from '@/components/settings/UsersSection';
import IntegrationsSection from '@/components/settings/IntegrationsSection';

export default function SettingsPage() {
  return (
    <AuthGate ownerOnly>
      {({ staff, token }) => (
        <>
          <h1>Settings</h1>
          <p className="sub">Business details, staff, and payment connections.</p>
          <BusinessSection />
          <UsersSection currentUserId={staff.id} />
          <h2 style={{ margin: '28px 0 12px' }}>Integrations</h2>
          <IntegrationsSection token={token} />
        </>
      )}
    </AuthGate>
  );
}
