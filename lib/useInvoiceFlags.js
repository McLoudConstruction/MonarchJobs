'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { invoiceFlagCounts } from '@/lib/dashboardTabs';

const EMPTY = { pastDue: 0, pastDueCents: 0, drafts: 0, reload() {} };
const Ctx = createContext(EMPTY);

// One light query for the whole shell: how many invoices are past due or still drafts. Office and
// owner only. Refreshes when the page changes and when the tab comes back into view, so the badge on
// Dashboard stays honest without polling.
export function InvoiceFlagsProvider({ enabled, pathname, children }) {
  const [counts, setCounts] = useState({ pastDue: 0, pastDueCents: 0, drafts: 0 });

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data, error } = await getSupabase().from('invoices')
      .select('status,balance_cents,due_date').in('status', ['draft', 'sent', 'partial']).limit(2000);
    // a missing table just means the invoicing migration is not run yet: no flags
    if (!error) setCounts(invoiceFlagCounts(data || []));
  }, [enabled]);

  useEffect(() => { load(); }, [load, pathname]);
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [load]);

  const value = useMemo(() => ({ ...counts, reload: load }), [counts, load]);
  return createElement(Ctx.Provider, { value }, children);
}

export const useInvoiceFlags = () => useContext(Ctx);
