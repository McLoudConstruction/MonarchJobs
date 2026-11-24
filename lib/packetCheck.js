// "Is the carrier packet ready?" A plain-language readiness check for a water loss, run from what the job already holds.
// Advice only: every gap is a warning with the place to fix it, nothing is blocked (the S500 checker idea: show the packet's gaps
// so the office can add a note for each exception). Pure and tested.
import { stepStatus, categoryOf } from './waterDayOne.js';
import { chamberStatus, hasReadings } from './chamberDry.js';
import { unitsStillOnSite } from './equipment.js';
import { buildReport } from './moistureReport.js';

// input: { steps: job_water_steps rows, photos: job_photos rows (not archived), plans: [normalized sketch plans] }
// Returns { items: [{ id, ok, label, detail }], gaps: n, total: n }. `detail` says what is missing and where to fix it.
export function packetCheck({ steps = [], photos = [], plans = [] } = {}) {
  const st = stepStatus(steps);
  const items = [];
  const add = (id, ok, label, detail = '') => items.push({ id, ok: !!ok, label, detail: ok ? '' : detail });

  add('safety', st.safety === 'done', 'Arrival safety check', 'Not recorded. Do it from Day 1 steps on the job.');
  add('authorization', st.authorization === 'done', 'Work authorization signed',
    st.authorization === 'absent' ? 'Customer was not present. Send the e-sign link from Day 1 steps.' : 'Not signed yet. Do it from Day 1 steps.');
  add('category', categoryOf(steps) != null, 'Water category set with a reason', 'Set it in the walkthrough step.');

  const live = (photos || []).filter((p) => !p.archived_at);
  add('photos', live.length > 0, 'Initial photos', 'No photos on this job yet.');

  const withRooms = plans.filter((p) => (p.rooms || []).length);
  add('sketch', withRooms.length > 0, 'Sketch with rooms', 'Draw the rooms on the Sketch tab.');

  const measured = plans.filter(hasReadings);
  add('readings', measured.length > 0, 'Moisture readings logged', 'Log readings on the Moisture tab.');

  // per plan checks, listed by room or chamber name so the office knows where to look
  const noGoal = [];
  const once = [];
  const notDry = [];
  const noRoomPhotos = [];
  const onSite = [];
  let early = 0;
  for (const plan of plans) {
    if (!(plan.days || []).length) continue;
    const rep = buildReport(plan);
    for (const r of rep.rows) {
      if (r.goal == null) noGoal.push(`point ${r.p.n}`);
      const read = Object.values(r.cells || {}).filter((v) => v != null).length;
      if (read < 2) once.push(`point ${r.p.n}`);
    }
    for (const c of chamberStatus(plan)) {
      if (c.state !== 'dry' && c.points > 0) notDry.push(c.name);
      if (c.state === 'no_readings' && c.units.length) notDry.push(`${c.name} (no readings)`);
      const photoRooms = new Set(live.filter((p) => p.room_key).map((p) => p.room_key));
      if (c.points > 0 && !c.roomIds.some((id) => photoRooms.has(id))) noRoomPhotos.push(c.name);
    }
    onSite.push(...unitsStillOnSite(plan));
    for (const u of plan.equipment || []) for (const e of u.log || []) if (e.why) early++;
  }
  const uniq = (a) => [...new Set(a)];
  if (measured.length) {
    add('goals', noGoal.length === 0, 'A dry standard for every material', `No standard set for ${uniq(noGoal).slice(0, 6).join(', ')}. Set it on the Moisture tab.`);
    add('rechecks', once.length === 0, 'Every point read more than once', `Only one reading for ${uniq(once).slice(0, 6).join(', ')}. Add a recheck or skip with a reason.`);
    add('roomphotos', noRoomPhotos.length === 0, 'A photo for each wet chamber', `No photo tied to ${uniq(noRoomPhotos).slice(0, 4).join(', ')}.`);
    add('dry', notDry.length === 0, 'Every chamber at its drying goal', `Not at the goal: ${uniq(notDry).slice(0, 4).join(', ')}.`);
    add('equipment', onSite.length === 0, 'All equipment picked up', `Still on site: ${uniq(onSite).slice(0, 8).join(', ')}.`);
  }
  add('certificate', st.certificate === 'done', 'Certificate of completion signed',
    st.certificate === 'absent' ? 'Customer was not present. Send the e-sign link.' : 'Not signed yet.');

  const gaps = items.filter((i) => !i.ok).length;
  return { items, gaps, total: items.length, early };
}
