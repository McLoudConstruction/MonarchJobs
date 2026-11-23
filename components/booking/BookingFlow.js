'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabaseClient';
import SignaturePad from '@/components/SignaturePad';
import PhoneInput from '@/components/PhoneInput';
import AddressFields from '@/components/AddressFields';
import CenterCard from '@/components/CenterCard';
import SlotPicker from './SlotPicker';
import { buildLines, priceBooking, QUANTITY_LABELS } from '@/lib/bookingPrice';
import { estimateTotals, lineCents } from '@/lib/estimate';
import { BOOKING_KINDS, BOOKING_KIND_LABELS, fmtSlotFull } from '@/lib/booking';
import { slowDayDiscountCents, daysPhrase } from '@/lib/slowDay';
import { money, UNIT_LABELS } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';
import './booking.css';

// The booking page, used two ways:
//  - a customer who was sent the link (no sign-in): carpet services the owner chose to show, then a time;
//  - a salesperson standing with a customer (signed in): every price-list item, any kind of job, and "schedule later".
// Steps: service -> price (the customer approves and signs) -> details -> time -> done.
// The server prices everything again from the price list; what is shown here is only a preview of that.

const STEPS = [['service', 'Service'], ['price', 'Price'], ['details', 'Your details'], ['time', 'Time']];
const BLANK_ADDRESS = { street: '', unit: '', city: '', state: 'MO', zip: '', gate_code: '', warnings: '' };

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export default function BookingFlow() {
  const [token, setToken] = useState(null);
  const [offerToken, setOfferToken] = useState(''); // a slow-day offer link (?offer=...)
  const [boot, setBoot] = useState(null);
  const [bootError, setBootError] = useState(null);

  const [step, setStep] = useState('service');
  const [kind, setKind] = useState('carpet');
  const [picks, setPicks] = useState({}); // price item id -> quantity as typed
  const [signerName, setSignerName] = useState('');
  const [signature, setSignature] = useState(null);
  const [cust, setCust] = useState({ first_name: '', last_name: '', phone: '', email: '' });
  const [addr, setAddr] = useState(BLANK_ADDRESS);
  const [notes, setNotes] = useState('');
  const [hp, setHp] = useState('');
  const [slots, setSlots] = useState(null);
  const [slot, setSlot] = useState(null);
  const [retryToken, setRetryToken] = useState(null); // the approval is saved; only the time needs picking again
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const authHeaders = useCallback((t = token) => (t ? { Authorization: `Bearer ${t}` } : {}), [token]);

  // Who is looking (signed-in staff or a customer), then the services.
  useEffect(() => {
    let alive = true;
    (async () => {
      let t = null;
      try {
        const { data } = await getSupabase().auth.getSession();
        t = data?.session?.access_token || null;
      } catch { /* no staff session available: this is a customer */ }
      if (!alive) return;
      setToken(t);
      const offerParam = new URLSearchParams(window.location.search).get('offer') || '';
      setOfferToken(offerParam);
      try {
        const res = await fetch(`/api/public/booking${offerParam ? `?offer=${encodeURIComponent(offerParam)}` : ''}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.status === 401) { setBootError({ expired: true }); return; }
        if (!res.ok) { setBootError({ text: 'Booking could not be loaded. Please try again in a moment.' }); return; }
        setBoot(body);
      } catch {
        if (alive) setBootError({ text: 'Booking could not be loaded. Please check your connection and reload.' });
      }
    })();
    return () => { alive = false; };
  }, []);

  const staff = boot?.staff || null;
  const services = useMemo(() => boot?.services || [], [boot]);
  const minimum = boot?.minimum || 0;
  const tz = boot?.timezone || 'America/Chicago';

  const pickList = useMemo(
    () => services.filter((s) => s.id in picks).map((s) => ({ id: s.id, quantity: picks[s.id] })),
    [services, picks],
  );
  const built = useMemo(() => buildLines(services, pickList), [services, pickList]);
  const totals = useMemo(() => estimateTotals(built.lines, minimum), [built, minimum]);
  const priced = useMemo(() => priceBooking(services, pickList, minimum), [services, pickList, minimum]);
  // A slow-day offer: a percent off, never below the job minimum. The server works it out again from the offer itself.
  const offer = !staff && boot?.offer && !boot.offer.invalid ? boot.offer : null;
  const discountCents = offer && priced.totals ? slowDayDiscountCents(priced.totals.totalCents, Math.round(minimum * 100), offer.percent) : 0;

  function toggle(item) {
    setPicks((p) => {
      const next = { ...p };
      if (item.id in next) delete next[item.id];
      else next[item.id] = item.unit === 'flat' ? '1' : '';
      return next;
    });
  }

  async function loadSlots() {
    setSlots(null);
    try {
      const slotsUrl = retryToken ? `/api/public/estimate/${retryToken}/slots` : `/api/public/booking/slots${offer ? `?offer=${encodeURIComponent(offerToken)}` : ''}`;
      const res = await fetch(slotsUrl, { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      setSlots(res.ok ? body : { tz, days: [] });
    } catch {
      setSlots({ tz, days: [] });
    }
  }

  function approvePrice(e) {
    e.preventDefault();
    setErr('');
    if (signerName.trim().length < 2) { setErr('Please type your full name.'); return; }
    if (!signature) { setErr('Please sign in the box.'); return; }
    const { first, last } = splitName(signerName);
    setCust((c) => ({ ...c, first_name: c.first_name || first, last_name: c.last_name || last }));
    setStep('details');
  }

  function toTime(e) {
    e.preventDefault();
    setErr('');
    if (!cust.first_name.trim() && !cust.last_name.trim()) { setErr('Please enter your name.'); return; }
    if (cust.phone.replace(/\D/g, '').length < 10) { setErr('Please enter a phone number we can reach.'); return; }
    if (addr.street.trim().length < 3 || !addr.city.trim()) { setErr('Please enter the street address and city for the job.'); return; }
    setStep('time');
    loadSlots();
  }

  async function submit(later) {
    setBusy(true);
    setErr('');
    try {
      // The approval was already saved and only the time was taken: just book the time, or leave it for the office.
      if (retryToken) {
        if (later) { setResult({ scheduled: false, estimate_token: retryToken }); setBusy(false); return; }
        const res = await fetch(`/api/public/estimate/${retryToken}/schedule`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: slot }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErr(body.error || 'Something went wrong. Please try again.');
          if (body.code === 'SLOT_TAKEN') { setSlot(null); loadSlots(); }
          setBusy(false);
          return;
        }
        setResult({ ...body, scheduled: true, estimate_token: retryToken });
        setBusy(false);
        return;
      }

      const res = await fetch('/api/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          kind, items: pickList, name: signerName, signature, customer: cust,
          address: { street: addr.street, unit: addr.unit, city: addr.city, state: addr.state, zip: addr.zip, gate_code: addr.gate_code, warnings: addr.warnings },
          notes, slot: later ? null : slot, later, hp, ...(offer ? { offer: offerToken } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setResult(body); setBusy(false); return; }
      if (body.code === 'SLOT_TAKEN') {
        // Taken before anything was saved, or a moment after the approval was saved.
        if (body.estimate_token) setRetryToken(body.estimate_token);
        setErr(body.error || 'That time was just taken. Please pick another.');
        setSlot(null);
        loadSlotsFor(body.estimate_token);
        setBusy(false);
        return;
      }
      setErr(body.error || 'Something went wrong. Please try again.');
      setBusy(false);
    } catch {
      setErr('Something went wrong. Please check your connection and try again.');
      setBusy(false);
    }
  }

  // Same as loadSlots, but for a token that was only just set (state has not caught up yet).
  async function loadSlotsFor(estimateToken) {
    if (!estimateToken) { loadSlots(); return; }
    setSlots(null);
    try {
      const res = await fetch(`/api/public/estimate/${estimateToken}/slots`);
      const body = await res.json().catch(() => ({}));
      setSlots(res.ok ? body : { tz, days: [] });
    } catch {
      setSlots({ tz, days: [] });
    }
  }

  function reset() {
    setStep('service'); setKind('carpet'); setPicks({}); setSignerName(''); setSignature(null);
    setCust({ first_name: '', last_name: '', phone: '', email: '' }); setAddr(BLANK_ADDRESS); setNotes('');
    setSlots(null); setSlot(null); setRetryToken(null); setErr(''); setResult(null);
  }

  async function copyLink() {
    const link = `${window.location.origin}/book`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this link:', link);
    }
  }

  // ------------------------------------------------------------------ screens
  if (bootError?.expired) {
    return (
      <CenterCard>
        <h2 className="auth-welcome">Sign in again</h2>
        <p className="hint auth-sub">Your sign-in has expired. <Link href="/login">Sign in</Link> and come back to this page.</p>
      </CenterCard>
    );
  }
  if (bootError) return <CenterCard><h2 className="auth-welcome">Booking unavailable</h2><p className="hint auth-sub">{bootError.text}</p></CenterCard>;
  if (!boot) return <div className="center-wrap"><p>Loading...</p></div>;

  const biz = boot.business || {};
  const contact = [displayPhone(biz.phone), biz.email].filter(Boolean).join(' · ');
  if (!boot.enabled) {
    return (
      <CenterCard>
        <h2 className="auth-welcome">Online booking is not available right now</h2>
        <p className="hint auth-sub">{contact ? `Please call or email us to book: ${contact}.` : 'Please contact us to book.'}</p>
      </CenterCard>
    );
  }
  if (!services.length) {
    return (
      <CenterCard>
        <h2 className="auth-welcome">Booking is not set up yet</h2>
        <p className="hint auth-sub">
          {staff
            ? 'There are no active items in the price list yet. Add them in Settings > Price list.'
            : `${contact ? `Please call or email us to book: ${contact}.` : 'Please contact us to book.'}`}
        </p>
      </CenterCard>
    );
  }

  const stepIndex = STEPS.findIndex(([k]) => k === step);
  const staffBar = staff && (
    <div className="bk-staffbar">
      <span>Booking in person as <strong>{staff.name}</strong></span>
      <span className="row">
        <button type="button" className="secondary small" onClick={copyLink}>{copied ? 'Link copied' : 'Copy customer link'}</button>
        <Link href="/schedule"><button type="button" className="secondary small">Back to the app</button></Link>
      </span>
    </div>
  );
  const header = (
    <>
      {logoUrl(biz.logo_path) && (
        <img src={logoUrl(biz.logo_path)} alt={biz.name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 90, objectFit: 'contain', margin: '0 0 10px' }} />
      )}
      <h1>{staff ? 'Book a job' : `Book with ${biz.name || 'us'}`}</h1>
      {contact && <p className="sub">{contact}</p>}
      {offer && <div className="banner ok">Special offer: {offer.percent}% off a carpet cleaning booked for {daysPhrase(offer.dates)}. Pick your services, then choose one of those days.</div>}
      {boot?.offer?.invalid && !staff && <div className="banner">{boot.offer.message} You can still book at the regular price.</div>}
    </>
  );

  // ---- done
  if (result) {
    const link = result.estimate_token ? `/e/${result.estimate_token}` : null;
    return (
      <div className="bk-wrap">
        {staffBar}
        {header}
        <div className="card bk-done">
          {result.scheduled ? (
            <>
              <div className="bk-big">{staff ? 'Booked' : 'You are booked'}</div>
              <p style={{ fontSize: 18, margin: '4px 0' }}><strong>{fmtSlotFull(result.start, result.end, result.tz || tz)}</strong></p>
              <p className="hint" style={{ margin: '4px 0 12px' }}>
                {addr.street}{addr.city ? `, ${addr.city}` : ''}
              </p>
              <p className="hint" style={{ marginBottom: 0 }}>{staff ? 'A confirmation goes to the customer by text and email when those are set up.' : `Need to change it? ${contact || 'Reply to the message we send you.'}`}</p>
            </>
          ) : (
            <>
              <div className="bk-big">{staff ? 'Saved, ready to schedule' : 'Thank you'}</div>
              <p className="hint" style={{ marginBottom: 0 }}>
                {staff ? 'The price is approved and the customer is in Leads under "Ready to schedule".' : `Your price is approved. We will contact you to confirm a time. ${contact ? `Questions? ${contact}` : ''}`}
              </p>
            </>
          )}
          <div className="bk-actions">
            {staff && result.job_id && <Link href={`/jobs/${result.job_id}`}><button type="button" className="primary big" style={{ width: '100%' }}>Open the work order</button></Link>}
            {staff && !result.job_id && result.lead_id && <Link href={`/leads/${result.lead_id}`}><button type="button" className="primary big" style={{ width: '100%' }}>Open the lead</button></Link>}
            {!staff && link && <a href={link}><button type="button" className="secondary big" style={{ width: '100%' }}>View your estimate</button></a>}
            {staff && <button type="button" className="secondary big" onClick={reset}>Book another job</button>}
          </div>
        </div>
      </div>
    );
  }

  const bar = (
    <div className="bk-steps" aria-hidden="true">{STEPS.map(([k], i) => <span key={k} className={i <= stepIndex ? 'on' : ''} />)}</div>
  );

  // ---- service
  if (step === 'service') {
    const canContinue = built.lines.length > 0 && built.errors.length === 0;
    return (
      <div className="bk-wrap">
        {staffBar}
        {header}
        {bar}
        <p className="bk-step-name">Step 1 of 4: choose the service</p>
        {staff && (
          <div className="bk-kinds" role="group" aria-label="Kind of job">
            {BOOKING_KINDS.map((k) => (
              <button key={k} type="button" className={`bk-kind${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{BOOKING_KIND_LABELS[k]}</button>
            ))}
          </div>
        )}
        <div className="bk-services">
          {services.map((s) => {
            const on = s.id in picks;
            const line = built.lines.find((l) => l.price_item_id === s.id);
            return (
              <div key={s.id} className={`bk-service${on ? ' on' : ''}`}>
                <button type="button" className="bk-service-head" aria-pressed={on} onClick={() => toggle(s)}>
                  <span>
                    <span className="bk-service-name">{s.name}</span>
                    {s.description && <span className="bk-service-desc" style={{ display: 'block' }}>{s.description}</span>}
                  </span>
                  <span className="bk-service-price">{money(s.price)}<small>{UNIT_LABELS[s.unit]}</small></span>
                </button>
                {on && s.unit !== 'flat' && (
                  <div className="bk-service-qty">
                    <label htmlFor={`q-${s.id}`}>{QUANTITY_LABELS[s.unit] || 'Amount'}</label>
                    <input
                      id={`q-${s.id}`}
                      type="number"
                      inputMode={s.unit === 'room' || s.unit === 'each' ? 'numeric' : 'decimal'}
                      min="0"
                      step={s.unit === 'room' || s.unit === 'each' ? '1' : 'any'}
                      value={picks[s.id]}
                      onChange={(e) => setPicks((p) => ({ ...p, [s.id]: e.target.value }))}
                      autoFocus
                    />
                    {line && <span className="bk-line-total">{money(lineCents(line) / 100)}</span>}
                  </div>
                )}
                {on && s.unit === 'flat' && <div className="bk-service-qty"><span className="bk-line-total">{money(s.price)}</span></div>}
              </div>
            );
          })}
        </div>
        <div className="bk-bar">
          <div>
            <div className="bk-bar-total">{built.lines.length ? money(totals.totalCents / 100) : 'Choose a service'}</div>
            {totals.minimumAdjustmentCents > 0 && <div className="bk-bar-note">Includes the {money(minimum)} minimum charge</div>}
            {built.errors.length > 0 && <div className="bk-bar-note">{built.errors[0]}</div>}
          </div>
          <button type="button" className="primary big" disabled={!canContinue} onClick={() => { setErr(''); setStep('price'); }}>See the price</button>
        </div>
      </div>
    );
  }

  // ---- price: the customer approves and signs
  if (step === 'price') {
    const base = priced.totals || totals;
    const t = discountCents > 0 ? { ...base, totalCents: base.totalCents - discountCents } : base;
    return (
      <div className="bk-wrap">
        {staffBar}
        {header}
        {bar}
        <p className="bk-step-name">Step 2 of 4: your price</p>
        <form className="card" onSubmit={approvePrice}>
          <div className="bk-price-big">{money(t.totalCents / 100)}</div>
          <table className="table">
            <thead><tr><th>Service</th><th>Qty</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {(priced.lines || built.lines).map((l) => (
                <tr key={l.price_item_id}>
                  <td>{l.description}<span className="muted" style={{ display: 'block', fontSize: 12 }}>{money(l.unit_price)} {UNIT_LABELS[l.unit]}</span></td>
                  <td>{Number(l.quantity)}</td>
                  <td style={{ textAlign: 'right' }}>{money(lineCents(l) / 100)}</td>
                </tr>
              ))}
              {t.minimumAdjustmentCents > 0 && (
                <tr><td colSpan="2">Minimum charge adjustment</td><td style={{ textAlign: 'right' }}>{money(t.minimumAdjustmentCents / 100)}</td></tr>
              )}
              {discountCents > 0 && (
                <tr><td colSpan="2">Slow-day offer ({offer.percent}% off)</td><td style={{ textAlign: 'right' }}>-{money(discountCents / 100)}</td></tr>
              )}
              <tr className="bk-total-row"><th colSpan="2">Total</th><th style={{ textAlign: 'right' }}>{money(t.totalCents / 100)}</th></tr>
            </tbody>
          </table>
          {priced.error && <div className="msg err">{priced.error}</div>}
          <h2 style={{ marginTop: 18 }}>Approve this price</h2>
          <p className="hint">
            {staff ? 'Hand the screen to the customer to review the price and sign. ' : ''}
            By signing, you approve the work and price above for a total of <strong>{money(t.totalCents / 100)}</strong>.
          </p>
          <div className="field"><label htmlFor="bk-signer">Your full name</label><input id="bk-signer" value={signerName} onChange={(e) => setSignerName(e.target.value)} autoComplete="name" /></div>
          <div className="field"><label>Your signature</label><SignaturePad onChange={setSignature} /></div>
          {err && <div className="msg err">{err}</div>}
          <div className="bk-actions">
            <button className="primary big" disabled={!!priced.error}>Approve and continue</button>
            <button type="button" className="secondary big" onClick={() => { setErr(''); setStep('service'); }}>Change the services</button>
          </div>
        </form>
      </div>
    );
  }

  // ---- details
  if (step === 'details') {
    const setC = (k) => (e) => setCust((c) => ({ ...c, [k]: e.target.value }));
    const setA = (patch) => setAddr((a) => ({ ...a, ...patch }));
    return (
      <div className="bk-wrap">
        {staffBar}
        {header}
        {bar}
        <p className="bk-step-name">Step 3 of 4: {staff ? 'the customer\'s details' : 'your details'}</p>
        <form className="card" onSubmit={toTime}>
          <h2>Contact</h2>
          <div className="grid2">
            <div className="field"><label>First name</label><input value={cust.first_name} onChange={setC('first_name')} autoComplete="given-name" /></div>
            <div className="field"><label>Last name</label><input value={cust.last_name} onChange={setC('last_name')} autoComplete="family-name" /></div>
            <div className="field"><label>Phone *</label><PhoneInput value={cust.phone} onChange={setC('phone')} /></div>
            <div className="field"><label>Email</label><input type="email" value={cust.email} onChange={setC('email')} autoComplete="email" /></div>
          </div>
          <h2 style={{ marginTop: 14 }}>Where is the job?</h2>
          {staff ? (
            <AddressFields values={addr} onChange={setA} required />
          ) : (
            <div className="grid2">
              <div className="field" style={{ gridColumn: '1 / -1' }}><label>Street address *</label><input value={addr.street} onChange={(e) => setA({ street: e.target.value })} autoComplete="address-line1" /></div>
              <div className="field"><label>Unit / suite</label><input value={addr.unit} onChange={(e) => setA({ unit: e.target.value })} autoComplete="address-line2" /></div>
              <div className="field"><label>City *</label><input value={addr.city} onChange={(e) => setA({ city: e.target.value })} autoComplete="address-level2" /></div>
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div className="field" style={{ width: 90 }}><label>State</label><input value={addr.state} maxLength={2} onChange={(e) => setA({ state: e.target.value.toUpperCase() })} autoComplete="address-level1" /></div>
                <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={addr.zip} inputMode="numeric" onChange={(e) => setA({ zip: e.target.value })} autoComplete="postal-code" /></div>
              </div>
            </div>
          )}
          <div className="grid2">
            <div className="field"><label>Gate code or access (optional)</label><input value={addr.gate_code} onChange={(e) => setA({ gate_code: e.target.value })} /></div>
            <div className="field"><label>Pets or other things to know (optional)</label><input value={addr.warnings} onChange={(e) => setA({ warnings: e.target.value })} /></div>
          </div>
          <div className="field"><label>Anything else we should know? (optional)</label><textarea className="sig-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {/* hidden from people; robots fill it in */}
          <div className="bk-hp" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label></div>
          {err && <div className="msg err">{err}</div>}
          <div className="bk-actions">
            <button className="primary big">Choose a time</button>
            <button type="button" className="secondary big" onClick={() => { setErr(''); setStep('price'); }}>Back</button>
          </div>
        </form>
      </div>
    );
  }

  // ---- time
  const chosen = slot && slots?.days.flatMap((d) => d.slots).find((s) => s.start === slot);
  const noTimes = slots && slots.days.length === 0;
  return (
    <div className="bk-wrap">
      {staffBar}
      {header}
      {bar}
      <p className="bk-step-name">Step 4 of 4: pick a time</p>
      <div className="card">
        {retryToken && <div className="banner">Your price is approved. That time was taken, so please pick another.</div>}
        {!slots && <p className="hint" style={{ margin: 0 }}>Loading open times...</p>}
        {slots && (
          <SlotPicker
            days={slots.days}
            tz={slots.tz || tz}
            value={slot}
            onPick={setSlot}
            empty={staff ? 'There are no open times in the booking window. You can schedule later from Leads.' : `There are no open times right now. Choose "Call me to schedule" and we will contact you${contact ? `, or call ${contact}` : ''}.`}
          />
        )}
        {err && <div className="msg err">{err}</div>}
        {chosen && <div className="bk-picked">{fmtSlotFull(chosen.start, chosen.end, slots.tz || tz)}</div>}
        <div className="bk-actions">
          {!noTimes && <button type="button" className="primary big" disabled={!slot || busy || !slots} onClick={() => submit(false)}>{busy ? 'Booking...' : 'Book this time'}</button>}
          {!offer && (
            <button type="button" className={`${noTimes ? 'primary' : 'secondary'} big`} disabled={busy} onClick={() => submit(true)}>
              {staff ? 'Schedule later' : 'Call me to schedule'}
            </button>
          )}
          {!retryToken && <button type="button" className="secondary big" disabled={busy} onClick={() => { setErr(''); setStep('details'); }}>Back</button>}
        </div>
      </div>
    </div>
  );
}
