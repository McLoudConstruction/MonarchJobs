'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { money } from '@/lib/format';
import { fmtDateTime, fmtTime } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';
import { estimateCents, inWindow } from '@/lib/ownerStats';
import { jobRevenue } from '@/lib/jobCost';
import { allottedMinutes, efficiency, efficiencyRollup, durationText, sessionMinutes } from '@/lib/jobClock';
import './clockpanel.css';

const dollars = (c) => money(c / 100);
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// Owner Overview: time changes waiting for approval, and carpet efficiency (dollars per clocked hour, clocked against the allotted
// time from the price list). Owner only. `bounds` is the dashboard's chosen time period (rangeBounds).
export default function ClockPanel({ bounds, rangeLabel }) {
  const sb = getSupabase();
  const [state, setState] = useState({ loading: true, error: '' });
  const [requests, setRequests] = useState([]);
  const [people, setPeople] = useState([]);
  const [jobs, setJobs] = useState([]);       // carpet jobs finished in the period, with their numbers worked out
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const [rq, st, jb] = await Promise.all([
      sb.from('job_time_edit_requests').select('*,job:jobs(id,job_number,customer:customers(display_name))').eq('status', 'pending').order('created_at'),
      sb.from('staff_users').select('id,full_name,email'),
      sb.from('jobs').select('id,job_number,completed_at,customer:customers(display_name)').eq('service', 'carpet').in('status', ['completed', 'closed']).not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(1000),
    ]);
    const failed = [rq, jb].find((r) => r.error);
    if (failed) { setState({ loading: false, error: /does not exist|schema cache/i.test(failed.error.message) ? 'The job clock is not set up yet. Run migration 024, then reload.' : failed.error.message }); return; }
    setRequests(rq.data || []); setPeople(st.data || []);

    const inRange = (jb.data || []).filter((j) => inWindow(j.completed_at, bounds.from, bounds.to));
    const ids = inRange.map((j) => j.id);
    const sessions = []; const invoices = []; const estimates = [];
    let rates = {};
    if (ids.length) {
      const parts = await Promise.all(chunk(ids, 80).map((c) => Promise.all([
        sb.from('job_clock_sessions').select('job_id,staff_id,started_at,ended_at,voided_at').in('job_id', c).is('voided_at', null).not('ended_at', 'is', null),
        sb.from('invoices').select('job_id,invoice_number,status,total_cents,created_at').in('job_id', c),
        sb.from('estimates').select('job_id,status,minimum_charge,chosen_tier,lines:estimate_lines(id,price_item_id,unit,quantity,unit_price,tier,optional,accepted)').in('job_id', c),
      ])));
      for (const [s, i, e] of parts) { sessions.push(...(s.data || [])); invoices.push(...(i.data || [])); estimates.push(...(e.data || [])); }
      const pi = await sb.from('price_items').select('id,minutes_per_unit');
      rates = Object.fromEntries((pi.data || []).map((x) => [x.id, x.minutes_per_unit]));
    }
    setJobs(inRange.map((j) => {
      const est = estimates.find((e) => e.job_id === j.id) || null;
      const byStaff = {};
      for (const s of sessions.filter((x) => x.job_id === j.id)) byStaff[s.staff_id] = (byStaff[s.staff_id] || 0) + sessionMinutes(s);
      const rev = jobRevenue(invoices.filter((i) => i.job_id === j.id), est ? estimateCents(est) : null);
      const allot = est ? allottedMinutes(est, rates) : { minutes: 0, any: false };
      return { jobId: j.id, number: j.job_number, customer: j.customer?.display_name || '', revenueCents: rev ? rev.cents : null, allottedMinutes: allot.any ? allot.minutes : 0, byStaff };
    }));
    setState({ loading: false, error: '' });
  }, [sb, bounds.from, bounds.to]);
  useEffect(() => { load(); }, [load]);

  const roll = useMemo(() => efficiencyRollup(jobs), [jobs]);
  const name = (id) => { const p = people.find((x) => x.id === id); return p ? staffName(p) : 'Someone'; };
  const worst = useMemo(() => jobs
    .map((j) => { const mins = Object.values(j.byStaff).reduce((a, b) => a + b, 0); return { ...j, mins, ...efficiency({ revenueCents: j.revenueCents, clockedMinutes: mins, allottedMinutes: j.allottedMinutes }) }; })
    .filter((j) => j.perHourCents != null)
    .sort((a, b) => a.perHourCents - b.perHourCents).slice(0, 5), [jobs]);

  async function decide(r, decision) {
    const note = decision === 'reject' ? window.prompt('Why is it not approved? (optional, the tech sees this)', '') : '';
    if (note === null) return;
    setBusy(r.id); setMsg(null);
    try {
      const token = (await sb.auth.getSession()).data?.session?.access_token;
      await apiFetch(`/api/clock/edit-requests/${r.id}`, token, { method: 'POST', body: JSON.stringify({ decision, note }) });
      setMsg({ text: decision === 'approve' ? 'Change approved.' : 'Change turned down.' });
      await load();
    } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy('');
  }

  if (state.loading) return null;
  if (state.error) return <div className="card"><h3>Job clock</h3><div className="msg err">{state.error}</div></div>;

  return (
    <>
      <div className="card" id="time-requests">
        <h3>Time changes to approve{requests.length > 0 && <span className="cp-badge">{requests.length}</span>}</h3>
        {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}
        {requests.length === 0 ? <p className="own-ok">Nothing waiting.</p> : requests.map((r) => (
          <div key={r.id} className="cp-req">
            <div className="cp-main">
              <div><strong>{name(r.requested_by)}</strong> · <Link href={`/jobs/${r.job_id}`}>#{r.job?.job_number} {r.job?.customer?.display_name}</Link></div>
              <div className="cp-times">Was {fmtDateTime(r.old_started_at)} to {fmtTime(r.old_ended_at)} ({durationText((new Date(r.old_ended_at) - new Date(r.old_started_at)) / 60000)})</div>
              <div className="cp-times">Asks {fmtDateTime(r.new_started_at)} to {fmtTime(r.new_ended_at)} ({durationText((new Date(r.new_ended_at) - new Date(r.new_started_at)) / 60000)})</div>
              <div className="cp-why">&ldquo;{r.reason}&rdquo;</div>
            </div>
            <div className="cp-buttons">
              <button type="button" className="primary" disabled={busy === r.id} onClick={() => decide(r, 'approve')}>Approve</button>
              <button type="button" className="secondary" disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Not approved</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Carpet efficiency, {rangeLabel.toLowerCase()}</h3>
        {roll.jobs === 0 ? (
          <p className="own-ok">No finished carpet jobs with clocked time and a price in this period yet.{roll.skipped > 0 ? ` (${roll.skipped} finished without a clock or a price.)` : ''}</p>
        ) : (
          <>
            <div className="own-tiles">
              <div className="own-tile"><div className="num">{roll.perHourCents == null ? '—' : dollars(roll.perHourCents)}</div><div className="lab">Per clocked hour</div></div>
              <div className="own-tile"><div className="num">{durationText(roll.clockedMinutes)}</div><div className="lab">Clocked on {roll.jobs} job{roll.jobs === 1 ? '' : 's'}</div></div>
              <div className="own-tile"><div className="num">{roll.usedPct == null ? '—' : `${roll.usedPct}%`}</div><div className="lab">Of allotted time used{roll.usedPct == null ? ' (no time rates set)' : ''}</div></div>
            </div>
            <table className="own-table">
              <thead><tr><th>Tech</th><th className="n">Jobs</th><th className="n">Hours</th><th className="n">Per hour</th></tr></thead>
              <tbody>
                {roll.byStaff.map((s) => (
                  <tr key={s.staffId}><td>{name(s.staffId)}</td><td className="n">{s.jobs}</td><td className="n">{(s.minutes / 60).toFixed(1)}</td><td className="n">{s.perHourCents == null ? '—' : dollars(s.perHourCents)}</td></tr>
                ))}
              </tbody>
            </table>
            {worst.length > 0 && (
              <>
                <h4 className="cp-sub">Lowest per hour</h4>
                <table className="own-table">
                  <tbody>
                    {worst.map((j) => (
                      <tr key={j.jobId}>
                        <td><Link href={`/jobs/${j.jobId}`}>#{j.number} {j.customer}</Link></td>
                        <td className="n">{dollars(j.perHourCents)}/hr</td>
                        <td className="n">{durationText(j.mins)}{j.allottedMinutes > 0 ? ` of ${durationText(j.allottedMinutes)}` : ''}{j.over ? ` (${j.diffMinutes} min over)` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <p className="hint">A job&rsquo;s price is its invoice, or its approved estimate when there is no invoice yet. When more than one person worked a job, its price is shared by each person&rsquo;s hours.{roll.skipped > 0 ? ` ${roll.skipped} finished job${roll.skipped === 1 ? '' : 's'} left out (no clock time or no price).` : ''}</p>
          </>
        )}
      </div>
    </>
  );
}
