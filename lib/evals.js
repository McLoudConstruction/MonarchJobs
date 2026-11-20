// Evals on the Leads page: the pure pieces (statuses, property details, filters, grouping). No network, so the tests can check them.
//
// An eval is one multi-family carpet evaluation sheet (lib/evalSheet.js) for one unit, kept against a property before any job
// exists. Rows: { id, property_id, eval_date, status, total_cents, job_id, data, created_at }.
import { cleanEval, evalTitle, SIZES } from './evalSheet.js';

// To do = asked for, not walked yet. Done = filled in. Quoted = the price has gone to the property. Converted = rolled into a work order.
export const EVAL_STATUSES = { todo: 'To do', done: 'Done', quoted: 'Quoted', converted: 'Converted' };
// The ones a person can pick by hand. Converted is set by the work order step, not chosen.
export const EVAL_PICKABLE = ['todo', 'done', 'quoted'];

export const EVAL_RANGES = [
  { key: 'all', label: 'Any date', days: null },
  { key: 'today', label: 'Today', days: 0 },
  { key: 'week', label: 'Last 7 days', days: 6 },
  { key: 'month', label: 'Last 30 days', days: 29 },
];

const str = (v, n) => String(v ?? '').trim().slice(0, n);
const email = (v) => {
  const s = str(v, 120).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
};

// A property's details as they are saved. `emailErrors` lists contacts whose email was typed but is not an address.
export function cleanProperty(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const emailErrors = [];
  const contact = (key, label) => {
    const typed = str(p[`${key}_email`], 120);
    const good = email(typed);
    if (typed && !good) emailErrors.push(label);
    return { [`${key}_name`]: str(p[`${key}_name`], 80), [`${key}_email`]: good, [`${key}_phone`]: str(p[`${key}_phone`], 30) };
  };
  return {
    value: {
      name: str(p.name, 120),
      address: str(p.address, 200),
      ...contact('manager', 'Property manager'),
      ...contact('maint', 'Maintenance supervisor'),
      notes: str(p.notes, 600),
    },
    emailErrors,
    ok: str(p.name, 120) !== '' && emailErrors.length === 0,
  };
}

export const blankProperty = () => ({
  name: '', address: '', manager_name: '', manager_email: '', manager_phone: '', maint_name: '', maint_email: '', maint_phone: '', notes: '',
});

// "YYYY-MM-DD" of the day `days` before `today` (also YYYY-MM-DD).
export function daysBefore(today, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today || '');
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - days));
  return d.toISOString().slice(0, 10);
}

// The eval's day: the date on the sheet, else the day it was added.
const evalDay = (e) => e.eval_date || String(e.created_at || '').slice(0, 10);

// Filters by property, status, date range and a search of building, unit and notes. `today` is the shop's today (YYYY-MM-DD).
export function filterEvals(evals, { propertyId = '', status = '', range = 'all', q = '', today = '' } = {}) {
  const r = EVAL_RANGES.find((x) => x.key === range) || EVAL_RANGES[0];
  const from = r.days == null ? '' : daysBefore(today, r.days);
  const term = String(q || '').trim().toLowerCase();
  return (evals || []).filter((e) => {
    if (propertyId && e.property_id !== propertyId) return false;
    if (status && e.status !== status) return false;
    if (from && evalDay(e) < from) return false;
    if (term) {
      const d = cleanEval(e.data);
      if (![d.building, d.unit, d.notes].some((t) => String(t).toLowerCase().includes(term))) return false;
    }
    return true;
  });
}

// "B12" and "204" sort the way a person reads them: 2 before 10, letters after numbers.
const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });

// Units grouped under their property, properties by name, units by building then unit. Properties with no evals in `evals` are left out.
// -> [{ property, evals: [...], totalCents, count }]
export function groupByProperty(evals, properties) {
  const byId = new Map((properties || []).map((p) => [p.id, p]));
  const groups = new Map();
  for (const e of evals || []) {
    const property = byId.get(e.property_id) || { id: e.property_id || 'none', name: 'No property' };
    if (!groups.has(property.id)) groups.set(property.id, { property, evals: [], totalCents: 0, count: 0 });
    const g = groups.get(property.id);
    g.evals.push(e);
    g.totalCents += Number(e.total_cents) || 0;
    g.count += 1;
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.evals.sort((a, b) => {
      const da = cleanEval(a.data);
      const db = cleanEval(b.data);
      return natural(da.building, db.building) || natural(da.unit, db.unit) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  }
  return out.sort((a, b) => natural(a.property.name, b.property.name));
}

// One line for a list row: "Bldg B12 / Unit 204 - 2 Bedroom".
export const evalRowTitle = (e) => evalTitle(e.data);

// The bedroom size on a row, for the list ("2 Bedroom"), or ''.
export function evalRowSize(e) {
  const d = cleanEval(e.data);
  return SIZES.find((s) => s.key === d.size)?.label || '';
}

export const centsText = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A blank new eval for a property. A new unit in the same building starts with the building filled in.
export function newEvalData({ property, previous = null, today = '' } = {}) {
  const prev = previous ? cleanEval(previous.data) : null;
  return cleanEval({ complex: property?.name || '', building: prev?.building || '', unit: '', date: today });
}

// Eval photos live in their own private bucket: {eval_id}/{photo_id}.jpg, with a small copy {eval_id}/{photo_id}_t.jpg.
export const EVAL_BUCKET = 'eval-photos';
export const EVAL_PHOTO_KINDS = { unit: 'Unit photos', paper: 'Paper copy' };
export const evalPhotoPaths = (evalId, photoId) => ({ full: `${evalId}/${photoId}.jpg`, thumb: `${evalId}/${photoId}_t.jpg` });
