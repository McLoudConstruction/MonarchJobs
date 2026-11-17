// Month calendar helpers for the Schedule page. Pure functions so they can be tested.

export const MAX_ROWS_PER_DAY = 4; // a day never draws more than this many rows

function startOfDayLocal(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function monthStart(d) {
  const x = startOfDayLocal(d);
  x.setDate(1);
  return x;
}

export function addMonths(d, n) {
  const x = monthStart(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

// Every day drawn for the month containing `d`: whole weeks, Monday to Sunday, so it is 28 to 42 days.
export function monthGridDays(d) {
  const first = monthStart(d);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0); // last day of the month
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  const trail = 6 - ((last.getDay() + 6) % 7);
  const count = lead + last.getDate() + trail;
  return Array.from({ length: count }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// Visits grouped by the local day they start, each day's list in time order.
export function groupVisitsByDay(visits) {
  const map = new Map();
  for (const v of visits) {
    const k = dayKey(v.starts_at);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  }
  for (const list of map.values()) list.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  return map;
}

// What one day cell draws. Up to `max` visits show as one row each. When there are more, the first
// max - 1 show and the last row becomes "+N more", so the cell is never taller than `max` rows.
export function dayRows(list, max = MAX_ROWS_PER_DAY) {
  if (list.length <= max) return { shown: list, more: 0 };
  return { shown: list.slice(0, max - 1), more: list.length - (max - 1) };
}
