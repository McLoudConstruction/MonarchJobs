'use client';

import { useState } from 'react';
import { ContactSection, AddressSection, ServiceSection } from '@/components/LeadForm';
import AppointmentPicker from '@/components/AppointmentPicker';
import { fmtDateTime, fmtDuration, leadDisplayName } from '@/lib/format';
import { displayPhone } from '@/lib/phone';

const STEPS = ['Customer', 'Service', 'Schedule'];

// The new-lead flow, built to be filled in on a live phone call: every step fits on one screen with
// no scrolling, and the Next / Save buttons stay in view at the bottom. Enter moves to the next step.
//   1 customer (contact + address), 2 service details, 3 schedule (optional).
// The parent owns the data and the saving; this only walks through the steps.
//   onSave()         saves the lead and opens it (add the estimate there, book later)
//   onSaveAndBook()  saves the lead and creates the work order from the appointment chosen
export default function LeadWizard({ value, onChange, subtitle, appt, onApptChange, staffList, conflicts, onConflicts, onSave, onSaveAndBook, busy, setMsg, msg }) {
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);

  const hasContact = [value.first_name, value.last_name, value.company_name, value.phone, value.email].some((x) => (x || '').trim());

  function go(n) {
    setMsg(null);
    if (n > 0 && !hasContact) { setMsg('Enter at least a name, phone or email first.'); setStep(0); return; }
    setStep(n);
    setReached((r) => Math.max(r, n));
  }

  const name = leadDisplayName(value) || displayPhone(value.phone) || '';
  const addressLine = [value.street, value.unit, value.city, [value.state, value.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  function submit(e) {
    e.preventDefault();
    if (step < 2) go(step + 1);
  }

  return (
    <form className="wizard" onSubmit={submit}>
      <div className="wizard-head">
        <h1>New lead</h1>
        {subtitle && <span className="wizard-sub">{subtitle}</span>}
        <ol className="wizard-steps">
          {STEPS.map((label, i) => (
            <li key={label} className={`${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`}>
              <button type="button" disabled={i > reached} onClick={() => go(i)}>
                <span className="wizard-num">{i < step ? '✓' : i + 1}</span>
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {step > 0 && (
        <div className="wizard-recap">
          <strong>{name || 'New lead'}</strong>
          {addressLine && <span> · {addressLine}</span>}
          <button type="button" className="linklike" onClick={() => go(0)}>Edit</button>
        </div>
      )}

      <div className="wizard-body">
        {step === 0 && (
          <div className="wizard-two lead-form">
            <ContactSection value={value} onChange={onChange} autoFocusName />
            <AddressSection value={value} onChange={onChange} />
          </div>
        )}

        {step === 1 && (
          <div className="lead-form">
            <ServiceSection value={value} onChange={onChange} wide />
          </div>
        )}

        {step === 2 && (
          <div className="card wizard-schedule">
            <div className="wizard-schedule-head">
              <h2>Schedule</h2>
              <span className="hint">
                Optional. Book a time now, or save the lead and add the estimate first.
                {appt.start && <> Booking: <strong>{fmtDateTime(new Date(appt.start))} for {fmtDuration(appt.duration)}</strong>.</>}
              </span>
            </div>
            <AppointmentPicker split value={appt} onChange={onApptChange} staffList={staffList} onConflicts={onConflicts} />
          </div>
        )}
      </div>

      <div className="wizard-actions">
        {msg && <div className="msg err wizard-msg">{msg}</div>}
        <span className="wizard-spacer" />
        {step > 0 && <button type="button" className="secondary" onClick={() => go(step - 1)}>Back</button>}
        <button type="button" className="secondary" disabled={busy} onClick={onSave}>{busy ? 'Saving...' : step === 2 ? 'Save lead, schedule later' : 'Save lead now'}</button>
        {step < 2 && <button type="submit" className="primary">Next: {STEPS[step + 1]}</button>}
        {step === 2 && <button type="button" className="primary" disabled={busy} onClick={onSaveAndBook}>{busy ? 'Booking...' : 'Save and create work order'}</button>}
      </div>
    </form>
  );
}
