// Truck stock rules. Pure, so the screen and the tests agree; the database (migration 048) does the same sums for finished visits.

// 'out' (none left), 'low' (at or under the "low at" level, when one is set) or 'ok'
export function stockStatus(qty, lowAt) {
  const q = Number(qty) || 0;
  const low = Number(lowAt) || 0;
  if (q <= 0 && low > 0) return 'out';
  if (low > 0 && q <= low) return 'low';
  return 'ok';
}
export const STATUS_LABEL = { out: 'Out', low: 'Low', ok: '' };

const num = (v) => (String(v ?? '').trim() === '' ? 0 : Number(v));
const whole2 = (n) => Math.round(n * 100) / 100;

export function cleanTruck(f) {
  const name = String(f.name || '').trim();
  if (!name) return { error: 'Give the truck a name.' };
  if (name.length > 40) return { error: 'The truck name can be up to 40 characters.' };
  const tech_ids = [...new Set((f.tech_ids || []).filter(Boolean))];
  if (tech_ids.length > 10) return { error: 'A truck can have up to 10 people.' };
  return { value: { name, tech_ids } };
}

export function cleanItem(f) {
  const name = String(f.name || '').trim();
  if (!name) return { error: 'Give the supply a name.' };
  if (name.length > 60) return { error: 'The supply name can be up to 60 characters.' };
  const unit = String(f.unit || '').trim();
  if (unit.length > 20) return { error: 'The unit can be up to 20 characters.' };
  const per = num(f.per_visit);
  const low = num(f.low_at);
  if (!Number.isFinite(per) || per < 0 || per > 999) return { error: '"Used per visit" must be 0 or more (up to 999).' };
  if (!Number.isFinite(low) || low < 0 || low > 99999) return { error: '"Low at" must be 0 or more.' };
  return { value: { name, unit, per_visit: whole2(per), low_at: whole2(low) } };
}

// A count typed by a person: 0 or more, up to 99,999.
export function cleanQty(v) {
  if (String(v ?? '').trim() === '') return { error: 'Enter a number.' };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99999) return { error: 'Enter a number from 0 to 99,999.' };
  return { value: whole2(n) };
}

// Everything at or under its low level: [{ truck, item, qty, status }], emptiest first
export function lowList(trucks, items, stock) {
  const out = [];
  for (const t of trucks) for (const i of items) {
    const row = stock.find((s) => s.truck_id === t.id && s.item_id === i.id);
    if (!row || !i.active) continue;
    const status = stockStatus(row.qty, i.low_at);
    if (status !== 'ok') out.push({ truck: t.name, item: i.name, unit: i.unit, qty: Number(row.qty), status });
  }
  return out.sort((a, b) => a.qty - b.qty);
}

export const qtyText = (qty, unit) => `${Number(qty)}${unit ? ` ${unit}` : ''}`;
