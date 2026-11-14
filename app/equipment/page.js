'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import AssetLabelDialog from '@/components/AssetLabelDialog';
import { getSupabase } from '@/lib/supabaseClient';
import { ASSET_STATUS, ASSET_ORDER, ASSET_TYPES, assetTag, cleanAssetForm, typeLabel, openIssues } from '@/lib/assets';

const BLANK = { type: 'airmover', label: '', serial: '', ppd: '', notes: '', qty: '1' };

function InventoryInner({ staff }) {
  const isOffice = staff.role !== 'tech';
  const [assets, setAssets] = useState(null);
  const [settings, setSettings] = useState(null);
  const [jobs, setJobs] = useState({});
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [type, setType] = useState('');
  const [picked, setPicked] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [msg, setMsg] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [issues, setIssues] = useState({}); // asset id -> open damage / not-working notes

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [{ data: a }, { data: s }] = await Promise.all([
      sb.from('equipment_assets').select('*').order('asset_no'),
      sb.from('settings').select('business_name,logo_path,asset_prefix').eq('id', 1).maybeSingle(),
    ]);
    setAssets(a || []);
    setSettings(s || {});
    setPrefix(s?.asset_prefix || 'EQ');
    // Open damage / not-working notes; the page still works before migration 016 is run.
    const { data: n, error: nErr } = await sb.from('equipment_notes').select('asset_id,kind,resolved_at').is('resolved_at', null).neq('kind', 'note');
    const by = {};
    if (!nErr) for (const x of n || []) (by[x.asset_id] ||= []).push(x);
    setIssues(by);
    const ids = [...new Set((a || []).map((x) => x.job_id).filter(Boolean))];
    if (ids.length) {
      const { data: j } = await sb.from('jobs').select('id,job_number,customer:customers(display_name)').in('id', ids);
      setJobs(Object.fromEntries((j || []).map((x) => [x.id, x])));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const tag = (a) => assetTag(settings?.asset_prefix, a.asset_no);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (assets || []).filter((a) => {
      if (status === 'active' ? a.status === 'retired' : status !== 'all' && a.status !== status) return false;
      if (type && a.type !== type) return false;
      if (!term) return true;
      return [tag(a), a.label, a.serial, typeLabel(a.type), jobs[a.job_id]?.job_number].join(' ').toLowerCase().includes(term);
    });
  }, [assets, q, status, type, jobs, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e) {
    e.preventDefault();
    setMsg(null);
    const c = cleanAssetForm(form);
    if (c.error) { setMsg({ err: true, text: c.error }); return; }
    const qty = Math.min(50, Math.max(1, Math.floor(Number(form.qty)) || 1));
    const rows = Array.from({ length: qty }, () => ({ ...c.value, created_by: staff.id }));
    const { error } = await getSupabase().from('equipment_assets').insert(rows);
    if (error) { setMsg({ err: true, text: error.message.includes('does not exist') ? 'Run migration 014 in Supabase first.' : error.message }); return; }
    setForm(BLANK); setAdding(false); setMsg({ text: `${qty} added.` });
    load();
  }

  async function savePrefix() {
    const p = prefix.trim();
    if (!/^[A-Za-z0-9]{1,6}$/.test(p)) { setMsg({ err: true, text: 'The prefix is 1 to 6 letters or numbers.' }); return; }
    const { error } = await getSupabase().from('settings').update({ asset_prefix: p.toUpperCase() }).eq('id', 1);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setMsg({ text: 'Prefix saved. Labels printed earlier keep the old prefix on paper, so reprint them if you change it.' });
    load();
  }

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const counts = useMemo(() => {
    const c = { available: 0, on_job: 0, repair: 0 };
    for (const a of assets || []) if (c[a.status] != null) c[a.status] += 1;
    return c;
  }, [assets]);
  const toPrint = (assets || []).filter((a) => picked.includes(a.id));

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Equipment</h1>
        {isOffice && <button className="primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : 'Add equipment'}</button>}
      </div>
      {assets && <p className="muted">{counts.available} available · {counts.on_job} on jobs · {counts.repair} in repair</p>}
      {msg && <div className={`msg${msg.err ? ' err' : ''}`}>{msg.text}</div>}

      {adding && (
        <form className="card asset-form" onSubmit={add}>
          <h3>Add equipment</h3>
          <label className="field">Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{ASSET_ORDER.map((t) => <option key={t} value={t}>{ASSET_TYPES[t].label}</option>)}</select>
          </label>
          <label className="field">Make and model<input value={form.label} maxLength={60} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Dri-Eaz LGR 3500i" /></label>
          <label className="field">Serial number (optional)<input value={form.serial} maxLength={60} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></label>
          {/^dehu|^desiccant$/.test(form.type) && <label className="field">Pints per day (rating)<input inputMode="numeric" value={form.ppd} onChange={(e) => setForm({ ...form, ppd: e.target.value })} placeholder="e.g. 70" /></label>}
          <label className="field">How many of these<input inputMode="numeric" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></label>
          <p className="hint">Each one gets its own asset number. Add several at once for a set of identical machines (up to 50).</p>
          <button className="primary">Add</button>
        </form>
      )}

      <div className="toolbar">
        <input type="search" placeholder="Search asset number, model, serial, job" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tabs">
        {[['active', 'Active'], ['available', 'Available'], ['on_job', 'On jobs'], ['repair', 'In repair'], ['retired', 'Retired'], ['all', 'All']].map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {ASSET_ORDER.map((t) => <option key={t} value={t}>{ASSET_TYPES[t].label}</option>)}
        </select>
        {isOffice && <button className="secondary" disabled={!shown.length} onClick={() => setPicked(picked.length === shown.length ? [] : shown.map((a) => a.id))}>{picked.length === shown.length && shown.length ? 'Clear selection' : 'Select all shown'}</button>}
        {isOffice && <button className="primary" disabled={!picked.length} onClick={() => setPrinting(true)}>Print labels ({picked.length})</button>}
      </div>

      {assets === null && <p className="muted">Loading...</p>}
      <div className="list-stack">
        {assets && shown.length === 0 && <p className="muted">{assets.length ? 'Nothing matches.' : 'No equipment yet. Add what the company owns and print an asset label for each machine.'}</p>}
        {shown.map((a) => (
          <div key={a.id} className="asset-row">
            {isOffice && <input type="checkbox" aria-label={`Select ${tag(a)}`} checked={picked.includes(a.id)} onChange={() => toggle(a.id)} />}
            <Link href={`/equipment/${a.id}`} className="list-item">
              <div className="title">{tag(a)} <span className={`badge as-${a.status}`}>{ASSET_STATUS[a.status]}</span>{openIssues(issues[a.id]).length > 0 && <span className="badge as-repair" title="Has an open damage or not-working note"> Needs attention</span>}</div>
              <div className="meta">{[typeLabel(a.type), a.label, a.serial && `S/N ${a.serial}`, a.ppd && `${a.ppd} pints/day`].filter(Boolean).join(' · ')}{a.job_id && jobs[a.job_id] ? ` · Job #${jobs[a.job_id].job_number} ${jobs[a.job_id].customer?.display_name || ''}` : ''}</div>
            </Link>
          </div>
        ))}
      </div>

      {staff.role === 'owner' && settings && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Asset number prefix</h3>
          <p className="hint">Printed before the number on every label, for example {assetTag(prefix || 'EQ', 12)}. 1 to 6 letters or numbers.</p>
          <div className="row"><input value={prefix} maxLength={6} onChange={(e) => setPrefix(e.target.value)} style={{ maxWidth: 120 }} aria-label="Asset prefix" /><button className="secondary" onClick={savePrefix}>Save prefix</button></div>
        </div>
      )}
      {printing && <AssetLabelDialog assets={toPrint} settings={settings} onClose={() => setPrinting(false)} />}
    </>
  );
}

export default function EquipmentPage() {
  return <AuthGate>{({ staff }) => <InventoryInner staff={staff} />}</AuthGate>;
}
