// Suggested stop order (push 2A, #27). For one tech on one day: which job should go in which time slot so the drive time is shortest.
// The start TIMES stay where they are; only which job sits in which slot changes, and the first stop stays put (we do not know
// where the tech starts the day). A suggestion that would not fit the day is never offered as applicable.
// Pure, so the server, the screen and the tests agree. matrix[i][j] is drive seconds from stop i to stop j (null when unknown).

export const MIN_STOPS = 3;       // with the first stop fixed, two stops cannot be improved
export const MAX_STOPS = 10;      // exact answer up to here; beyond this the tab says the day is too long to suggest
export const MIN_SAVING_SECONDS = 5 * 60; // smaller savings are not worth moving anyone

const roundUp = (sec, to) => Math.ceil(sec / to) * to;

export function totalDrive(matrix, order) {
  let t = 0;
  for (let i = 0; i < order.length - 1; i += 1) {
    const s = matrix?.[order[i]]?.[order[i + 1]];
    if (!Number.isFinite(s)) return Infinity;
    t += s;
  }
  return t;
}

// Shortest path through all stops starting at stop 0, by dynamic programming over subsets (exact for up to 10 stops).
// Returns the order as indexes into the stop list, always starting with 0. Returns null if some drive time is unknown.
export function bestOrder(matrix) {
  const n = matrix.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  if (n > MAX_STOPS) return null;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) if (i !== j && !Number.isFinite(matrix[i]?.[j])) return null;
  const full = 1 << n;
  const dp = Array.from({ length: full }, () => new Array(n).fill(Infinity));
  const prev = Array.from({ length: full }, () => new Array(n).fill(-1));
  dp[1][0] = 0;
  for (let mask = 1; mask < full; mask += 1) {
    if (!(mask & 1)) continue;
    for (let last = 0; last < n; last += 1) {
      if (!(mask & (1 << last)) || dp[mask][last] === Infinity) continue;
      for (let nx = 1; nx < n; nx += 1) {
        if (mask & (1 << nx)) continue;
        const m2 = mask | (1 << nx);
        const cost = dp[mask][last] + matrix[last][nx];
        if (cost < dp[m2][nx]) { dp[m2][nx] = cost; prev[m2][nx] = last; }
      }
    }
  }
  let best = Infinity;
  let end = 0;
  for (let last = 1; last < n; last += 1) if (dp[full - 1][last] < best) { best = dp[full - 1][last]; end = last; }
  const order = [];
  for (let mask = full - 1, cur = end; cur !== -1; ) {
    order.push(cur);
    const p = prev[mask][cur];
    mask &= ~(1 << cur);
    cur = p;
  }
  return order.reverse();
}

// stops: the day's visits for one tech, earliest first: [{ id, starts_at, duration_minutes }].
// matrix: drive seconds between them in that same order. Returns the plan the screen shows:
// { ok, reason, current, suggested, savedSeconds, fits, moves: [{ id, from, to, newStart, newEnd }] }.
export function planRoute({ stops, matrix, roundTo = 15 * 60 }) {
  const n = stops.length;
  if (n < MIN_STOPS) return { ok: false, reason: 'few', moves: [] };
  if (n > MAX_STOPS) return { ok: false, reason: 'many', moves: [] };
  const order = bestOrder(matrix);
  if (!order) return { ok: false, reason: 'unknown', moves: [] };
  const currentOrder = stops.map((_, i) => i);
  const current = totalDrive(matrix, currentOrder);
  const suggested = totalDrive(matrix, order);
  const savedSeconds = Math.round(current - suggested);

  // the slot times in the order they happen; the new order's jobs take them in turn
  const slotStarts = stops.map((s) => Date.parse(s.starts_at));
  const moves = [];
  let fits = true;
  order.forEach((stopIdx, slot) => {
    const s = stops[stopIdx];
    const start = slotStarts[slot];
    const end = start + s.duration_minutes * 60000;
    if (slot < n - 1) {
      const drive = matrix[stopIdx][order[slot + 1]];
      if (end + roundUp(drive, roundTo) * 1000 > slotStarts[slot + 1]) fits = false;
    }
    if (stopIdx !== slot) moves.push({ id: s.id, from: stopIdx, to: slot, newStart: new Date(start).toISOString(), newEnd: new Date(end).toISOString() });
  });

  if (moves.length === 0 || savedSeconds < MIN_SAVING_SECONDS) return { ok: false, reason: 'already', current, suggested, savedSeconds: Math.max(0, savedSeconds), order, fits, moves: [] };
  if (!fits) return { ok: false, reason: 'nofit', current, suggested, savedSeconds, order, fits, moves };
  return { ok: true, reason: '', current, suggested, savedSeconds, order, fits, moves };
}

export const REASON_TEXT = {
  few: 'Needs at least three stops in the day.',
  many: `More than ${MAX_STOPS} stops in one day is too many to suggest an order for.`,
  unknown: 'Some drive times could not be worked out. Check the addresses.',
  already: 'The current order is already about as short as it gets.',
  nofit: 'A shorter order exists, but the jobs would not fit in the time slots, so it is not offered.',
};

export const minutes = (sec) => Math.round(sec / 60);
