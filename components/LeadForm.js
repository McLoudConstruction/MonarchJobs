'use client';

import AddressFields from '@/components/AddressFields';
import PhoneInput from '@/components/PhoneInput';
import { JOB_TYPES, CUSTOMER_TYPES } from '@/lib/format';

// Columns a lead form reads and writes. name and address are filled in by the database from these.
export const LEAD_FIELDS = [
  'source', 'customer_type', 'first_name', 'last_name', 'company_name', 'phone', 'email',
  'street', 'unit', 'city', 'state', 'zip', 'gate_code', 'warnings',
  'job_type', 'service_requested', 'loss_summary', 'po_number', 'notes',
];

export const BLANK_LEAD = {
  source: 'phone', customer_type: 'residential', first_name: '', last_name: '', company_name: '', phone: '', email: '',
  street: '', unit: '', city: '', state: 'MO', zip: '', gate_code: '', warnings: '',
  job_type: 'floor_cleaning', service_requested: '', loss_summary: '', po_number: '', notes: '',
};

export function pickLeadFields(obj) {
  return Object.fromEntries(LEAD_FIELDS.map((k) => [k, obj[k] ?? BLANK_LEAD[k]]));
}

// Everything the office collects before a time is chosen. The parent supplies the <form> and buttons.
export default function LeadForm({ value, onChange }) {
  const set = (k) => (e) => onChange({ [k]: e.target.value });
  return (
    <div className="lead-form">
      <div className="card">
        <h2>Contact</h2>
        <div className="grid2">
          <div className="field"><label>Type</label>
            <select value={value.customer_type} onChange={set('customer_type')}>
              {Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field"><label>Company (if any)</label><input value={value.company_name} onChange={set('company_name')} /></div>
          <div className="field"><label>First name</label><input value={value.first_name} onChange={set('first_name')} autoComplete="off" /></div>
          <div className="field"><label>Last name</label><input value={value.last_name} onChange={set('last_name')} autoComplete="off" /></div>
          <div className="field"><label>Phone</label><PhoneInput value={value.phone} onChange={set('phone')} /></div>
          <div className="field"><label>Email</label><input type="email" value={value.email} onChange={set('email')} /></div>
          <div className="field"><label>How did they reach us?</label>
            <select value={value.source} onChange={set('source')}>
              <option value="phone">Phone call</option><option value="web">Website</option>
              <option value="referral">Referral</option><option value="manual">Other</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Service address</h2>
        <AddressFields values={value} onChange={onChange} />
        <div className="grid2">
          <div className="field"><label>Gate code</label><input value={value.gate_code} onChange={set('gate_code')} /></div>
          <div className="field"><label>Warnings (pets, hazards)</label><input value={value.warnings} onChange={set('warnings')} /></div>
        </div>
      </div>

      <div className="card">
        <h2>Service</h2>
        <div className="grid2">
          <div className="field"><label>Job type</label>
            <select value={value.job_type} onChange={set('job_type')}>
              {Object.entries(JOB_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field"><label>PO number</label><input value={value.po_number} onChange={set('po_number')} /></div>
        </div>
        <div className="field"><label>Service requested</label><input placeholder="Carpet cleaning, water in kitchen..." value={value.service_requested} onChange={set('service_requested')} /></div>
        <div className="field"><label>Loss summary for the tech</label><input placeholder="Short blurb: what happened, what to bring" value={value.loss_summary} onChange={set('loss_summary')} /></div>
        <div className="field"><label>Internal notes</label><textarea value={value.notes} onChange={set('notes')} /><div className="note">Never shown to the customer. Carried onto the job.</div></div>
      </div>
    </div>
  );
}
