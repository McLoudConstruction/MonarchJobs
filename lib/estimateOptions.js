// Options and add-ons on an estimate. Pure, so the staff screen, the customer page and the server agree.
//
// A line is one of:
//   included        no tier, not optional: in every version of the quote
//   good/better/best  part of one tier: counted only when the customer picks that tier
//   optional        an add-on the customer can tick (any tier)
// The customer's choice is { tier, picks }: the tier they chose (or null when the quote has no tiers) and the
// ids of the optional lines they ticked.
import { estimateTotals } from './estimate.js';

export const TIER_ORDER = ['good', 'better', 'best'];
export const TIER_LABELS = { good: 'Good', better: 'Better', best: 'Best' };

// What the line-type dropdown offers. 'included' is the default.
export const LINE_KINDS = [
  ['included', 'Included'],
  ['good', 'Good option'],
  ['better', 'Better option'],
  ['best', 'Best option'],
  ['optional', 'Optional add-on'],
];

export const lineKind = (l) => (l?.optional ? 'optional' : l?.tier || 'included');
export function kindFields(kind) {
  if (kind === 'optional') return { tier: null, optional: true };
  if (TIER_ORDER.includes(kind)) return { tier: kind, optional: false };
  return { tier: null, optional: false };
}
export const lineKindLabel = (l) => {
  const k = lineKind(l);
  return k === 'included' ? '' : (LINE_KINDS.find(([v]) => v === k) || [])[1] || '';
};

export const tiersPresent = (lines) => TIER_ORDER.filter((t) => (lines || []).some((l) => l.tier === t));
export const hasTiers = (lines) => tiersPresent(lines).length > 0;
export const optionalLines = (lines) => (lines || []).filter((l) => l.optional);

// The lines that count for a choice.
export function effectiveLines(lines, choice = {}) {
  const picks = new Set(choice.picks || []);
  return (lines || []).filter((l) => {
    if (l.optional) return picks.has(l.id);
    if (l.tier) return choice.tier === l.tier;
    return true;
  });
}

// What the customer has chosen, as saved on an approved estimate.
export function choiceFromEstimate(est, lines) {
  return { tier: est?.chosen_tier || null, picks: (lines || []).filter((l) => l.optional && l.accepted).map((l) => l.id) };
}

// Totals for each tier (included lines plus that tier's lines, no add-ons), for the staff screen and the customer cards.
export function tierTotals(lines, minimumCharge) {
  const out = {};
  for (const t of tiersPresent(lines)) out[t] = estimateTotals(effectiveLines(lines, { tier: t, picks: [] }), minimumCharge);
  return out;
}

// Checks what the customer sent and returns { choice } or { error }. Unknown ids and tiers are rejected.
export function validateChoice(lines, body) {
  const tiers = tiersPresent(lines);
  let tier = null;
  if (tiers.length) {
    tier = String(body?.tier || '');
    if (!tiers.includes(tier)) return { error: 'Please choose one of the options.' };
  }
  const optionalIds = new Set(optionalLines(lines).map((l) => l.id));
  const raw = Array.isArray(body?.picks) ? body.picks : [];
  const picks = [];
  for (const id of raw) {
    if (!optionalIds.has(id)) return { error: 'One of the add-ons you ticked is no longer on this estimate. Please reload the page.' };
    if (!picks.includes(id)) picks.push(id);
  }
  return { choice: { tier, picks } };
}

// What the office sees as "the total" right now: the customer's choice once approved, otherwise only included lines
// (and, when there are tiers, no tier is counted until one is chosen: see tierTotals).
export function currentTotals(est, lines) {
  const choice = est?.status === 'approved' ? choiceFromEstimate(est, lines) : { tier: null, picks: [] };
  return estimateTotals(effectiveLines(lines, choice), est?.minimum_charge);
}
