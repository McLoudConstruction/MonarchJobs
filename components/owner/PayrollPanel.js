'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { dayStartInstant, dayKey } from '@/lib/shiftClock';
import { staffName } from '@/lib/userDisplay';
import {
  PERIOD_KINDS, DEFAULT_ANCHOR, periodFor, shiftPeriod, periodLabel, addDays, payrollSummary, payrollSummaryCsv, payrollDetailCsv, payrollFileName, hoursText,
} from '@/lib/payroll';
import SaveButton from '@/components/SaveButton';
import './owner.css';
import { useSaveStatus } from '@/lib/saveStatus';

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// Owner only. Hours by person for a pay period, as a CSV for the payroll service. Shift clock hours when a person clocked a shift,
// otherwise their job clock hours. The period setting (weekly, every two weeks, twice a month, monthly) is saved with the business.
export default function PayrollPanel() {
  const sb = getSupabase();
  const [cfg, setCfg] = useState(null); // { kind, anchor }
  const [period, setPeriod] = useState(null);
  const [data, setData] = useState({ loading: true });
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(null);
  const saveS = useSaveStatus();
  const [now] = useState(() => new Date());

  useEffect(() => {
    sb.from('settings').select('payroll_period,payroll_anchor').eq('id', 1).maybeSingle().then(({ data: s, error }) => {
      if (error) { setData({ loading: false, error: 'This needs the latest database update (042). Run it in Supabase, then reload.' }); return; }
      const c = { kind: s?.payroll_period || 'biweekly', anchor: s?.payroll_anchor || DEFAULT_ANCHOR };
      setCfg(c);
      // The period that just ended is what payroll is usually run for, so that is the one that opens.
      setPeriod(shiftPeriod(c.kind, c.anchor, periodFor(c.kind, c.anchor, dayKey(now)), -1));
    });
  }, [sb, now]);

  const load = useCallback(async () => {
    if (!period) return;
    const from = dayStartInstant(addDays(period.start, -1)).toISOString(); // a day either side so a shift past midnight is not cut off
    const to = dayStartInstant(addDays(period.end, 2)).toISOString();
    const [st, sh, br, se] = await Promise.all([
      sb.from('staff_users').select('id,full_name,email,role,active').order('full_name'),
      sb.from('shifts').select('*').gte('started_at', from).lt('started_at', to).is('voided_at', null),
      sb.from('shift_breaks').select('*').gte('started_at', from).lt('started_at', to).is('voided_at', null),
      sb.from('job_clock_sessions').select('id,staff_id,job_id,started_at,ended_at,voided_at').gte('started_at', from).lt('started_at', to).is('voided_at', null),
    ]);
    const bad = [st, se].find((r) => r.error);
    if (bad) { setData({ loading: false, error: bad.error.message }); return; }
    // The shift clock tables only exist after migration 025; without them the export still works from the job clock.
    setData({ loading: false, people: st.data || [], shifts: sh.error ? [] : sh.data || [], breaks: br.error ? [] : br.data || [], sessions: se.data || [] });
  }, [sb, period]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const summary = useMemo(() => {
    if (!period || !data.people) return [];
    const people = data.people.map((p) => ({ ...p, name: staffName(p) }));
    return payrollSummary({ people, shifts: data.shifts, breaks: data.breaks, sessions: data.sessions, period, now });
  }, [data, period, now]);

  async function saveCfg(next) {
    const { error } = await sb.from('settings').update({ payroll_period: next.kind, payroll_anchor: next.anchor }).eq('id', 1);
    if (error) { setMsg({ err: true, text: error.message }); return false; }
    setCfg(next); setPeriod(shiftPeriod(next.kind, next.anchor, periodFor(next.kind, next.anchor, dayKey(now)), -1)); setMsg(null);
    return true;
  }
  const [form, setForm] = useState(null);
  const startForm = () => setForm({ kind: cfg.kind, anchor: cfg.anchor });
  const submit = saveS.track(async (e) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.anchor)) { setMsg({ err: true, text: 'Pick the first day of a pay period.' }); return false; }
    const ok = await saveCfg(form);
    if (ok) setForm(null);
    return ok;
  });

  const total = summary.reduce((n, p) => n + p.payMinutes, 0);
  const flagged = summary.filter((p) => p.running || p.checks > 0).length;

  return (
    <section className="card" aria-label="Payroll export">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Payroll export</h2>
        <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Open'}</button>
      </div>
      {!open && <p className="hint" style={{ marginBottom: 0 }}>Hours by person for a pay period, as a CSV for your payroll service.</p>}
      {open && (
        <>
          {data.error && <div className="msg err" role="alert">{data.error}</div>}
          {cfg && period && (
            <>
              <div className="tc-week" style={{ marginTop: 12 }}>
                <button type="button" className="secondary" onClick={() => setPeriod(shiftPeriod(cfg.kind, cfg.anchor, period, -1))}>&larr; Earlier</button>
                <strong>{periodLabel(period)}</strong>
                <button type="button" className="secondary" onClick={() => setPeriod(shiftPeriod(cfg.kind, cfg.anchor, period, 1))} disabled={period.end >= dayKey(now)}>Later &rarr;</button>
                <span style={{ flex: 1 }} />
                <button type="button" className="secondary" onClick={startForm}>Pay period: {PERIOD_KINDS[cfg.kind].split(' (')[0].toLowerCase()}</button>
              </div>
              {form && (
                <form className="card tc-edit" onSubmit={submit}>
                  <label>How often is payroll run?
                    <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                      {Object.entries(PERIOD_KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </label>
                  {(form.kind === 'weekly' || form.kind === 'biweekly') && (
                    <label>First day of any pay period
                      <input type="date" value={form.anchor} onChange={(e) => setForm({ ...form, anchor: e.target.value })} required />
                    </label>
                  )}
                  <SaveButton save={saveS} idle="Save" className="primary" />
                  <button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button>
                </form>
              )}
              {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}
              {data.loading ? <p className="muted">Loading...</p> : summary.length === 0 ? <p className="muted">No hours in this pay period.</p> : (
                <>
                  <table className="own-table">
                    <thead><tr><th>Person</th><th className="n">Hours</th><th className="n">Days</th><th>From</th><th /></tr></thead>
                    <tbody>
                      {summary.map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td className="n"><strong>{hoursText(p.payMinutes)}</strong></td>
                          <td className="n">{p.daysWorked}</td>
                          <td className="muted">{p.source}</td>
                          <td>{p.running ? <span className="tab-count warn" title="A clock is still running">still clocked in</span> : p.checks > 0 ? <span className="tab-count warn" title="Something in this period does not add up. It is listed in the detail file.">{p.checks} to check</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td><strong>Total</strong></td><td className="n"><strong>{hoursText(total)}</strong></td><td /><td /><td /></tr></tfoot>
                  </table>
                  {flagged > 0 && <p className="hint">Fix anything marked before you download: a clock still running is counted up to now, and a change to a time entry shows in the next download.</p>}
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <button type="button" className="primary" onClick={() => download(payrollFileName(period, 'summary'), payrollSummaryCsv(summary, period))}>Download summary CSV</button>
                    <button type="button" className="secondary" onClick={() => download(payrollFileName(period, 'detail'), payrollDetailCsv(summary, period))}>Download daily detail</button>
                  </div>
                  <p className="hint">Hours are written as decimals (8.50 is eight and a half hours). Pay rates are not in the file: your payroll service applies them.</p>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
