import test from 'node:test';
import assert from 'node:assert/strict';
import { reportablePhotos, photoSections, beforeAfterPairs, photoReportAvailability, renderPhotoReport, MAX_REPORT_PHOTOS } from '../lib/photoReport.js';
import { reportGroups, sketchContents, defaultSketch, dryingReady, DRYING_REPORTS } from '../lib/reports.js';

let n = 0;
const P = (kind, extra = {}) => ({ id: `p${++n}`, kind, taken_at: new Date(2026, 10, 1, 9, n).toISOString(), caption: '', storage_path: 'x', ...extra });
const rooms = [{ value: 's1|kitchen', label: 'Kitchen' }, { value: 's1|hall', label: 'Hall' }];
const inRoom = (key) => ({ sketch_id: 's1', room_key: key });

test('reportablePhotos drops archived photos and the original behind a marked-up copy', () => {
  const orig = P('damage');
  const marked = P('damage', { derived_from: orig.id });
  const gone = P('damage', { archived_at: '2026-11-02T00:00:00Z' });
  const keep = P('before');
  assert.deepEqual(reportablePhotos([orig, marked, gone, keep]).map((p) => p.id), [marked.id, keep.id]);
});

test('photoSections groups by folder in the usual order, oldest first, and filters', () => {
  const a = P('after'); const b = P('before'); const c = P('before', inRoom('kitchen')); const d = P('damage');
  const s = photoSections([a, b, c, d], {}, rooms);
  assert.deepEqual(s.map((x) => x.heading), ['Before', 'After', 'Damage']);
  assert.deepEqual(s[0].photos.map((p) => p.id), [b.id, c.id]);
  assert.deepEqual(photoSections([a, b, c, d], { kinds: ['before'] }, rooms).map((x) => x.heading), ['Before']);
  assert.equal(photoSections([a, b, c, d], { room: 's1|kitchen' }, rooms)[0].photos.length, 1);
});

test('photoSections by room follows the sketch order, with photos in no room last', () => {
  const hall = P('during', inRoom('hall')); const kit = P('before', inRoom('kitchen')); const none = P('other');
  const s = photoSections([none, hall, kit], { groupBy: 'room' }, rooms);
  assert.deepEqual(s.map((x) => x.heading), ['Kitchen', 'Hall', 'Not in a room']);
});

test('beforeAfterPairs: linked pairs first, then earliest before with latest after in a room; each photo once', () => {
  const b1 = P('before', inRoom('kitchen'));
  const a1 = P('after', { ...inRoom('kitchen'), pair_of: b1.id });
  const b2 = P('before', inRoom('hall')); const b3 = P('before', inRoom('hall'));
  const a2 = P('after', inRoom('hall')); const a3 = P('after', inRoom('hall'));
  const loneBefore = P('before', inRoom('kitchen'));
  const pairs = beforeAfterPairs([b1, a1, b2, b3, a2, a3, loneBefore], rooms);
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs.map((p) => p.roomName), ['Kitchen', 'Hall', 'Hall']);
  assert.equal(pairs[0].before.id, b1.id);
  assert.equal(pairs[0].after.id, a1.id);
  const used = pairs.flatMap((p) => [p.before.id, p.after.id]);
  assert.equal(new Set(used).size, used.length);
  assert.ok(!used.includes(loneBefore.id));
  assert.equal(beforeAfterPairs([b1, a1, b2, b3, a2, a3], rooms, { room: 's1|hall' }).length, 2);
});

test('beforeAfterPairs ignores an after whose link points at a non-before or missing photo, and photos with no room', () => {
  const during = P('during'); const orphan = P('after', { pair_of: during.id }); const bare = P('before'); const bareAfter = P('after');
  assert.equal(beforeAfterPairs([during, orphan, bare, bareAfter], rooms).length, 0);
  assert.deepEqual(photoReportAvailability([during, orphan], rooms), { photoCount: 2, pairCount: 0 });
});

const jpeg = (tag) => new Uint8Array([0xff, 0xd8, tag, 0xff, 0xd9]);
const img = (tag, extra = {}) => ({ bytes: jpeg(tag), w: 1100, h: 825, caption: '', takenAt: '2026-11-03T15:00:00Z', label: '', ...extra });
const text = (pdf) => Buffer.from(pdf).toString('latin1');
const info = { business: 'Monarch Cleaning', phone: '(555) 123-4567', customer: 'Ada Lovelace', address: '1 Main St, Kansas City', jobNumber: 1042, jobType: 'Carpet' };

