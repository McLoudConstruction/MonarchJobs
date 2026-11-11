// Objects: the things that sit on or in a structure and matter for a rebuild (doors, windows, cabinets,
// outlets, fans...). This file is data and cleanup only, so the sketch model can use it without cycles.
//
// An object in the plan: { id, t: type, x, y, r: degrees, w, d, label, note, h, f, m }
//   x, y   centre, in feet           r  rotation; for wall items, local +y points into the room
//   w, d   width along the wall / length, and depth, in feet
//   h      height off the floor in feet (outlets, windows...), or null
//   oh     height of the opening in feet (doors, windows), or null
//   f, m   flip which side a door swings / which end it hinges on

export const MAX_OBJECTS = 400;

// mode: 'wall'  sits in a wall (door, window): cuts the wall line
//       'wallpoint'  small symbol on a wall (outlet, switch)
//       'box'   a footprint on the floor (cabinet, fridge)
//       'point' a symbol anywhere (ceiling fan, light)
// kind: how it is drawn and coloured
// on:   which surface views show it
export const OBJECT_TYPES = {
  // doors and windows are measured in inches (see inches() below); w = width, oh = opening height, in feet
  door:        { label: 'Door',            group: 'Openings',   mode: 'wall', kind: 'door',    w: 3,   d: 0.4, oh: 80 / 12, on: ['floor', 'wall'], family: 'door', typeLabel: 'Single (swing)' },
  doubledoor:  { label: 'Double door',     group: 'Openings',   mode: 'wall', kind: 'double',  w: 6,   d: 0.4, oh: 80 / 12, on: ['floor', 'wall'], family: 'door', menu: false },
  french:      { label: 'French doors',    group: 'Openings',   mode: 'wall', kind: 'double',  w: 5,   d: 0.4, oh: 80 / 12, on: ['floor', 'wall'], family: 'door', menu: false },
  slider:      { label: 'Sliding glass door', group: 'Openings', mode: 'wall', kind: 'slider', w: 6,   d: 0.4, oh: 80 / 12, on: ['floor', 'wall'], family: 'door', menu: false },
  bypass:      { label: 'Bypass (closet) door', group: 'Openings', mode: 'wall', kind: 'slider', w: 5, d: 0.4, oh: 80 / 12, on: ['floor', 'wall'], family: 'door', menu: false },
  pocket:      { label: 'Pocket door',     group: 'Openings',   mode: 'wall', kind: 'pocket',  w: 2.5, d: 0.4, oh: 80 / 12, on: ['floor', 'wall'], family: 'door', menu: false },
  bifold:      { label: 'Bifold door',     group: 'Openings',   mode: 'wall', kind: 'bifold',  w: 4,   d: 0.4, oh: 80 / 12, on: ['floor', 'wall'], family: 'door', menu: false },
  barn:        { label: 'Barn door',       group: 'Openings',   mode: 'wall', kind: 'barn',    w: 3,   d: 0.4, oh: 84 / 12, on: ['floor', 'wall'], family: 'door', menu: false },
  dutch:       { label: 'Dutch door',      group: 'Openings',   mode: 'wall', kind: 'dutch',   w: 3,   d: 0.4, oh: 80 / 12, on: ['floor', 'wall'], family: 'door', menu: false },
  garage:      { label: 'Garage door',     group: 'Openings',   mode: 'wall', kind: 'garage',  w: 16,  d: 0.4, oh: 7,       on: ['floor', 'wall'], family: 'door', menu: false },
  window:      { label: 'Window',          group: 'Openings',   mode: 'wall', kind: 'window',  w: 3,   d: 0.4, oh: 4, on: ['floor', 'wall'], h: 3 },
  opening:     { label: 'Archway / opening', group: 'Openings', mode: 'wall', kind: 'opening', w: 3,   d: 0.4, oh: 80 / 12, on: ['floor', 'wall'] },

  base:        { label: 'Base cabinets',   group: 'Cabinets',   mode: 'box', kind: 'cabinet', w: 3,   d: 2,    on: ['floor'] },
  upper:       { label: 'Upper cabinets',  group: 'Cabinets',   mode: 'box', kind: 'upper',   w: 3,   d: 1,    on: ['wall'], h: 4.5 },
  tall:        { label: 'Pantry / tall cabinet', group: 'Cabinets', mode: 'box', kind: 'cabinet', w: 2, d: 2,  on: ['floor'] },
  island:      { label: 'Island',          group: 'Cabinets',   mode: 'box', kind: 'island',  w: 6,   d: 3,    on: ['floor'] },
  counter:     { label: 'Countertop',      group: 'Cabinets',   mode: 'box', kind: 'cabinet', w: 4,   d: 2,    on: ['floor'] },
  vanity:      { label: 'Vanity',          group: 'Cabinets',   mode: 'box', kind: 'cabinet', w: 3,   d: 1.75, on: ['floor'] },
  builtin:     { label: 'Built-in shelving', group: 'Cabinets', mode: 'box', kind: 'cabinet', w: 4,   d: 1,    on: ['floor', 'wall'] },

  sink:        { label: 'Sink',            group: 'Fixtures',   mode: 'box', kind: 'sink',    w: 2.5, d: 1.75, on: ['floor'] },
  toilet:      { label: 'Toilet',          group: 'Fixtures',   mode: 'box', kind: 'toilet',  w: 1.5, d: 2.5,  on: ['floor'] },
  tub:         { label: 'Bathtub',         group: 'Fixtures',   mode: 'box', kind: 'tub',     w: 5,   d: 2.5,  on: ['floor'] },
  shower:      { label: 'Shower',          group: 'Fixtures',   mode: 'box', kind: 'shower',  w: 3,   d: 3,    on: ['floor'] },
  fridge:      { label: 'Refrigerator',    group: 'Appliances', mode: 'box', kind: 'plain',   w: 3,   d: 2.5,  on: ['floor'] },
  range:       { label: 'Range / stove',   group: 'Appliances', mode: 'box', kind: 'range',   w: 2.5, d: 2.5,  on: ['floor'] },
  dishwasher:  { label: 'Dishwasher',      group: 'Appliances', mode: 'box', kind: 'plain',   w: 2,   d: 2,    on: ['floor'] },
  washer:      { label: 'Washer',          group: 'Appliances', mode: 'box', kind: 'round',   w: 2.25, d: 2.5, on: ['floor'] },
  dryer:       { label: 'Dryer',           group: 'Appliances', mode: 'box', kind: 'round',   w: 2.25, d: 2.5, on: ['floor'] },
  waterheater: { label: 'Water heater',    group: 'Appliances', mode: 'box', kind: 'circle',  w: 2,   d: 2,    on: ['floor'] },
  furnace:     { label: 'Furnace / HVAC',  group: 'Appliances', mode: 'box', kind: 'plain',   w: 2.5, d: 2.5,  on: ['floor'] },

  fireplace:   { label: 'Fireplace',       group: 'Structure',  mode: 'box', kind: 'fireplace', w: 5, d: 1.5,  on: ['floor', 'wall'] },
  stairs:      { label: 'Stairs',          group: 'Structure',  mode: 'box', kind: 'stairs',  w: 3,   d: 10,   on: ['floor'] },
  column:      { label: 'Column / post',   group: 'Structure',  mode: 'box', kind: 'column',  w: 1,   d: 1,    on: ['floor', 'ceiling'] },
  box:         { label: 'Other item',      group: 'Structure',  mode: 'box', kind: 'plain',   w: 3,   d: 2,    on: ['floor'] },

  outlet:      { label: 'Outlet',          group: 'Electrical', mode: 'wallpoint', kind: 'outlet', w: 0.5, d: 0.5, on: ['wall'], h: 1.25 },
  switch:      { label: 'Switch',          group: 'Electrical', mode: 'wallpoint', kind: 'switch', w: 0.5, d: 0.5, on: ['wall'], h: 4 },
  panel:       { label: 'Electric panel',  group: 'Electrical', mode: 'wallpoint', kind: 'panel',  w: 1.5, d: 0.6, on: ['wall'], h: 5 },
  fan:         { label: 'Ceiling fan',     group: 'Ceiling',    mode: 'point', kind: 'fan',    w: 4,   d: 4,    on: ['ceiling'] },
  light:       { label: 'Light fixture',   group: 'Ceiling',    mode: 'point', kind: 'light',  w: 1.5, d: 1.5,  on: ['ceiling'] },
  recessed:    { label: 'Recessed light',  group: 'Ceiling',    mode: 'point', kind: 'recessed', w: 0.6, d: 0.6, on: ['ceiling'] },
  detector:    { label: 'Smoke detector',  group: 'Ceiling',    mode: 'point', kind: 'detector', w: 0.7, d: 0.7, on: ['ceiling'] },
  vent:        { label: 'Vent / register', group: 'Ceiling',    mode: 'point', kind: 'vent',   w: 1,   d: 0.7,  on: ['floor', 'wall', 'ceiling'] },
};

