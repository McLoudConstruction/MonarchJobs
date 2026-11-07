// Estimate math in whole cents to avoid floating point drift.
// One minimum applies to the whole job, not to each room or line.

// Quantity has up to 3 decimals and price up to 2, so both are scaled to whole numbers, multiplied
// exactly, then rounded once to the cent (half a cent rounds away from zero).
export function lineCents(line) {
  const q = Math.round(Number(line.quantity) * 1000);
  const p = Math.round(Number(line.unit_price) * 100);
  const product = q * p; // in thousandths of a cent
  const sign = product < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(product) / 1000);
}

export function estimateTotals(lines, minimumCharge) {
  const subtotal = lines.reduce((sum, l) => sum + lineCents(l), 0);
  const minimum = Math.round(Number(minimumCharge || 0) * 100);
  // The minimum only tops up a positive subtotal. An empty estimate stays at zero.
  const minimumAdjustment = subtotal > 0 && subtotal < minimum ? minimum - subtotal : 0;
  return {
    subtotalCents: subtotal,
    minimumAdjustmentCents: minimumAdjustment,
    totalCents: subtotal + minimumAdjustment,
  };
}

export function centsToDollars(cents) {
  return cents / 100;
}

export const ESTIMATE_STATUS = { draft: 'Draft', sent: 'Sent', approved: 'Approved', declined: 'Declined' };

// The lines and minimum exactly as a customer saw them, in a stable order. Stored with a signature,
// and compared later to tell whether the estimate changed after it was signed.
export function estimateSnapshot(lines, minimumCharge) {
  return {
    minimum_charge: Number(minimumCharge || 0),
    lines: [...lines]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
      .map((l) => ({
        description: String(l.description),
        unit: l.unit,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
      })),
  };
}

export function sameSnapshot(a, b) {
  const norm = (s) => JSON.stringify({ m: Number(s?.minimum_charge || 0), l: (s?.lines || []).map((l) => [l.description, l.unit, Number(l.quantity), Number(l.unit_price)]) });
  return norm(a) === norm(b);
}
