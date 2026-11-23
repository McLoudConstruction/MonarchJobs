'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { parseFollowupDays } from '@/lib/estimateFollowup';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

const FIELDS = 'ontheway_auto,aftercare_auto,aftercare_default,rebook_enabled,rebook_months,rebook_message,plan_offer_enabled,plan_offer_days,plan_offer_message,plan_remind_enabled,plan_remind_days,plan_remind_message,estimate_followup_enabled,estimate_followup_days,estimate_followup_unopened,estimate_followup_opened,estimate_expiry_enabled,estimate_valid_days';

// Owner: after-job care instructions, and reminders to past customers (rebooking, plan offers, plan reminders).
// A collapsed row: click the title to open its settings. The status on the right follows the checkbox inside.
function OutreachSection({ title, enabled, open, onToggle, children }) {
  return (
    <section className={`out-sec${open ? ' open' : ''}`}>
      <button type="button" className="out-sec-head" aria-expanded={open} onClick={onToggle}>
        <span className="out-sec-chev" aria-hidden="true">&#9656;</span>
        <span className="out-sec-title">{title}</span>
        <span className={`out-status ${enabled ? 'on' : 'off'}`}>{enabled ? 'Enabled' : 'Disabled'}</span>
      </button>
      {open && <div className="out-sec-body">{children}</div>}
    </section>
  );
}