export const OBJECT_GROUPS = ['Openings', 'Cabinets', 'Fixtures', 'Appliances', 'Structure', 'Electrical', 'Ceiling'];

// Doors, windows and the like are quoted in inches: 36" not 3'.
export const isInches = (type) => !!OBJECT_TYPES[type] && OBJECT_TYPES[type].mode === 'wall';
export const inchesText = (ft) => `${String(Math.round(ft * 12 * 4) / 4)}"`;
// "36", "36in", 36" or 3'  ->  feet, or NaN
export function parseInches(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/inches|inch|in\b/g, '"');
  if (!t) return NaN;
  if (/['\u2032]/.test(t)) { // feet and inches typed out: 3'  or  6'8"
    const m = /^(\d+(?:\.\d+)?)\s*['\u2032]\s*(?:(\d+(?:\.\d+)?)\s*["\u2033]?)?$/.exec(t);
    return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0) : NaN;
  }
  const m = /^(\d+(?:\.\d+)?)\s*["\u2033]?$/.exec(t);
  return m ? Number(m[1]) / 12 : NaN;
}

export const objectShownOn = (o, surface) => surface === 'all' || (OBJECT_TYPES[o.t]?.on || []).includes(surface);

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
const COORD = 5000;

export function makeObject(type, x, y, extra = {}) {
  const t = OBJECT_TYPES[type];
  const id = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8);
  return { id, t: type, x: round2(x), y: round2(y), r: 0, w: t.w, d: t.d, label: '', note: '', h: t.h ?? null, oh: t.oh ?? null, f: false, m: false, ...extra };
}

