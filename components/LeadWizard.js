'use client';

import { useState } from 'react';
import { ContactSection, AddressSection, ServiceSection } from '@/components/LeadForm';
import AppointmentPicker from '@/components/AppointmentPicker';
import { fmtDateTime, fmtDuration, leadDisplayName } from '@/lib/format';
import { displayPhone } from '@/lib/phone';

const STEPS = [
  { key: 'customer', label: 'Customer', sub: 'Contact and address' },
  { key: 'service', label: 'Service', sub: 'What needs doing' },
  { key: 'schedule', label: 'Schedule', sub: 'Pick a time' },
];

// The new-lead flow, one step at a time on a wide layout:
// 1 customer (contact + address), 2 service details, 3 schedule (optional).
// The parent owns the data and the saving; this only walks through the steps.
//   onSave()            saves the lead and opens it (add the estimate there, book later)
//   onSaveAndBook()     saves the lead and creates the work order from the appointment chosen
export default function LeadWizard({ value, onChange, appt, onApptChange, staffList, conflicts, onConflicts, onSave, onSaveAndBook, busy, setMsg, msg }) {
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);

  const hasContact = [value.first_name, value.last_name, value.company_name, value.phone, value.email].some((x) => (x || '').trim());

  function go(n) {
    setMsg(null);
    if (n > 0 && !hasContact) { setMsg('Enter at least a name, phone or email first.'); setStep(0); return; }
    setStep(n);
    setReached((r) => Math.max(r, n));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  const name = leadDisplayName(value) || displayPhone(value.phone) || '';
  const addressLine = [value.street, value.unit, value.city, [value.state, value.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <div className="wizard">
      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`}>
            <button type="button" disabled={i > reached} onClick={() => go(i)}>
              <span className="wizard-num">{i < step ? '✓' : i + 1}</span>
              <span className="wizard-label">{s.label}<small>{s.sub}</small></span>
            </button>
          </li>
        ))}
      </ol>

      {step > 0 && (
        <div className="wizard-recap">
          <strong>{name || 'New lead'}</strong>
          {addressLine && <span> · {addressLine}</span>}
          <button type="button" className="linklike" onClick={() => go(0)}>Edit</button>
        </div>
      )}

      {step === 0 && (
        <div className="wizard-body wizard-two lead-form">
          <ContactSection value={value} onChange={onChange} />
          <AddressSection value={value} onChange={onChange} />
        </div>
      )}

      {step === 1 && (
        <div className="wizard-body lead-form">
          <ServiceSection value={value} onChange={onChange} />
        </div>
      )}

      {step === 2 && (
        <div className="wizard-body">
          <div className="card">
            <h2>Schedule</h2>
            <p className="hint">
              Optional. Pick a start time and tech to book it now, or save the lead and add the estimate first.
              You can always book from the lead later.
            </p>
            <AppointmentPicker value={appt} onChange={onApptChange} staffList={staffList} onConflicts={onConflicts} />
            {appt.start && (
              <p className="hint" style={{ marginTop: 10 }}>
                Booking would be <strong>{fmtDateTime(new Date(appt.start))} for {fmtDuration(appt.duration)}</strong>
                {conflicts.length > 0 && !appt.override ? ' (tech is double-booked, see above)' : ''}.
              </p>
            )}
          </div>
        </div>
      )}

      {msg && <div className="msg err">{msg}</div>}

      <div className="wizard-actions">
        {step > 0 && <button type="button" className="secondary" onClick={() => go(step - 1)}>Back</button>}
        <span className="wizard-spacer" />
        {step < 2 && <button type="button" className="primary" onClick={() => go(step + 1)}>Next: {STEPS[step + 1].label}</button>}
        {step === 1 && <button type="button" className="secondary" disabled={busy} onClick={onSave}>{busy ? 'Saving...' : 'Save lead, schedule later'}</button>}
        {step === 2 && <button type="button" className="secondary" disabled={busy} onClick={onSave}>{busy ? 'Saving...' : 'Save lead, schedule later'}</button>}
        {step === 2 && <button type="button" className="primary" disabled={busy} onClick={onSaveAndBook}>{busy ? 'Booking...' : 'Save and create work order'}</button>}
        {step === 0 && <button type="button" className="secondary" disabled={busy} onClick={onSave}>{busy ? 'Saving...' : 'Save lead now'}</button>}
      </div>
    </div>
  );
}
