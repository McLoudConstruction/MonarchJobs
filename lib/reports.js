// What the job's Reports tab offers, worked out from what the job has. Pure, so the tab and the tests agree.
//
// A report is made on the spot from the job's current data, so it is never out of date. Nothing is stored. Reports that
// leave the office (everything here) never name staff.
import { hasFeature } from './services.js';
import { normalizePlan } from './sketch.js';
import { reportablePhotos, beforeAfterPairs } from './photoReport.js';

// The drying PDFs and files, in the order they are listed. `needs` says what the sketch must hold for it to make sense.
export const DRYING_REPORTS = [
  { key: 'moisture-full', variant: 'full', format: 'pdf', title: 'Moisture report', needs: 'any', text: 'Floor plan, readings by day, drying curves, dry dates, equipment placed and the full log. The report to give the customer.' },
  { key: 'moisture-summary', variant: 'summary', format: 'pdf', title: 'Summary', needs: 'any', text: 'One page: status, the floor plan and a result for each room.' },
  { key: 'moisture-equipment', variant: 'equipment', format: 'pdf', title: 'Equipment report', needs: 'equipment', text: 'What equipment was set, where, for how long, and how the dehumidifiers performed.' },
  { key: 'moisture-carrier', variant: 'carrier', format: 'pdf', title: 'Carrier packet', needs: 'any', text: 'The full report plus a map page for each room and dehumidifier performance. For the insurance file.' },
  { key: 'moisture-log', variant: 'log', format: 'csv', title: 'Moisture log (spreadsheet)', needs: 'readings', text: 'Every reading, one row each.' },
  { key: 'moisture-summary-csv', variant: 'summary-csv', format: 'csv', title: 'Moisture summary (spreadsheet)', needs: 'readings', text: 'One row per moisture point with its status.' },
  { key: 'equipment-log', variant: 'equipment-csv', format: 'csv', title: 'Equipment log (spreadsheet)', needs: 'equipment', text: 'Every machine, where and when it was placed and picked up.' },
];

// What one sketch holds, for turning reports on and off. sketches: [{ id, name, plan }]
export function sketchContents(sketches) {
  return (sketches || []).map((s) => {
    const plan = normalizePlan(s.plan);
    return { id: s.id, name: s.name || 'Sketch', readings: plan.moisture.length, equipment: (plan.equipment || []).length, rooms: plan.rooms.length };
  });
}

// Is this drying report ready for a sketch with these contents?
export function dryingReady(report, c) {
  if (!c) return false;
  if (report.needs === 'equipment') return c.equipment > 0;
  if (report.needs === 'readings') return c.readings > 0;
  return c.readings > 0 || c.equipment > 0;
}

// Which sketch to start on: the one with the most readings (then equipment), so the usual single-sketch job needs no choosing.
export function defaultSketch(contents) {
  if (!contents.length) return null;
  return [...contents].sort((a, b) => (b.readings + b.equipment) - (a.readings + a.equipment))[0].id;
}

// The groups the tab shows. photos: the job's photo rows. Returns
// [{ key, title, note?, items: [{ key, title, text, ready, hint }] }]. Drying only for jobs that have the Moisture tab.
export function reportGroups({ service = '', sketches = [], photos = [], rooms = [] }) {
  const live = reportablePhotos(photos);
  const pairs = beforeAfterPairs(photos, rooms);
  const groups = [{
    key: 'photos',
    title: 'Photos',
    items: [
      { key: 'photo-report', title: 'Photo report', text: 'Pictures in groups (Before, During, After, Damage) or by room, two to a row, each with its date.', ready: live.length > 0, hint: 'Take or add photos on the Photos tab first.' },
      { key: 'before-after', title: 'Before & after', text: 'Each Before next to its After, one pair to a row, with the room named.', ready: pairs.length > 0, hint: 'Needs a Before and an After photo of the same room. Open a Before photo and tap Take the after to line them up.' },
    ],
  }];
  if (hasFeature(service, 'moistureTab')) {
    const contents = sketchContents(sketches);
    const best = contents.find((c) => c.id === defaultSketch(contents));
    groups.push({
      key: 'drying',
      title: 'Drying',
      items: DRYING_REPORTS.map((r) => ({
        key: r.key, title: r.title, text: r.text, format: r.format, variant: r.variant,
        ready: dryingReady(r, best),
        hint: !contents.length ? 'Draw the rooms on the Sketch tab, then log readings on the Moisture tab.'
          : r.needs === 'equipment' ? 'Place equipment on the Moisture tab first.'
            : r.needs === 'readings' ? 'Log moisture readings on the Moisture tab first.'
              : 'Log readings or place equipment on the Moisture tab first.',
      })),
    });
  }
  return groups;
}

export const reportFileName = (jobNumber, suffix, ext) => `job-${jobNumber || 'report'}-${suffix}.${ext}`;
