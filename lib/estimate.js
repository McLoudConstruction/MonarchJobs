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
