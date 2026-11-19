// The labor pool: people who worked a job but are not on the staff list (day labor, a borrowed crew). A staff member enters their
// names and times on the job clock and signs to certify them. The names are kept in a pool so repeat helpers are one tap next time;
// they are never matched against staff_users, and they have no logins or pay rates here. Pure, so the form, the server and the
// tests agree. Tables are in migration 026.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };

export const MAX_ENTRIES = 30;          // names on one signed form
export const NAME_MAX = 80;
export const MAX_SPAN_HOURS = 24;       // one person, one entry
export const MAX_AGE_DAYS = 30;         // how far back a form may reach
export const SIGNATURE_MAX = 600000;    // characters of PNG data URL

export const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
export const nameKey = (v) => cleanName(v).toLowerCase();

const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;

export function entryMinutes(e) {
  const a = ms(e?.started_at); const b = ms(e?.ended_at);
  if (a === null || b === null || b <= a) return 0;
  return Math.round((b - a) / MIN);
}
export const totalMinutes = (entries) => (entries || []).filter((e) => !e.voided_at).reduce((n, e) => n + entryMinutes(e), 0);

// "4 h 30 min", "45 min"
export function minutesText(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

// Checks one signed labor form.
//   entries:   [{ name, started_at, ended_at, pool_id? }]  (times as ISO strings)
//   signature: PNG data URL of the staff member's signature
//   existing:  this job's labor entries already saved [{ worker_name, started_at, ended_at, voided_at? }], so a name is not counted twice
// Returns { error } or { value: [{ name, key, started_at, ended_at, pool_id }] }.
export function validateLabor({ entries, signature, existing = [] }, now = new Date()) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return { error: 'Add at least one person.' };
  if (list.length > MAX_ENTRIES) return { error: `One form can have up to ${MAX_ENTRIES} people. Send it in two.` };
  const out = [];
  const live = (existing || []).filter((x) => !x.voided_at);
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i] || {};
    const who = `Row ${i + 1}`;
    const name = cleanName(row.name);
    if (name.length < 2) return { error: `${who}: type the person's name.` };
    const s = ms(row.started_at); const e = ms(row.ended_at);
    if (s === null || e === null) return { error: `${who} (${name}): enter a start and an end time.` };
    if (e <= s) return { error: `${who} (${name}): the end time has to be after the start time.` };
    if (e - s > MAX_SPAN_HOURS * HOUR) return { error: `${who} (${name}): one entry can be at most ${MAX_SPAN_HOURS} hours. Split it into two.` };
    if (e > now.getTime() + 5 * MIN) return { error: `${who} (${name}): the end time cannot be in the future.` };
    if (s < now.getTime() - MAX_AGE_DAYS * DAY) return { error: `${who} (${name}): that is more than ${MAX_AGE_DAYS} days ago. Ask the owner to add it.` };
    const key = nameKey(name);
    const dupe = out.find((o) => o.key === key && overlaps(s, e, new Date(o.started_at).getTime(), new Date(o.ended_at).getTime()));
    if (dupe) return { error: `${who}: ${name} is already on this form for overlapping times.` };
    const saved = live.find((x) => nameKey(x.worker_name) === key && overlaps(s, e, ms(x.started_at), ms(x.ended_at)));
    if (saved) return { error: `${name} already has time on this job that overlaps those hours.` };
    out.push({ name, key, started_at: new Date(s).toISOString(), ended_at: new Date(e).toISOString(), pool_id: typeof row.pool_id === 'string' && row.pool_id ? row.pool_id : null });
  }
  const sig = String(signature || '');
  if (!sig.startsWith('data:image/png;base64,') || sig.length < 200) return { error: 'Sign in the box to certify these names and times.' };
  if (sig.length > SIGNATURE_MAX) return { error: 'That signature is too large. Clear it and sign again.' };
  return { value: out };
}

// Names from the pool that match what is being typed, for the pick list. Starts-with matches first, then anywhere in the name.
export function suggestNames(pool, typed, taken = [], limit = 6) {
  const q = nameKey(typed);
  const used = new Set((taken || []).map(nameKey));
  const live = (pool || []).filter((p) => p.active !== false && !used.has(nameKey(p.name)));
  if (!q) return live.slice(0, limit);
  const starts = live.filter((p) => nameKey(p.name).startsWith(q));
  const inside = live.filter((p) => !nameKey(p.name).startsWith(q) && nameKey(p.name).includes(q));
  return [...starts, ...inside].slice(0, limit);
}

// Entries grouped by the signed form they came in on, newest form first: [{ cert, entries, minutes }]. Voided entries are left out.
export function groupByCertification(certs, entries) {
  const live = (entries || []).filter((e) => !e.voided_at);
  return [...(certs || [])]
    .sort((a, b) => String(b.certified_at).localeCompare(String(a.certified_at)))
    .map((cert) => {
      const mine = live.filter((e) => e.certification_id === cert.id).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
      return { cert, entries: mine, minutes: totalMinutes(mine) };
    })
    .filter((g) => g.entries.length > 0);
}
