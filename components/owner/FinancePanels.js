'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { money } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';
import { todayIn } from '@/lib/invoice';
import { loadJobMoney } from '@/lib/jobMarginsClient';
import { marginByGroup, marginCsvRows, LOSS_ORDER, LOSS_GROUPS, SERVICE_ORDER, SERVICE_GROUPS } from '@/lib/jobMargins';
import { COMMISSION_BASIS, cleanRule, commissionReport, commissionCsv } from '@/lib/commission';
import { forecast, bookedWork, WEEKS } from '@/lib/cashFlow';
import { estimateCents } from '@/lib/ownerStats';
import { toCsv } from '@/lib/csv';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';
import './owner.css';

const dollars = (c) => money((c || 0) / 100);
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const missing = (e) => /does not exist|schema cache/i.test(e?.message || String(e));

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// One read of the jobs in the period, shared by the two panels that need it.
function useJobMoney(bounds) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' });
  const load = useCallback(async () => {
    if (!bounds) return; // another panel on the page is doing the read
    setState((s) => ({ ...s, loading: true }));
    try { setState({ loading: false, rows: await loadJobMoney(getSupabase(), bounds), error: '' }); }
    catch (e) { setState({ loading: false, rows: [], error: e.message || 'Could not read the jobs.' }); }
  }, [bounds]);
  useEffect(() => { load(); }, [load]);
  return state;
}

