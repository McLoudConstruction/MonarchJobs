'use client';

import AuthGate from '@/components/AuthGate';
import OwnerDashboard from '@/components/owner/OwnerDashboard';

// Owner only. The page reads the same tables the other pages do, so this is about who sees the numbers, not extra access.
export default function OwnerPage() {
  return <AuthGate ownerOnly>{() => <OwnerDashboard />}</AuthGate>;
}
