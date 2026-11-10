'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import LeadWizard from '@/components/LeadWizard';
import { BLANK_LEAD, pickLeadFields } from '@/components/LeadForm';
import { defaultAppointment } from '@/components/AppointmentPicker';
import { getSupabase } from '@/lib/supabaseClient';
import { fromLocalInput } from '@/lib/format';

const BOOK_ERRORS = {
  TECH_DOUBLE_BOOKED: 'That tech is already booked then. Tick "Book anyway" or pick another time or tech.',
  LEAD_NEEDS_ADDRESS: 'Add the service address before creating the work order.',
  NOT_ALLOWED: 'Only the office and owner can create work orders.',
};
const friendly = (m) => BOOK_ERRORS[Object.keys(BOOK_ERRORS).find((k) => (m || '').includes(k))] || m;

function NewLead({ staff }) {
  const router = useRouter();
  const customerId = useSearchParams().get('customer');
  const [form, setForm] = useState(BLANK_LEAD);
  const [customer, setCustomer] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [appt, setAppt] = useState(defaultAppointment);
  const [conflicts, setConflicts] = useState([]);
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

  // techs for the schedule step
  useEffect(() => {
    getSupabase().from('staff_users').select('id,full_name,email,role').eq('active', true).order('full_name')
      .then(({ data }) => setStaffList(data || []));
  }, []);

  const hasContact = () => [form.first_name, form.last_name, form.company_name, form.phone, form.email].some((x) => (x || '').trim());

  // Saves the lead and returns its id, or null (with a message) if it failed.
  async function insertLead() {
    if (!hasContact()) { setMsg('Enter at least a name, phone or email.'); return null; }
    const { data, error } = await getSupabase().from('leads')
      .insert({ ...pickLeadFields(form), customer_id: customer?.id ?? null, created_by: staff.id })
      .select('id').single();
    if (error) { setMsg(error.message); return null; }
    return data.id;
  }

  async function save() {
    setMsg(null);
    setBusy(true);
    const id = await insertLead();
    if (!id) { setBusy(false); return; }
    router.push(`/leads/${id}`);
  }

  async function saveAndBook() {
    setMsg(null);
    if (!form.street.trim()) { setMsg(BOOK_ERRORS.LEAD_NEEDS_ADDRESS); return; }
    if (conflicts.length && !appt.override) { setMsg(BOOK_ERRORS.TECH_DOUBLE_BOOKED); return; }
    setBusy(true);
    const id = await insertLead();
    if (!id) { setBusy(false); return; }
    const { data: jobId, error } = await getSupabase().rpc('create_work_order', {
      p_lead: id,
      p_starts_at: fromLocalInput(appt.start),
      p_duration_minutes: appt.duration,
      p_tech: appt.techId || null,
      p_allow_conflict: !!appt.override,
    });
    if (error) {
      // the lead is saved; open it so nothing typed is lost
      router.push(`/leads/${id}`);
      return;
    }
    router.push(`/jobs/${jobId}`);
  }

  return (
    <>
      <LeadWizard
        subtitle={customer ? `for existing customer ${customer.display_name}` : ''}
        value={form}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        appt={appt}
        onApptChange={setAppt}
        staffList={staffList}
        conflicts={conflicts}
        onConflicts={setConflicts}
        onSave={save}
        onSaveAndBook={saveAndBook}
        busy={busy}
        msg={msg}
        setMsg={setMsg}
      />
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
