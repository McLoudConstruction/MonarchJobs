'use client';

import { useMemo, useState } from 'react';
import { monthGridDays, monthStart, addMonths } from '@/lib/monthGrid';
import { dayInfo } from '@/lib/onCall';
import { colorHex } from '@/lib/userColors';
import { staffName } from '@/lib/userDisplay';
import '@/components/monthgrid.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ymd = (d) => d.toLocaleDateString('en-CA');
const short = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const first = (p) => staffName(p).split(/\s+/)[0];

// A month of who is on call. Each day carries the on-call person's colored name; days someone is off show "Off: name" and are
// flagged in red when the person who was due to be on call is off (the next person in the rotation covers those days).
// cfg: the rotation settings as they are on screen (not yet saved), plus { tz, timeOff, overrides, isActive }.
export default function OnCallCalendar({ cfg, people }) {
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const days = useMemo(() => monthGridDays(month), [month]);
  const info = useMemo(() => days.map((d) => dayInfo(ymd(d), cfg)), [days, cfg]);
  const person = (id) => people.find((p) => p.id === id);
  const todayStr = ymd(new Date());
  const ready = cfg.oncall_order.length > 0 && !!cfg.oncall_start;

  // one line per week where the person due to be on call is off
  const conflicts = useMemo(() => {
    const out = [];
    for (let w = 0; w < info.length; w += 7) {
      const week = info.slice(w, w + 7).filter((x) => x.plannedOff && x.date >= ymd(month) && x.date.slice(0, 7) === ymd(month).slice(0, 7));
      if (!week.length) continue;
      const byPerson = new Map();
      for (const x of week) byPerson.set(x.plannedId, [...(byPerson.get(x.plannedId) || []), x]);
      for (const [pid, xs] of byPerson) {
        const covers = [...new Set(xs.map((x) => x.staffId).filter((id) => id && id !== pid))];
        out.push({ key: `${w}-${pid}`, text: `${short(xs[0].date)}${xs.length > 1 ? ` to ${short(xs[xs.length - 1].date)}` : ''}: ${person(pid) ? staffName(person(pid)) : 'Someone'} is off during their on-call week. ${covers.length ? `${covers.map((id) => (person(id) ? staffName(person(id)) : 'Someone')).join(' and ')} covers.` : 'Nobody is free to cover.'}` });
      }
    }
    return out;
  }, [info, month, people]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="mg">
        <div className="mg-bar">
          <button type="button" className="secondary" onClick={() => setMonth(addMonths(month, -1))}>Previous</button>
          <span className="range">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          <button type="button" className="secondary" onClick={() => setMonth(addMonths(month, 1))}>Next</button>
          <button type="button" className="secondary" onClick={() => setMonth(monthStart(new Date()))}>This month</button>
          <span className="mg-legend"><span>Colored name = on call that day</span><span style={{ color: 'var(--danger)' }}>Red = the person due on call is off</span></span>
        </div>
        <div className="mg-scroll">
          <div className="mg-grid">
            {WEEKDAYS.map((d) => <div key={d} className="mg-dow">{d}</div>)}
            {days.map((d, i) => {
              const x = info[i];
              const on = x.staffId && person(x.staffId);
              const hex = on ? colorHex(on, people) : null;
              return (
                <div key={x.date} className={`mg-day${d.getMonth() !== month.getMonth() ? ' out' : ''}${x.date === todayStr ? ' today' : ''}`}>
                  <div className="mg-num">{d.getDate()}</div>
                  {ready && on && (
                    <span className="mg-row" style={{ '--mg-color': hex }} title={`${staffName(on)} is on call${x.swapped ? ' (swap)' : ''}${x.covering ? ' (covering)' : ''}`}>
                      <b>{first(on)}</b>{x.swapped ? ' (swap)' : x.covering ? ' (covering)' : ''}
                    </span>
                  )}
                  {ready && !on && <span className="mg-row" style={{ '--mg-color': '#b42318' }}>Nobody</span>}
                  {x.off.map((id) => (
                    <span key={id} className={`mg-row${id === x.plannedId ? ' flag' : ''}`} style={{ '--mg-color': '#6b7686' }} title={id === x.plannedId ? 'Due to be on call but off this day' : 'Time off'}>
                      Off: {person(id) ? first(person(id)) : 'Someone'}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {!ready && <p className="hint">Check the people in the rotation and pick a start Monday to see the calendar fill in.</p>}
      {conflicts.length > 0 && (
        <div className="banner flag" style={{ marginTop: 8 }}>
          <strong>Time off in on-call weeks</strong>
          <ul style={{ margin: '4px 0 0 18px', fontWeight: 400 }}>{conflicts.map((c) => <li key={c.key}>{c.text}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
