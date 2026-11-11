'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import LeadWizard from '@/components/LeadWizard';
import LeadKindPicker from '@/components/LeadKindPicker';
import { BLANK_LEAD, pickLeadFields } from '@/components/LeadForm';
import { defaultAppointment } from '@/components/AppointmentPicker';
import { getSupabase } from '@/lib/supabaseClient';
import { fromLocalInput } from '@/lib/format';
import { JOB_TYPE_FOR_KIND, RESTORATION_TYPES, finishLead } from '@/lib/leadIntake';

const BOOK_ERRORS = {
  TECH_DOUBLE_BOOKED: 'That tech is already booked then. Tick "Book anyway" or pick another time or tech.',
  LEAD_NEEDS_ADDRESS: 'Add the service address before creating the work order.',
  NOT_ALLOWED: 'Only the office and owner can create work orders.',
};
const friendly = (m) => BOOK_ERRORS[Object.keys(BOOK_ERRORS).find((k) => (m || '').includes(k))] || m;

// Mitigation and extraction are urgent work: the schedule starts at the current time, rounded to the hour.
const startsNow = (kind, type) => kind === 'restoration' && (type === 'mitigation' || type === 'extraction');

// Keeps ?kind=restoration&type=extraction in the address bar so a refresh stays on the same screen.
function rememberChoice(kind, type, customerId) {
  const q = new URLSearchParams();
  if (customerId) q.set('customer', customerId);
  if (kind) q.set('kind', kind);
  if (type) q.set('type', type);
  const s = q.toString();
  window.history.replaceState(null, '', `/leads/new${s ? `?${s}` : ''}`);
}

function NewLead({ staff }) {
  const router = useRouter();
  const params = useSearchParams();
  const startKind = params.get('kind');
  const startType = params.get('type');
  const [customerId, setCustomerId] = useState(params.get('customer'));
  const [kind, setKind] = useState(startKind === 'restoration' || startKind === 'carpet' ? startKind : '');
  const [form, setForm] = useState(() => ({
    ...BLANK_LEAD,
    restoration_type: RESTORATION_TYPES[startType] ? startType : null,
    job_type: JOB_TYPE_FOR_KIND[startKind] || BLANK_LEAD.job_type,
  }));
  const [customer, setCustomer] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [appt, setAppt] = useState(() => defaultAppointment({ nearestHour: startsNow(startKind, startType) }));
  const apptTouched = useRef(false);
  const [conflicts, setConflicts] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // Starting from an existing customer (from their page, or picked from the match hint) fills in who
  // they are and their most recent address.
  const loadCustomer = useCallback((id) => {
    const sb = getSupabase();
    Promise.all([
      sb.from('customers').select('*').eq('id', id).maybeSingle(),
      sb.from('addresses').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(1),
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
  }, []);

  useEffect(() => { if (customerId) loadCustomer(customerId); }, [customerId, loadCustomer]);

  // techs for the schedule step
  useEffect(() => {
    getSupabase().from('staff_users').select('id,full_name,email,role').eq('active', true).order('full_name')
      .then(({ data }) => setStaffList(data || []));
  }, []);

  function pickKind(k) {
    setKind(k);
    setForm((f) => ({ ...f, job_type: JOB_TYPE_FOR_KIND[k], restoration_type: k === 'restoration' ? f.restoration_type : null }));
    rememberChoice(k, null, customerId);
  }
  function pickType(t) {
    setForm((f) => ({ ...f, restoration_type: t }));
    if (!apptTouched.current) setAppt(defaultAppointment({ nearestHour: startsNow('restoration', t) }));
    rememberChoice('restoration', t, customerId);
  }
  // Back to the first screen. Nothing typed so far is lost.
  function restart() {
    setKind('');
    setForm((f) => ({ ...f, restoration_type: null }));
    rememberChoice(null, null, customerId);
  }
  // A carpet caller who mentions water damage: same person and address, restoration questions.
  function switchToRestoration() {
    setKind('restoration');
    setForm((f) => ({ ...f, job_type: JOB_TYPE_FOR_KIND.restoration, restoration_type: null }));
    rememberChoice('restoration', null, customerId);
  }

  const hasContact = () => [form.first_name, form.last_name, form.company_name, form.phone, form.email].some((x) => (x || '').trim());

  // Saves the lead and returns its id, or null (with a message) if it failed.
  async function insertLead() {
    if (!hasContact()) { setMsg('Enter at least a name, phone or email.'); return null; }
    const { data, error } = await getSupabase().from('leads')
      .insert({ ...pickLeadFields(finishLead(form, kind)), customer_id: customer?.id ?? null, created_by: staff.id })
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

  const subtitle = customer ? `for existing customer ${customer.display_name}` : '';
  const needsPicker = !kind || (kind === 'restoration' && !form.restoration_type);

  if (needsPicker) {
    return (
      <LeadKindPicker
        kind={kind}
        subtitle={subtitle}
        onPickKind={pickKind}
        onPickType={pickType}
        onBack={restart}
      />
    );
  }

  return (
    <LeadWizard
      kind={kind}
      subtitle={subtitle}
      value={form}
      onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
      appt={appt}
      onApptChange={(a) => { apptTouched.current = true; setAppt(a); }}
      onEnterSchedule={() => { if (!apptTouched.current) setAppt(defaultAppointment({ nearestHour: startsNow(kind, form.restoration_type) })); }}
      staffList={staffList}
      conflicts={conflicts}
      onConflicts={setConflicts}
      onSave={save}
      onSaveAndBook={saveAndBook}
      busy={busy}
      msg={msg}
      setMsg={setMsg}
      linkedCustomerId={customer?.id}
      onUseCustomer={(id) => { setCustomerId(id); rememberChoice(kind, form.restoration_type, id); }}
      onRestart={restart}
      onSwitchToRestoration={switchToRestoration}
    />
  );
}

export default function NewLeadPage() {
  return (
    <AuthGate officeOnly>
      {({ staff }) => <Suspense fallback={<p>Loading...</p>}><NewLead staff={staff} /></Suspense>}
    </AuthGate>
  );
}
