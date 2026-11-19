// Before and after cleaning inspections: what the tech and the customer agree on at the door.
// Stored as one JSON document per inspection (job_inspections.data). Pure, so it can be tested.
//
//   { room_count, photo_ids, rooms: [{ id, name, fiber, traffic, pretest, notes, photo_ids, issues: [{ id, where, type, result, note }] }],
//     notes, drying_hours, walkthrough, comments }
// The simple record is a number of rooms and photos, then the customer signs. `rooms` holds only the rooms the tech calls out
// (a stain, a different fiber, a spot test), each with its own notes, photos and spots; `room_count` is how many rooms in all, and is
// never less than the rooms called out. Records saved before room_count existed get it from their rooms.
// "Before" fills in fiber, traffic, pretest and issues (type, where) for called-out rooms. "After" keeps the same rooms and spots and
// adds a result for each spot, the drying time, and whether the walk-through was done.
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
export const MAX_ROOM_COUNT = 200;
const MAX_PHOTOS = 60;
const MAX_ISSUES = 30;
const MAX_ROOM_PHOTOS = 30;
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const oneOf = (v, list, fallback = '') => (list.includes(v) ? v : fallback);

export function newId(prefix = 'i') {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

export function blankRoom(name = '') {
  return { id: newId('r'), name, fiber: '', traffic: false, pretest: 'not_tested', notes: '', photo_ids: [], issues: [] };
}
export function blankIssue() {
  return { id: newId('s'), where: '', type: 'Food or drink', result: '', note: '' };
}
export function blankInspection() {
  return { room_count: 0, photo_ids: [], rooms: [], notes: '', drying_hours: null, walkthrough: false, comments: '' };
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
      photo_ids: [...new Set((Array.isArray(r?.photo_ids) ? r.photo_ids : []).map((i) => str(i, 40)).filter(Boolean))].slice(0, MAX_ROOM_PHOTOS), // pictures taken or added during the walkthrough
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
  const declared = Math.round(Number(d.room_count));
  const out = {
    room_count: Math.max(Number.isFinite(declared) && declared > 0 ? Math.min(declared, MAX_ROOM_COUNT) : 0, rooms.length),
    photo_ids: [...new Set((Array.isArray(d.photo_ids) ? d.photo_ids : []).map((i) => str(i, 40)).filter(Boolean))].slice(0, MAX_PHOTOS), // pictures of the job as a whole
    rooms,
    notes: str(d.notes, 800),
  };
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
    photo_ids: [],
    rooms: base.rooms.map((r) => ({ ...r, photo_ids: [], issues: r.issues.map((s) => ({ ...s, result: '', note: '' })) })),
    notes: '', drying_hours: null, walkthrough: false, comments: '',
  });
}

// What is still missing before the customer can sign. [] means ready.
export function missingBeforeSigning(kind, data, { absent = false } = {}) {
  const d = cleanInspection(kind, data);
  const out = [];
  if (d.room_count < 1) out.push('Enter how many rooms.');
  if (d.rooms.some((r) => !r.name)) out.push('Give every called-out room a name.');
  if (kind === 'post') {
    if (d.rooms.some((r) => r.issues.some((s) => !s.result))) out.push('Choose a result for every spot.');
    if (!d.walkthrough && !absent) out.push('Tick that you walked through the work with the customer.');
  }
  return out;
}

// Every photo on a record: the ones of the job as a whole and the ones on called-out rooms.
export const inspectionPhotoIds = (d) => [...new Set([...(d.photo_ids || []), ...(d.rooms || []).flatMap((r) => r.photo_ids || [])])];

// Counts for a one-line summary.
export function summarize(kind, data) {
  const d = cleanInspection(kind, data);
  const issues = d.rooms.flatMap((r) => r.issues);
  const photos = inspectionPhotoIds(d).length;
  const roomText = `${d.room_count} room${d.room_count === 1 ? '' : 's'}`;
  const photoText = photos ? `, ${photos} photo${photos === 1 ? '' : 's'}` : '';
  const base = { rooms: d.room_count, called_out: d.rooms.length, spots: issues.length, photos };
  if (kind !== 'post') return { ...base, text: `${roomText}, ${issues.length} spot${issues.length === 1 ? '' : 's'} noted${photoText}` };
  const notRemoved = issues.filter((s) => NOT_REMOVED.includes(s.result)).length;
  return {
    ...base, notRemoved,
    text: `${roomText}, ${issues.length} spot${issues.length === 1 ? '' : 's'}${issues.length ? `, ${notRemoved} not removed` : ''}${photoText}${d.drying_hours ? `, dries in about ${d.drying_hours} hours` : ''}`,
  };
}

export const floorLabel = (key) => FLOOR_TYPES[key] || '';

// The latest signed record of a kind.
export function latestSigned(list, kind) {
  return (list || []).filter((i) => i.kind === kind && i.signed_at).sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))[0] || null;
}
