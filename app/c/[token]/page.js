'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { fmtDateTime } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';
import { PROBLEM_KINDS, PLAN_INTERVALS } from '@/lib/customerPage';

// Customer-facing page after a cleaning: care instructions, the signed service record, report a problem,
// ask for another visit, stop reminders. No sign-in; the secret link is the access. No staff names are shown.
async function post(token, path, body) {
  const res = await fetch(`/api/public/customer/${token}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.');
  return json;
}

function ProblemForm({ token, onDone }) {
  const [kind, setKind] = useState('');
  const [details, setDetails] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await post(token, 'problem', { kind, details, phone }); onDone(); } catch (e2) { setErr(e2.message); setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="pk">What happened?</label>
        <select id="pk" value={kind} onChange={(e) => setKind(e.target.value)} required>
          <option value="">Choose...</option>
          {Object.entries(PROBLEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="pd">Tell us more (where, and when you noticed)</label>
        <textarea id="pd" className="sig-notes" rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </div>
      <div className="field"><label htmlFor="pp">Best phone number (optional)</label><input id="pp" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></div>
      {err && <div className="msg err">{err}</div>}
      <button className="primary big" style={{ width: '100%' }} disabled={busy || !kind}>{busy ? 'Sending...' : 'Send to us'}</button>
    </form>
  );
}

function RequestForm({ token, plan, onDone }) {
  const [months, setMonths] = useState('3');
  const [times, setTimes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await post(token, 'request', { kind: plan ? 'plan' : 'rebook', interval_months: months, preferred_times: times }); onDone(); } catch (e2) { setErr(e2.message); setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      {plan && (
        <div className="field"><label htmlFor="pm">How often?</label>
          <select id="pm" value={months} onChange={(e) => setMonths(e.target.value)}>
            {PLAN_INTERVALS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </select>
        </div>
      )}
      <div className="field"><label htmlFor="pt">Best days or times (optional)</label>
        <textarea id="pt" className="sig-notes" rows={3} maxLength={500} value={times} onChange={(e) => setTimes(e.target.value)} placeholder="Weekday mornings..." />
      </div>
      {err && <div className="msg err">{err}</div>}
      <button className="primary big" style={{ width: '100%' }} disabled={busy}>{busy ? 'Sending...' : plan ? 'Ask about a plan' : 'Request a visit'}</button>
    </form>
  );
}

function Record({ title, rec, labels, notRemoved, post: isPost }) {
  if (!rec) return null;
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="hint">Signed by {rec.signed_by} on {fmtDateTime(rec.signed_at)}.</p>
      {rec.rooms.map((r) => (
        <div key={r.id} style={{ margin: '10px 0' }}>
          <strong>{r.name}</strong>
          <span className="muted">{[r.fiber, r.traffic ? 'high traffic' : ''].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
          {r.notes && <div className="hint">{r.notes}</div>}
          {r.issues.map((s) => (
            <div key={s.id} style={{ paddingLeft: 12 }}>
              {s.type}{s.where ? `, ${s.where}` : ''}
              {isPost && s.result && <> — <strong style={{ color: notRemoved.includes(s.result) ? '#b45309' : undefined }}>{labels[s.result]}</strong></>}
              {isPost && s.note && <span className="muted"> ({s.note})</span>}
            </div>
          ))}
        </div>
      ))}
      {rec.notes && <p>{rec.notes}</p>}
      {isPost && rec.comments && <p><strong>Customer comments:</strong> {rec.comments}</p>}
    </div>
  );
}

export default function CustomerPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(null); // 'problem' | 'visit' | 'plan'
  const [done, setDone] = useState('');
  const [optBusy, setOptBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/public/customer/${token}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('This page is not available.');
        setData(body);
      })
      .catch((e) => setError(e.message));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="center-wrap"><div className="card"><h2>Page unavailable</h2><p className="hint">{error} If you think this is a mistake, please contact us.</p></div></div>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;

  const b = data.business;
  const contact = [displayPhone(b.phone), b.email].filter(Boolean).join(' · ');
  const hasCare = data.aftercare.notes.length > 0 || data.aftercare.dry_hours;

  async function toggleOpt() {
    setOptBusy(true);
    try { await post(token, 'optout', { opt_out: !data.opted_out }); await load(); } catch { /* shown on next load */ }
    setOptBusy(false);
  }

  return (
    <div className="page customer-page" style={{ maxWidth: 720 }}>
      {logoUrl(b.logo_path) && <img src={logoUrl(b.logo_path)} alt={b.business_name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 110, objectFit: 'contain', margin: '0 0 12px' }} />}
      <h1>{b.business_name || 'Your service'}</h1>
      <p className="sub">{contact}</p>
      <p>{data.first_name ? `Hi ${data.first_name}, thank you` : 'Thank you'} for choosing us.</p>

      {done && <div className="msg ok">{done}</div>}

      {hasCare && (
        <div className="card">
          <h2>Care instructions</h2>
          {data.aftercare.dry_hours && <p><strong>Your floors should be dry in about {data.aftercare.dry_hours} hour{data.aftercare.dry_hours === 1 ? '' : 's'}.</strong></p>}
          {data.aftercare.notes.map((n, i) => (
            <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{n.service && <strong>{n.service}<br /></strong>}{n.text}</p>
          ))}
        </div>
      )}

      <Record title="Before we cleaned" rec={data.before} labels={data.result_labels} notRemoved={data.not_removed} />
      <Record title="After we cleaned" rec={data.after} labels={data.result_labels} notRemoved={data.not_removed} post />

      <div className="card">
        <h2>Something not right?</h2>
        {data.problems.length > 0 && (
          <ul style={{ paddingLeft: 18 }}>
            {data.problems.map((p, i) => <li key={i}>{PROBLEM_KINDS[p.kind]}, reported {fmtDateTime(p.created_at)}: {p.status === 'handled' ? 'we have followed up' : 'we received it and will be in touch'}</li>)}
          </ul>
        )}
        {panel === 'problem'
          ? <ProblemForm token={token} onDone={() => { setPanel(null); setDone('Thank you. We got your message and will contact you soon.'); load(); }} />
          : <button className="primary big" style={{ width: '100%' }} onClick={() => setPanel('problem')}>Report a problem</button>}
      </div>

      <div className="card">
        <h2>Need us again?</h2>
        {panel === 'visit' ? <RequestForm token={token} onDone={() => { setPanel(null); setDone('Thank you. We will contact you to schedule.'); }} />
          : panel === 'plan' ? <RequestForm token={token} plan onDone={() => { setPanel(null); setDone('Thank you. We will contact you about a regular cleaning plan.'); }} />
          : (
            <div className="row">
              <button className="secondary" onClick={() => setPanel('visit')}>Request another cleaning</button>
              <button className="secondary" onClick={() => setPanel('plan')}>Ask about a regular plan</button>
            </div>
          )}
      </div>

      <p className="hint" style={{ textAlign: 'center' }}>
        {data.opted_out ? 'You will not get reminders from us.' : 'We may send you a reminder when your carpets are due.'}{' '}
        <button type="button" className="secondary small" disabled={optBusy} onClick={toggleOpt}>{data.opted_out ? 'Turn reminders back on' : 'Stop reminders'}</button>
      </p>
    </div>
  );
}
