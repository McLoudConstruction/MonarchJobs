'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import { addDays, fmtDay, fmtTime, fmtDuration } from '@/lib/format';
import { doubleBookedIds } from '@/lib/schedule';
import { DAY_START_HOUR, DAY_END_HOUR, layoutDay, timeFromFraction, fractionFromTime, dragStartFromPoint, weekStartMonday } from '@/lib/weekGrid';
import { techColorOf, UNASSIGNED_COLOR } from '@/lib/userColors';
import { staffName } from '@/lib/userDisplay';
import './weekgrid.css';

const HOUR_PX = 44;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const GUTTER_PX = 56;       // width of the hour labels column (keep in step with weekgrid.css)
const ROLLING_DAYS = 28;    // days loaded to start with in rolling mode
const ROLLING_MAX_DAYS = 140;

// A week of visits laid out by time of day. Pass onPick to let the person click a time slot, or drag the
// dashed appointment box to a new time or day (used when scheduling); pass proposed to draw the
// appointment being planned; pass linkVisits to open a job when its block is clicked (used on the
// Schedule page). With rolling, the first column is always today and the grid scrolls sideways through
// the following days and weeks (more days load as you near the end) instead of paging a Monday-to-Sunday week.
export default function WeekGrid({
  weekStart, onWeekChange, techs, focusTechId = '', proposed = null, onPick = null,
  excludeVisitId = null, linkVisits = false, hint = null, rolling = false, proposedLabel = 'New',
}) {
  const [visits, setVisits] = useState([]);
  const [view, setView] = useState(focusTechId || 'all');
  const [dragStart, setDragStart] = useState(null); // Date while the planned appointment is being dragged
  const colRefs = useRef([]);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const justDragged = useRef(false);
  const [span, setSpan] = useState(ROLLING_DAYS);   // rolling: how many days are drawn
  const [firstIdx, setFirstIdx] = useState(0);        // rolling: index of the left-most visible day
  const rangeStart = useMemo(() => {
    if (!rolling) return weekStart;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, [rolling, weekStart]);
  const count = rolling ? span : 7;
  const days = useMemo(() => Array.from({ length: count }, (_, i) => addDays(rangeStart, i)), [rangeStart, count]);
  const rangeEnd = useMemo(() => addDays(rangeStart, count), [rangeStart, count]);

  // follow the tech chosen in the form above, unless the person has picked another view
  useEffect(() => { setView(focusTechId || 'all'); }, [focusTechId]);

  useEffect(() => {
    let cancelled = false;
    getSupabase().from('job_visits')
      .select('id,tech_id,starts_at,ends_at,duration_minutes,status,job:jobs(id,job_number,customer:customers(display_name),address:addresses(street,city))')
      .lt('starts_at', rangeEnd.toISOString()).gt('ends_at', rangeStart.toISOString())
      .neq('status', 'cancelled').order('starts_at')
      .then(({ data }) => { if (!cancelled) setVisits(data || []); });
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd]);

  const techName = (id) => { const t = techs.find((x) => x.id === id); return t ? staffName(t) : 'Unassigned'; };
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

  // Open on the right part of the day: the appointment being planned if it is in this week, otherwise now.
  // Does nothing where the page itself scrolls instead of this box.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollHeight <= el.clientHeight + 1) return;
    const inWeek = (d) => d >= rangeStart && d < rangeEnd;
    const planned = proposed?.start ? new Date(proposed.start) : null;
    const target = planned && inWeek(planned) ? planned : inWeek(new Date()) ? new Date() : null;
    const f = target ? fractionFromTime(target, target) : 0;
    el.scrollTop = Math.max(0, f * HOURS.length * HOUR_PX - HOUR_PX * 1.5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart.getTime()]);

  // Rolling: draw far enough ahead to include the appointment being planned.
  useEffect(() => {
    if (!rolling || !proposed?.start) return;
    const day = new Date(proposed.start);
    day.setHours(0, 0, 0, 0);
    const need = Math.round((day.getTime() - rangeStart.getTime()) / 86400000) + 1;
    if (need > span) setSpan(Math.min(ROLLING_MAX_DAYS, Math.ceil((need + 7) / 7) * 7));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling, proposed?.start]);

  // Rolling: when the appointment moves to a day that is off screen (typed in the date picker), scroll to it.
  const propDayKey = proposed?.start ? new Date(proposed.start).toDateString() : '';
  useEffect(() => {
    if (!rolling || !propDayKey) return;
    const el = scrollRef.current;
    const idx = days.findIndex((d) => d.toDateString() === propDayKey);
    if (!el || idx < 0) return;
    const w = colWidth();
    const centre = idx * w + w / 2;
    if (centre < el.scrollLeft || centre > el.scrollLeft + el.clientWidth - GUTTER_PX) el.scrollTo({ left: idx * w, behavior: 'smooth' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling, propDayKey, days.length]);

  const colWidth = () => colRefs.current[0]?.offsetWidth || 120;
  function onScroll() {
    if (!rolling) return;
    const el = scrollRef.current;
    if (!el) return;
    const w = colWidth();
    setFirstIdx(Math.min(Math.max(Math.round(el.scrollLeft / w), 0), days.length - 1));
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - w * 3) setSpan((s) => Math.min(ROLLING_MAX_DAYS, s + ROLLING_DAYS));
  }
  const scrollWeeks = (dir) => scrollRef.current?.scrollBy({ left: dir * colWidth() * 7, behavior: 'smooth' });
  const scrollToToday = () => scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' });

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
    <div className={`wg${rolling ? ' wg-rolling' : ''}`} style={{ '--wg-hour': `${HOUR_PX}px` }}>
      <div className="wg-bar">
        <button type="button" className="secondary small" onClick={() => (rolling ? scrollWeeks(-1) : onWeekChange(addDays(weekStart, -7)))}>Prev</button>
        <button type="button" className="secondary small" onClick={() => (rolling ? scrollToToday() : onWeekChange(weekStartMonday(new Date())))}>{rolling ? 'Today' : 'This week'}</button>
        <button type="button" className="secondary small" onClick={() => (rolling ? scrollWeeks(1) : onWeekChange(addDays(weekStart, 7)))}>Next</button>
        <span className="range">{fmtDay(days[rolling ? firstIdx : 0])} to {fmtDay(days[Math.min((rolling ? firstIdx : 0) + 6, days.length - 1)])}</span>
        <span className="wg-legend">
          {techs.filter((t) => view === 'all' || t.id === view).map((t) => (
            <span key={t.id}><i style={{ background: techColorOf(techs, t.id) }} />{staffName(t)}</span>
          ))}
          <span><i style={{ background: UNASSIGNED_COLOR }} />Unassigned</span>
        </span>
        <span style={{ flex: 1 }} />
        <select value={view} onChange={(e) => setView(e.target.value)} aria-label="Show">
          <option value="all">All techs</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{staffName(t)}</option>)}
        </select>
      </div>
      <div className="wg-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="wg-inner" style={rolling ? { '--wg-n': days.length } : undefined}>
          <div className="wg-head">
            <div />
            {days.map((d, i) => {
              const { outside } = layoutDay(shown, d);
              const isToday = d.toDateString() === todayKey;
              return (
                <div key={d.getTime()} className={`${isToday ? 'today' : ''}${rolling && i > 0 && d.getDay() === 1 ? ' wk' : ''}`}>
                  {fmtDay(d)}
                  {rolling && isToday && <span className="out tag">Today</span>}
                  {outside.length > 0 && <span className="out">+{outside.length} outside {hourLabel(DAY_START_HOUR)} to {hourLabel(DAY_END_HOUR)}</span>}
                </div>
              );
            })}
          </div>
          <div className="wg-body">
            <div className="wg-gutter" style={{ height: HOURS.length * HOUR_PX }}>
              {HOURS.map((h, i) => <span key={h} style={{ top: i * HOUR_PX }}>{i === 0 ? '' : hourLabel(h)}</span>)}
            </div>
            {days.map((d, di) => {
              const { items } = layoutDay(shown, d);
              const showProposed = propStart && propStart.toDateString() === d.toDateString();
              const pTop = showProposed ? fractionFromTime(propStart, d) : 0;
              const pHeight = showProposed ? ((proposed.duration || 60) / ((DAY_END_HOUR - DAY_START_HOUR) * 60)) : 0;
              return (
                <div key={d.getTime()} ref={(el) => { colRefs.current[days.indexOf(d)] = el; }}
                  className={`wg-col${onPick ? ' clickable' : ''}${d.toDateString() === todayKey ? ' today' : ''}${rolling && di > 0 && d.getDay() === 1 ? ' wk' : ''}`}
                  style={{ height: HOURS.length * HOUR_PX }} onClick={(e) => pick(e, d)}>
                  {items.map(({ visit: v, top, height, lane, lanes }) => {
                    const style = {
                      top: `${top * 100}%`, height: `${height * 100}%`, left: `calc(${(lane / lanes) * 100}% + 1px)`,
                      width: `calc(${100 / lanes}% - 2px)`, '--wg-color': techColorOf(techs, v.tech_id),
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
                  {d.toDateString() === todayKey && (() => { const f = fractionFromTime(new Date(), d); return f > 0 && f < 1 ? <div className="wg-now" style={{ top: `${f * 100}%` }} /> : null; })()}
                  {showProposed && pTop < 1 && pTop + pHeight > 0 && (
                    <div className={`wg-proposed${onPick ? ' draggable' : ''}${dragStart ? ' dragging' : ''}`}
                      onPointerDown={(e) => beginDrag(e, d)} onClick={(e) => e.stopPropagation()}
                      title={onPick ? 'Drag to move the appointment' : undefined}
                      style={{ top: `${Math.max(pTop, 0) * 100}%`, height: `${Math.min(pHeight, 1 - Math.max(pTop, 0)) * 100}%` }}>
                      {proposedLabel}: {fmtTime(propStart)} · {fmtDuration(proposed.duration)}
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
