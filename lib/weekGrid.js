// Layout rules for the week timeline used to pick an appointment time. Pure functions so they
// can be tested. Times are positioned as a share of the visible hours in a day column.

export const DAY_START_HOUR = 6;   // first hour shown
export const DAY_END_HOUR = 20;    // last hour shown (the grid ends at 8 PM)
export const SNAP_MINUTES = 15;

const MIN = 60 * 1000;

export function visibleMinutes(startHour = DAY_START_HOUR, endHour = DAY_END_HOUR) {
  return (endHour - startHour) * 60;
}

function dayBounds(day, startHour, endHour) {
  const s = new Date(day);
  s.setHours(startHour, 0, 0, 0);
  const e = new Date(day);
  e.setHours(endHour, 0, 0, 0);
  return [s.getTime(), e.getTime()];
}

// Places one day's visits in the column. Overlapping visits are put side by side ("lanes").
// Visits outside the visible hours are clipped; ones entirely outside are listed as `outside`.
// Each visit needs starts_at and duration_minutes (or ends_at).
export function layoutDay(visits, day, { startHour = DAY_START_HOUR, endHour = DAY_END_HOUR } = {}) {
  const [from, to] = dayBounds(day, startHour, endHour);
  const total = to - from;
  const items = [];
  const outside = [];

  const sorted = [...visits]
    .map((v) => {
      const start = new Date(v.starts_at).getTime();
      const end = v.duration_minutes ? start + v.duration_minutes * MIN : new Date(v.ends_at).getTime();
      return { v, start, end };
    })
    .filter((x) => x.end > new Date(day).setHours(0, 0, 0, 0) && x.start < new Date(day).setHours(24, 0, 0, 0))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const laneEnds = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  const finishCluster = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.lanes = lanes;
    cluster = [];
    laneEnds.length = 0;
  };

  for (const x of sorted) {
    if (x.end <= from || x.start >= to) {
      outside.push(x.v);
      continue;
    }
    if (x.start >= clusterEnd) {
      finishCluster();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((e) => e <= x.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(x.end);
    } else {
      laneEnds[lane] = x.end;
    }
    clusterEnd = Math.max(clusterEnd, x.end);
    const top = (Math.max(x.start, from) - from) / total;
    const bottom = (Math.min(x.end, to) - from) / total;
    const item = { visit: x.v, top, height: Math.max(bottom - top, 0.01), lane, lanes: 1 };
    items.push(item);
    cluster.push(item);
  }
  finishCluster();
  return { items, outside };
}

// A click or tap at `fraction` (0 at the top of the column, 1 at the bottom) becomes a start time,
// snapped to the nearest quarter hour and kept inside the visible hours.
export function timeFromFraction(day, fraction, { startHour = DAY_START_HOUR, endHour = DAY_END_HOUR, snap = SNAP_MINUTES } = {}) {
  const f = Math.min(Math.max(fraction, 0), 1);
  const minutes = Math.round((f * visibleMinutes(startHour, endHour)) / snap) * snap;
  const capped = Math.min(minutes, visibleMinutes(startHour, endHour) - snap);
  const d = new Date(day);
  d.setHours(startHour, 0, 0, 0);
  return new Date(d.getTime() + capped * MIN);
}

export function fractionFromTime(date, day, { startHour = DAY_START_HOUR, endHour = DAY_END_HOUR } = {}) {
  const [from, to] = dayBounds(day, startHour, endHour);
  return (new Date(date).getTime() - from) / (to - from);
}

// Dragging the planned appointment: given the on-screen rectangles of the day columns
// (left, right, top, height), the pointer position, and how far below the top of the box the person
// grabbed it (as a share of the column height), returns the new start time. The column under the pointer
// wins; past either edge it sticks to the first or last day. Snaps like a click does.
export function dragStartFromPoint(days, rects, clientX, clientY, grabFraction = 0, opts = {}) {
  if (!days.length || days.length !== rects.length) return null;
  let i = rects.findIndex((r) => clientX >= r.left && clientX < r.right);
  if (i === -1) i = clientX < rects[0].left ? 0 : days.length - 1;
  const r = rects[i];
  if (!(r.height > 0)) return null;
  return timeFromFraction(days[i], (clientY - r.top) / r.height - grabFraction, opts);
}

// Monday of the week containing `d`, at local midnight.
export function weekStartMonday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

// Colors for techs, stable by position in the list. Unassigned is grey.
const PALETTE = ['#2563a8', '#2f7d6d', '#a8552a', '#7b4fa3', '#b08a00', '#a3365a'];
export function techColor(techIds, id) {
  if (!id) return '#6b7686';
  const i = techIds.indexOf(id);
  return PALETTE[(i < 0 ? techIds.length : i) % PALETTE.length];
}
