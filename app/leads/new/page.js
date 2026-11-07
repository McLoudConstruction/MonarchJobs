'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import LeadForm, { BLANK_LEAD, pickLeadFields } from '@/components/LeadForm';
import { getSupabase } from '@/lib/supabaseClient';

function NewLead({ staff }) {
  const router = useRouter();
  const customerId = useSearchParams().get('customer');
  const [form, setForm] = useState(BLANK_LEAD);
  const [customer, setCustomer] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Starting from an existing customer fills in who they are and their most recent address.
  useEffect(() => {
    if (!customerId) return;
    const sb = getSupabase();
    Promise.all([
      sb.from('customers').select('*').eq('id', customerId).maybeSingle(),
      sb.from('addresses').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1),
    ]).then(([c, a]) => {
      if (!c.data) return;
      setCustomer(c.data);
      const addr = a.data?.[0];
      setForm((f) => ({
        ...f,
        customer_type: c.data.customer_type, first_name: c.data.first_name, last_name: c.data.last_name,
        company_name: c.data.company_name, phone: c.data.phone, email: c.data.email,
        ...(addr ? { street: addr.street, unit: addr.unit, city: addr.city, state: addr.state, zip: addr.zip, gate_code: addr.gate_code, warnings: addr.warnings } : {}),
      }));
    });
  }, [customerId]);

  async function create(e) {
    e.preventDefault();
    setMsg(null);
    if (![form.first_name, form.last_name, form.company_name, form.phone, form.email].some((x) => x.trim())) {
      setMsg('Enter at least a name, phone or email.');
      return;
    }
    setBusy(true);
    const { data, error } = await getSupabase().from('leads')
      .insert({ ...pickLeadFields(form), customer_id: customer?.id ?? null, created_by: staff.id })
      .select('id').single();
    if (error) { setMsg(error.message); setBusy(false); return; }
    router.push(`/leads/${data.id}`);
  }

  return (
    <>
      <h1>New lead</h1>
      <p className="sub">{customer ? `For existing customer ${customer.display_name}.` : 'Enter what you know now. Add the estimate and pick a time on the next screen.'}</p>
      <form onSubmit={create} className="lead-new">
        <LeadForm value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        {msg && <div className="msg err">{msg}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save lead'}</button>
      </form>
    </>
  );
}

export default function NewLeadPage() {
  return (
    <AuthGate officeOnly>
      {({ staff }) => <Suspense fallback={<p>Loading...</p>}><NewLead staff={staff} /></Suspense>}
    </AuthGate>
  );
}
