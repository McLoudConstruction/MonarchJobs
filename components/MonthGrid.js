'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtTime, fmtDuration } from '@/lib/format';
import { techColorOf, UNASSIGNED_COLOR } from '@/lib/userColors';
import { monthGridDays, monthStart, addMonths, groupVisitsByDay, dayRows, dayKey } from '@/lib/monthGrid';
import { doubleBookedIds } from '@/lib/schedule';
import { staffName } from '@/lib/userDisplay';
import './monthgrid.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// One month of visits on a calendar. Each visit is a single row in its day (time, job number, customer),
// and a day draws at most four rows: when there are more, the last row reads "+N more" and opens that
// day's full list underneath the calendar.
export default function MonthGrid({ month, onMonthChange, techs, focusTechId = '', linkVisits = true }) {
  const [visits, setVisits] = useState([]);
  const [view, setView] = useState(focusTechId || 'all');
  const [openDay, setOpenDay] = useState(null); // dayKey of the day whose full list is showing

  const days = useMemo(() => monthGridDays(month), [month]);
  const rangeStart = days[0];
  const rangeEnd = useMemo(() => {
    const last = days[days.length - 1];
    return new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  }, [days]);

  useEffect(() => { setView(focusTechId || 'all'); }, [focusTechId]);
  useEffect(() => { setOpenDay(null); }, [month]);

  useEffect(() => {
    let cancelled = false;
    getSupabase().from('job_visits')
      .select('id,tech_id,starts_at,ends_at,duration_minutes,status,job:jobs(id,job_number,customer:customers(display_name),address:addresses(street,city))')
      .gte('starts_at', rangeStart.toISOString()).lt('starts_at', rangeEnd.toISOString())
      .neq('status', 'cancelled').order('starts_at')
      .then(({ data }) => { if (!cancelled) setVisits(data || []); });
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd]);

  const techName = (id) => { const t = techs.find((x) => x.id === id); return t ? staffName(t) : 'Unassigned'; };
  const shown = useMemo(() => visits.filter((v) => view === 'all' || v.tech_id === view), [visits, view]);
  const flagged = useMemo(() => doubleBookedIds(shown), [shown]);
  const byDay = useMemo(() => groupVisitsByDay(shown), [shown]);
  const todayKey = dayKey(new Date());
  const thisMonth = monthStart(month).getMonth();
  const openList = openDay ? byDay.get(openDay) || [] : [];

  function row(v) {
    const mins = v.duration_minutes || Math.round((new Date(v.ends_at) - new Date(v.starts_at)) / 60000);
    const cls = `mg-row${v.status === 'finished' ? ' done' : ''}${flagged.has(v.id) ? ' flag' : ''}`;
    const style = { '--mg-color': techColorOf(techs, v.tech_id) };
    const title = `${fmtTime(v.starts_at)} · ${fmtDuration(mins)} · ${techName(v.tech_id)} - #${v.job?.job_number} ${v.job?.customer?.display_name || ''}${v.job?.address?.street ? `, ${v.job.address.street}` : ''}`;
    const body = <><b>{fmtTime(v.starts_at)}</b> #{v.job?.job_number} {v.job?.customer?.display_name}</>;
    return linkVisits && v.job?.id
      ? <Link key={v.id} href={`/jobs/${v.job.id}`} className={cls} style={style} title={title}>{body}</Link>
      : <div key={v.id} className={cls} style={style} title={title}>{body}</div>;
  }

  return (
    <div className="mg">
      <div className="mg-bar">
        <button type="button" className="secondary small" onClick={() => onMonthChange(addMonths(month, -1))}>Prev</button>
        <button type="button" className="secondary small" onClick={() => onMonthChange(monthStart(new Date()))}>This month</button>
        <button type="button" className="secondary small" onClick={() => onMonthChange(addMonths(month, 1))}>Next</button>
        <span className="range">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
        <span className="mg-legend">
          {techs.filter((t) => view === 'all' || t.id === view).map((t) => (
            <span key={t.id}><i style={{ background: techColorOf(techs, t.id) }} />{staffName(t)}</span>
          ))}
          <span><i style={{ background: UNASSIGNED_COLOR }} />Unassigned</span>
        </span>
        <span style={{ flex: 1 }} />
        {techs.length > 1 && (
          <select value={view} onChange={(e) => setView(e.target.value)} aria-label="Show">
            <option value="all">All techs</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{staffName(t)}</option>)}
          </select>
        )}
      </div>
      <div className="mg-scroll">
        <div className="mg-grid">
          {WEEKDAYS.map((w) => <div key={w} className="mg-dow">{w}</div>)}
          {days.map((d) => {
            const k = dayKey(d);
            const { shown: rows, more } = dayRows(byDay.get(k) || []);
            const cls = `mg-day${d.getMonth() !== thisMonth ? ' out' : ''}${k === todayKey ? ' today' : ''}${k === openDay ? ' open' : ''}`;
            return (
              <div key={k} className={cls}>
                <div className="mg-num">{d.getDate() === 1 ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.getDate()}</div>
                {rows.map(row)}
                {more > 0 && (
                  <button type="button" className="mg-more" onClick={() => setOpenDay(k === openDay ? null : k)}>+{more} more</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {openDay && (
        <div className="mg-open">
          <div className="mg-open-head">
            <strong>{new Date(`${openDay}T00:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
            <span className="muted"> · {openList.length} appointments</span>
            <button type="button" className="secondary small" style={{ marginLeft: 'auto' }} onClick={() => setOpenDay(null)}>Close</button>
          </div>
          {openList.map(row)}
        </div>
      )}
    </div>
  );
}
