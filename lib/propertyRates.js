// Per-property rates (push 1A, #24). A property (apartment complex, management company site) can have its own price
// for any price-list item. When an estimate is tied to a property, the estimate builder uses that price instead of
// the standard one. Prices are plain numbers in dollars with two decimals; no rate means the standard price.

// [{ price_item_id, unit_price }] -> Map(price_item_id -> number)
export function rateMap(rows = []) {
  const m = new Map();
  for (const r of rows) {
    const p = Number(r.unit_price);
    if (r.price_item_id && Number.isFinite(p) && p >= 0) m.set(r.price_item_id, p);
  }
  return m;
}

// The price to use for an item: the property's rate when there is one.
export function priceFor(item, rates) {
  const r = rates instanceof Map ? rates.get(item.id) : undefined;
  return r === undefined ? Number(item.price) : r;
}

export const isCustomRate = (item, rates) => rates instanceof Map && rates.has(item.id) && Number(rates.get(item.id)) !== Number(item.price);

// What to type in a rate box: blank, or a price. Returns { value: number | null } or { error }.
export function cleanRate(text) {
  const s = String(text ?? '').trim().replace(/^\$/, '');
  if (s === '') return { value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Enter a price like 12.50, or leave it blank for the standard price.' };
  const n = Number(s);
  if (n > 100000) return { error: 'That price is too large.' };
  return { value: n };
}

// Lines already on an estimate that would change if the property's rates were applied.
// lines: [{ id, price_item_id, unit_price, is_custom }] -> [{ id, from, to }]
export function rateChanges(lines = [], rates) {
  const out = [];
  if (!(rates instanceof Map)) return out;
  for (const l of lines) {
    if (l.is_custom || !l.price_item_id || !rates.has(l.price_item_id)) continue;
    const to = rates.get(l.price_item_id);
    if (Number(l.unit_price) !== to) out.push({ id: l.id, from: Number(l.unit_price), to });
  }
  return out;
}
