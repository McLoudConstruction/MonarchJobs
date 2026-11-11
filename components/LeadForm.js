'use client';

import AddressFields from '@/components/AddressFields';
import PhoneInput from '@/components/PhoneInput';
import { JOB_TYPES, CUSTOMER_TYPES } from '@/lib/format';
import { ContactExtra, AddressExtra, RestorationLoss, RestorationSafety, RestorationInsurance, CarpetService, CarpetCondition, CarpetTiming, TypeCard } from '@/components/LeadIntake';

// Columns a lead form reads and writes. name and address are filled in by the database from these.
export const LEAD_FIELDS = [
  'source', 'customer_type', 'first_name', 'last_name', 'company_name', 'phone', 'email',
  'street', 'unit', 'city', 'state', 'zip', 'gate_code', 'warnings',
  'job_type', 'service_requested', 'loss_summary', 'po_number', 'notes',
  'restoration_type', 'priority', 'intake',
];

export const BLANK_LEAD = {
  source: 'phone', customer_type: 'residential', first_name: '', last_name: '', company_name: '', phone: '', email: '',
  street: '', unit: '', city: '', state: 'MO', zip: '', gate_code: '', warnings: '',
  job_type: 'floor_cleaning', service_requested: '', loss_summary: '', po_number: '', notes: '',
  restoration_type: null, priority: null, intake: {},
};

export function pickLeadFields(obj) {
  return Object.fromEntries(LEAD_FIELDS.map((k) => [k, obj[k] ?? BLANK_LEAD[k]]));
}

// The three groups of fields, exported so the new-lead wizard can show them one step at a time.
// The lead page still shows them all together through LeadForm below.
export function ContactSection({ value, onChange, autoFocusName = false, extra = null }) {
  const set = (k) => (e) => onChange({ [k]: e.target.value });
  return (
    <div className="card">
      <h2>Contact</h2>
      <div className="grid2">
        <div className="field"><label>Type</label>
          <select value={value.customer_type} onChange={set('customer_type')}>
            {Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label>Company (if any)</label><input value={value.company_name} onChange={set('company_name')} /></div>
        <div className="field"><label>First name</label><input value={value.first_name} onChange={set('first_name')} autoComplete="off" autoFocus={autoFocusName} /></div>
        <div className="field"><label>Last name</label><input value={value.last_name} onChange={set('last_name')} autoComplete="off" /></div>
        <div className="field"><label>Phone</label><PhoneInput value={value.phone} onChange={set('phone')} /></div>
        <div className="field"><label>Email</label><input type="email" value={value.email} onChange={set('email')} /></div>
        <div className="field"><label>How did they reach us?</label>
          <select value={value.source} onChange={set('source')}>
            <option value="phone">Phone call</option><option value="web">Website</option>
            <option value="referral">Referral</option><option value="manual">Other</option>
          </select>
        </div>
        {extra}
      </div>
    </div>
  );
}

export function AddressSection({ value, onChange, after = null }) {
  const set = (k) => (e) => onChange({ [k]: e.target.value });
  return (
    <div className="card">
      <h2>Service address</h2>
      <AddressFields
        values={value}
        onChange={onChange}
        extra={<div className="field"><label>Gate code</label><input value={value.gate_code} onChange={set('gate_code')} /></div>}
      />
      <div className="field"><label>Warnings (pets, hazards)</label><input value={value.warnings} onChange={set('warnings')} /></div>
      {after}
    </div>
  );
}

// wide = the new-lead wizard's two-column layout; the lead page uses the stacked one.
export function ServiceSection({ value, onChange, wide = false }) {
  const set = (k) => (e) => onChange({ [k]: e.target.value });
  const jobType = (
    <div className="field"><label>Job type</label>
      <select value={value.job_type} onChange={set('job_type')}>
        {Object.entries(JOB_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  );
  const po = <div className="field"><label>PO number</label><input value={value.po_number} onChange={set('po_number')} /></div>;
  const requested = <div className="field"><label>Service requested</label><input placeholder="Carpet cleaning, water in kitchen..." value={value.service_requested} onChange={set('service_requested')} /></div>;
  const loss = <div className="field"><label>Loss summary for the tech</label><input placeholder="Short blurb: what happened, what to bring" value={value.loss_summary} onChange={set('loss_summary')} /></div>;
  const notes = <div className="field"><label>Internal notes</label><textarea value={value.notes} onChange={set('notes')} /><div className="note">Never shown to the customer. Carried onto the job.</div></div>;
  if (wide) {
    return (
      <div className="card">
        <h2>Service</h2>
        <div className="grid2">{jobType}{po}{requested}{loss}</div>
        {notes}
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Service</h2>
      <div className="grid2">{jobType}{po}</div>
      {requested}
      {loss}
      {notes}
    </div>
  );
}

// The Stage 1 sections for a kind, in the order the new-lead steps ask them.
export function IntakeSections({ kind, value, onChange }) {
  if (kind === 'restoration') {
    return (<><TypeCard value={value} onChange={onChange} /><RestorationLoss value={value} onChange={onChange} /><RestorationSafety value={value} onChange={onChange} /><RestorationInsurance value={value} onChange={onChange} /></>);
  }
  return (<><CarpetService value={value} onChange={onChange} /><CarpetCondition value={value} onChange={onChange} /><CarpetTiming value={value} onChange={onChange} /></>);
}

// Everything the office collects before a time is chosen. The parent supplies the <form> and buttons.
// kind is 'restoration' or 'carpet' for leads made through the new-lead picker; older leads show the plain form.
export default function LeadForm({ value, onChange, kind = '' }) {
  if (!kind) {
    return (
      <div className="lead-form">
        <ContactSection value={value} onChange={onChange} />
        <AddressSection value={value} onChange={onChange} />
        <ServiceSection value={value} onChange={onChange} />
      </div>
    );
  }
  return (
    <div className="lead-form">
      <ContactSection value={value} onChange={onChange} extra={<ContactExtra kind={kind} value={value} onChange={onChange} />} />
      <AddressSection value={value} onChange={onChange} after={<AddressExtra kind={kind} value={value} onChange={onChange} />} />
      <IntakeSections kind={kind} value={value} onChange={onChange} />
    </div>
  );
}
