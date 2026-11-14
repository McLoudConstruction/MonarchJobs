// How much drying equipment a water loss calls for, and how that compares with what is on site. Pure functions.
//
// These follow the IICRC S500 rules of thumb that restoration software uses for a first estimate. They are advice for
// the technician, never a rule: nothing is blocked, and the technician decides.
//   Air movers, for each room with water in it: 1 for the room, plus 1 for each 70 to 50 sq ft of affected floor, plus
//     1 for each 150 to 100 sq ft of affected wall (above 2 ft) and ceiling together. Each division rounds up. A room
//     under 25 sq ft gets only the one. The low figure uses the larger divisors, the high figure the smaller ones.
//   LGR dehumidifier, for all the rooms with water together (one drying space): the volume in cubic feet divided by a
//     factor for the water class, in pints per day: class 1: 100, class 2: 50, class 3 and 4: 40.
//   Class, when not set by hand: the share of the surfaces in the wet rooms (floor, ceiling, and walls above 2 ft)
//     that is affected. Under 5% is class 1, up to 40% class 2, more than that class 3. Class 4 is always by hand.
// Rooms without a ceiling height are worked out at DEFAULT_CEIL, and the result says so.

import { affectedTotals, roomArea, roomTitle } from './sketch.js';
import { equipmentCounts, equipmentOnSite } from './equipment.js';
import { hitRoom } from './sketch.js';

export const DEFAULT_CEIL = 8;
export const TINY_ROOM = 25; // sq ft
export const AM_FLOOR = [70, 50]; // sq ft of floor per air mover: low, high
export const AM_WALL_CEIL = [150, 100]; // sq ft of wall and ceiling per air mover: low, high
export const DEHU_FACTOR = { 1: 100, 2: 50, 3: 40, 4: 40 }; // cubic feet per pint per day
export const CLASS_TEXT = { 1: 'Class 1', 2: 'Class 2', 3: 'Class 3', 4: 'Class 4' };
const WALL_SKIP = 2; // feet of wall above the floor that is left out of the room's surfaces

export const classFromShare = (share) => (share < 0.05 ? 1 : share <= 0.4 ? 2 : 3);

const perimeter = (pts) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);
const up = (n) => Math.ceil(n - 1e-9);

// Air movers for one room: { low, high }
export function airMoversFor(area, floor, wallCeil) {
  if (area < TINY_ROOM) return { low: 1, high: 1 };
  return {
    low: 1 + up(floor / AM_FLOOR[0]) + up(wallCeil / AM_WALL_CEIL[0]),
    high: 1 + up(floor / AM_FLOOR[1]) + up(wallCeil / AM_WALL_CEIL[1]),
  };
}

// Pints per day of LGR dehumidification for a volume (cubic feet) and class.
export const dehuPints = (volume, cls) => (volume > 0 ? up(volume / (DEHU_FACTOR[cls] || DEHU_FACTOR[3])) : 0);

const status = (placed, low) => (placed <= 0 ? 'none' : placed < low ? 'under' : 'ok');

