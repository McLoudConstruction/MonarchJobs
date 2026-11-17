'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { money, CUSTOMER_TYPES } from '@/lib/format';
import { RANGES, rangeBounds, financials, invoiceStats, customerStats, workStats, attentionItems, changeText, AGING } from '@/lib/ownerStats';
import { PAYMENT_METHODS } from '@/lib/invoice';
import { PlansDue, MailingList } from '@/components/customer/OutreachPanels';
import './owner.css';

const TABS = [['overview', 'Overview'], ['financials', 'Financials'], ['customers', 'Customers'], ['work', 'Jobs & leads']];
const JOB_STATUS_LABEL = { booked: 'Booked', on_the_way: 'On the way', in_progress: 'In progress' };

const dollars = (cents) => money(cents / 100);
// $12.4k for tiles and chart labels, full dollars under $1,000
const short = (cents) => {
  const d = cents / 100;
  if (Math.abs(d) >= 10000) return `$${Math.round(d / 1000)}k`;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(1)}k`;
  return `$${Math.round(d)}`;
};

// Reads every row of a query, a thousand at a time. `build` makes a fresh query each time.
async function readAll(build) {
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}

async function loadAll() {
  const sb = getSupabase();
  const now = new Date().toISOString();
  const [est, cust, jobs, leads, plans, prob, unassigned, repair, invs, pays] = await Promise.all([
    readAll(() => sb.from('estimates')
      .select('id,status,minimum_charge,chosen_tier,sent_at,approved_at,declined_at,created_at,job:jobs(service,job_type,customer_id),lead:leads(restoration_type,job_type,customer_id),lines:estimate_lines(id,quantity,unit_price,tier,optional,accepted)')
      .order('id')),
    readAll(() => sb.from('customers').select('id,display_name,customer_type,created_at,last_visit_at').eq('archived', false).order('id')),
    readAll(() => sb.from('jobs').select('id,customer_id,service,job_type,status,completed_at,updated_at,created_at').order('id')),
    readAll(() => sb.from('leads').select('id,status,created_at,accepted_at,restoration_type,job_type').order('id')),
    readAll(() => sb.from('service_plans').select('id,status,next_due,interval_months,price').order('id')),
    sb.from('job_problem_reports').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    sb.from('job_visits').select('id', { count: 'exact', head: true }).is('tech_id', null).eq('status', 'scheduled').gte('starts_at', now),
    sb.from('equipment_assets').select('id', { count: 'exact', head: true }).eq('status', 'in_repair'),
    readAll(() => sb.from('invoices').select('id,status,total_cents,credit_cents,interest_cents,balance_cents,due_date,issued_at,paid_at').order('id')),
    readAll(() => sb.from('payments').select('id,amount_cents,tip_cents,method,received_at').order('id')),
  ]);
  const failed = [est, cust, jobs, leads].find((r) => r.error);
  if (failed) return { error: failed.error.message };
  return {
    estimates: est.data, customers: cust.data, jobs: jobs.data, leads: leads.data,
    plans: plans.error ? [] : plans.data, // a missing plans table just means migration 015 is not run
    problemsOpen: prob.error ? 0 : prob.count || 0,
    unassigned: unassigned.error ? 0 : unassigned.count || 0,
    equipmentRepair: repair.error ? 0 : repair.count || 0,
    invoices: invs.error ? [] : invs.data, // a missing table just means migration 019 is not run
    payments: pays.error ? [] : pays.data,
    invoicesMissing: !!(invs.error || pays.error),
  };
}

function Tile({ num, label, change, href, good = true }) {
  const body = (
    <>
      <div className="num">{num}</div>
      <div className="lab">{label}</div>
      {change ? <div className={`chg ${change.startsWith('-') ? (good ? 'down' : 'up') : change.startsWith('+') ? (good ? 'up' : 'down') : ''}`}>{change} vs. before</div> : null}
    </>
  );
  return href ? <Link href={href} className="own-tile">{body}</Link> : <div className="own-tile">{body}</div>;
}

// Rows of label / bar / value. `items`: [{ label, value, text, href? }]
function HBars({ items, empty = 'Nothing yet.' }) {
  if (!items.length) return <p className="own-ok">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="own-hbars">
      {items.map((i) => (
        <div className="own-hbar" key={i.label}>
          <div className="name" title={i.label}>{i.href ? <Link href={i.href}>{i.label}</Link> : i.label}</div>
          <div className="track" aria-hidden="true"><div className="fill" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} /></div>
          <div className="val">{i.text}</div>
        </div>
      ))}
    </div>
  );
}

// Twelve months as columns. `format` makes the label over a column.
function Columns({ months, valueOf, format, label }) {
  const max = Math.max(...months.map(valueOf), 1);
  return (
    <div className="own-cols" role="img" aria-label={label}>
      {months.map((m) => {
        const v = valueOf(m);
        return (
          <div className="own-col" key={m.key} title={`${m.label}: ${format(v)}`}>
            {v > 0 && <div className="v">{format(v)}</div>}
            <div className={`bar${v > 0 ? '' : ' zero'}`} style={{ height: `${v > 0 ? Math.max(3, (v / max) * 100) : 1}%` }} />
            <div className="m">{m.label.split(' ')[0]}</div>
          </div>
        );
      })}
    </div>
  );
}

function Overview({ fin, inv, cust, work, attn, rangeLabel }) {
  return (
    <>
      <div className="own-tiles">
        <Tile num={dollars(fin.bookedCents)} label={`Booked, ${rangeLabel.toLowerCase()}`} change={changeText(fin.bookedCents, fin.prevBookedCents)} />
        <Tile num={dollars(inv.collectedCents)} label="Collected" change={changeText(inv.collectedCents, inv.prevCollectedCents)} />
        <Tile num={dollars(inv.owedCents)} label="Owed by customers" href="/invoices" good={false} />
        <Tile num={fin.winRate === null ? '—' : `${fin.winRate}%`} label="Estimates won" />
        <Tile num={cust.newInRange} label="New customers" change={changeText(cust.newInRange, cust.newPrev)} href="/customers" />
        <Tile num={work.openCount} label="Jobs open now" href="/jobs" />
      </div>

      <div className="own-grid">
        <div className="card">
          <h3>Needs your attention</h3>
          {attn.length === 0 ? <p className="own-ok">Nothing is waiting on you.</p> : (
            <ul className="own-attn">
              {attn.map((a) => <li key={a.key}><Link href={a.href}><span>{a.text}</span><span className="go" aria-hidden="true">&rsaquo;</span></Link></li>)}
            </ul>
          )}
        </div>
        <div className="card">
          <h3>Waiting on customers</h3>
          <table className="own-table">
            <tbody>
              <tr><td>Estimates sent</td><td className="n">{fin.sentCount}</td><td className="n">{dollars(fin.sentCents)}</td></tr>
              <tr><td>Drafts not sent</td><td className="n">{fin.draftCount}</td><td className="n">{dollars(fin.draftCents)}</td></tr>
              <tr><td>Approved, not scheduled</td><td className="n">{work.readyToSchedule}</td><td className="n"></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Booked by month</h3>
        <Columns months={fin.months} valueOf={(m) => m.cents} format={short} label="Booked revenue for each of the last twelve months" />
      </div>

      <div className="own-links">
        <Link href="/leads"><button type="button" className="secondary">Leads</button></Link>
        <Link href="/jobs"><button type="button" className="secondary">Jobs</button></Link>
        <Link href="/schedule"><button type="button" className="secondary">Schedule</button></Link>
        <Link href="/customers"><button type="button" className="secondary">Customers</button></Link>
        <Link href="/equipment"><button type="button" className="secondary">Equipment</button></Link>
        <Link href="/settings"><button type="button" className="secondary">Settings</button></Link>
      </div>
    </>
  );
}

function Financials({ fin, inv, invoicesMissing, rangeLabel }) {
  return (
    <>
      <div className="own-note">
        <strong>Booked</strong> means an estimate the customer approved, counted on the day they approved it, at the tier and add-ons they picked.
        <strong> Collected</strong> is money actually received (card, Square, cash, check), minus refunds. Tips are counted apart. Profit needs job costs, which are not tracked yet.
        {invoicesMissing && <> <strong>Invoices are not set up yet:</strong> run the latest database update (migration 019).</>}
      </div>
      <div className="own-tiles">
        <Tile num={dollars(inv.collectedCents)} label={`Collected, ${rangeLabel.toLowerCase()}`} change={changeText(inv.collectedCents, inv.prevCollectedCents)} />
        <Tile num={dollars(inv.owedCents)} label={`Owed by customers (${inv.openCount})`} href="/invoices" good={false} />
        <Tile num={dollars(inv.pastDueCents)} label={`Past due (${inv.pastDueCount})`} href="/invoices" good={false} />
        <Tile num={dollars(inv.invoicedCents)} label={`Invoiced, ${rangeLabel.toLowerCase()} (${inv.invoicedCount})`} />
      </div>
      <div className="own-grid">
        <div className="card">
          <h3>Who owes, and how late</h3>
          <HBars items={AGING.map((a) => ({ label: a.label, value: inv.aging[a.key], text: dollars(inv.aging[a.key]) })).filter((i) => i.value > 0)} empty="Nothing is owed." />
          <p className="hint" style={{ marginTop: 10 }}>
            {inv.draftCount > 0 ? `${inv.draftCount} invoice${inv.draftCount === 1 ? '' : 's'} drafted, not sent (${dollars(inv.draftCents)}). ` : ''}
            {inv.avgDaysToPay !== null ? `Paid invoices took ${inv.avgDaysToPay} days on average.` : ''}
          </p>
        </div>
        <div className="card">
          <h3>How customers paid, {rangeLabel.toLowerCase()}</h3>
          <HBars items={Object.entries(inv.byMethod).filter(([, c]) => c !== 0).map(([m, c]) => ({ label: PAYMENT_METHODS[m] || m, value: Math.max(c, 0), text: dollars(c) }))} empty="No payments in this period." />
          {inv.tipCents > 0 && <p className="hint" style={{ marginTop: 10 }}>Plus {dollars(inv.tipCents)} in tips.</p>}
        </div>
      </div>
      <div className="card">
        <h3>Collected by month, last 12 months</h3>
        <Columns months={inv.months} valueOf={(m) => m.cents} format={short} label="Money collected for each of the last twelve months" />
      </div>
      <h3 style={{ marginTop: 24 }}>Booked work</h3>
      <div className="own-tiles">
        <Tile num={dollars(fin.bookedCents)} label={`Booked, ${rangeLabel.toLowerCase()}`} change={changeText(fin.bookedCents, fin.prevBookedCents)} />
        <Tile num={fin.approvedCount} label="Estimates approved" />
        <Tile num={fin.avgCents ? dollars(fin.avgCents) : '—'} label="Average job" />
        <Tile num={fin.winRate === null ? '—' : `${fin.winRate}%`} label={`Won (${fin.approvedCount} of ${fin.approvedCount + fin.declinedCount} decided)`} />
      </div>

      <div className="own-grid">
        <div className="card">
          <h3>Booked by service</h3>
          <HBars items={fin.byService.map((s) => ({ label: s.label, value: s.cents, text: `${dollars(s.cents)} · ${s.count}` }))} empty="No approved estimates in this period." />
        </div>
        <div className="card">
          <h3>Still open</h3>
          <table className="own-table">
            <tbody>
              <tr><td>Sent, no answer yet</td><td className="n">{fin.sentCount}</td><td className="n">{dollars(fin.sentCents)}</td></tr>
              <tr><td>Out more than a week</td><td className="n">{fin.staleCount}</td><td className="n"></td></tr>
              <tr><td>Drafts not sent</td><td className="n">{fin.draftCount}</td><td className="n">{dollars(fin.draftCents)}</td></tr>
              <tr><td>Declined ({rangeLabel.toLowerCase()})</td><td className="n">{fin.declinedCount}</td><td className="n">{dollars(fin.declinedCents)}</td></tr>
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 10 }}>Open estimates are valued at their included lines, or the lowest option when there are Good / Better / Best choices.</p>
        </div>
      </div>

      <div className="card">
        <h3>Booked by month, last 12 months</h3>
        <Columns months={fin.months} valueOf={(m) => m.cents} format={short} label="Booked revenue for each of the last twelve months" />
      </div>

      {(fin.tieredCount > 0 || fin.addOnCents > 0) && (
        <div className="card">
          <h3>Options and add-ons</h3>
          <table className="own-table">
            <tbody>
              <tr><td>Approved estimates with Good / Better / Best</td><td className="n">{fin.tieredCount}</td></tr>
              <tr><td>Add-ons customers ticked</td><td className="n">{dollars(fin.addOnCents)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Customers({ cust, rangeLabel }) {
  const types = Object.entries(cust.byType).map(([k, n]) => ({ label: CUSTOMER_TYPES[k] || k, value: n, text: String(n) }));
  return (
    <>
      <div className="own-tiles">
        <Tile num={cust.total} label="Customers" href="/customers" />
        <Tile num={cust.newInRange} label={`New, ${rangeLabel.toLowerCase()}`} change={changeText(cust.newInRange, cust.newPrev)} />
        <Tile num={cust.repeatRate === null ? '—' : `${cust.repeatRate}%`} label={`Repeat customers (${cust.repeat} of ${cust.withJobs})`} />
        <Tile num={cust.plansActive} label="Active cleaning plans" />
        <Tile num={cust.plansDueSoon} label="Plans due in 30 days" />
        {cust.plansPerYearCents > 0 && <Tile num={dollars(cust.plansPerYearCents)} label="Plans, value per year" />}
      </div>

      <div className="own-grid">
        <div className="card">
          <h3>Top customers, {rangeLabel.toLowerCase()}</h3>
          {cust.top.length === 0 ? <p className="own-ok">No approved estimates in this period.</p> : (
            <table className="own-table">
              <thead><tr><th>Customer</th><th className="n">Jobs</th><th className="n">Booked</th></tr></thead>
              <tbody>
                {cust.top.map((t) => (
                  <tr key={t.id}><td><Link href={`/customers/${t.id}`}>{t.name}</Link></td><td className="n">{t.count}</td><td className="n">{dollars(t.cents)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>By type</h3>
          <HBars items={types} empty="No customers yet." />
          <h3 style={{ marginTop: 22 }}>New customers by month</h3>
          <Columns months={cust.newPerMonth} valueOf={(m) => m.count} format={(v) => String(v)} label="New customers for each of the last twelve months" />
        </div>
      </div>

      <PlansDue />
      <MailingList />
      <div className="own-links">
        <Link href="/customers"><button type="button" className="secondary">Open the full customer list</button></Link>
      </div>
    </>
  );
}

function Work({ work, rangeLabel }) {
  const l = work.lead;
  return (
    <>
      <div className="own-tiles">
        <Tile num={work.openCount} label="Jobs open now" href="/jobs" />
        <Tile num={work.doneCount} label={`Jobs finished, ${rangeLabel.toLowerCase()}`} />
        <Tile num={l.total} label={`New leads, ${rangeLabel.toLowerCase()}`} href="/leads" />
        <Tile num={l.bookRate === null ? '—' : `${l.bookRate}%`} label="Leads booked (of those decided)" />
        <Tile num={work.readyToSchedule} label="Ready to schedule" href="/leads" />
        <Tile num={work.waitingOnCustomer} label="Estimates sent, leads waiting" href="/leads" />
      </div>
      <div className="own-grid">
        <div className="card">
          <h3>Open jobs</h3>
          <HBars items={work.byStatus.filter((s) => s.count > 0).map((s) => ({ label: JOB_STATUS_LABEL[s.key] || s.key, value: s.count, text: String(s.count) }))} empty="No open jobs." />
        </div>
        <div className="card">
          <h3>By service</h3>
          {work.byService.length === 0 ? <p className="own-ok">Nothing in this period.</p> : (
            <table className="own-table">
              <thead><tr><th>Service</th><th className="n">Open</th><th className="n">Finished</th></tr></thead>
              <tbody>{work.byService.map((s) => <tr key={s.key}><td>{s.label}</td><td className="n">{s.open}</td><td className="n">{s.done}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Leads, {rangeLabel.toLowerCase()}</h3>
          <HBars items={[['New', l.new], ['Estimate sent', l.quoted], ['Approved', l.accepted], ['Booked', l.booked], ['Lost', l.lost]].filter(([, n]) => n > 0).map(([label, n]) => ({ label, value: n, text: String(n) }))} empty="No leads in this period." />
        </div>
      </div>
    </>
  );
}

export default function OwnerDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState('30d');
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (TABS.some(([k]) => k === h)) setTab(h);
    try { const r = sessionStorage.getItem('mj_owner_range'); if (RANGES.some(([k]) => k === r)) setRange(r); } catch { /* storage unavailable */ }
  }, []);
  const openTab = (k) => { setTab(k); window.history.replaceState(null, '', `#${k}`); };
  const pickRange = (k) => { setRange(k); try { sessionStorage.setItem('mj_owner_range', k); } catch { /* ignore */ } };

  const load = useCallback(async () => {
    setError('');
    const res = await loadAll();
    if (res.error) setError(res.error); else setData(res);
  }, []);
  useEffect(() => { load(); }, [load]);

  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const bounds = useMemo(() => rangeBounds(range, now), [range, now]);
  const rangeLabel = RANGES.find(([k]) => k === range)?.[1] || '';
  const calc = useMemo(() => {
    if (!data) return null;
    const fin = financials(data.estimates, bounds, now);
    const cust = customerStats(data.customers, data.jobs, data.estimates, data.plans, bounds, now);
    const work = workStats(data.jobs, data.leads, bounds);
    const inv = invoiceStats(data.invoices, data.payments, bounds, now);
    const attn = attentionItems({ fin, work, cust, inv, problemsOpen: data.problemsOpen, unassigned: data.unassigned, equipmentRepair: data.equipmentRepair });
    return { fin, inv, cust, work, attn, invoicesMissing: data.invoicesMissing };
  }, [data, bounds, now]);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h1>Owner dashboard</h1>
        <div className="own-range" role="group" aria-label="Time period">
          {RANGES.map(([k, label]) => <button key={k} type="button" className={range === k ? 'on' : ''} aria-pressed={range === k} onClick={() => pickRange(k)}>{label}</button>)}
        </div>
      </div>
      <p className="sub">Customers, jobs and money in one place. Owner only.</p>

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => openTab(k)}>{label}</button>)}
      </div>

      {error && <div className="msg err">Could not load the numbers: {error} <button type="button" className="secondary small" onClick={load}>Try again</button></div>}
      {!error && !calc && <p className="muted">Loading…</p>}
      {calc && tab === 'overview' && <Overview {...calc} rangeLabel={rangeLabel} />}
      {calc && tab === 'financials' && <Financials fin={calc.fin} inv={calc.inv} invoicesMissing={calc.invoicesMissing} rangeLabel={rangeLabel} />}
      {calc && tab === 'customers' && <Customers cust={calc.cust} rangeLabel={rangeLabel} />}
      {calc && tab === 'work' && <Work work={calc.work} rangeLabel={rangeLabel} />}
    </>
  );
}
