'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';
import { inWindow } from '@/lib/ownerStats';
import { gobackCounts, reasonText } from '@/lib/visitReasons';
import './clockpanel.css';

// Owner Overview: go-backs, the second visits added because of a tech's failure (missed an area, redo, forgot equipment), counted per
// tech for the chosen period. They are logged from the Add visit popup on a job. Owner only. `bounds` is the dashboard's time period.
export default function GobackPanel({ bounds, rangeLabel }) {
  const sb = getSupabase();
  const [state, setState] = useState({ loading: true, error: '' });
  const [rows, setRows] = useState([]);
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const [g, st] = await Promise.all([
      sb.from('job_gobacks').select('id,job_id,tech_id,reason,reason_note,created_at,voided_at,job:jobs(id,job_number,customer:customers(display_name))').order('created_at', { ascending: false }).limit(500),
      sb.from('staff_users').select('id,full_name,email'),
    ]);
    if (g.error) { setState({ loading: false, error: /does not exist|schema cache/i.test(g.error.message) ? 'Go-backs are not set up yet. Run migration 026, then reload.' : g.error.message }); return; }
    setRows(g.data || []); setPeople(st.data || []);
    setState({ loading: false, error: '' });
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  const emailOf = (id) => people.find((x) => x.id === id)?.email || '';
  const name = (id) => { const p = people.find((x) => x.id === id); return p ? staffName(p) : 'Someone'; };
  const inRange = useMemo(() => rows.filter((r) => !r.voided_at && inWindow(r.created_at, bounds.from, bounds.to)), [rows, bounds.from, bounds.to]);
  const counts = useMemo(() => gobackCounts(inRange), [inRange]);

  async function remove(r) {
    const reason = window.prompt('Remove this go-back from the tech’s record? Use this if it was logged by mistake. Why? (optional)', '');
    if (reason === null) return;
    setBusy(r.id);
    const { error } = await sb.from('job_gobacks').update({ voided_at: new Date().toISOString(), void_reason: String(reason).trim().slice(0, 300) }).eq('id', r.id);
    setBusy('');
    if (error) { setState((s) => ({ ...s, error: error.message })); return; }
    await load();
  }

  if (state.loading) return null;
  if (state.error) return <div className="card"><h3>Go-backs</h3><div className="msg err">{state.error}</div></div>;

  return (
    <div className="card" id="gobacks">
      <h3>Go-backs, {rangeLabel.toLowerCase()}{inRange.length > 0 && <span className="cp-badge">{inRange.length}</span>}</h3>
      {inRange.length === 0 ? <p className="own-ok">No go-backs in this period.</p> : (
        <>
          <table className="own-table">
            <thead><tr><th>Tech</th><th className="n">Go-backs</th></tr></thead>
            <tbody>{counts.map((c) => <tr key={c.techId}><td>{name(c.techId)}{emailOf(c.techId) && <div className="muted" style={{ fontSize: 13 }}>{emailOf(c.techId)}</div>}</td><td className="n">{c.count}</td></tr>)}</tbody>
          </table>
          <h4 className="cp-sub">Latest</h4>
          {inRange.slice(0, 8).map((r) => (
            <div key={r.id} className="cp-req">
              <div className="cp-main">
                <div><strong>{name(r.tech_id)}</strong> · <Link href={`/jobs/${r.job_id}`}>#{r.job?.job_number} {r.job?.customer?.display_name}</Link></div>
                <div className="cp-times">{fmtDateTime(r.created_at)}</div>
                <div className="cp-why">{reasonText(r) || 'Go-back'}{r.reason !== 'other' && r.reason_note ? `: ${r.reason_note}` : ''}</div>
              </div>
              <div className="cp-buttons"><button type="button" className="secondary small" disabled={busy === r.id} onClick={() => remove(r)}>Remove</button></div>
            </div>
          ))}
        </>
      )}
      <p className="hint">Added from the Add visit popup when a second visit is the tech&rsquo;s fault. Only you and the office see this.</p>
    </div>
  );
}
