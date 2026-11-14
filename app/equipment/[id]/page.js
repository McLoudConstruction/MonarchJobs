'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import AssetLabelDialog from '@/components/AssetLabelDialog';
import { getSupabase } from '@/lib/supabaseClient';
import { ASSET_STATUS, assetTag, cleanAssetForm } from '@/lib/assets';
import { EQUIPMENT_ORDER, EQUIPMENT_TYPES } from '@/lib/equipment';
import { fmtDateTime } from '@/lib/format';

// The page a label's QR code opens.
function AssetInner({ staff }) {
  const { id } = useParams();
  const isOffice = staff.role !== 'tech';
  const [a, setA] = useState(undefined);
  const [settings, setSettings] = useState(null);
  const [job, setJob] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [{ data }, { data: s }] = await Promise.all([
      sb.from('equipment_assets').select('*').eq('id', id).maybeSingle(),
      sb.from('settings').select('business_name,logo_path,asset_prefix').eq('id', 1).maybeSingle(),
    ]);
    setA(data || null); setSettings(s || {});
    if (data?.job_id) {
      const { data: j } = await sb.from('jobs').select('id,job_number,customer:customers(display_name)').eq('id', data.job_id).maybeSingle();
      setJob(j || null);
    } else setJob(null);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(status) {
    const patch = status === 'retired' ? { status, retired_at: new Date().toISOString(), job_id: null, unit_id: null } : { status, retired_at: null, ...(status !== 'on_job' ? { job_id: null, unit_id: null } : {}) };
    if (status === 'retired' && !window.confirm('Retire this machine? It stays in the inventory and in old job records, but cannot be placed on new jobs.')) return;
    const { error } = await getSupabase().from('equipment_assets').update(patch).eq('id', id);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    load();
  }
  async function save(e) {
    e.preventDefault();
    const c = cleanAssetForm(form);
    if (c.error) { setMsg({ err: true, text: c.error }); return; }
    const { error } = await getSupabase().from('equipment_assets').update(c.value).eq('id', id);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setForm(null); setMsg({ text: 'Saved.' }); load();
  }

  if (a === undefined) return <p className="muted">Loading...</p>;
  if (a === null) return <><p>That equipment was not found.</p><Link href="/equipment">Back to equipment</Link></>;
  const tag = assetTag(settings?.asset_prefix, a.asset_no);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{tag} <span className={`badge as-${a.status}`}>{ASSET_STATUS[a.status]}</span></h1>
        <Link href="/equipment">All equipment</Link>
      </div>
      {msg && <div className={`msg${msg.err ? ' err' : ''}`}>{msg.text}</div>}
      <div className="card">
        <div className="title">{EQUIPMENT_TYPES[a.type]?.label || 'Equipment'}</div>
        <div className="meta">{[a.label, a.serial && `S/N ${a.serial}`, a.ppd && `${a.ppd} pints per day`].filter(Boolean).join(' · ') || 'No model entered'}</div>
        {a.notes && <p>{a.notes}</p>}
        {a.status === 'on_job' && (job
          ? <p>On <Link href={`/jobs/${job.id}?unit=${encodeURIComponent(a.unit_id || '')}#moisture`}>Job #{job.job_number} {job.customer?.display_name || ''}</Link>{a.unit_id ? ' (opens the unit)' : ''}</p>
          : <p className="muted">On a job.</p>)}
        <p className="muted">Last changed {fmtDateTime(a.updated_at)}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {isOffice && <button className="secondary" onClick={() => setPrinting(true)}>Print label</button>}
          {isOffice && <button className="secondary" onClick={() => setForm({ type: a.type, label: a.label, serial: a.serial, ppd: a.ppd || '', notes: a.notes })}>Edit</button>}
          {a.status === 'available' && <button className="secondary" onClick={() => setStatus('repair')}>Send to repair</button>}
          {a.status === 'repair' && <button className="secondary" onClick={() => setStatus('available')}>Back from repair</button>}
          {a.status === 'on_job' && isOffice && <button className="secondary" onClick={() => setStatus('available')}>Mark as back at the shop</button>}
          {isOffice && a.status !== 'retired' && <button className="danger small" onClick={() => setStatus('retired')}>Retire</button>}
          {isOffice && a.status === 'retired' && <button className="secondary" onClick={() => setStatus('available')}>Bring back</button>}
        </div>
        {a.status === 'available' && <p className="hint">To put it on a job, open the job's Moisture tab, tap the machine on the plan and choose this asset number under Asset.</p>}
      </div>
      {form && (
        <form className="card asset-form" onSubmit={save}>
          <h3>Edit</h3>
          <label className="field">Type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{EQUIPMENT_ORDER.map((t) => <option key={t} value={t}>{EQUIPMENT_TYPES[t].label}</option>)}</select></label>
          <label className="field">Make and model<input value={form.label} maxLength={60} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <label className="field">Serial number<input value={form.serial} maxLength={60} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></label>
          <label className="field">Pints per day (rating)<input inputMode="numeric" value={form.ppd} onChange={(e) => setForm({ ...form, ppd: e.target.value })} /></label>
          <label className="field">Notes<input value={form.notes} maxLength={300} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="row"><button className="primary">Save</button><button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      {printing && <AssetLabelDialog assets={[a]} settings={settings} onClose={() => setPrinting(false)} />}
    </>
  );
}

export default function AssetPage() {
  return <AuthGate>{({ staff }) => <AssetInner staff={staff} />}</AuthGate>;
}
