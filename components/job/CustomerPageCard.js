'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { fmtDateTime } from '@/lib/format';
import { PROBLEM_KINDS } from '@/lib/customerPage';

// Office only: the customer's care page link, send the care instructions now, and any problems the customer reported.
export default function CustomerPageCard({ jobId, token, staff, jobStatus }) {
  const [info, setInfo] = useState(null); // { token }
  const [problems, setProblems] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState({});

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [{ data: j, error }, { data: p }] = await Promise.all([
      sb.from('jobs').select('customer_token').eq('id', jobId).maybeSingle(),
      sb.from('job_problem_reports').select('*').eq('job_id', jobId).order('created_at', { ascending: false }),
    ]);
    if (error || !j) return; // migration 015 not run yet: the card stays hidden
    setInfo(j);
    setProblems(p || []);
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  if (!info) return null;
  const link = typeof window !== 'undefined' ? `${window.location.origin}/c/${info.customer_token}` : '';
  const finished = ['completed', 'closed'].includes(jobStatus);

  async function sendNow() {
    setBusy(true); setMsg(null);
    try {
      // apiFetch already reads the answer and throws on an error
      const body = await apiFetch(`/api/jobs/${jobId}/aftercare`, token, { method: 'POST' });
      setMsg({ err: !body.ok, text: body.ok ? 'Sent.' : `Nothing could be sent automatically. Text: ${body.results.sms.detail} Email: ${body.results.email.detail}` });
    } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }

  async function handle(p) {
    const { error } = await getSupabase().from('job_problem_reports').update({ status: 'handled', handled_at: new Date().toISOString(), handled_by: staff.id, handled_note: (note[p.id] || '').slice(0, 1000) }).eq('id', p.id);
    if (!error) await getSupabase().from('job_events').insert({ job_id: jobId, actor_id: staff.id, actor_email: staff.email, kind: 'problem_handled', details: { problem: p.kind } });
    load();
  }

  const open = problems.filter((p) => p.status === 'new');
  return (
    <div className="card">
      <h2>Customer page</h2>
      {open.length > 0 && <div className="banner flag">The customer reported {open.length === 1 ? 'a problem' : `${open.length} problems`}. Please follow up.</div>}
      {problems.map((p) => (
        <div key={p.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
          <strong>{PROBLEM_KINDS[p.kind]}</strong> <span className="muted">{fmtDateTime(p.created_at)}</span>
          {p.details && <div style={{ whiteSpace: 'pre-wrap' }}>{p.details}</div>}
          {p.contact_phone && <div className="muted">Call: {p.contact_phone}</div>}
          {p.status === 'new' ? (
            <div className="row" style={{ marginTop: 6 }}>
              <input placeholder="What you did (optional)" value={note[p.id] || ''} onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} style={{ flex: 1 }} />
              <button className="primary small" onClick={() => handle(p)}>Mark handled</button>
            </div>
          ) : <div className="muted">Handled {fmtDateTime(p.handled_at)}{p.handled_note ? `: ${p.handled_note}` : ''}</div>}
        </div>
      ))}
      <div className="field" style={{ marginTop: 10, marginBottom: 6 }}><label>Link to send the customer</label><div className="copybox">{link}</div></div>
      <div className="row">
        <button className="secondary small" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
        <a href={link} target="_blank" rel="noreferrer"><button type="button" className="secondary small">Open</button></a>
        <button className="secondary small" disabled={busy || !finished} onClick={sendNow}>{busy ? 'Sending...' : 'Send care instructions now'}</button>
      </div>
      {!finished && <p className="hint" style={{ marginTop: 6 }}>Care instructions go out automatically when the job is finished (if aftercare is set up in Settings).</p>}
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`} style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  );
}