// Cleans a list read from storage: unknown types are dropped, numbers are limited, the rest is trimmed.
export function cleanObjects(list, uid) {
  const out = [];
  for (const o of (Array.isArray(list) ? list : []).slice(0, MAX_OBJECTS)) {
    if (!o || typeof o !== 'object' || !OBJECT_TYPES[o.t]) continue;
    if (!Number.isFinite(Number(o.x)) || !Number.isFinite(Number(o.y))) continue;
    const t = OBJECT_TYPES[o.t];
    out.push({
      id: uid(o.id), t: o.t,
      x: round2(clamp(Number(o.x), -COORD, COORD)), y: round2(clamp(Number(o.y), -COORD, COORD)),
      r: round2(((num(o.r, 0) % 360) + 360) % 360),
      w: round4(clamp(num(o.w, t.w), 0.1, 100)), d: round4(clamp(num(o.d, t.d), 0.1, 100)),
      label: String(o.label ?? '').slice(0, 40), note: String(o.note ?? '').slice(0, 80),
      h: o.h == null || o.h === '' ? null : round4(clamp(num(o.h, 0), 0, 30)),
      oh: o.oh == null || o.oh === '' ? (t.oh ?? null) : round4(clamp(num(o.oh, 0), 0, 30)),
      f: !!o.f, m: !!o.m,
    });
  }
  return out;
}

// How big an object looks on the sketch, for fitting the view: a circle around it.
export const objectRadius = (o) => Math.max(o.w, o.d) / 2 + 0.5;

// "3 doors, 2 windows" style counts, biggest first.
export function objectCounts(plan) {
  const n = {};
  for (const o of plan.objects || []) n[o.t] = (n[o.t] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([t, count]) => ({ t, label: OBJECT_TYPES[t].label, count }));
}
