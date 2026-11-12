'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { addDays, startOfDay, fmtDay, fmtTime, fmtDuration, JOB_TYPES } from '@/lib/format';
import { weekStartMonday, layoutDay, fractionFromTime } from '@/lib/weekGrid';
import { doubleBookedIds } from '@/lib/schedule';
import { visitsOnDay, dayHourRange, focusFraction, visitMinutes, sameDay, weekDays } from '@/lib/techDay';
import './techschedule.css';

// A technician's schedule on a phone. Day is the main view: a vertical timeline with a block for each
// appointment, and scrolling the page scrolls through the hours of the day (down = later). Week is a
// plain list of the seven days. A technician only ever sees their own visits, so there is no tech filter.

const HOUR_PX = 80;
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h % 24 < 12 ? 'AM' : 'PM'}`;
const STATUS_LABEL = { on_the_way: 'On the way', started: 'In progress', finished: 'Done' };
const shortDate = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
const plural = (n) => `${n} appointment${n === 1 ? '' : 's'}`;

function addressText(v) {
  const a = v.job?.address;
  return a ? [a.street, a.city].filter(Boolean).join(', ') : '';
}

function VisitStatus({ status }) {
  return STATUS_LABEL[status] ? <span className={`tday-st s-${status}`}>{STATUS_LABEL[status]}</span> : null;
}

// Presentational part: everything is passed in, so it can be shown without a database.
export function TechScheduleView({
  visits, ready, error, day, mode, now, onDay, onMode, onShift, onToday, onRetry,
}) {
  const headRef = useRef(null);
  const gridRef = useRef(null);
  const scrolledFor = useRef(null);
  const touch = useRef(null);

  const weekStart = useMemo(() => weekStartMonday(day), [day]);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const isToday = sameDay(day, now);
  const thisWeek = sameDay(weekStartMonday(now), weekStart);
  const flagged = useMemo(() => doubleBookedIds(visits), [visits]);

  const dayVisits = useMemo(() => visitsOnDay(visits, day), [visits, day]);
  const range = useMemo(() => dayHourRange(dayVisits, day), [dayVisits, day]);
  const { items } = useMemo(() => layoutDay(dayVisits, day, range), [dayVisits, day, range]);
  const hours = range.endHour - range.startHour;
  const gridPx = hours * HOUR_PX;
  const weekCount = useMemo(() => days.reduce((n, d) => n + visitsOnDay(visits, d).length, 0), [days, visits]);

  // Open on the right part of the day: now if it is today, otherwise the first appointment.
  const dayKey = day.getTime();
  useEffect(() => {
    if (mode !== 'day' || !ready) return;
    if (scrolledFor.current === dayKey) return;
    scrolledFor.current = dayKey;
    const grid = gridRef.current;
    const sc = grid && grid.closest('.shell-content');
    if (!grid || !sc) return;
    const f = focusFraction({ visits: dayVisits, day, range, now: new Date() });
    const gridTop = grid.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const headH = headRef.current ? headRef.current.offsetHeight : 0;
    const target = f == null ? 0 : gridTop + f * gridPx - headH - HOUR_PX * 0.75;
    sc.scrollTo({ top: Math.max(0, target) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ready, dayKey]);

  function switchMode(next) {
    if (next === mode) return;
    scrolledFor.current = null;
    const sc = headRef.current && headRef.current.closest('.shell-content');
    if (sc) sc.scrollTo({ top: 0 });
    onMode(next);
  }

  function pickDay(d) {
    scrolledFor.current = null;
    onDay(d);
    if (mode !== 'day') onMode('day');
  }

  // a sideways swipe on the timeline moves to the next or previous day
  function swipeStart(e) {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }
  function swipeEnd(e) {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) onShift(dx < 0 ? 1 : -1);
  }

  const nowFraction = isToday ? fractionFromTime(now, day, range) : null;

  const title = mode === 'day' ? fmtDay(day) : `${shortDate(days[0])} to ${shortDate(days[6])}`;
  const count = mode === 'day' ? dayVisits.length : weekCount;
  const backNeeded = mode === 'day' ? !isToday : !thisWeek;

  return (
    <div className="tday">
      <div className="tday-head" ref={headRef}>
        <div className="tday-row">
          <button type="button" className="tday-arrow" aria-label={mode === 'day' ? 'Previous day' : 'Previous week'} onClick={() => onShift(-1)}>&#8249;</button>
          <div className="tday-title">
            <strong>{title}</strong>
            <span>
              {ready ? plural(count) : 'Loading'}
              {backNeeded && <> &middot; <button type="button" className="tday-link" onClick={onToday}>{mode === 'day' ? 'Today' : 'This week'}</button></>}
              {!backNeeded && mode === 'day' && ' · Today'}
            </span>
          </div>
          <button type="button" className="tday-arrow" aria-label={mode === 'day' ? 'Next day' : 'Next week'} onClick={() => onShift(1)}>&#8250;</button>
          <div className="seg tday-seg" role="tablist" aria-label="Schedule view">
            <button type="button" role="tab" aria-selected={mode === 'day'} className={mode === 'day' ? 'on' : ''} onClick={() => switchMode('day')}>Day</button>
            <button type="button" role="tab" aria-selected={mode === 'week'} className={mode === 'week' ? 'on' : ''} onClick={() => switchMode('week')}>Week</button>
          </div>
        </div>
        {mode === 'day' && (
          <div className="tday-strip">
            {days.map((d) => {
              const n = visitsOnDay(visits, d).length;
              const cls = `tday-chip${sameDay(d, day) ? ' on' : ''}${sameDay(d, now) ? ' today' : ''}`;
              return (
                <button key={d.getTime()} type="button" className={cls} onClick={() => pickDay(d)}
                  aria-label={`${fmtDay(d)}, ${plural(n)}`} aria-pressed={sameDay(d, day)}>
                  <small>{d.toLocaleDateString([], { weekday: 'short' })}</small>
                  <b>{d.getDate()}</b>
                  <span className="dots">{Array.from({ length: Math.min(n, 3) }, (_, i) => <i key={i} />)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="banner flag" style={{ marginTop: 12 }}>
          Could not load the schedule: {error}{' '}
          <button type="button" className="tday-link" onClick={onRetry}>Try again</button>
        </div>
      )}

      {!ready && !error && <p className="muted" style={{ marginTop: 16 }}>Loading your schedule...</p>}

      {ready && mode === 'day' && (
        <div className="tday-body" onTouchStart={swipeStart} onTouchEnd={swipeEnd}>
          {dayVisits.length === 0 && (
            <p className="tday-empty">{isToday ? 'Nothing scheduled for today.' : 'Nothing scheduled this day.'}</p>
          )}
          <div className="tday-grid" ref={gridRef} style={{ height: gridPx }}>
            {Array.from({ length: hours + 1 }, (_, i) => (
              <span key={i} className="tday-hour" style={{ top: i * HOUR_PX }}>{hourLabel(range.startHour + i)}</span>
            ))}
            <div className="tday-lane" style={{ '--hour': `${HOUR_PX}px` }}>
              {items.map(({ visit: v, top, height, lane, lanes }) => {
                const px = Math.max(Math.round(height * gridPx) - 2, 34);
                const mins = visitMinutes(v);
                const cls = ['tday-block', `s-${v.status}`, px < 62 ? 'short' : '', flagged.has(v.id) ? 'flag' : ''].filter(Boolean).join(' ');
                const style = {
                  top: Math.round(top * gridPx) + 1, height: px,
                  left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`,
                };
                const who = v.job?.customer?.display_name || 'Customer';
                const addr = addressText(v);
                const body = px < 62 ? (
                  <>
                    <span className="t">{fmtTime(v.starts_at)}</span>
                    <span className="who">{who}</span>
                    <VisitStatus status={v.status} />
                  </>
                ) : (
                  <>
                    <div className="t">{fmtTime(v.starts_at)} &middot; {fmtDuration(mins)} <VisitStatus status={v.status} /></div>
                    <div className="who">{who}</div>
                    {addr && <div className="addr">{addr}</div>}
                    {px >= 110 && v.job && (
                      <div className="addr">#{v.job.job_number}{v.job.job_type && JOB_TYPES[v.job.job_type] ? ` · ${JOB_TYPES[v.job.job_type]}` : ''}</div>
                    )}
                  </>
                );
                return v.job?.id ? (
                  <Link key={v.id} href={`/jobs/${v.job.id}`} className={cls} style={style}>{body}</Link>
                ) : (
                  <div key={v.id} className={cls} style={style}>{body}</div>
                );
              })}
              {nowFraction != null && nowFraction > 0 && nowFraction < 1 && (
                <div className="tday-now" style={{ top: Math.round(nowFraction * gridPx) }}><span>{fmtTime(now)}</span></div>
              )}
            </div>
          </div>
        </div>
      )}

      {ready && mode === 'week' && (
        <div className="tweek">
          {days.map((d) => {
            const list = visitsOnDay(visits, d);
            return (
              <section key={d.getTime()} className={`tweek-day${sameDay(d, now) ? ' today' : ''}`}>
                <button type="button" className="tweek-head" onClick={() => pickDay(d)}>
                  <span>{fmtDay(d)}{sameDay(d, now) && <em>Today</em>}</span>
                  <small>{list.length ? plural(list.length) : 'No appointments'} &rsaquo;</small>
                </button>
                {list.map((v) => {
                  const cls = `tweek-card s-${v.status}${flagged.has(v.id) ? ' flag' : ''}`;
                  const inner = (
                    <>
                      <div className="t">{fmtTime(v.starts_at)} &middot; {fmtDuration(visitMinutes(v))} <VisitStatus status={v.status} /></div>
                      <div className="who">{v.job?.customer?.display_name || 'Customer'}</div>
                      {addressText(v) && <div className="addr">{addressText(v)}</div>}
                    </>
                  );
                  return v.job?.id
                    ? <Link key={v.id} href={`/jobs/${v.job.id}`} className={cls}>{inner}</Link>
                    : <div key={v.id} className={cls}>{inner}</div>;
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Loads the signed-in technician's own visits for the week on screen.
export default function TechSchedule({ staff }) {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [mode, setMode] = useState('day');
  const [data, setData] = useState({ key: null, visits: [] });
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const req = useRef(0);

  const weekKey = useMemo(() => weekStartMonday(day).getTime(), [day]);

  const load = useCallback(async () => {
    const id = ++req.current;
    const from = new Date(weekKey);
    const to = addDays(from, 7);
    const { data: rows, error: err } = await getSupabase().from('job_visits')
      .select('id,tech_id,starts_at,ends_at,duration_minutes,status,job:jobs(id,job_number,job_type,customer:customers(display_name),address:addresses(street,city))')
      .eq('tech_id', staff.id)
      .lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString())
      .neq('status', 'cancelled').order('starts_at');
    if (id !== req.current) return; // a newer request replaced this one
    if (err) { setError(err.message); return; }
    setError('');
    setData({ key: weekKey, visits: rows || [] });
  }, [staff.id, weekKey]);

  useEffect(() => { load(); }, [load]);

  // fresh data and a fresh "now" line whenever the app comes back to the front
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') { setNow(new Date()); load(); } };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); clearInterval(tick); };
  }, [load]);

  const ready = data.key === weekKey;
  const shift = (n) => setDay((d) => addDays(d, mode === 'week' ? n * 7 : n));

  return (
    <TechScheduleView
      visits={ready ? data.visits : []}
      ready={ready}
      error={error}
      day={day}
      mode={mode}
      now={now}
      onDay={setDay}
      onMode={setMode}
      onShift={shift}
      onToday={() => setDay(startOfDay(new Date()))}
      onRetry={load}
    />
  );
}
