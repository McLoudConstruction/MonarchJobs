'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PhoneInput from '@/components/PhoneInput';
import { getSupabase } from '@/lib/supabaseClient';
import { displayPhone, digitsOnly } from '@/lib/phone';
import * as L from '@/lib/leadIntake';

// The Stage 1 questions for Restoration and Carpet leads. Every section is a card (or two) of
// dropdowns, chips and short text fields. They read and write value.intake through onChange, so the
// new-lead wizard shows them one step at a time and the lead page shows them all together.

function useIntake(value, onChange) {
  const i = value.intake || {};
  const set = (patch) => onChange({ intake: { ...(value.intake || {}), ...patch } });
  return [i, set];
}

// ------------------------------------------------------------------ field pieces
export function Pick({ label, value, onChange, options, blank = 'Select...', wide = false }) {
  return (
    <div className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label>{label}</label>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{blank}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Text({ label, value, onChange, placeholder, wide = false, numeric = false, type = 'text' }) {
  return (
    <div className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label>{label}</label>
      <input
        type={type}
        value={value || ''}
        placeholder={placeholder}
        inputMode={numeric ? 'numeric' : undefined}
        autoComplete="off"
        onChange={(e) => onChange(numeric ? e.target.value.replace(/[^\d.]/g, '') : e.target.value)}
      />
    </div>
  );
}

// Tap to turn each choice on or off. Stores the labels of the chosen ones as a list.
export function Chips({ label, value, onChange, options }) {
  const chosen = value || [];
  const toggle = (v) => onChange(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
  return (
    <div className="field" style={{ gridColumn: '1 / -1' }}>
      <label>{label}</label>
      <div className="intake-chips">
        {options.map((o) => (
          <button key={o.value} type="button" className={`intake-chip ${chosen.includes(o.value) ? "on" : ""}`} aria-pressed={chosen.includes(o.value)} onClick={() => toggle(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ people and place (both kinds)
// Rendered inside the Contact card (after "How did they reach us?").
export function ContactExtra({ kind, value, onChange }) {
  const [i, set] = useIntake(value, onChange);
  if (kind === 'restoration') {
    return (
      <>
        <Pick label="Caller is the" value={i.relationship} onChange={(v) => set({ relationship: v })} options={L.RELATIONSHIPS} />
        <Pick label="How did you hear about us?" value={i.heard_about} onChange={(v) => set({ heard_about: v })} options={L.HEARD_ABOUT_RESTORATION} />
      </>
    );
  }
  const notOwner = i.relationship && i.relationship !== 'Owner';
  return (
    <>
      <Pick label="Best way to reach them" value={i.preferred_contact} onChange={(v) => set({ preferred_contact: v })} options={L.CONTACT_METHODS} />
      <Text label="Best time to reach them" value={i.best_time} onChange={(v) => set({ best_time: v })} placeholder="Weekday evenings" />
      <Pick label="Caller is the" value={i.relationship} onChange={(v) => set({ relationship: v })} options={L.CARPET_RELATIONSHIPS} />
      <Pick label="How did you hear about us?" value={i.heard_about} onChange={(v) => set({ heard_about: v })} options={L.HEARD_ABOUT_CARPET} />
      {notOwner && <Text wide label="Who authorizes the work and who pays?" value={i.authorizer} onChange={(v) => set({ authorizer: v })} />}
    </>
  );
}

// Rendered inside the Service address card (after Warnings).
export function AddressExtra({ kind, value, onChange }) {
  const [i, set] = useIntake(value, onChange);
  return (
    <div className="grid2">
      {kind === 'restoration' && <Pick label="Property" value={i.property_type} onChange={(v) => set({ property_type: v })} options={L.PROPERTY_TYPES} />}
      <Text wide={kind !== 'restoration'} label={kind === 'restoration' ? 'Mailing address (if different)' : 'Billing address (if different)'} value={i.alt_address} onChange={(v) => set({ alt_address: v })} />
    </div>
  );
}

// A repeat caller should not be entered twice: offer the customers on file that match the phone or email.
export function CustomerMatchHint({ phone, email, linkedId, onUse }) {
  const [matches, setMatches] = useState([]);
  useEffect(() => {
    if (linkedId) { setMatches([]); return undefined; }
    const goodPhone = digitsOnly(phone).length >= 10;
    const goodEmail = /.+@.+\..+/.test(email || '');
    if (!goodPhone && !goodEmail) { setMatches([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      getSupabase().rpc('find_customer_matches', { p_phone: goodPhone ? phone : '', p_email: goodEmail ? email : '' })
        .then(({ data }) => { if (live) setMatches(data || []); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [phone, email, linkedId]);
  if (!matches.length) return null;
  return (
    <div className="match-card">
      <div className="match-title">Existing customer?</div>
      <div className="match-sub">This phone number or email is already on file.</div>
      {matches.slice(0, 3).map((m) => (
        <div key={m.id} className="match-row">
          <div className="match-who">
            <strong>{m.display_name}</strong>
            <span>{[m.phone && displayPhone(m.phone), m.email].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="match-actions">
            <Link href={`/customers/${m.id}`} target="_blank" className="match-view">View</Link>
            <button type="button" className="secondary small" onClick={() => onUse(m.id)}>Use this customer</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ notes (both kinds)
export function NotesCard({ kind, value, onChange }) {
  const set = (k) => (e) => onChange({ [k]: e.target.value });
  return (
    <div className="card">
      <h2>Notes</h2>
      <div className="field"><label>PO number</label><input value={value.po_number || ''} onChange={set('po_number')} /></div>
      <div className="field">
        <label>{kind === 'restoration' ? 'Loss summary for the tech' : 'Job summary for the tech'}</label>
        <textarea placeholder="Filled in from your answers when you save. Type here to use your own." value={value.loss_summary || ''} onChange={set('loss_summary')} />
      </div>
      <div className="field"><label>Internal notes</label><textarea value={value.notes || ''} onChange={set('notes')} /><div className="note">Never shown to the customer. Carried onto the job.</div></div>
    </div>
  );
}

// ------------------------------------------------------------------ restoration
export function RestorationLoss({ value, onChange }) {
  const [i, set] = useIntake(value, onChange);
  return (
    <>
      <div className="card">
        <h2>What happened</h2>
        <div className="grid2">
          <Pick label="Cause" value={i.loss_type} onChange={(v) => set({ loss_type: v })} options={L.LOSS_TYPES.map((o) => ({ value: o.label, label: o.label }))} />
          <Pick label="Water source" value={i.water_source} onChange={(v) => set({ water_source: v })} options={L.WATER_SOURCES} />
          <Pick label="Loss started" value={i.loss_started} onChange={(v) => set({ loss_started: v })} options={L.LOSS_AGE} />
          <Pick label="Discovered" value={i.loss_discovered} onChange={(v) => set({ loss_discovered: v })} options={L.LOSS_AGE} />
          <Pick label="Is the water still running?" value={i.water_flow} onChange={(v) => set({ water_flow: v })} options={L.WATER_FLOW} />
          <Pick label="Standing water" value={i.standing_water} onChange={(v) => set({ standing_water: v })} options={L.STANDING_WATER} />
        </div>
      </div>
      <div className="card">
        <h2>What is affected</h2>
        <div className="grid2">
          <Text label="Rooms and floors" value={i.affected_rooms} onChange={(v) => set({ affected_rooms: v })} placeholder="Kitchen, hall, basement" />
          <Text label="Approx. square feet" numeric value={i.affected_sqft} onChange={(v) => set({ affected_sqft: v })} />
          <Chips label="Water coming through" value={i.water_spread} onChange={(v) => set({ water_spread: v })} options={L.WATER_SPREAD} />
          <Chips label="What is wet" value={i.materials_wet} onChange={(v) => set({ materials_wet: v })} options={L.MATERIALS_WET} />
        </div>
      </div>
    </>
  );
}

export function RestorationSafety({ value, onChange }) {
  const [i, set] = useIntake(value, onChange);
  const suggested = L.suggestPriority(i);
  const priority = value.priority || suggested;
  return (
    <>
      <div className="card">
        <h2>Safety</h2>
        <div className="grid2">
          <Pick label="Anyone hurt or in danger?" value={i.injuries} onChange={(v) => set({ injuries: v })} options={L.YES_NO} />
          <Pick label="Habitable tonight?" value={i.habitable} onChange={(v) => set({ habitable: v })} options={L.HABITABLE} />
          <Pick wide label="Electrical" value={i.electrical} onChange={(v) => set({ electrical: v })} options={L.ELECTRICAL} />
          <Chips label="Any of these present?" value={i.site_hazards} onChange={(v) => set({ site_hazards: v })} options={L.SITE_HAZARDS} />
          <Chips label="In the home" value={i.vulnerable} onChange={(v) => set({ vulnerable: v })} options={L.VULNERABLE} />
          <Pick wide label="Age of the home" value={i.home_age} onChange={(v) => set({ home_age: v })} options={L.HOME_AGE} />
        </div>
        {i.home_age === 'pre1980' && <div className="note">Built before 1980: asbestos and lead testing come before any demo.</div>}
      </div>
      <div className="card">
        <h2>Access and site</h2>
        <div className="grid2">
          <Text label="On site, can give access" value={i.onsite_name} onChange={(v) => set({ onsite_name: v })} placeholder="Name" />
          <div className="field"><label>Phone</label><PhoneInput value={i.onsite_phone || ''} onChange={(e) => set({ onsite_phone: e.target.value })} /></div>
          <Text wide label="Parking, lockbox, HOA or building rules, elevator" value={i.access_notes} onChange={(v) => set({ access_notes: v })} />
          <Pick wide label="Power for equipment" value={i.site_power} onChange={(v) => set({ site_power: v })} options={L.SITE_POWER} />
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Priority</label>
            <select value={priority} onChange={(e) => onChange({ priority: e.target.value })} className={`prio-select prio-${priority}`}>
              {Object.entries(L.PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>
    </>
  );
}

export function RestorationInsurance({ value, onChange }) {
  const [i, set] = useIntake(value, onChange);
  const claim = i.claim === 'yes';
  return (
    <>
      <div className="card">
        <h2>Insurance</h2>
        <div className="grid2">
          <Pick label="Who is paying?" value={i.payer} onChange={(v) => set({ payer: v })} options={L.PAYERS} />
          <Text label="Decision-maker" value={i.decision_maker} onChange={(v) => set({ decision_maker: v })} />
          <Pick wide label="Filing an insurance claim?" value={i.claim} onChange={(v) => set({ claim: v })} options={L.YES_NO_UNSURE} />
          {claim && (
            <>
              <Text label="Carrier" value={i.carrier} onChange={(v) => set({ carrier: v })} />
              <Text label="Claim number" value={i.claim_number} onChange={(v) => set({ claim_number: v })} />
              <Text label="Policy number" value={i.policy_number} onChange={(v) => set({ policy_number: v })} />
              <Pick label="Claim reported?" value={i.claim_reported} onChange={(v) => set({ claim_reported: v })} options={L.YES_NO} />
              <Text label="Adjuster name" value={i.adjuster_name} onChange={(v) => set({ adjuster_name: v })} />
              <div className="field"><label>Adjuster phone</label><PhoneInput value={i.adjuster_phone || ''} onChange={(e) => set({ adjuster_phone: e.target.value })} /></div>
              <Text label="Deductible, if known" value={i.deductible} onChange={(v) => set({ deductible: v })} placeholder="$1,000" />
              <Pick label="Program" value={i.claim_program} onChange={(v) => set({ claim_program: v })} options={L.CLAIM_PROGRAM} />
              <Pick label="Carrier requires a preferred contractor?" value={i.preferred_contractor} onChange={(v) => set({ preferred_contractor: v })} options={L.YES_NO_UNSURE} />
              <Pick label="OK to start emergency work before the adjuster arrives?" value={i.emergency_ok} onChange={(v) => set({ emergency_ok: v })} options={L.YES_NO_UNSURE} />
            </>
          )}
        </div>
      </div>
      <NotesCard kind="restoration" value={value} onChange={onChange} />
    </>
  );
}

// ------------------------------------------------------------------ carpet
export function CarpetService({ value, onChange }) {
  const [i, set] = useIntake(value, onChange);
  const items = i.clean_items || [];
  const extras = i.clean_extras || [];
  return (
    <>
      <div className="card">
        <h2>What needs cleaning</h2>
        <div className="grid2">
          <Chips label="Cleaning" value={items} onChange={(v) => set({ clean_items: v })} options={L.CLEAN_ITEMS} />
          <Pick label="Type of clean" value={i.clean_type} onChange={(v) => set({ clean_type: v })} options={L.CLEAN_TYPES} />
          <Text label="Rooms or areas" numeric value={i.area_count} onChange={(v) => set({ area_count: v })} />
          <Text label="Approx. square feet" numeric value={i.sqft} onChange={(v) => set({ sqft: v })} />
          <Chips label="Also include" value={extras} onChange={(v) => set({ clean_extras: v })} options={L.CLEAN_EXTRAS} />
          {extras.includes('Stairs') && <Text label="How many stairs?" numeric value={i.stairs} onChange={(v) => set({ stairs: v })} />}
          {items.includes('Area rugs') && <Text wide label="Rugs: size, material, stay or go to the shop" value={i.rugs} onChange={(v) => set({ rugs: v })} />}
        </div>
      </div>
      <div className="card">
        <h2>Carpet</h2>
        <div className="grid2">
          <Pick label="Fiber" value={i.fiber} onChange={(v) => set({ fiber: v })} options={L.FIBERS.map((o) => ({ value: o.label, label: o.label }))} />
          <Pick label="Age" value={i.carpet_age} onChange={(v) => set({ carpet_age: v })} options={L.CARPET_AGE} />
          <Pick wide label="Warranty that requires a specific cleaning method?" value={i.warranty} onChange={(v) => set({ warranty: v })} options={L.WARRANTY} />
          <Chips label="Existing damage" value={i.prior_damage} onChange={(v) => set({ prior_damage: v })} options={L.PRIOR_DAMAGE} />
        </div>
      </div>
    </>
  );
}

export function CarpetCondition({ value, onChange, onSwitchToRestoration }) {
  const [i, set] = useIntake(value, onChange);
  const flagged = L.needsRestorationReview(i);
  return (
    <>
      <div className="card">
        <h2>Stains and odor</h2>
        <div className="grid2">
          <Chips label="Stains" value={i.stains} onChange={(v) => set({ stains: v })} options={L.STAINS} />
          <Pick label="Traffic lanes or heavy soiling?" value={i.soiling} onChange={(v) => set({ soiling: v })} options={L.SOILING} />
          <Pick label="Pet odor or urine?" value={i.pet_odor} onChange={(v) => set({ pet_odor: v })} options={L.YES_NO} />
          {i.pet_odor === 'yes' && <Text wide label="Which rooms, how old, treated before?" value={i.pet_odor_details} onChange={(v) => set({ pet_odor_details: v })} />}
        </div>
      </div>
      <div className="card">
        <h2>History</h2>
        <div className="grid2">
          <Pick label="Last professionally cleaned" value={i.last_cleaned} onChange={(v) => set({ last_cleaned: v })} options={L.LAST_CLEANED} />
          <Text label="Already tried" value={i.already_tried} onChange={(v) => set({ already_tried: v })} placeholder="Store cleaner, rental machine, other company" />
          <Pick label="Recent water damage, leaks or flooding?" value={i.recent_water} onChange={(v) => set({ recent_water: v })} options={L.YES_NO} />
          <Pick label="Mold or musty smell?" value={i.mold_smell} onChange={(v) => set({ mold_smell: v })} options={L.YES_NO} />
        </div>
        {flagged && (
          <div className="banner warn">
            {i.recent_water === 'yes' ? 'Recent water damage belongs in the restoration workflow.' : 'Mold or a musty smell is flagged for restoration review.'}
            {onSwitchToRestoration && <> <button type="button" className="secondary small" onClick={onSwitchToRestoration}>Switch to Restoration</button></>}
          </div>
        )}
      </div>
    </>
  );
}

export function CarpetTiming({ value, onChange }) {
  const [i, set] = useIntake(value, onChange);
  return (
    <>
      <div className="card">
        <h2>When</h2>
        <div className="grid2">
          <Text label="Needed by" type="date" value={i.needed_by} onChange={(v) => set({ needed_by: v })} />
          <Text label="What is the deadline for?" value={i.deadline_reason} onChange={(v) => set({ deadline_reason: v })} placeholder="Move-in, event, listing, inspection" />
          <Text wide label="Preferred days and time windows" value={i.preferred_windows} onChange={(v) => set({ preferred_windows: v })} />
          <Pick label="Who lets us in?" value={i.access} onChange={(v) => set({ access: v })} options={L.CARPET_ACCESS} />
          <Pick label="Property" value={i.occupancy} onChange={(v) => set({ occupancy: v })} options={L.OCCUPANCY} />
          <Pick label="Furniture" value={i.furnishing} onChange={(v) => set({ furnishing: v })} options={L.FURNISHING} />
        </div>
      </div>
      <div className="card">
        <h2>Quote</h2>
        <div className="grid2">
          <Pick wide label="How will this be quoted?" value={i.quote_type} onChange={(v) => set({ quote_type: v })} options={L.QUOTE_TYPES} />
        </div>
        <NotesInline kind="carpet" value={value} onChange={onChange} />
      </div>
    </>
  );
}

// The carpet timing step has room for the notes under the quote choice instead of a third card.
function NotesInline({ kind, value, onChange }) {
  const set = (k) => (e) => onChange({ [k]: e.target.value });
  return (
    <>
      <div className="grid2">
        <div className="field"><label>PO number</label><input value={value.po_number || ''} onChange={set('po_number')} /></div>
      </div>
      <div className="field">
        <label>{kind === 'restoration' ? 'Loss summary for the tech' : 'Job summary for the tech'}</label>
        <textarea placeholder="Filled in from your answers when you save. Type here to use your own." value={value.loss_summary || ''} onChange={set('loss_summary')} />
      </div>
      <div className="field"><label>Internal notes</label><textarea value={value.notes || ''} onChange={set('notes')} /></div>
    </>
  );
}

// ------------------------------------------------------------------ restoration type and priority (lead page)
export function TypeCard({ value, onChange }) {
  const suggested = L.suggestPriority(value.intake || {});
  const priority = value.priority || suggested;
  return (
    <div className="card">
      <h2>Restoration</h2>
      <div className="grid2">
        <Pick label="Type" value={value.restoration_type} onChange={(v) => onChange({ restoration_type: v || null })} options={Object.entries(L.RESTORATION_TYPES).map(([k, t]) => ({ value: k, label: t.label }))} />
        <div className="field"><label>Priority</label>
          <select value={priority} onChange={(e) => onChange({ priority: e.target.value })}>
            {Object.entries(L.PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
