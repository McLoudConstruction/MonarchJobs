'use client';

import { RESTORATION_TYPES } from '@/lib/leadIntake';

// The first screen of a new lead: Restoration or Carpet. Restoration opens a second screen with its three types.
export default function LeadKindPicker({ kind, subtitle, onPickKind, onPickType, onBack }) {
  const second = kind === 'restoration';
  return (
    <div className="kind-picker">
      <div className="kind-head">
        <h1>{second ? 'What kind of restoration?' : 'New lead'}</h1>
        {subtitle && <span className="wizard-sub">{subtitle}</span>}
      </div>
      {!second && <p className="sub">What is the call about?</p>}

      {!second && (
        <div className="kind-grid two">
          <button type="button" className="kind-btn" onClick={() => onPickKind('restoration')}>
            <span className="kind-title">Restoration</span>
            <span className="kind-hint">Water, mold, fire and other losses</span>
          </button>
          <button type="button" className="kind-btn" onClick={() => onPickKind('carpet')}>
            <span className="kind-title">Carpet</span>
            <span className="kind-hint">Cleaning, stains and odor</span>
          </button>
        </div>
      )}

      {second && (
        <>
          <div className="kind-grid three">
            {Object.entries(RESTORATION_TYPES).map(([k, t]) => (
              <button key={k} type="button" className="kind-btn" onClick={() => onPickType(k)}>
                <span className="kind-title">{t.label}</span>
                <span className="kind-hint">{t.hint}</span>
              </button>
            ))}
          </div>
          <button type="button" className="linklike kind-back" onClick={onBack}>Back</button>
        </>
      )}
    </div>
  );
}
