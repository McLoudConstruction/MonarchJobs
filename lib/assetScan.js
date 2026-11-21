// Reading a scanned equipment label. The QR on a label holds the unit's page address (.../equipment/<id>), see lib/assets.js.
// Pure and tested.
import { ASSET_STATUS } from './assets.js';
import { EQUIPMENT_TYPES } from './equipment.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// The asset id inside a scanned code: the label's address, or a bare id. '' when it is not one of ours.
export function assetIdFromScan(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/\/equipment\/([^/?#\s]+)/i);
  if (m) return m[1];
  return UUID.test(s) && s.length <= 40 ? s.match(UUID)[0] : '';
}

// What to do with a scanned tag for the unit being placed.
//   list: [{ id, tag, type, status }]   unit: { t, asset }
// -> { ok: true, asset, switchType } or { ok: false, text }
export function checkScannedAsset(text, list, unit) {
  const id = assetIdFromScan(text);
  if (!id) return { ok: false, text: 'That is not one of our equipment tags. Try the QR on the label.' };
  const a = (list || []).find((x) => x.id === id);
  if (!a) return { ok: false, text: 'That tag is not in the equipment inventory.' };
  if (!EQUIPMENT_TYPES[a.type]) return { ok: false, text: `${a.tag} is not drying equipment, so it is not placed on the sketch.` };
  if (a.id !== unit?.asset && a.status !== 'available') return { ok: false, text: `${a.tag} is ${(ASSET_STATUS[a.status] || a.status).toLowerCase()}, so it cannot go on this job.` };
  return { ok: true, asset: a, switchType: a.type !== unit?.t };
}
