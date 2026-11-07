'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import PhoneInput from '@/components/PhoneInput';

export default function BusinessSection() {
  const [form, setForm] = useState({ business_name: '', phone: '', email: '', timezone: 'America/Chicago' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSupabase()
      .from('settings')
      .select('business_name,phone,email,timezone')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => data && setForm(data));
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await getSupabase().from('settings').update(form).eq('id', 1);
    setBusy(false);
    setMsg(error ? { err: true, text: error.message } : { text: 'Saved.' });
  }

  return (
    <form className="card" onSubmit={save}>
      <h2>Business</h2>
      <p className="hint">Shown on estimates, invoices and customer messages.</p>
      <div className="field"><label>Business name</label><input value={form.business_name} onChange={set('business_name')} /></div>
      <div className="field"><label>Phone</label><PhoneInput value={form.phone} onChange={set('phone')} /></div>
      <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
      <div className="field"><label>Time zone</label><input value={form.timezone} onChange={set('timezone')} /><div className="note">IANA name, for example America/Chicago.</div></div>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
    </form>
  );
}
