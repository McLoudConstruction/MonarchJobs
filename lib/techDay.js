// Helpers for the technician's phone schedule (a vertical day timeline and a week list).
// Pure functions so they can be tested. All times are the browser's local time.
import { DAY_START_HOUR, DAY_END_HOUR, fractionFromTime } from './weekGrid.js';

const MIN = 60 * 1000;

function midnight(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function nextMidnight(d) {
  const x = midnight(d);
  x.setDate(x.getDate() + 1);
  return x;
}

export function sameDay(a, b) {
  return midnight(a).getTime() === midnight(b).getTime();
}

// Length of a visit in minutes (stored duration, or derived from the end time).
export function visitMinutes(v) {
  if (v.duration_minutes) return Number(v.duration_minutes);
  const m = Math.round((new Date(v.ends_at) - new Date(v.starts_at)) / MIN);
  return m > 0 ? m : 60;
}

// Visits that run during `day` (including one that started the evening before), earliest first.
export function visitsOnDay(visits, day) {
  const from = midnight(day).getTime();
  const to = nextMidnight(day).getTime();
  return visits
    .filter((v) => {
      const s = new Date(v.starts_at).getTime();
      return s < to && s + visitMinutes(v) * MIN > from;
    })
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

// The hours the day's timeline covers: 6 AM to 8 PM, stretched to take in any visit outside that
// window, so a technician never has an appointment that is off the page.
export function dayHourRange(visits, day, base = { startHour: DAY_START_HOUR, endHour: DAY_END_HOUR }) {
  const from = midnight(day).getTime();
  const to = nextMidnight(day).getTime();
  let startHour = base.startHour;
  let endHour = base.endHour;
  for (const v of visits) {
    const s = new Date(v.starts_at).getTime();
    const e = s + visitMinutes(v) * MIN;
    if (e <= from || s >= to) continue;
    startHour = Math.min(startHour, s <= from ? 0 : new Date(s).getHours());
    if (e >= to) {
      endHour = 24;
    } else {
      const end = new Date(e);
      endHour = Math.max(endHour, Math.min(24, end.getHours() + (end.getMinutes() || end.getSeconds() ? 1 : 0)));
    }
  }
  return { startHour, endHour };
}

// Where the page should open on the timeline, as a share (0 to 1) of the day's height.
// Today opens at the current time; another day opens at its first appointment. null means
// "no reason to scroll" (an empty day), so the page stays at the top.
export function focusFraction({ visits, day, range, now = new Date() }) {
  let t;
  if (sameDay(now, day)) t = now;
  else if (visits.length) t = new Date(Math.max(new Date(visits[0].starts_at).getTime(), midnight(day).getTime()));
  else return null;
  const f = fractionFromTime(t, day, range);
  return Math.min(Math.max(f, 0), 1);
}

// Seven days starting at `start`.
export function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}
