// The company-wide equipment inventory: helpers for asset numbers, status and the link a label holds. Pure.
import { EQUIPMENT_TYPES } from './equipment.js';

export const ASSET_STATUS = { available: 'Available', on_job: 'On a job', repair: 'In repair', retired: 'Retired' };
export const DEFAULT_PREFIX = 'EQ';

// 12 -> "EQ-0012"
export const assetTag = (prefix, no) => `${String(prefix || DEFAULT_PREFIX).toUpperCase()}-${String(no).padStart(4, '0')}`;

// The page a label opens
export const assetLink = (origin, id) => `${String(origin).replace(/\/+$/, '')}/equipment/${id}`;

export const typeLabel = (t) => (EQUIPMENT_TYPES[t] || EQUIPMENT_TYPES.other).label;

// Typed values from the add / edit form, cleaned; { error } when something is wrong.
export function cleanAssetForm(f) {
  const type = EQUIPMENT_TYPES[f.type] ? f.type : '';
  if (!type) return { error: 'Choose what kind of equipment it is.' };
  const ppdText = String(f.ppd ?? '').trim();
  const ppd = ppdText === '' ? null : Math.round(Number(ppdText));
  if (ppd !== null && !(ppd > 0 && ppd <= 999)) return { error: 'Pints per day is a number from 1 to 999, or leave it empty.' };
  return { value: { type, label: String(f.label ?? '').trim().slice(0, 60), serial: String(f.serial ?? '').trim().slice(0, 60), ppd, notes: String(f.notes ?? '').trim().slice(0, 300) } };
}

// What the plans say about where each asset is: the units that name an asset, as of the latest day.
//   Map assetId -> { unitId, onSite }   (a picked-up unit is not on site)
export function assetUsage(plan, unitAtFn) {
  const out = new Map();
  for (const u of plan.equipment || []) {
    if (!u.asset) continue;
    const s = unitAtFn(plan, u, null);
    const onSite = s.state === 'on';
    const prev = out.get(u.asset);
    if (!prev || (onSite && !prev.onSite)) out.set(u.asset, { unitId: u.id, onSite });
  }
  return out;
}

// What to write to the inventory after a job's plan changes. `known`: the assets that are recorded as on this job now.
//   { claim: [{ id, unitId }]  assets now on site here, release: [id]  assets recorded here that are no longer on site }
export function assetChanges(usage, known, jobId) {
  const claim = [];
  for (const [id, v] of usage) if (v.onSite) claim.push({ id, unitId: v.unitId });
  const onSite = new Set(claim.map((c) => c.id));
  const release = (known || []).filter((a) => a.job_id === jobId && !onSite.has(a.id)).map((a) => a.id);
  return { claim, release };
}
