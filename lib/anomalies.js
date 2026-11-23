// Anomaly alerts (#112): the owner is told when a job's hours, cost or equipment days pass a set share of the estimate. Pure.
//
// The three checks, all against a job that is still open:
//   hours       time on the job clock reached the hours percent of the time allowed (allotted minutes from the estimate lines and
//               the price list's minutes per unit; skipped when no line has a time rate)
//   cost        purchases, labor and equipment run time reached the cost percent of what the customer is paying (approved estimate)
//   equipment   a machine has been on site that many calendar days or more and is still there
// Each job gets each alert once. Alerts are advice for the owner and change nothing on the job. Wording stays calm and plain.
import { durationText } from './jobClock.js';

export const ANOMALY_DEFAULTS = { enabled: false, hoursPct: 120, costPct: 75, equipDays: 5 };
export const ANOMALY_LIMITS = { hoursPct: [100, 500], costPct: [10, 200], equipDays: [1, 60] };

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const clamp = (v, [lo, hi], fallback) => { const n = Math.round(num(v)); return Number.isFinite(Number(v)) && n >= lo && n <= hi ? n : fallback; };

// Settings row -> numbers the rules use. Anything out of range falls back to the default.
export function readAnomalySettings(row) {
  const s = row || {};
  return {
    enabled: !!s.anomaly_alerts_enabled,
    hoursPct: clamp(s.anomaly_hours_pct, ANOMALY_LIMITS.hoursPct, ANOMALY_DEFAULTS.hoursPct),
    costPct: clamp(s.anomaly_cost_pct, ANOMALY_LIMITS.costPct, ANOMALY_DEFAULTS.costPct),
    equipDays: clamp(s.anomaly_equip_days, ANOMALY_LIMITS.equipDays, ANOMALY_DEFAULTS.equipDays),
  };
}

// What a form typed in. Returns { error } or { value } in the settings columns.
export function cleanAnomalyForm(f) {
  const out = {};
  for (const [key, col] of [['hoursPct', 'anomaly_hours_pct'], ['costPct', 'anomaly_cost_pct'], ['equipDays', 'anomaly_equip_days']]) {
    const [lo, hi] = ANOMALY_LIMITS[key];
    const n = Number(String(f[key] ?? '').trim());
    if (!Number.isInteger(n) || n < lo || n > hi) {
      return { error: key === 'equipDays' ? `Equipment days must be a whole number from ${lo} to ${hi}.` : `Enter a whole percent from ${lo} to ${hi}.` };
    }
    out[col] = n;
  }
  out.anomaly_alerts_enabled = !!f.enabled;
  return { value: out };
}

const label = (job) => [job.number ? `Job #${job.number}` : 'A job', job.customer].filter(Boolean).join(' · ');

// job: { number, customer }
// facts: { clockedMinutes, allotted: { minutes, any }, costCents, estimateCents, equipment: [{ code, days }] (machines still on site) }
// Returns [{ kind, title, body }]. The kind is part of the once-only key.
export function checkJob(job, facts, settings) {
  const out = [];
  const allotted = facts.allotted || {};
  const clocked = num(facts.clockedMinutes);
  if (allotted.any && num(allotted.minutes) > 0 && clocked > 0 && clocked >= (num(allotted.minutes) * settings.hoursPct) / 100) {
    const pct = Math.round((clocked / allotted.minutes) * 100);
    out.push({ kind: 'hours', title: `Hours are at ${pct}% of the time allowed`, body: `${label(job)} · ${durationText(clocked)} on the clock, ${durationText(allotted.minutes)} allowed` });
  }
  const est = num(facts.estimateCents); const cost = num(facts.costCents);
  if (est > 0 && cost > 0 && cost >= (est * settings.costPct) / 100) {
    const pct = Math.round((cost / est) * 100);
    out.push({ kind: 'cost', title: `Costs are at ${pct}% of the estimate`, body: `${label(job)} · $${(cost / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of $${(est / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` });
  }
  const long = (facts.equipment || []).filter((u) => num(u.days) >= settings.equipDays);
  if (long.length) {
    const most = Math.max(...long.map((u) => num(u.days)));
    out.push({ kind: 'equipment', title: `Equipment has been on site ${most} days`, body: `${label(job)} · ${long.map((u) => u.code).slice(0, 6).join(', ')}${long.length > 6 ? ` and ${long.length - 6} more` : ''}` });
  }
  return out;
}

export const anomalyKey = (jobId, kind) => `anomaly:${jobId}:${kind}`;
