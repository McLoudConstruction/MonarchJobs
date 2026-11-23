'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/useAuth';
import { staffName } from '@/lib/userDisplay';
import { fmtTime } from '@/lib/format';

// One tech, one day: a suggested order that cuts the drive time. The time slots stay the same; jobs swap places.
// Nothing changes until Apply is tapped. Customers are not messaged, so check anyone who was already told a time.
export default function RouteOrderCard({ date, tech, techId, token, onApplied }) {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function post(action, extra = {}) {
    return apiFetch('/api/schedule/route-order', token, { method: 'POST', body: JSON.stringify({ action, date, tech_id: techId, ...extra }) });
  }
  async function check() {
    setBusy(true); setMsg(null);
    try { setPlan(await post('suggest')); } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }
  async function apply() {
    if (!window.confirm('Move these jobs into the new order? The time slots stay the same, but jobs swap places. The tech is told about changed visits. Customers are NOT told, so call anyone who was already given a time.')) return;
    setBusy(true); setMsg(null);
    try {
      const r = await post('apply', { visit_ids: plan.moves });
      setMsg({ err: false, text: `Done. ${r.applied} ${r.applied === 1 ? 'visit' : 'visits'} moved.` });
      setPlan(null); onApplied?.();
    } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }

  return (
    <div className="card">
      <h3>{tech ? staffName(tech) : 'Tech'}: shortest drive order</h3>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      {!plan && <button type="button" className="secondary" disabled={busy} onClick={check}>{busy ? 'Working it out...' : 'Suggest an order'}</button>}
      {plan && (
        <>
          {plan.message && <p className="hint">{plan.message}</p>}
          {plan.suggested.length > 0 && (
            <div className="grid2">
              <div><strong>Now</strong><ol>{plan.current.map((s) => <li key={s.id}>{fmtTime(s.start)} {s.label}</li>)}</ol></div>
              <div><strong>Suggested</strong><ol>{plan.suggested.map((s) => <li key={s.id}>{fmtTime(s.start)} {s.label}</li>)}</ol></div>
            </div>
          )}
          {plan.suggested.length > 0 && <p className="hint">Drive time between stops: about {plan.currentMinutes} min now, {plan.suggestedMinutes} min suggested{plan.ok ? ` (saves about ${plan.savedMinutes} min)` : ''}. The first stop stays first, and traffic is not considered.</p>}
          <div className="row">
            {plan.ok && <button type="button" className="primary" disabled={busy} onClick={apply}>{busy ? 'Applying...' : 'Apply this order'}</button>}
            <button type="button" className="secondary" disabled={busy} onClick={() => { setPlan(null); setMsg(null); }}>Close</button>
          </div>
        </>
      )}
    </div>
  );
}
