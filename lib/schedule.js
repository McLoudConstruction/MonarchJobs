// Scheduling helpers. A visit counts toward double-booking while it is still active.
const ACTIVE = new Set(['scheduled', 'on_the_way', 'started']);

function ms(v) {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return ms(aStart) < ms(bEnd) && ms(bStart) < ms(aEnd);
}

// Visits for the same tech that overlap the proposed time range.
export function findConflicts(visits, { techId, start, end, excludeId = null }) {
  if (!techId) return [];
  return visits.filter(
    (v) =>
      v.tech_id === techId &&
      v.id !== excludeId &&
      ACTIVE.has(v.status) &&
      overlaps(v.starts_at, v.ends_at, start, end)
  );
}

// Ids of visits that currently overlap another active visit for the same tech.
// This is what keeps jobs "visibly flagged" after an owner overrides the warning.
export function doubleBookedIds(visits) {
  const flagged = new Set();
  const byTech = new Map();
  for (const v of visits) {
    if (!v.tech_id || !ACTIVE.has(v.status)) continue;
    if (!byTech.has(v.tech_id)) byTech.set(v.tech_id, []);
    byTech.get(v.tech_id).push(v);
  }
  for (const list of byTech.values()) {
    const sorted = [...list].sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (ms(sorted[j].starts_at) >= ms(sorted[i].ends_at)) break;
        flagged.add(sorted[i].id);
        flagged.add(sorted[j].id);
      }
    }
  }
  return flagged;
}