// The whole picture for a plan.
//   { rooms: [{ id, title, area, ceil, ceilSet, volume, affected: {floor, wall, ceiling}, low, high }],
//     assumed: how many wet rooms had no ceiling height set,
//     air: { low, high, now, peak, status },
//     dehu: { cls, auto, share, volume, pints, now, peak, nowPints, unrated, status },
//     other: units on site that are not air movers or LGR dehumidifiers, by type,
//     wet: whether any room has water in it }
// `now` is what is on site on the latest day, `peak` the most on site on any single day.
export function sizePlan(plan) {
  const totals = affectedTotals(plan);
  const rooms = [];
  let volume = 0; let surface = 0; let hit = 0; let assumed = 0;
  for (const r of plan.rooms || []) {
    const w = totals.rooms[r.id]?.water;
    if (!w) continue;
    const area = roomArea(r);
    const ceilSet = Number(r.ceil) > 0;
    const ceil = ceilSet ? Number(r.ceil) : DEFAULT_CEIL;
    if (!ceilSet) assumed += 1;
    const wallAbove = perimeter(r.pts) * Math.max(0, ceil - WALL_SKIP);
    const am = airMoversFor(area, w.floor, w.wall + w.ceiling);
    volume += area * ceil;
    surface += area * 2 + wallAbove;
    hit += w.floor + w.wall + w.ceiling;
    rooms.push({ surface: area * 2 + wallAbove, hit: w.floor + w.wall + w.ceiling, id: r.id, title: roomTitle(r), area: Math.round(area), ceil, ceilSet, volume: Math.round(area * ceil), affected: { floor: w.floor, wall: w.wall, ceiling: w.ceiling }, low: am.low, high: am.high });
  }
  const share = surface > 0 ? Math.min(1, hit / surface) : 0;
  const auto = classFromShare(share);
  const manual = [1, 2, 3, 4].includes(plan.sizing?.cls) ? plan.sizing.cls : 0;
  const cls = manual || auto;

  const days = plan.days || [];
  const lastDay = days.length ? days[days.length - 1].id : null;
  const nowCounts = equipmentCounts(plan, lastDay).byType;
  const peakOf = (t) => days.reduce((m, d) => Math.max(m, equipmentCounts(plan, d.id).byType[t] || 0), 0);
  const low = rooms.reduce((s, r) => s + r.low, 0);
  const high = rooms.reduce((s, r) => s + r.high, 0);
  const lgr = equipmentOnSite(plan, lastDay).filter((x) => x.u.t === 'dehu');
  const rated = lgr.filter((x) => x.u.ppd > 0);
  const nowPints = rated.reduce((s, x) => s + x.u.ppd, 0);
  const pints = dehuPints(volume, cls);
  let dstatus = 'none';
  if (lgr.length) dstatus = rated.length === lgr.length ? (nowPints >= pints ? 'ok' : 'under') : 'unrated';
  const other = {};
  for (const [t, n] of Object.entries(nowCounts)) if (t !== 'airmover' && t !== 'dehu') other[t] = n;

  // Each chamber on its own: the volume, class and dehumidifier capacity of the rooms in it. Wet rooms left out of every chamber
  // share one group, so nothing is left unsized.
  let chambers = [];
  if ((plan.chambers || []).length) {
    const groups = (plan.chambers || []).map((c) => ({ id: c.id, name: c.name, roomIds: new Set(c.rooms) }));
    const inChamber = new Set(groups.flatMap((g) => [...g.roomIds]));
    const rest = rooms.filter((r) => !inChamber.has(r.id)).map((r) => r.id);
    if (rest.length) groups.push({ id: '_', name: 'Other rooms', roomIds: new Set(rest) });
    const onSiteNow = equipmentOnSite(plan, lastDay);
    chambers = groups.map((g) => {
      const rs = rooms.filter((r) => g.roomIds.has(r.id));
      const vol = rs.reduce((t, r) => t + r.volume, 0);
      const sh = rs.reduce((t, r) => t + r.surface, 0) > 0 ? Math.min(1, rs.reduce((t, r) => t + r.hit, 0) / rs.reduce((t, r) => t + r.surface, 0)) : 0;
      const gAuto = classFromShare(sh);
      const gCls = manual || gAuto;
      const units = onSiteNow.filter((x) => g.roomIds.has(hitRoom(plan, x.x, x.y)?.id));
      const dh = units.filter((x) => x.u.t === 'dehu');
      const rated = dh.filter((x) => x.u.ppd > 0);
      const need = dehuPints(vol, gCls);
      const have = rated.reduce((t, x) => t + x.u.ppd, 0);
      let st = 'none';
      if (dh.length) st = rated.length === dh.length ? (have >= need ? 'ok' : 'under') : 'unrated';
      const am = units.filter((x) => x.u.t === 'airmover').length;
      const lowAm = rs.reduce((t, r) => t + r.low, 0);
      return { id: g.id, name: g.name, wet: rs.length > 0, rooms: rs.map((r) => r.title), volume: Math.round(vol), cls: gCls, pints: need, dehuNow: dh.length, havePints: have, unrated: dh.length - rated.length, dehuStatus: st, airLow: lowAm, airHigh: rs.reduce((t, r) => t + r.high, 0), airNow: am, airStatus: rs.length ? status(am, lowAm) : 'ok' };
    }).filter((c) => c.wet);
  }

  return {
    chambers,
    rooms, assumed, wet: rooms.length > 0,
    air: { low, high, now: nowCounts.airmover || 0, peak: peakOf('airmover'), status: status(nowCounts.airmover || 0, low) },
    dehu: { cls, auto, manual: !!manual, share, volume: Math.round(volume), pints, now: lgr.length, peak: peakOf('dehu'), nowPints, unrated: lgr.length - rated.length, status: dstatus },
    other,
  };
}

// One line for each tile, in words.
export function airText(s) {
  if (!s.wet) return 'Draw the water on the plan to size air movers.';
  const need = s.air.low === s.air.high ? `${s.air.low}` : `${s.air.low} to ${s.air.high}`;
  return `${need} needed · ${s.air.now} on site now · most at once ${s.air.peak}`;
}
export function dehuText(s) {
  if (!s.wet) return 'Draw the water on the plan to size dehumidifiers.';
  const d = s.dehu;
  const have = d.now === 0 ? 'none on site' : d.status === 'unrated' ? `${d.now} on site; add each unit's pints per day to check` : `${d.now} on site, ${d.nowPints} pints per day`;
  return `${d.pints} pints per day needed · ${have}`;
}
