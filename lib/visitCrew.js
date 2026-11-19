// Visits with more than one team member. A crew is several job_visits rows with the same crew_id (the lead's visit id), one row per
// person, so each person keeps their own schedule, status buttons and job clock. A visit with crew_id null is on its own.

// Group a job's visits for display: [{ key, lead, members: [rows, lead first], solo }]. Order follows the lead's start time.
export function groupVisits(visits) {
  const groups = new Map();
  for (const v of visits || []) {
    const key = v.crew_id || v.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const members = [...rows].sort((a, b) => (a.id === key ? -1 : b.id === key ? 1 : 0));
    return { key, lead: members[0], members, solo: members.length === 1 };
  }).sort((a, b) => String(a.lead.starts_at).localeCompare(String(b.lead.starts_at)));
}

// Rows of the same crew as this visit, this one included. Cancelled rows do not count as part of the crew.
export function crewOf(visit, visits) {
  if (!visit?.crew_id) return visit ? [visit] : [];
  return (visits || []).filter((v) => v.crew_id === visit.crew_id && v.status !== 'cancelled');
}

// What saving a crew needs: which people to add, which rows to remove, which rows to keep. `rows` are the crew's current rows
// (lead first), `wanted` the ids of the extra people now ticked, `leadId` the lead's person. A person whose visit has already begun cannot
// be removed, so they stay even if unticked.
export function planCrew({ rows, leadTech, wanted }) {
  const extras = [...new Set((wanted || []).filter((id) => id && id !== leadTech))];
  const lead = rows[0];
  const others = rows.slice(1);
  const have = new Map(others.map((r) => [r.tech_id, r]));
  const add = extras.filter((id) => !have.has(id));
  const remove = others.filter((r) => !extras.includes(r.tech_id) && r.status === 'scheduled');
  const keep = [lead, ...others.filter((r) => !remove.includes(r))].filter(Boolean);
  return { add, remove, keep };
}

// A crew member added after the lead finished: the job is complete once everybody who started is done. Rows still only scheduled in
// the finishing visit's own crew are part of the same visit, not a return trip.
export const isReturnVisit = (row, finishing) => !(finishing.crew_id && row.crew_id === finishing.crew_id && row.status === 'scheduled');
