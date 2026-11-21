'use client';

import { useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { getSupabase } from '@/lib/supabaseClient';
import { cleanProperty, blankProperty } from '@/lib/evals';
import { formatPhone } from '@/lib/phone';
import PropertyRates from '@/components/eval/PropertyRates';

// Add or edit a property: its name and address, the property manager and the maintenance supervisor (who get the signed-eval receipt later).
// `property` is an existing row to edit, or null for a new one. onSaved(row) gets the saved row.
export default function PropertyForm({ open, property, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...blankProperty(), ...(property || {}) }));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const phone = (k) => (e) => setForm((f) => ({ ...f, [k]: formatPhone(e.target.value) }));

  async function save(e) {
    e.preventDefault();
    const c = cleanProperty(form);
    if (!c.value.name) { setErr('Type the property name.'); return; }
    if (c.emailErrors.length) { setErr(`Check the email for: ${c.emailErrors.join(', ')}.`); return; }
    setSaving(true);
    setErr('');
    const sb = getSupabase();
    const q = property?.id
      ? sb.from('properties').update(c.value).eq('id', property.id)
      : sb.from('properties').insert(c.value);
    const { data, error } = await q.select('*').single();
    setSaving(false);
    if (error) { setErr(/duplicate key|properties_name_uniq/i.test(error.message) ? 'A property with that name already exists.' : error.message); return; }
    onSaved(data);
  }

  const contact = (key, title) => (
    <fieldset className="pf-contact">
      <legend>{title}</legend>
      <div className="pf-grid">
        <div className="field"><label>Name</label><input value={form[`${key}_name`]} onChange={set(`${key}_name`)} maxLength={80} /></div>
        <div className="field"><label>Phone</label><input type="tel" inputMode="tel" value={form[`${key}_phone`]} onChange={phone(`${key}_phone`)} maxLength={30} /></div>
        <div className="field pf-wide"><label>Email</label><input type="email" inputMode="email" autoCapitalize="none" value={form[`${key}_email`]} onChange={set(`${key}_email`)} maxLength={120} /></div>
      </div>
    </fieldset>
  );

  return (
    <PopupModal open={open} onClose={onClose} title={property?.id ? 'Edit property' : 'Add property'} closeOnOverlay={false}>
      <form onSubmit={save} className="pf-form">
        <div className="field"><label>Property name</label><input value={form.name} onChange={set('name')} maxLength={120} autoFocus={!property?.id} placeholder="Oak Ridge Apartments" /></div>
        <div className="field"><label>Address</label><input value={form.address} onChange={set('address')} maxLength={200} /></div>
        {contact('manager', 'Property manager')}
        {contact('maint', 'Maintenance supervisor')}
        <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={set('notes')} maxLength={600} /></div>
        {property?.id && <PropertyRates propertyId={property.id} />}
        {err && <div className="banner flag">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving...' : 'Save property'}</button>
        </div>
      </form>
    </PopupModal>
  );
}
