// Pricing a booking from the price list. Pure: the booking screen and the server run the same code, and the server
// always re-prices from the price list, so a customer can never send their own prices.
import { estimateTotals } from './estimate.js';

export const MAX_BOOKING_LINES = 20;
export const MAX_QUANTITY = 100000;

// What to ask for, by price-list unit.
export const QUANTITY_LABELS = { sqft: 'Square feet', room: 'Number of rooms', hour: 'Hours', each: 'How many', flat: '' };

// The quantity as a number, or null when it is not usable. Flat prices are always one. Rooms and "each" are whole numbers.
export function cleanQuantity(unit, raw) {
  if (unit === 'flat') return 1;
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_QUANTITY) return null;
  if (unit === 'room' || unit === 'each') return Number.isInteger(n) ? n : null;
  return Math.round(n * 1000) / 1000;
}

// picks: [{ id, quantity }]. Lines for the picks that are usable so far, and a message for each that is not.
export function buildLines(items, picks) {
  const byId = new Map((items || []).map((i) => [i.id, i]));
  const lines = [];
  const errors = [];
  const seen = new Set();
  (Array.isArray(picks) ? picks : []).forEach((p, i) => {
    const item = byId.get(p?.id);
    if (!item) { errors.push('One of the services is no longer available. Please reload the page.'); return; }
    if (seen.has(item.id)) { errors.push(`${item.name} is listed twice.`); return; }
    seen.add(item.id);
    const q = cleanQuantity(item.unit, p.quantity);
    if (q === null) {
      errors.push(item.unit === 'room' || item.unit === 'each'
        ? `Enter a whole number for ${item.name}.`
        : `Enter ${(QUANTITY_LABELS[item.unit] || 'an amount').toLowerCase()} for ${item.name}.`);
      return;
    }
    lines.push({ price_item_id: item.id, description: item.name, unit: item.unit, quantity: q, unit_price: Number(item.price), sort_order: i });
  });
  return { lines, errors };
}

// The full price, with the job minimum applied, or { error }.
export function priceBooking(items, picks, minimum) {
  if (!Array.isArray(picks) || !picks.length) return { error: 'Choose at least one service.' };
  if (picks.length > MAX_BOOKING_LINES) return { error: `Choose up to ${MAX_BOOKING_LINES} services.` };
  const { lines, errors } = buildLines(items, picks);
  if (errors.length) return { error: errors[0] };
  const totals = estimateTotals(lines, minimum);
  if (totals.totalCents <= 0) return { error: 'The total comes to $0. Check the amounts.' };
  return { lines, totals, minimum: Number(minimum || 0) };
}
