'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { parseFollowupDays } from '@/lib/estimateFollowup';
import { STORM_EVENT_CHOICES, parseLocation } from '@/lib/weather';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

const FIELDS = 'ontheway_auto,aftercare_auto,aftercare_default,rebook_enabled,rebook_months,rebook_message,plan_offer_enabled,plan_offer_days,plan_offer_message,plan_remind_enabled,plan_remind_days,plan_remind_message,estimate_followup_enabled,estimate_followup_days,estimate_followup_unopened,estimate_followup_opened,estimate_expiry_enabled,estimate_valid_days,referral_enabled,referral_reward_text,street_offers_enabled,street_offer_text,street_offer_max,street_offer_quiet_days,reschedule_enabled,reschedule_notice_hours,reschedule_max,slowday_enabled,slowday_percent,slowday_look_ahead_days,slowday_min_notice_hours,slowday_open_share,slowday_max_dates,slowday_max_per_day,slowday_quiet_days,slowday_message,weather_location,storm_enabled,storm_events,storm_window_days,storm_max,storm_message,freeze_enabled,freeze_precautions';

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
  const [wx, setWx] = useState(null); // "check the weather now" answer
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
    if ((f.storm_enabled || f.freeze_enabled) && !parseLocation(f.weather_location)) { setMsg({ err: true, text: 'Enter a 5-digit ZIP code for the weather alert area, for example 64801.' }); return false; }
    if (f.storm_enabled && !(f.storm_events || []).length) { setMsg({ err: true, text: 'Tick at least one kind of storm warning.' }); return false; }
    const row = {
      reschedule_enabled: !!f.reschedule_enabled,
      reschedule_notice_hours: Math.min(336, Math.max(0, Math.round(Number(f.reschedule_notice_hours)) || 0)),
      reschedule_max: Math.min(10, Math.max(1, Math.round(Number(f.reschedule_max)) || 2)),
      slowday_enabled: !!f.slowday_enabled,
      slowday_percent: Math.min(50, Math.max(1, Math.round(Number(f.slowday_percent)) || 10)),
      slowday_look_ahead_days: Math.min(30, Math.max(1, Math.round(Number(f.slowday_look_ahead_days)) || 7)),
      slowday_min_notice_hours: Math.min(336, Math.max(0, Math.round(Number(f.slowday_min_notice_hours)) || 0)),
      slowday_open_share: Math.min(100, Math.max(10, Math.round(Number(f.slowday_open_share)) || 60)),
      slowday_max_dates: Math.min(7, Math.max(1, Math.round(Number(f.slowday_max_dates)) || 3)),
      slowday_max_per_day: Math.min(50, Math.max(1, Math.round(Number(f.slowday_max_per_day)) || 10)),
      slowday_quiet_days: Math.min(730, Math.max(0, Math.round(Number(f.slowday_quiet_days)) || 0)),
      slowday_message: f.slowday_message.trim().slice(0, 300),
      weather_location: f.weather_location.trim().slice(0, 60),
      storm_enabled: !!f.storm_enabled,
      storm_events: (f.storm_events || []).filter((e) => STORM_EVENT_CHOICES.includes(e)),
      storm_window_days: Math.min(14, Math.max(1, Math.round(Number(f.storm_window_days)) || 5)),
      storm_max: Math.min(100, Math.max(1, Math.round(Number(f.storm_max)) || 25)),
      storm_message: f.storm_message.trim().slice(0, 300),
      freeze_enabled: !!f.freeze_enabled,
      freeze_precautions: f.freeze_precautions.trim().slice(0, 600),
      estimate_followup_enabled: !!f.estimate_followup_enabled, estimate_followup_days: followDays.length ? followDays : [2, 5, 10],
      estimate_followup_unopened: f.estimate_followup_unopened.trim(), estimate_followup_opened: f.estimate_followup_opened.trim(),
      estimate_expiry_enabled: !!f.estimate_expiry_enabled, estimate_valid_days: Math.min(365, Math.max(1, Number(f.estimate_valid_days) || 30)),
      referral_enabled: !!f.referral_enabled, referral_reward_text: f.referral_reward_text.trim().slice(0, 160),
      street_offers_enabled: !!f.street_offers_enabled, street_offer_text: f.street_offer_text.trim().slice(0, 300),
      street_offer_max: Math.min(50, Math.max(1, Math.round(Number(f.street_offer_max)) || 10)),
      street_offer_quiet_days: Math.min(730, Math.max(0, Math.round(Number(f.street_offer_quiet_days) || 0))),
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

  async function checkWeather() {
    setBusy(true); setWx(null);
    try { setWx(await apiFetch('/api/weather/check', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: f.weather_location }) })); } catch (e) { setMsg({ err: true, text: e.message }); }
    setBusy(false);
  }
  const toggleEvent = (name) => (e) => {
    const cur = new Set(f.storm_events || []);
    if (e.target.checked) cur.add(name); else cur.delete(name);
    setF({ ...f, storm_events: STORM_EVENT_CHOICES.filter((x) => cur.has(x)) });
  };

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
      <OutreachSection title="Referral program" enabled={!!f.referral_enabled} open={openSec === 'referral'} onToggle={tog('referral')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.referral_enabled} onChange={set('referral_enabled')} />
        Show customers a share link and code on their page
      </label>
      <div className="field"><label>What the customer gets (optional)</label>
        <input maxLength={160} value={f.referral_reward_text} onChange={set('referral_reward_text')} placeholder="$25 off your next cleaning when a friend books" />
      </div>
      <p className="hint">A friend who opens the link asks for a quote and becomes a lead marked Referral. The friend never sees who sent them. When that friend's job is finished the reward shows as owed under Financials, Referrals, where you mark it paid. A friend who is already a customer, or who is the same person, is still a lead but earns no reward.</p>
      </OutreachSection>
      <OutreachSection title="On your street offers" enabled={!!f.street_offers_enabled} open={openSec === 'street'} onToggle={tog('street')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.street_offers_enabled} onChange={set('street_offers_enabled')} />
        After a finished job, let me offer a visit to past customers on the same street
      </label>
      <div className="field"><label>The offer (optional)</label>
        <textarea className="sig-notes" rows={2} maxLength={300} value={f.street_offer_text} onChange={set('street_offer_text')} placeholder="This week only: 10% off a cleaning for neighbors." />
      </div>
      <div className="field" style={{ maxWidth: 300 }}><label>Most people in one batch</label><input type="number" min="1" max="50" value={f.street_offer_max} onChange={set('street_offer_max')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>Skip anyone we cleaned for in the last (days)</label><input type="number" min="0" max="730" value={f.street_offer_quiet_days} onChange={set('street_offer_quiet_days')} /></div>
      <p className="hint">Nothing is sent by itself. On a finished job the office sees who lives on that street, unticks anyone they like, and taps Send. It texts and emails people who have a phone or email, never anyone who stopped reminders, never anyone with open work, and never someone who already got a message in the last day. One offer per person per job. The message never names the customer whose job was finished.</p>
      </OutreachSection>
      <OutreachSection title="Customer rescheduling" enabled={!!f.reschedule_enabled} open={openSec === 'resched'} onToggle={tog('resched')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.reschedule_enabled} onChange={set('reschedule_enabled')} />
        Let carpet customers pick a new open time for their visit
      </label>
      <div className="field" style={{ maxWidth: 300 }}><label>Cannot be changed online within (hours of the visit)</label><input type="number" min="0" max="336" value={f.reschedule_notice_hours} onChange={set('reschedule_notice_hours')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>Most times one visit can be moved</label><input type="number" min="1" max="10" value={f.reschedule_max} onChange={set('reschedule_max')} /></div>
      <p className="hint">The customer's estimate page links to their visit page, where they see only the open times (the same rules as online booking, so the old time opens up again). The office is told when a customer moves a visit. If the assigned tech is busy or off at the new time, the tech is taken off the visit so the office can assign someone. Restoration visits and visits already under way can never be moved by the customer. The customer gets a text and email with the new time.</p>
      </OutreachSection>
      <OutreachSection title="Slow-day offers" enabled={!!f.slowday_enabled} open={openSec === 'slowday'} onToggle={tog('slowday')}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={f.slowday_enabled} onChange={set('slowday_enabled')} />
        Offer a percent off for days that are mostly empty
      </label>
      <div className="field" style={{ maxWidth: 300 }}><label>Percent off</label><input type="number" min="1" max="50" value={f.slowday_percent} onChange={set('slowday_percent')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>A day is slow when this share of its times is open (%)</label><input type="number" min="10" max="100" value={f.slowday_open_share} onChange={set('slowday_open_share')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>Never offer a day sooner than (hours from now)</label><input type="number" min="0" max="336" value={f.slowday_min_notice_hours} onChange={set('slowday_min_notice_hours')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>Look this many days ahead</label><input type="number" min="1" max="30" value={f.slowday_look_ahead_days} onChange={set('slowday_look_ahead_days')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>Most days in one offer</label><input type="number" min="1" max="7" value={f.slowday_max_dates} onChange={set('slowday_max_dates')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>Most people to offer in one day</label><input type="number" min="1" max="50" value={f.slowday_max_per_day} onChange={set('slowday_max_per_day')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>Skip anyone we cleaned for in the last (days)</label><input type="number" min="0" max="730" value={f.slowday_quiet_days} onChange={set('slowday_quiet_days')} /></div>
      {wording('slowday_message', 'Wording (optional)')}
      <p className="hint">You can also use {'{percent}'} and {'{days}'} in the wording. Once a day, after the other reminders, the emptiest days in the window are found and past carpet customers get a text and email with a private link. The link shows only those days, takes the percent off the booking (never below your job minimum), and works once. Anyone who got another message today, or a slow-day offer in the last two weeks, is skipped. "Who would get a reminder today?" below lists these too.</p>
      </OutreachSection>
      <OutreachSection title="Weather alerts" enabled={!!(f.storm_enabled || f.freeze_enabled)} open={openSec === 'weather'} onToggle={tog('weather')}>
      <div className="field" style={{ maxWidth: 300 }}><label>Alert area: ZIP code of your base</label><input value={f.weather_location} maxLength={60} onChange={set('weather_location')} placeholder="64801" /></div>
      <p className="hint">Alerts come from the National Weather Service, checked every 30 minutes. You can also type coordinates like 37.21, -93.29.</p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
        <input type="checkbox" checked={f.freeze_enabled} onChange={set('freeze_enabled')} />
        Freeze warning: tell the whole team when a freeze is expected
      </label>
      <div className="field"><label>Precautions shown with the warning</label>
        <textarea className="sig-notes" rows={3} maxLength={600} value={f.freeze_precautions} onChange={set('freeze_precautions')} />
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
        <input type="checkbox" checked={f.storm_enabled} onChange={set('storm_enabled')} />
        Storm alert: tell the office and owner, with a capacity check and a message to preview
      </label>
      <div className="field"><label>Warnings that count</label>
        {STORM_EVENT_CHOICES.map((name) => (
          <label key={name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={(f.storm_events || []).includes(name)} onChange={toggleEvent(name)} /> {name}
          </label>
        ))}
      </div>
      <div className="field" style={{ maxWidth: 300 }}><label>Count open times for the next (days)</label><input type="number" min="1" max="14" value={f.storm_window_days} onChange={set('storm_window_days')} /></div>
      <div className="field" style={{ maxWidth: 300 }}><label>Most people in one message batch</label><input type="number" min="1" max="100" value={f.storm_max} onChange={set('storm_max')} /></div>
      {wording('storm_message', 'Message after a storm (optional)')}
      <p className="hint">A freeze warning shows on everyone's schedule and sends a quiet notification to every team member's devices; "Got it" hides it on that device. A storm alert goes to the office and owner only: on the Schedule page they see how many open times there are in the next few days and who would get a message (past customers, most recent first). Nothing is sent until someone taps Send, and sending is blocked when there are no open times to offer. Watches and advisories are not included.</p>
      <div className="row"><button type="button" className="secondary" disabled={busy} onClick={checkWeather}>{busy ? 'Checking...' : 'Check the weather now'}</button></div>
      {wx && (
        <div style={{ marginTop: 8 }}>
          {wx.active.length === 0 ? <strong>No alerts for your area right now.</strong> : (
            <>
              <strong>Active for your area:</strong>
              <ul style={{ paddingLeft: 18 }}>{wx.active.map((a, i) => <li key={i}>{a.event} ({a.kind === 'freeze' ? 'freeze' : 'storm'}){a.expires_at ? ` until ${new Date(a.expires_at).toLocaleString()}` : ''}</li>)}</ul>
            </>
          )}
          <p className="hint">{wx.saved ? `Alert area saved as ${wx.saved}. ` : ''}This is what the weather service lists right now. No message was sent.</p>
        </div>
      )}
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
