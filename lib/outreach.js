// Reminders to past customers: rebooking at set intervals, a recurring-plan offer after a first cleaning, and
// reminders for customers who have a plan. This file decides who gets which message; the server sends it.
// Pure, so it can be tested. Dates are 'YYYY-MM-DD' in the business time zone.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function dateInTz(value, tz = 'America/Chicago') {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const parts = (s) => String(s).split('-').map(Number);
const fmt = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function addDays(s, n) {
  const [y, m, d] = parts(s);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Jan 31 + 1 month is Feb 28 (or 29), never March 3.
export function addMonths(s, n) {
  const [y, m, d] = parts(s);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fmt(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(d, last));
}

export const WINDOW_DAYS = 14; // a reminder is sent in the two weeks after it falls due, so a missed day is not lost
const inWindow = (today, start, endDays = WINDOW_DAYS) => today >= start && today <= addDays(start, endDays);

export const KIND_LABELS = { rebook: 'Rebooking reminder', plan_offer: 'Plan offer', plan_reminder: 'Plan reminder' };
const PRIORITY = { plan_reminder: 3, plan_offer: 2, rebook: 1 };

// customers: [{ id, display_name, first_name, phone, email, opt_out, last_visit_at, last_job: { id, token, type } | null, has_open_work }]
// plans: [{ id, customer_id, status, next_due, interval_months, name }]
// logged: Set or array of `${customer_id}|${dedupe_key}` already sent
// Returns at most one message per customer.
export function planOutreach({ now = new Date(), tz = 'America/Chicago', settings = {}, customers = [], plans = [], logged = [] }) {
  const today = dateInTz(now, tz);
  const done = logged instanceof Set ? logged : new Set(logged);
  const byCustomer = new Map();
  for (const p of plans) {
    if (!byCustomer.has(p.customer_id)) byCustomer.set(p.customer_id, []);
    byCustomer.get(p.customer_id).push(p);
  }
  const months = [...new Set((settings.rebook_months || []).map(Number).filter((m) => m >= 1 && m <= 60))].sort((a, b) => b - a);
  const out = [];

  for (const c of customers) {
    if (!c.phone && !c.email) continue;
    if (c.opt_out || c.has_open_work || !c.last_job?.token) continue;
    const mine = byCustomer.get(c.id) || [];
    const candidates = [];
    const add = (kind, dedupe, detail, plan = null) => {
      if (!done.has(`${c.id}|${dedupe}`)) candidates.push({ kind, dedupe, detail, plan });
    };

    if (settings.plan_remind_enabled !== false) {
      for (const p of mine.filter((x) => x.status === 'active')) {
        const start = addDays(p.next_due, -(Number(settings.plan_remind_days) || 14));
        if (today >= start && today <= addDays(p.next_due, WINDOW_DAYS)) add('plan_reminder', `plan:${p.id}:${p.next_due}`, `${p.name} due ${p.next_due}`, p);
      }
    }

    const last = c.last_visit_at ? dateInTz(c.last_visit_at, tz) : null;
    const hasPlan = mine.some((x) => x.status === 'active' || x.status === 'paused');
    if (last && c.last_job.type === 'floor_cleaning' && !hasPlan) {
      if (settings.plan_offer_enabled) {
        const start = addDays(last, Number(settings.plan_offer_days) || 75);
        if (inWindow(today, start)) add('plan_offer', `planoffer:${last}`, `first clean ${last}, offer after ${settings.plan_offer_days || 75} days`);
      }
      if (settings.rebook_enabled) {
        for (const m of months) {
          if (inWindow(today, addMonths(last, m))) { add('rebook', `rebook:${m}:${last}`, `${m} months since ${last}`); break; }
        }
      }
    }

    candidates.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind]);
    const pick = candidates[0];
    if (pick) {
      out.push({
        kind: pick.kind, dedupe: pick.dedupe, detail: pick.detail, plan_id: pick.plan?.id || null,
        customer_id: c.id, name: c.display_name, first_name: c.first_name, phone: c.phone, email: c.email,
        job_id: c.last_job.id, token: c.last_job.token,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ wording
const DEFAULTS = {
  rebook: 'Hi {first}, it has been a while since {business} cleaned your carpets. Ready for a fresh clean? Request a time here: {link}',
  plan_offer: 'Hi {first}, thanks again for choosing {business}. Many customers keep their carpets fresh with a regular cleaning. See the options here: {link}',
  plan_reminder: 'Hi {first}, your regular cleaning with {business} is coming up. Pick a time here: {link}',
};
const SUBJECTS = {
  rebook: 'Time for a fresh clean?',
  plan_offer: 'Keep your carpets fresh with a regular cleaning',
  plan_reminder: 'Your regular cleaning is coming up',
};

export function renderTemplate(template, vars) {
  return String(template).replace(/\{(first|business|link)\}/g, (_, k) => vars[k] ?? '');
}

// kind: rebook | plan_offer | plan_reminder; custom: the owner's own wording from Settings (may be empty)
export function buildOutreachMessages({ kind, custom = '', business, firstName, link }) {
  const biz = String(business || '').trim() || 'us';
  const first = String(firstName || '').trim() || 'there';
  const base = renderTemplate(String(custom || '').trim() || DEFAULTS[kind], { first, business: biz, link });
  const sms = `${base} Reply STOP to opt out.`;
  const subject = SUBJECTS[kind];
  const text = `${base}\n\nTo stop these reminders, open the link above and choose "Stop reminders".\n\n${biz}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430;max-width:520px">
<p>${esc(base.replace(link, '')).trim()}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f3a5f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open</a></p>
<p style="color:#6b7686;font-size:14px">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
<p style="color:#6b7686;font-size:13px">To stop these reminders, open the link and choose "Stop reminders".</p>
<p>${esc(biz)}</p></div>`;
  return { sms, subject, text, html };
}

// When a job is finished, an active plan for that customer moves to its next date if the visit was close to the due date.
export function advancePlan(plan, completedAt, tz = 'America/Chicago') {
  if (!plan || plan.status !== 'active') return null;
  const done = dateInTz(completedAt, tz);
  if (done < addDays(plan.next_due, -30)) return null;
  return addMonths(done, plan.interval_months);
}