test('photo report PDF: valid, header facts, section headings and counts, no staff or location data', () => {
  const sections = [
    { heading: 'Before', photos: [img(1, { caption: 'Stain by the door' }), img(2), img(3)] },
    { heading: 'After', photos: [img(4)] },
  ];
  const pdf = renderPhotoReport({ mode: 'photos', title: '1 Main St', info, sections, preparedAt: new Date(2026, 10, 16) });
  const t = text(pdf);
  assert.ok(t.startsWith('%PDF-1.4'));
  assert.ok(t.trimEnd().endsWith('%%EOF'));
  assert.match(t, /Photo Report/);
  assert.match(t, /Monarch Cleaning/);
  assert.match(t, /Ada Lovelace/);
  assert.match(t, /#1042/);
  assert.match(t, /\(Before\) Tj/);
  assert.match(t, /3 photos/);
  assert.match(t, /Stain by the door/);
  assert.equal((t.match(/\/Subtype \/Image/g) || []).length, 4);
  const start = Number(/startxref\n(\d+)/.exec(t)[1]);
  assert.ok(t.slice(start).startsWith('xref'));
  assert.doesNotMatch(t, /gps|latitude|created_by/i);
});

test('photo report PDF: captions and dates can be left off', () => {
  const sections = [{ heading: 'Before', photos: [img(1, { caption: 'Internal remark' })] }];
  const t = text(renderPhotoReport({ mode: 'photos', title: 'x', info, sections, showCaptions: false, showDates: false }));
  assert.doesNotMatch(t, /Internal remark/);
  assert.doesNotMatch(t, /Nov 3, 2026/);
  const on = text(renderPhotoReport({ mode: 'photos', title: 'x', info, sections }));
  assert.match(on, /Internal remark/);
  assert.match(on, /Nov 3, 2026/);
});

test('photo report PDF: many photos flow onto more pages, each page numbered', () => {
  const photos = Array.from({ length: 24 }, (_, i) => img(i + 1));
  const t = text(renderPhotoReport({ mode: 'photos', title: 'x', info, sections: [{ heading: 'During', photos }] }));
  const pages = (t.match(/\/Type \/Page /g) || []).length;
  assert.ok(pages >= 4, `expected several pages, got ${pages}`);
  assert.match(t, new RegExp(`Page ${pages} of ${pages}`));
});

test('before and after PDF: labels both sides and names the room', () => {
  const pairs = [{ roomName: 'Kitchen', before: img(1), after: img(2) }, { roomName: 'Hall', before: img(3), after: img(4) }];
  const t = text(renderPhotoReport({ mode: 'beforeafter', title: 'x', info, pairs }));
  assert.match(t, /Before & After/);
  assert.equal((t.match(/\(BEFORE\) Tj/g) || []).length, 2);
  assert.equal((t.match(/\(AFTER\) Tj/g) || []).length, 2);
  assert.match(t, /\(Kitchen\) Tj/);
  assert.match(t, /Comparisons/);
});

test('an empty section list still makes a valid one-page PDF', () => {
  const t = text(renderPhotoReport({ mode: 'photos', title: 'x', info, sections: [] }));
  assert.equal((t.match(/\/Type \/Page /g) || []).length, 1);
});

test('the report size limit is set', () => assert.ok(MAX_REPORT_PHOTOS >= 50 && MAX_REPORT_PHOTOS <= 300));

// ------------------------------------------------------------------ what the tab offers
const sketch = (id, name, plan) => ({ id, name, plan });
const wetPlan = { rooms: [{ id: 'r', label: 'Kitchen', pts: [[0, 0], [10, 0], [10, 10], [0, 10]] }], moisture: [{ id: 'm1', x: 5, y: 5, readings: [] }] };

test('reportGroups: photos for every job; drying only where the Moisture tab exists', () => {
  const ph = [P('before', inRoom('kitchen'))];
  const carpet = reportGroups({ service: 'carpet', photos: ph, rooms });
  assert.deepEqual(carpet.map((g) => g.key), ['photos']);
  assert.deepEqual(reportGroups({ service: 'mitigation', photos: ph, rooms }).map((g) => g.key), ['photos', 'drying']);
  assert.deepEqual(reportGroups({ service: 'remediation', photos: ph, rooms }).map((g) => g.key), ['photos']);
  assert.deepEqual(reportGroups({ service: '', photos: ph, rooms }).map((g) => g.key), ['photos', 'drying']); // unknown service shows everything
});

test('reportGroups: photo reports are ready only when there is something to put in them', () => {
  const none = reportGroups({ service: 'carpet', photos: [], rooms })[0].items;
  assert.deepEqual(none.map((i) => i.ready), [false, false]);
  const b = P('before', inRoom('kitchen')); const a = P('after', { ...inRoom('kitchen'), pair_of: b.id });
  const some = reportGroups({ service: 'carpet', photos: [b, a], rooms })[0].items;
  assert.deepEqual(some.map((i) => i.ready), [true, true]);
  assert.match(none[1].hint, /Before and an After/);
});

test('drying reports need readings or equipment, equipment ones need equipment, spreadsheets need readings', () => {
  const empty = sketchContents([sketch('a', 'Main', {})])[0];
  const wet = sketchContents([sketch('a', 'Main', wetPlan)])[0];
  const equipped = { ...empty, equipment: 2 };
  const by = Object.fromEntries(DRYING_REPORTS.map((r) => [r.key, r]));
  assert.equal(dryingReady(by['moisture-full'], empty), false);
  assert.equal(dryingReady(by['moisture-full'], wet), true);
  assert.equal(dryingReady(by['moisture-equipment'], wet), false);
  assert.equal(dryingReady(by['moisture-equipment'], equipped), true);
  assert.equal(dryingReady(by['moisture-log'], equipped), false);
  assert.equal(dryingReady(by['moisture-log'], wet), true);
  assert.equal(dryingReady(by['moisture-full'], null), false);
});

test('defaultSketch picks the sketch with the most readings and equipment', () => {
  const list = sketchContents([sketch('a', 'Empty', {}), sketch('b', 'Wet', wetPlan)]);
  assert.equal(defaultSketch(list), 'b');
  assert.equal(defaultSketch([]), null);
});

test('with no sketch the drying group explains where to start', () => {
  const drying = reportGroups({ service: 'mitigation', photos: [], rooms, sketches: [] })[1];
  assert.equal(drying.items.every((i) => !i.ready), true);
  assert.match(drying.items[0].hint, /Sketch tab/);
});