export default function RemindersSection({ token }) {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const saveS = useSaveStatus();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [openSec, setOpenSec] = useState(null); // one section open at a time
  const tog = (k) => () => setOpenSec((o) => (o === k ? null : k));

  useEffect(() => {
    getSupabase().from('settings').select(FIELDS).eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (error) { setMissing(true); return; }
      setF({ ...data, rebook_months: (data.rebook_months || []).join(', '), estimate_followup_days: (data.estimate_followup_days || []).join(', ') });
    });
  }, []);

  if (missing) return <div className="card"><p className="muted">This needs the latest database updates (015 and 040). Run them in Supabase, then reload.</p></div>;
  if (!f) return <div className="card"><p className="muted">Loading...</p></div>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    const months = [...new Set(String(f.rebook_months).split(/[,\s]+/).map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 60))].sort((a, b) => a - b);
    if (f.rebook_enabled && !months.length) { setMsg({ err: true, text: 'Enter the months for rebooking reminders, for example 3, 6, 12.' }); return false; }
    const followDays = parseFollowupDays(f.estimate_followup_days);
    if (f.estimate_followup_enabled && !followDays.length) { setMsg({ err: true, text: 'Enter the days for estimate follow-ups, for example 2, 5, 10.' }); return false; }
    const row = {
      estimate_followup_enabled: !!f.estimate_followup_enabled, estimate_followup_days: followDays.length ? followDays : [2, 5, 10],
      estimate_followup_unopened: f.estimate_followup_unopened.trim(), estimate_followup_opened: f.estimate_followup_opened.trim(),
      estimate_expiry_enabled: !!f.estimate_expiry_enabled, estimate_valid_days: Math.min(365, Math.max(1, Number(f.estimate_valid_days) || 30)),
      ontheway_auto: !!f.ontheway_auto, aftercare_auto: !!f.aftercare_auto, aftercare_default: f.aftercare_default.trim(),
      rebook_enabled: !!f.rebook_enabled, rebook_months: months, rebook_message: f.rebook_message.trim(),
      plan_offer_enabled: !!f.plan_offer_enabled, plan_offer_days: Math.min(365, Math.max(7, Number(f.plan_offer_days) || 75)), plan_offer_message: f.plan_offer_message.trim(),
      plan_remind_enabled: !!f.plan_remind_enabled, plan_remind_days: Math.min(60, Math.max(1, Number(f.plan_remind_days) || 14)), plan_remind_message: f.plan_remind_message.trim(),
    };
    const { error } = await getSupabase().from('settings').update(row).eq('id', 1);
    if (error) { setMsg({ err: true, text: error.message }); return false; }
    setF({ ...f, ...row, rebook_months: months.join(', '), estimate_followup_days: row.estimate_followup_days.join(', ') });
    setMsg({ text: 'Saved.' });
    return true;
  }

  async function runPreview() {
    setBusy(true); setPreview(null);
    try {
      // apiFetch already reads the answer and throws on an error
      setPreview(await apiFetch('/api/outreach/preview', token, { method: 'POST' }));
    } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }

  const wording = (k, label) => (
    <div className="field"><label>{label}</label>
      <textarea className="sig-notes" rows={2} maxLength={400} value={f[k]} onChange={set(k)} placeholder="Leave blank to use our standard wording. You can use {first}, {business} and {link}." />
    </div>
  );

  return (
    <form className="card" onSubmit={saveS.track(save)}>
      <h2>Outreach</h2>
      <p className="hint">Messages go by text and email to customers who have a phone or email on file. Every message has a way to stop reminders, and customers who stop are never contacted or mailed. Texting must be set up in Integrations.</p>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}

      <OutreachSection title="On the way" enabled={!!f.ontheway_auto} open={openSec === 'otw'} onToggle={tog('otw')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.ontheway_auto} onChange={set('ontheway_auto')} />
        Text and email the customer when the team taps On the way
      </label>
      <p className="hint">The message gives the minutes and a link to a page that shows the visit status and your phone number. It never names a team member. Running late sends the new time. A tap saved on a phone with no signal is not sent if it is more than 30 minutes old.</p>
      </OutreachSection>
      <OutreachSection title="After a job" enabled={!!f.aftercare_auto} open={openSec === 'after'} onToggle={tog('after')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.aftercare_auto} onChange={set('aftercare_auto')} />
        Send care instructions and the customer page link when a job is finished
      </label>
      <div className="field"><label>Care note sent with every job (optional)</label>
        <textarea className="sig-notes" rows={3} maxLength={1500} value={f.aftercare_default} onChange={set('aftercare_default')} placeholder="Open windows if you can. Wait 24 hours before moving furniture back..." />
      </div>
      <p className="hint">Each service can also have its own aftercare text and drying time in the Price list. Nothing is sent after a job unless there is care text or a drying time to share.</p>

      </OutreachSection>
      <OutreachSection title="Rebooking reminders" enabled={!!f.rebook_enabled} open={openSec === 'rebook'} onToggle={tog('rebook')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.rebook_enabled} onChange={set('rebook_enabled')} />
        Remind past carpet-cleaning customers to book again
      </label>
      <div className="field" style={{ maxWidth: 300 }}><label>Months since their last cleaning</label><input value={f.rebook_months} onChange={set('rebook_months')} placeholder="3, 6, 12, 18, 24" /></div>
      {wording('rebook_message', 'Wording (optional)')}

      </OutreachSection>
      <OutreachSection title="Regular plan offer" enabled={!!f.plan_offer_enabled} open={openSec === 'offer'} onToggle={tog('offer')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.plan_offer_enabled} onChange={set('plan_offer_enabled')} />
        Offer a regular cleaning plan to one-time customers
      </label>
      <div className="field" style={{ maxWidth: 300 }}><label>Days after their cleaning</label><input type="number" min="7" max="365" value={f.plan_offer_days} onChange={set('plan_offer_days')} /></div>
      {wording('plan_offer_message', 'Wording (optional)')}

      </OutreachSection>
      <OutreachSection title="Plan reminders" enabled={!!f.plan_remind_enabled} open={openSec === 'remind'} onToggle={tog('remind')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.plan_remind_enabled} onChange={set('plan_remind_enabled')} />
        Remind customers who have a plan before their visit is due
      </label>
      <div className="field" style={{ maxWidth: 300 }}><label>Days before it is due</label><input type="number" min="1" max="60" value={f.plan_remind_days} onChange={set('plan_remind_days')} /></div>
      {wording('plan_remind_message', 'Wording (optional)')}

      </OutreachSection>
      <OutreachSection title="Estimate follow-up" enabled={!!f.estimate_followup_enabled} open={openSec === 'estfollow'} onToggle={tog('estfollow')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.estimate_followup_enabled} onChange={set('estimate_followup_enabled')} />
        Follow up on estimates that were sent and have not been approved
      </label>
      <div className="field" style={{ maxWidth: 300 }}><label>Days after the estimate was sent</label><input value={f.estimate_followup_days} onChange={set('estimate_followup_days')} placeholder="2, 5, 10" /></div>
      {wording('estimate_followup_unopened', 'Wording when they have not opened it (optional)')}
      {wording('estimate_followup_opened', 'Wording when they opened it but have not answered (optional)')}
      <p className="hint">One text and email on each of those days, using the customer's phone and email on the estimate. It stops by itself when the customer approves or declines, when the estimate expires, after the last day, or if the customer taps "Stop reminders about this estimate". Sending the estimate again starts the count over. Anyone who already got another message today is skipped, so nobody gets two.</p>
      </OutreachSection>
      <OutreachSection title="Estimate expiry (restoration)" enabled={!!f.estimate_expiry_enabled} open={openSec === 'estexpiry'} onToggle={tog('estexpiry')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.estimate_expiry_enabled} onChange={set('estimate_expiry_enabled')} />
        Restoration estimates are valid for a set number of days
      </label>
      <div className="field" style={{ maxWidth: 300 }}><label>Valid for (days)</label><input type="number" min="1" max="365" value={f.estimate_valid_days} onChange={set('estimate_valid_days')} /></div>
      <p className="hint">The count starts when the estimate is sent, and the estimate is good through the whole last day. The customer's page shows the date; after it, the page says the estimate expired and cannot be approved online. Only estimates sent after you turn this on get a date. The owner can extend a sent estimate from the estimate on the lead or job. Carpet estimates never expire.</p>
      </OutreachSection>
      <div className="row" style={{ marginTop: 14 }}>
        <SaveButton save={saveS} idle="Save" className="primary" />
        <button type="button" className="secondary" disabled={busy} onClick={runPreview}>{busy ? 'Checking...' : 'Who would get a reminder today?'}</button>
      </div>
      <p className="hint">Reminders go out once a day. Save first, then check; the check sends nothing. After running update 015, the database needs your site address once (instructions at the bottom of that file).</p>

      {preview && (
        <div style={{ marginTop: 10 }}>
          <strong>{preview.total === 0 ? 'Nobody is due today.' : `${preview.total} customer${preview.total === 1 ? '' : 's'} due today`}</strong>
          <ul style={{ paddingLeft: 18 }}>
            {preview.items.map((it, i) => <li key={i}>{it.customer}: {it.kind} ({it.detail}){!it.phone && !it.email ? ' - no contact' : ''}</li>)}
          </ul>
        </div>
      )}
    </form>
  );
}
