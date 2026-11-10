'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { addDays, fmtDay, fmtTime, fmtDuration } from '@/lib/format';
import { doubleBookedIds } from '@/lib/schedule';
import { DAY_START_HOUR, DAY_END_HOUR, layoutDay, timeFromFraction, fractionFromTime, dragStartFromPoint, weekStartMonday, techColor } from '@/lib/weekGrid';
import './weekgrid.css';

const HOUR_PX = 44;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

// A week of visits laid out by time of day. Pass onPick to let the person click a time slot, or drag the
// dashed appointment box to a new time or day (used when scheduling); pass proposed to draw the
// appointment being planned; pass linkVisits to open a job when its block is clicked (used on the
// Schedule page).
export default function WeekGrid({
  weekStart, onWeekChange, techs, focusTechId = '', proposed = null, onPick = null,
  excludeVisitId = null, linkVisits = false, hint = null,
}) {
  const [visits, setVisits] = useState([]);
  const [view, setView] = useState(focusTechId || 'all');
  const [dragStart, setDragStart] = useState(null); // Date while the planned appointment is being dragged
  const colRefs = useRef([]);
  const dragRef = useRef(null);
  const justDragged = useRef(false);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  // follow the tech chosen in the form above, unless the person has picked another view
  useEffect(() => { setView(focusTechId || 'all'); }, [focusTechId]);

  useEffect(() => {
    let cancelled = false;
    getSupabase().from('job_visits')
      .select('id,tech_id,starts_at,ends_at,duration_minutes,status,job:jobs(id,job_number,customer:customers(display_name),address:addresses(street,city))')
      .lt('starts_at', weekEnd.toISOString()).gt('ends_at', weekStart.toISOString())
      .neq('status', 'cancelled').order('starts_at')
      .then(({ data }) => { if (!cancelled) setVisits(data || []); });
    return () => { cancelled = true; };
  }, [weekStart, weekEnd]);

  const techIds = useMemo(() => techs.map((t) => t.id), [techs]);
  const techName = (id) => { const t = techs.find((x) => x.id === id); return t ? t.full_name || t.email : 'Unassigned'; };
  const shown = useMemo(
    () => visits.filter((v) => v.id !== excludeVisitId && (view === 'all' || v.tech_id === view)),
    [visits, view, excludeVisitId],
  );
  const flagged = useMemo(() => doubleBookedIds(shown), [shown]);
  const todayKey = new Date().toDateString();

  function pick(e, day) {
    if (!onPick || justDragged.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPick(timeFromFraction(day, (e.clientY - r.top) / r.height));
  }

  const propStart = dragStart || (proposed?.start ? new Date(proposed.start) : null);

  // Drag the planned appointment. Listeners go on the window so the drag keeps working when the box
  // moves into another day's column (the box is redrawn there).
  function beginDrag(e, day) {
    if (!onPick || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const col = colRefs.current[days.findIndex((d) => d.toDateString() === day.toDateString())];
    if (!col) return;
    e.preventDefault();
    e.stopPropagation();
    const r = col.getBoundingClientRect();
    const boxTop = r.top + fractionFromTime(propStart, day) * r.height;
    const state = { grab: (e.clientY - boxTop) / r.height, latest: null, moved: false, startX: e.clientX, startY: e.clientY };
    dragRef.current = state;

    const onMove = (ev) => {
      if (!state.moved && Math.hypot(ev.clientX - state.startX, ev.clientY - state.startY) < 4) return;
      state.moved = true;
      const rects = colRefs.current.map((c) => c.getBoundingClientRect());
      const next = dragStartFromPoint(days, rects, ev.clientX, ev.clientY, state.grab);
      if (next) { state.latest = next; setDragStart(next); }
    };
    const finish = (commit) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragRef.current = null;
      setDragStart(null);
      if (state.moved) {
        justDragged.current = true; // swallow the click that follows a drag
        setTimeout(() => { justDragged.current = false; }, 0);
        if (commit && state.latest) onPick(state.latest);
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  return (
    <div className="wg" style={{ '--wg-hour': `${HOUR_PX}px` }}>
      <div className="wg-bar">
        <button type="button" className="secondary small" onClick={() => onWeekChange(addDays(weekStart, -7))}>Previous week</button>
        <button type="button" className="secondary small" onClick={() => onWeekChange(weekStartMonday(new Date()))}>This week</button>
        <button type="button" className="secondary small" onClick={() => onWeekChange(addDays(weekStart, 7))}>Next week</button>
        <span className="range">{fmtDay(days[0])} to {fmtDay(days[6])}</span>
        <span style={{ flex: 1 }} />
        <label className="muted" style={{ fontSize: 14 }}>Show{' '}
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="all">All techs</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
          </select>
        </label>
      </div>
      <div className="wg-legend">
        {techs.filter((t) => view === 'all' || t.id === view).map((t) => (
          <span key={t.id}><i style={{ background: techColor(techIds, t.id) }} />{t.full_name || t.email}</span>
        ))}
        <span><i style={{ background: techColor(techIds, null) }} />Unassigned</span>
      </div>
      <div className="wg-scroll">
        <div className="wg-inner">
          <div className="wg-head">
            <div />
            {days.map((d) => {
              const { outside } = layoutDay(shown, d);
              return (
                <div key={d.getTime()} className={d.toDateString() === todayKey ? 'today' : ''}>
                  {fmtDay(d)}
                  {outside.length > 0 && <span className="out">+{outside.length} outside {hourLabel(DAY_START_HOUR)} to {hourLabel(DAY_END_HOUR)}</span>}
                </div>
              );
            })}
          </div>
          <div className="wg-body">
            <div className="wg-gutter" style={{ height: HOURS.length * HOUR_PX }}>
              {HOURS.map((h, i) => <span key={h} style={{ top: i * HOUR_PX }}>{i === 0 ? '' : hourLabel(h)}</span>)}
            </div>
            {days.map((d) => {
              const { items } = layoutDay(shown, d);
              const showProposed = propStart && propStart.toDateString() === d.toDateString();
              const pTop = showProposed ? fractionFromTime(propStart, d) : 0;
              const pHeight = showProposed ? ((proposed.duration || 60) / ((DAY_END_HOUR - DAY_START_HOUR) * 60)) : 0;
              return (
                <div key={d.getTime()} ref={(el) => { colRefs.current[days.indexOf(d)] = el; }}
                  className={`wg-col${onPick ? ' clickable' : ''}${d.toDateString() === todayKey ? ' today' : ''}`}
                  style={{ height: HOURS.length * HOUR_PX }} onClick={(e) => pick(e, d)}>
                  {items.map(({ visit: v, top, height, lane, lanes }) => {
                    const style = {
                      top: `${top * 100}%`, height: `${height * 100}%`, left: `calc(${(lane / lanes) * 100}% + 1px)`,
                      width: `calc(${100 / lanes}% - 2px)`, '--wg-color': techColor(techIds, v.tech_id),
                    };
                    const mins = v.duration_minutes || Math.round((new Date(v.ends_at) - new Date(v.starts_at)) / 60000);
                    const cls = `wg-visit${v.status === 'finished' ? ' done' : ''}${flagged.has(v.id) ? ' flag' : ''}`;
                    const body = (
                      <>
                        <div className="t">{fmtTime(v.starts_at)} · {fmtDuration(mins)}</div>
                        <div>#{v.job?.job_number} {v.job?.customer?.display_name}</div>
                      </>
                    );
                    const title = `${techName(v.tech_id)} · ${v.job?.address?.street || ''}`;
                    return linkVisits && v.job?.id ? (
                      <Link key={v.id} href={`/jobs/${v.job.id}`} className={cls} style={style} title={title} onClick={(e) => e.stopPropagation()}>{body}</Link>
                    ) : (
                      <div key={v.id} className={cls} style={style} title={title} onClick={(e) => e.stopPropagation()}>{body}</div>
                    );
                  })}
                  {showProposed && pTop < 1 && pTop + pHeight > 0 && (
                    <div className={`wg-proposed${onPick ? ' draggable' : ''}${dragStart ? ' dragging' : ''}`}
                      onPointerDown={(e) => beginDrag(e, d)} onClick={(e) => e.stopPropagation()}
                      title={onPick ? 'Drag to move the appointment' : undefined}
                      style={{ top: `${Math.max(pTop, 0) * 100}%`, height: `${Math.min(pHeight, 1 - Math.max(pTop, 0)) * 100}%` }}>
                      New: {fmtTime(propStart)} · {fmtDuration(proposed.duration)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {hint && <div className="wg-hint">{hint}</div>}
    </div>
  );
}
