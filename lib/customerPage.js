// The customer's own page for a job (/c/[token]): report a problem, ask for a time, ask about a plan, stop reminders.
// Checks what the public form sends. Pure, so it can be tested.

export const PROBLEM_KINDS = {
  spot_returned: 'A spot or stain came back',
  not_clean: 'An area is not clean',
  damage: 'Something was damaged',
  drying: 'The floor is still wet or smells',
  other: 'Something else',
};
export const MAX_PROBLEMS_PER_DAY = 5;

export function cleanProblem(body) {
  const kind = String(body?.kind || '');
  if (!PROBLEM_KINDS[kind]) return { error: 'Please choose what happened.' };
  const details = String(body?.details || '').trim().slice(0, 2000);
  if (kind === 'other' && details.length < 5) return { error: 'Please tell us a little about what happened.' };
  const phone = String(body?.phone || '').replace(/[^\d+() -]/g, '').slice(0, 24);
  return { value: { kind, details, contact_phone: phone } };
}

// How often a customer might want the same visit: in months.
export const PLAN_INTERVALS = [
  [1, 'Every month'], [2, 'Every 2 months'], [3, 'Every 3 months'], [4, 'Every 4 months'], [6, 'Every 6 months'], [12, 'Once a year'],
];

export function cleanRequest(body) {
  const kind = body?.kind === 'plan' ? 'plan' : 'rebook';
  const times = String(body?.preferred_times || '').trim().slice(0, 500);
  const months = Math.round(Number(body?.interval_months));
  if (kind === 'plan' && !PLAN_INTERVALS.some(([m]) => m === months)) return { error: 'Please choose how often you would like us to come.' };
  return { value: { kind, preferred_times: times, interval_months: kind === 'plan' ? months : null } };
}
