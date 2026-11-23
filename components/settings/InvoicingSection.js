'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

// Owner choices for invoices: payment terms, the note at the bottom, late interest, and who may void.
export default function InvoicingSection() {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const saveS = useSaveStatus();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSupabase().from('settings').select('invoice_terms_days,invoice_footer,late_interest_rate,late_interest_commercial_only,auto_invoice,office_can_void').eq('id', 1).maybeSingle()
      .then(({ data, error }) => {
        if (error) setMsg({ err: true, text: /invoice_terms_days/.test(error.message) ? 'Run the latest database update first (migration 019).' : error.message });
        else setF({ ...data, auto_invoice: data.auto_invoice === 'off' ? 'off' : 'draft' });
      });
  }, []);

  if (!f) return <div className="card"><h2>Invoicing</h2>{msg ? <div className="msg err">{msg.text}</div> : <p className="muted">Loading...</p>}</div>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    const terms = Math.round(Number(f.invoice_terms_days));
    const rate = Number(f.late_interest_rate);
    if (!(terms >= 0 && terms <= 120)) { setMsg({ err: true, text: 'Payment terms must be 0 to 120 days.' }); return false; }
    if (!(rate >= 0 && rate <= 100)) { setMsg({ err: true, text: 'The late interest rate must be 0 to 100.' }); return false; }
    setBusy(true);
    const { error } = await getSupabase().from('settings').update({
      invoice_terms_days: terms, invoice_footer: f.invoice_footer || '', late_interest_rate: rate,
      late_interest_commercial_only: !!f.late_interest_commercial_only, auto_invoice: f.auto_invoice, office_can_void: !!f.office_can_void,
    }).eq('id', 1);
    setBusy(false);
    setMsg(error ? { err: true, text: error.message } : { text: 'Saved.' });
    return !error;
  }

  return (
    <form className="card" onSubmit={saveS.track(save)}>
      <h2>Invoicing</h2>
      <p className="hint">Invoices are made from the approved estimate. Card payments on site use Stripe, and the payment link with a tip uses Square. Both are connected under Integrations.</p>
      <div className="field">
        <label>When a job is finished</label>
        <select value={f.auto_invoice} onChange={set('auto_invoice')}>
          <option value="draft">Make a draft invoice and tell the office to review it</option>
          <option value="off">Do nothing (the office creates invoices by hand)</option>
        </select>
        <div className="note">A draft is never sent by itself. The customer sees nothing until you send it.</div>
      </div>
      <div className="field"><label>Payment due in (days)</label><input inputMode="numeric" value={f.invoice_terms_days} onChange={set('invoice_terms_days')} /><div className="note">Counted from the day the invoice is sent. After that the invoice shows as past due.</div></div>
      <div className="field"><label>Note at the bottom of every invoice</label><textarea rows={3} maxLength={1000} value={f.invoice_footer} onChange={set('invoice_footer')} placeholder="Thank you for your business. Checks payable to..." /></div>
      <div className="field"><label>Late interest, default rate per month (%)</label><input inputMode="decimal" value={f.late_interest_rate} onChange={set('late_interest_rate')} /><div className="note">Never added automatically. You choose to add it, per invoice, once it is past due. You can change the rate each time.</div></div>
      <label className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}><input type="checkbox" checked={!!f.late_interest_commercial_only} onChange={set('late_interest_commercial_only')} /><span>Warn me before adding late interest to a household (not business) customer</span></label>
      <label className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}><input type="checkbox" checked={!!f.office_can_void} onChange={set('office_can_void')} /><span>Let office staff void invoices and reopen finished jobs (otherwise only you can)</span></label>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <SaveButton save={saveS} idle="Save" className="primary" disabled={busy} />
    </form>
  );
}
