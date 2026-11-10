'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabaseClient';
import { doubleBookedIds } from '@/lib/schedule';
import WeekGrid from '@/components/WeekGrid';
import { addDays, startOfDay, fmtDay, fmtTime, fmtDuration } from '@/lib/format';
import { weekStartMonday } from '@/lib/weekGrid';
import { staffName } from '@/lib/userDisplay';

function weekStart(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  return addDays(x, -dow);
}

function ScheduleInner({ staff }) {
  const [start, setStart] = useState(weekStart(new Date()));
  const [visits, setVisits] = useState([]);
  const [techs, setTechs] = useState([]);
  const [view, setView] = useState('board'); // board | timeline
  const end = useMemo(() => addDays(start, 7), [start]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const isOffice = staff.role !== 'tech';

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [v, s] = await Promise.all([
      sb.from('job_visits')
        .select('id,tech_id,starts_at,ends_at,duration_minutes,status,job:jobs(id,job_number,job_type,customer:customers(display_name),address:addresses(street,city))')
        .gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString())
        .neq('status', 'cancelled').order('starts_at'),
      sb.from('staff_users').select('id,full_name,email,role').eq('active', true).order('full_name'),
    ]);
    setVisits(v.data || []);
    setTechs(s.data || []);
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  const flagged = useMemo(() => doubleBookedIds(visits), [visits]);

  const rows = useMemo(() => {
    const ids = new Set(visits.map((v) => v.tech_id));
    const list = techs.filter((t) => t.role === 'tech' || ids.has(t.id));
    const visible = isOffice ? list : list.filter((t) => t.id === staff.id);
    return [...visible.map((t) => ({ id: t.id, label: staffName(t) })), ...(isOffice ? [{ id: null, label: 'Unassigned' }] : [])];
  }, [techs, visits, isOffice, staff.id]);

  const today = startOfDay(new Date()).getTime();

  function cell(row, day) {
    const dayStart = day.getTime();
    const dayEnd = addDays(day, 1).getTime();
    return visits.filter((v) => (v.tech_id || null) === row.id && new Date(v.starts_at).getTime() >= dayStart && new Date(v.starts_at).getTime() < dayEnd);
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Schedule</h1>
        {isOffice && <Link href="/leads/new"><button className="primary">New lead</button></Link>}
      </div>
      <div className="tabs">
        <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>By tech</button>
        <button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Time of day</button>
      </div>
      {view === 'board' && <div className="toolbar">
        <button className="secondary" onClick={() => setStart(addDays(start, -7))}>Previous week</button>
        <button className="secondary" onClick={() => setStart(weekStart(new Date()))}>This week</button>
        <button className="secondary" onClick={() => setStart(addDays(start, 7))}>Next week</button>
        <span className="muted">{fmtDay(days[0])} to {fmtDay(days[6])}</span>
      </div>}
      {view === 'timeline' && (
        <WeekGrid
          weekStart={start}
          onWeekChange={(d) => setStart(weekStartMonday(d))}
          techs={isOffice ? techs.filter((t) => t.role === 'tech') : techs.filter((t) => t.id === staff.id)}
          focusTechId={isOffice ? '' : staff.id}
          linkVisits
        />
      )}
      {view === 'board' && flagged.size > 0 && <div className="banner flag">{flagged.size} visits this week overlap another visit for the same tech. They are marked in red.</div>}
      {view === 'board' && <div className="sched-wrap">
        <table className="sched min">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Tech</th>
              {days.map((d) => <th key={d.getTime()}>{fmtDay(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id || 'none'}>
                <th>{r.label}</th>
                {days.map((d) => (
                  <td key={d.getTime()} className={d.getTime() === today ? 'today' : ''}>
                    {cell(r, d).map((v) => (
                      <Link key={v.id} href={`/jobs/${v.job.id}`}
                        className={`visit${flagged.has(v.id) ? ' flag' : ''}${v.status === 'finished' ? ' done' : ''}`}>
                        <div className="t">{fmtTime(v.starts_at)} · {fmtDuration(v.duration_minutes)}</div>
                        <div>#{v.job.job_number} {v.job.customer?.display_name}</div>
                        <div className="muted">{v.job.address?.street}</div>
                      </Link>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {view === 'board' && rows.length === 0 && <p className="muted">No techs yet. Add staff and set their role to Tech in Settings.</p>}
    </>
  );
}

export default function SchedulePage() {
  return <AuthGate>{({ staff }) => <ScheduleInner staff={staff} />}</AuthGate>;
}
