'use client';

import { useState } from 'react';
import { ContactSection, AddressSection } from '@/components/LeadForm';
import {
  ContactExtra, AddressExtra, CustomerMatchHint,
  RestorationLoss, RestorationSafety, RestorationInsurance, CarpetService, CarpetCondition, CarpetTiming,
} from '@/components/LeadIntake';
import AppointmentPicker from '@/components/AppointmentPicker';
import { fmtDateTime, fmtDuration, leadDisplayName } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { KINDS, RESTORATION_TYPES, STEPS } from '@/lib/leadIntake';

// The new-lead flow, built to be filled in on a live phone call. The steps depend on the kind of lead:
//   Restoration: Customer, Loss, Safety & site, Insurance, Schedule
//   Carpet:      Customer, Service, Condition, Timing, Schedule
// Every step is one or two cards of dropdowns, chips and short fields, and Save lead now is always in view.
// The parent owns the data and the saving; this only walks through the steps.
//   onSave()         saves the lead and opens it (add the estimate there, book later)
//   onSaveAndBook()  saves the lead and creates the work order from the appointment chosen
export default function LeadWizard({
  kind, value, onChange, subtitle, appt, onApptChange, staffList, conflicts, onConflicts, onSave, onSaveAndBook,
  busy, setMsg, msg, onEnterSchedule, linkedCustomerId, onUseCustomer, onRestart, onSwitchToRestoration,
}) {
  const steps = STEPS[kind];
  const last = steps.length - 1;
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);

  const hasContact = [value.first_name, value.last_name, value.company_name, value.phone, value.email].some((x) => (x || '').trim());

  function go(n) {
    setMsg(null);
    if (n > 0 && !hasContact) { setMsg('Enter at least a name, phone or email first.'); setStep(0); return; }
    if (n === last) onEnterSchedule?.();
    setStep(n);
    setReached((r) => Math.max(r, n));
  }

  const name = leadDisplayName(value) || displayPhone(value.phone) || '';
  const addressLine = [value.street, value.unit, value.city, [value.state, value.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const kindLabel = kind === 'restoration' && value.restoration_type
    ? `Restoration · ${RESTORATION_TYPES[value.restoration_type].label}`
    : KINDS[kind];

  function submit(e) {
    e.preventDefault();
    if (step < last) go(step + 1);
  }

  const common = { value, onChange };

  return (
    <form className="wizard" onSubmit={submit}>
      <div className="wizard-head">
        <h1>New lead</h1>
        <span className="kind-pill">{kindLabel} <button type="button" className="linklike" onClick={onRestart}>Change</button></span>
        {subtitle && <span className="wizard-sub">{subtitle}</span>}
        <ol className="wizard-steps">
          {steps.map((label, i) => (
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
          <>
            <div className="wizard-two lead-form">
              <ContactSection {...common} autoFocusName extra={<ContactExtra kind={kind} {...common} />}
                hint={<CustomerMatchHint value={value} linkedId={linkedCustomerId} onUse={onUseCustomer} />} />
              <AddressSection {...common} after={<AddressExtra kind={kind} {...common} />} />
            </div>
          </>
        )}

        {step > 0 && step < last && (
          <div className="wizard-two lead-form">
            {kind === 'restoration' && step === 1 && <RestorationLoss {...common} />}
            {kind === 'restoration' && step === 2 && <RestorationSafety {...common} />}
            {kind === 'restoration' && step === 3 && <RestorationInsurance {...common} />}
            {kind === 'carpet' && step === 1 && <CarpetService {...common} />}
            {kind === 'carpet' && step === 2 && <CarpetCondition {...common} onSwitchToRestoration={onSwitchToRestoration} />}
            {kind === 'carpet' && step === 3 && <CarpetTiming {...common} />}
          </div>
        )}

        {step === last && (
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
        <button type="button" className="secondary" disabled={busy} onClick={onSave}>{busy ? 'Saving...' : step === last ? 'Save lead, schedule later' : 'Save lead now'}</button>
        {step < last && <button type="submit" className="primary">Next: {steps[step + 1]}</button>}
        {step === last && <button type="button" className="primary" disabled={busy} onClick={onSaveAndBook}>{busy ? 'Booking...' : 'Save and create work order'}</button>}
      </div>
    </form>
  );
}