// ----------------------------------------------------------------------------------------------------- profit by kind of work
export function ProfitByLossPanel({ bounds, rangeLabel, money: shared }) {
  const own = useJobMoney(shared ? null : bounds);
  const { loading, rows, error } = shared || own;
  const [by, setBy] = useState('loss');
  const result = useMemo(() => marginByGroup(
    rows.filter((r) => r.finishedInPeriod).map((r) => ({ jobId: r.jobId, group: by === 'loss' ? r.group : r.serviceKey, revenueCents: r.revenueCents, costCents: r.costCents, marginCents: r.marginCents })),
    by === 'loss' ? { order: LOSS_ORDER, labels: LOSS_GROUPS } : { order: SERVICE_ORDER, labels: SERVICE_GROUPS },
  ), [rows, by]);

  return (
    <section className="card" aria-label="Profit by kind of work">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Profit by kind of work, {rangeLabel.toLowerCase()}</h3>
        <div className="own-range" role="group" aria-label="Group jobs by">
          <button type="button" className={by === 'loss' ? 'on' : ''} aria-pressed={by === 'loss'} onClick={() => setBy('loss')}>Kind of loss</button>
          <button type="button" className={by === 'service' ? 'on' : ''} aria-pressed={by === 'service'} onClick={() => setBy('service')}>Service</button>
        </div>
      </div>
      {error ? <div className="msg err" role="alert">{error}</div> : loading ? <p className="muted">Loading...</p> : result.groups.length === 0 ? (
        <p className="own-ok">No finished jobs with a price in this period.</p>
      ) : (
        <>
          <table className="own-table">
            <thead><tr><th>Kind of work</th><th className="n">Jobs</th><th className="n">Revenue</th><th className="n">Cost</th><th className="n">Margin</th><th className="n">Margin %</th></tr></thead>
            <tbody>
              {result.groups.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td><td className="n">{g.jobs}</td><td className="n">{dollars(g.revenueCents)}</td><td className="n">{dollars(g.costCents)}</td>
                  <td className="n"><strong>{dollars(g.marginCents)}</strong></td><td className="n">{g.marginPercent == null ? '—' : `${g.marginPercent}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td><strong>All finished jobs</strong></td><td className="n">{result.totals.jobs}</td><td className="n">{dollars(result.totals.revenueCents)}</td><td className="n">{dollars(result.totals.costCents)}</td><td className="n"><strong>{dollars(result.totals.marginCents)}</strong></td><td className="n">{result.totals.marginPercent == null ? '—' : `${result.totals.marginPercent}%`}</td></tr></tfoot>
          </table>
          <p className="hint">
            Revenue is the job&rsquo;s newest invoice, or its approved estimate when nothing is invoiced. Cost is what was logged on the job&rsquo;s Costs tab (purchases, hours at each person&rsquo;s cost rate, equipment days at the daily rates), so a job with nothing logged looks more profitable than it was.
            {result.skipped > 0 ? ` ${result.skipped} finished job${result.skipped === 1 ? ' has' : 's have'} no price and ${result.skipped === 1 ? 'is' : 'are'} left out.` : ''}
          </p>
          <button type="button" className="secondary" onClick={() => download(`profit-by-kind-of-work-${by}.csv`, toCsv(marginCsvRows(result)))}>Download CSV</button>
        </>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------- commission
export function CommissionPanel({ bounds, rangeLabel, money: shared }) {
  const sb = getSupabase();
  const own = useJobMoney(shared ? null : bounds);
  const { loading, rows, error } = shared || own;
  const [people, setPeople] = useState([]);
  const [rules, setRules] = useState({});   // saved rules: { staffId: { basis, percent } }
  const [form, setForm] = useState({});     // what is typed: { staffId: { basis, percent } }
  const [msg, setMsg] = useState(null);
  const [setup, setSetup] = useState('');
  const [editing, setEditing] = useState(false);
  const saveS = useSaveStatus();

  const loadRules = useCallback(async () => {
    const [st, rl] = await Promise.all([
      sb.from('staff_users').select('id,full_name,email,role,active').order('full_name'),
      sb.from('commission_rules').select('staff_id,basis,percent'),
    ]);
    if (rl.error) { setSetup(missing(rl.error) ? 'Commission rules need the latest database update (042). Run it in Supabase, then reload.' : rl.error.message); return; }
    const list = (st.data || []).map((p) => ({ ...p, name: staffName(p) }));
    setPeople(list);
    const saved = Object.fromEntries((rl.data || []).map((r) => [r.staff_id, { basis: r.basis, percent: Number(r.percent) }]));
    setRules(saved);
    setForm(Object.fromEntries(list.filter((p) => p.active).map((p) => [p.id, { basis: saved[p.id]?.basis || 'paid', percent: saved[p.id] ? String(saved[p.id].percent) : '' }])));
  }, [sb]);
  useEffect(() => { loadRules(); }, [loadRules]);

  const report = useMemo(() => commissionReport({ rules, people, jobs: rows }), [rules, people, rows]);

  const save = saveS.track(async (e) => {
    e.preventDefault(); setMsg(null);
    const upserts = []; const removes = [];
    for (const [id, f] of Object.entries(form)) {
      if (String(f.percent).trim() === '') { if (rules[id]) removes.push(id); continue; }
      const c = cleanRule(f);
      if (c.error) { setMsg({ err: true, text: `${people.find((p) => p.id === id)?.name || 'Someone'}: ${c.error}` }); return false; }
      upserts.push({ staff_id: id, ...c.value });
    }
    if (upserts.length) { const { error: e1 } = await sb.from('commission_rules').upsert(upserts, { onConflict: 'staff_id' }); if (e1) { setMsg({ err: true, text: e1.message }); return false; } }
    if (removes.length) { const { error: e2 } = await sb.from('commission_rules').delete().in('staff_id', removes); if (e2) { setMsg({ err: true, text: e2.message }); return false; } }
    await loadRules(); setEditing(false);
    return true;
  });

  const unmatched = report.unassigned.reduce((n, j) => n + j.basisCents, 0);
  return (
    <section className="card" aria-label="Commission">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Commission, {rangeLabel.toLowerCase()}</h3>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="secondary" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? 'Close rules' : 'Set rules'}</button>
          <button type="button" className="secondary" disabled={!report.people.length} onClick={() => download(`commission-${rangeLabel.toLowerCase().replace(/\s+/g, '-')}.csv`, commissionCsv(report, rangeLabel))}>Download CSV</button>
        </div>
      </div>
      {setup && <div className="msg err" role="alert">{setup}</div>}
      {editing && !setup && (
        <form onSubmit={save} style={{ margin: '12px 0' }}>
          <table className="own-table">
            <thead><tr><th>Person</th><th>Percent of</th><th className="n">Percent</th></tr></thead>
            <tbody>
              {people.filter((p) => p.active).map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td><select aria-label={`What ${p.name}'s percent is taken from`} value={form[p.id]?.basis || 'paid'} onChange={(e) => setForm({ ...form, [p.id]: { ...form[p.id], basis: e.target.value } })}>
                    {Object.entries(COMMISSION_BASIS).map(([k, v]) => <option key={k} value={k}>{v.label.replace('Percent of ', '')}</option>)}
                  </select></td>
                  <td className="n"><input aria-label={`${p.name}'s percent`} inputMode="decimal" style={{ width: 80 }} value={form[p.id]?.percent ?? ''} placeholder="none" onChange={(e) => setForm({ ...form, [p.id]: { ...form[p.id], percent: e.target.value } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Leave the percent empty for no commission. &ldquo;Paid invoices&rdquo; is taken from money received in the period (refunds off, tips left out). &ldquo;Margin&rdquo; is taken from jobs finished in the period: revenue minus logged costs, never below zero. A job worked by several people is shared by the minutes each clocked on it.</p>
          {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}
          <SaveButton save={saveS} idle="Save rules" className="primary" />
        </form>
      )}
      {error ? <div className="msg err" role="alert">{error}</div> : loading ? <p className="muted">Loading...</p> : report.people.length === 0 ? (
        <p className="own-ok">{Object.keys(rules).length ? 'No commission earned in this period.' : 'No commission rules yet. Tap Set rules to add one.'}</p>
      ) : (
        <>
          <p style={{ margin: '8px 0' }}>Total commission: <strong>{dollars(report.totalCents)}</strong></p>
          {report.people.map((p) => (
            <details key={p.staffId} className="own-detail">
              <summary><strong>{p.name}</strong> <span className="muted">{p.hasRule ? `${p.percent}% ${COMMISSION_BASIS[p.basis].short}` : 'no rule'}</span> <span style={{ float: 'right' }}><strong>{dollars(p.commissionCents)}</strong></span></summary>
              {p.lines.length === 0 ? <p className="muted">Nothing to pay on in this period.</p> : (
                <table className="own-table">
                  <thead><tr><th>Job</th><th className="n">Share</th><th className="n">From</th><th className="n">Commission</th></tr></thead>
                  <tbody>{p.lines.map((l) => (
                    <tr key={l.jobId}><td><Link href={`/jobs/${l.jobId}`}>{l.number ? `#${l.number}` : 'Job'}</Link> {l.customer}</td><td className="n">{l.sharePct}%</td><td className="n">{dollars(l.basisCents)}</td><td className="n">{dollars(l.commissionCents)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </details>
          ))}
        </>
      )}
      {!loading && !error && (report.unassigned.length > 0 || report.noMargin > 0) && (
        <p className="hint">
          {report.unassigned.length > 0 ? `${report.unassigned.length} job${report.unassigned.length === 1 ? '' : 's'} with ${dollars(unmatched)} collected had nobody on the job clock, so no one is credited. ` : ''}
          {report.noMargin > 0 ? `${report.noMargin} finished job${report.noMargin === 1 ? ' has' : 's have'} no price, so margin commission skips ${report.noMargin === 1 ? 'it' : 'them'}.` : ''}
        </p>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------- cash-flow forecast
export function CashFlowPanel() {
  const sb = getSupabase();
  const [state, setState] = useState({ loading: true, error: '' });
  const [data, setData] = useState(null);
  const [openWeek, setOpenWeek] = useState(null);

  const load = useCallback(async () => {
    try {
      const [inv, jobs, set] = await Promise.all([
        sb.from('invoices').select('id,invoice_number,job_id,status,total_cents,credit_cents,balance_cents,issued_at,paid_at,due_date').neq('status', 'void').limit(5000),
        sb.from('jobs').select('id,job_number,status,customer:customers(display_name)').in('status', ['booked', 'on_the_way', 'in_progress', 'completed']).limit(2000),
        sb.from('settings').select('invoice_terms_days').eq('id', 1).maybeSingle(),
      ]);
      const bad = [inv, jobs].find((r) => r.error);
      if (bad) { setState({ loading: false, error: missing(bad.error) ? 'Invoices are not set up yet. Run migration 019, then reload.' : bad.error.message }); return; }
      const ids = (jobs.data || []).map((j) => j.id);
      const estimates = {}; const visits = [];
      for (const c of chunk(ids, 80)) {
        const [e, v] = await Promise.all([
          sb.from('estimates').select('job_id,status,minimum_charge,chosen_tier,lines:estimate_lines(id,quantity,unit_price,tier,optional,accepted)').in('job_id', c).eq('status', 'approved'),
          sb.from('job_visits').select('job_id,starts_at,status').in('job_id', c),
        ]);
        for (const x of e.data || []) estimates[x.job_id] = estimateCents(x);
        visits.push(...(v.data || []));
      }
      setData({ invoices: inv.data || [], booked: bookedWork({ jobs: (jobs.data || []).map((j) => ({ id: j.id, job_number: j.job_number, status: j.status, customer: j.customer?.display_name || '' })), estimates, invoices: inv.data || [], visits }), terms: set.data?.invoice_terms_days ?? 14 });
      setState({ loading: false, error: '' });
    } catch (e) { setState({ loading: false, error: e.message }); }
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  const f = useMemo(() => (data ? forecast({ invoices: data.invoices, booked: data.booked, today: todayIn(), termsDays: data.terms, weeks: WEEKS }) : null), [data]);
  const max = f ? Math.max(1, ...f.weeks.map((w) => w.totalCents)) : 1;
  const when = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <section className="card" aria-label="Cash-flow forecast">
      <h3 style={{ marginTop: 0 }}>Cash-flow forecast, next {WEEKS} weeks</h3>
      {state.error ? <div className="msg err" role="alert">{state.error}</div> : state.loading || !f ? <p className="muted">Loading...</p> : (
        <>
          <div className="own-tiles" style={{ marginBottom: 12 }}>
            <div className="own-tile"><div className="num">{dollars(f.totalCents)}</div><div className="lab">Expected in {WEEKS} weeks</div></div>
            <div className="own-tile"><div className="num">{dollars(f.openCents)}</div><div className="lab">From invoices already out</div></div>
            <div className="own-tile"><div className="num">{dollars(f.weeks.reduce((n, w) => n + w.bookedCents, 0))}</div><div className="lab">From booked work not yet invoiced</div></div>
            {f.riskCents > 0 && <div className="own-tile"><div className="num">{dollars(f.riskCents)}</div><div className="lab">Over 60 days late, not counted</div></div>}
          </div>
          <div className="own-hbars">
            {f.weeks.map((w) => (
              <div key={w.index}>
                <button type="button" className="link" style={{ display: 'block', width: '100%', textAlign: 'left' }} aria-expanded={openWeek === w.index} onClick={() => setOpenWeek(openWeek === w.index ? null : w.index)}>
                  <div className="own-hbar" style={{ gridTemplateColumns: '120px 1fr auto' }}>
                    <div className="name">{when(w.start)} &ndash; {when(w.end)}</div>
                    <div className="track" aria-hidden="true"><div className="fill" style={{ width: `${Math.max(w.totalCents ? 2 : 0, (w.totalCents / max) * 100)}%` }} /></div>
                    <div className="val">{dollars(w.totalCents)}</div>
                  </div>
                </button>
                {openWeek === w.index && (
                  <ul style={{ margin: '6px 0 10px 12px', paddingLeft: 16 }}>
                    {w.items.length === 0 ? <li className="muted">Nothing expected this week.</li> : w.items.map((it, i) => (
                      <li key={i}>{it.jobId ? <Link href={`/jobs/${it.jobId}`}>{it.label}</Link> : it.label}: {dollars(it.cents)}{it.kind === 'booked' ? ' (not invoiced yet)' : ''}{it.late ? ' (later than customers usually pay)' : ''}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            Customers usually pay {f.lag.days} day{f.lag.days === 1 ? '' : 's'} after an invoice is issued{f.lag.source === 'history' ? ` (the middle of ${f.lag.samples} paid invoices this past year)` : ` (your invoice terms, until 5 invoices have been paid)`}.
            Booked work is counted when its last visit is done plus that delay. Invoices that are later than that count in week 1.
            {f.beyondCents > 0 ? ` ${dollars(f.beyondCents)} more is expected after these ${WEEKS} weeks.` : ''} This is an estimate from past habits, not a promise from any customer.
          </p>
        </>
      )}
    </section>
  );
}

// The Financials tab asks for all three; the two job-based panels share one read.
export default function FinancePanels({ bounds, rangeLabel }) {
  const shared = useJobMoney(bounds);
  return (
    <>
      <CashFlowPanel />
      <ProfitByLossPanel bounds={bounds} rangeLabel={rangeLabel} money={shared} />
      <CommissionPanel bounds={bounds} rangeLabel={rangeLabel} money={shared} />
    </>
  );
}
