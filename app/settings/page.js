'use client';

import { useEffect, useState } from 'react';
import AuthGate from '@/components/AuthGate';
import BusinessSection from '@/components/settings/BusinessSection';
import BrandingSection from '@/components/settings/BrandingSection';
import UsersSection from '@/components/settings/UsersSection';
import PriceListSection from '@/components/settings/PriceListSection';
import IntegrationsSection from '@/components/settings/IntegrationsSection';

const TABS = [
  { id: 'business', label: 'Business' },
  { id: 'users', label: 'Users' },
  { id: 'prices', label: 'Price list' },
  { id: 'integrations', label: 'Integrations' },
];

const validTab = (id) => (TABS.some((t) => t.id === id) ? id : 'business');

export default function SettingsPage() {
  const [tab, setTab] = useState('business');

  // The open tab is kept in the URL (#users, #integrations, ...) so a refresh or a shared link
  // lands on the same tab.
  useEffect(() => {
    const fromHash = () => setTab(validTab(window.location.hash.replace('#', '')));
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  function open(id) {
    setTab(id);
    window.history.replaceState(null, '', `#${id}`);
  }

  return (
    <AuthGate ownerOnly>
      {({ staff, token }) => (
        <>
          <h1>Settings</h1>
          <p className="sub">Business details, logo, staff, pricing and connections.</p>

          <div className="stage-tabs" role="tablist" aria-label="Settings sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`settings-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`settings-panel-${t.id}`}
                className={`stage-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => open(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
            {tab === 'business' && (
              <>
                <BusinessSection />
                <BrandingSection token={token} />
              </>
            )}
            {tab === 'users' && <UsersSection currentUserId={staff.id} token={token} />}
            {tab === 'prices' && <PriceListSection />}
            {tab === 'integrations' && <IntegrationsSection token={token} />}
          </div>
        </>
      )}
    </AuthGate>
  );
}
