'use client';

import { CLOCK_REASONS, OTHER_REASON } from '@/lib/clockReasons';

// "Why" for a time change request: a list of common reasons, and "Other" opens a text box.
// `form` holds { reasonChoice, reason }; `reason` is the text that gets sent (the chosen reason, or what was typed for Other).
export default function ReasonField({ form, setForm }) {
  const choice = form.reasonChoice || '';
  return (
    <>
      <label>Why
        <select value={choice} required onChange={(e) => { const c = e.target.value; setForm({ ...form, reasonChoice: c, reason: c === OTHER_REASON ? '' : c }); }}>
          <option value="" disabled>Choose a reason</option>
          {CLOCK_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {choice === OTHER_REASON && (
        <label>Tell us more
          <input value={form.reason} maxLength={300} autoFocus onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="What happened?" required />
        </label>
      )}
    </>
  );
}
