// Before and after cleaning inspections: what the tech and the customer agree on at the door.
// Stored as one JSON document per inspection (job_inspections.data). Pure, so it can be tested.
//
//   { rooms: [{ id, name, fiber, traffic, pretest, notes, issues: [{ id, where, type, result, note }] }],
//     notes, drying_hours, walkthrough, comments }
// "Before" fills in fiber, traffic, pretest and issues (type, where). "After" keeps the same rooms and spots and adds a
// result for each spot, the drying time, and whether the walk-through was done.
import { FLOOR_TYPES, roomTitle } from './sketch.js';

export const KINDS = { pre: 'Before cleaning', post: 'After cleaning' };

export const FIBERS = [
  'Nylon', 'Polyester', 'Wool', 'Olefin (polypropylene)', 'Triexta', 'Acrylic', 'Viscose or silk', 'Natural fiber (sisal, jute)', 'Not sure',
];
export const ISSUE_TYPES = [
  'Pet urine', 'Food or drink', 'Grease or oil', 'Ink', 'Rust', 'Bleach or dye', 'Wicking or reappearing', 'Burn', 'Worn or frayed', 'Seam or stretch', 'Other',
];
export const PRETEST = { not_tested: 'Not tested', ok: 'Tested, no change', risk: 'Tested, color change or damage risk' };
export const RESULTS = { removed: 'Removed', improved: 'Improved', same: 'No change', permanent: 'Permanent, will not come out' };
// A spot is "unresolved" when the cleaning did not remove it: these are listed for the customer.
export const NOT_REMOVED = ['same', 'permanent'];

const MAX_ROOMS = 40;
const MAX_ISSUES = 30;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const oneOf = (v, list, fallback = '') => (list.includes(v) ? v : fallback);

export function newId(prefix = 'i') {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

export function blankRoom(name = '') {
  return { id: newId('r'), name, fiber: '', traffic: false, pretest: 'not_tested', notes: '', issues: [] };
}
export function blankIssue() {
  return { id: newId('s'), where: '', type: 'Food or drink', result: '', note: '' };
}
export function blankInspection() {
  return { rooms: [], notes: '', drying_hours: null, walkthrough: false, comments: '' };
}

// Rooms to start from: the job's sketch rooms that have carpet, or no floor type set yet.
export function roomsFromPlan(plan) {
  return (plan?.rooms || [])
    .filter((r) => !r.floor || r.floor === 'carpet')
    .map((r) => blankRoom(roomTitle(r)));
}

// Reads whatever is stored and returns a safe document for the kind.
export function cleanInspection(kind, raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const rooms = (Array.isArray(d.rooms) ? d.rooms : []).slice(0, MAX_ROOMS).map((r) => {
    const base = {
      id: str(r?.id, 24) || newId('r'),
      name: str(r?.name, 60),
      fiber: oneOf(r?.fiber, FIBERS),
      traffic: !!r?.traffic,
      pretest: oneOf(r?.pretest, Object.keys(PRETEST), 'not_tested'),
      notes: str(r?.notes, 400),
      issues: (Array.isArray(r?.issues) ? r.issues : []).slice(0, MAX_ISSUES).map((s) => {
        const issue = { id: str(s?.id, 24) || newId('s'), where: str(s?.where, 80), type: oneOf(s?.type, ISSUE_TYPES, 'Other') };
        if (kind === 'post') {
          issue.result = oneOf(s?.result, Object.keys(RESULTS));
          issue.note = str(s?.note, 200);
        }
        return issue;
      }),
    };
    return base;
  });
  const out = { rooms, notes: str(d.notes, 800) };
  if (kind === 'post') {
    const h = Math.round(Number(d.drying_hours));
    out.drying_hours = Number.isFinite(h) && h >= 1 && h <= 72 ? h : null;
    out.walkthrough = !!d.walkthrough;
    out.comments = str(d.comments, 600);
  }
  return out;
}

// The "after" form starts from what was written "before": same rooms, same spots, results left blank.
export function seedPostFromPre(pre) {
  const base = cleanInspection('pre', pre);
  return cleanInspection('post', {
    ...base,
    rooms: base.rooms.map((r) => ({ ...r, issues: r.issues.map((s) => ({ ...s, result: '', note: '' })) })),
    notes: '', drying_hours: null, walkthrough: false, comments: '',
  });
}

// What is still missing before the customer can sign. [] means ready.
export function missingBeforeSigning(kind, data) {
  const d = cleanInspection(kind, data);
  const out = [];
  if (!d.rooms.length) out.push('Add at least one room.');
  if (d.rooms.some((r) => !r.name)) out.push('Give every room a name.');
  if (kind === 'post') {
    if (d.rooms.some((r) => r.issues.some((s) => !s.result))) out.push('Choose a result for every spot.');
    if (!d.walkthrough) out.push('Tick that you walked through the work with the customer.');
  }
  return out;
}

// Counts for a one-line summary.
export function summarize(kind, data) {
  const d = cleanInspection(kind, data);
  const issues = d.rooms.flatMap((r) => r.issues);
  const base = { rooms: d.rooms.length, spots: issues.length };
  if (kind !== 'post') return { ...base, text: `${d.rooms.length} room${d.rooms.length === 1 ? '' : 's'}, ${issues.length} spot${issues.length === 1 ? '' : 's'} noted` };
  const notRemoved = issues.filter((s) => NOT_REMOVED.includes(s.result)).length;
  return {
    ...base, notRemoved,
    text: `${d.rooms.length} room${d.rooms.length === 1 ? '' : 's'}, ${issues.length} spot${issues.length === 1 ? '' : 's'}${issues.length ? `, ${notRemoved} not removed` : ''}${d.drying_hours ? `, dries in about ${d.drying_hours} hours` : ''}`,
  };
}

export const floorLabel = (key) => FLOOR_TYPES[key] || '';

// The latest signed record of a kind.
export function latestSigned(list, kind) {
  return (list || []).filter((i) => i.kind === kind && i.signed_at).sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))[0] || null;
}
