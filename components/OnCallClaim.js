'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';

// On an emergency lead nobody has taken yet: one button to say "I've got it", which stops the alerts for it.
export default function OnCallClaim({ leadId }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await getSupabase().from('oncall_alerts').select('claimed_at').eq('lead_id', leadId).maybeSingle();
    setOpen(!!data && !data.claimed_at);
  }, [leadId]);
  useEffect(() => { load(); }, [load]);
  if (!open) return null;
  return (
    <div className="banner flag">
      Nobody has taken this emergency lead yet.
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="primary" disabled={busy} onClick={async () => { setBusy(true); await getSupabase().rpc('oncall_claim', { p_lead: leadId }); setBusy(false); load(); }}>I&apos;ve got it</button>
      </div>
    </div>
  );
}
