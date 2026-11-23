'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { readAnomalySettings, cleanAnomalyForm, ANOMALY_LIMITS } from '@/lib/anomalies';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

const FIELDS = 'anomaly_alerts_enabled,anomaly_hours_pct,anomaly_cost_pct,anomaly_equip_days';

// Owner: a heads-up when an open job's hours, costs or equipment days pass a share of the estimate. Off until switched on here.
export default function JobAlertsSection({ token }) {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const saveS = useSaveStatus();

  useEffect(() => {
    getSupabase().from('settings').select(FIELDS).eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (error) { setMissing(true); return; }
      setF(readAnomalySettings(data));
    });
  }, []);
  if (missing) return <div className="card"><h2>Job alerts</h2><p className="muted">This needs the latest database update (042). Run it in Supabase, then reload.</p></div>;
  if (!f) return null;

  const save = saveS.track(async (e) => {
    e.preventDefault(); setMsg(null);
    const c = cleanAnomalyForm(f);
    if (c.error) { setMsg({ err: true, text: c.error }); return false; }
    const { error } = await getSupabase().from('settings').update(c.value).eq('id', 1);
    if (error) { setMsg({ err: true, text: error.message }); return false; }
    return true;
  });

  async function runPreview() {
    setBusy(true); setMsg(null);
    try { setPreview(await apiFetch('/api/alerts/preview', token, { method: 'POST', body: '{}' })); }
    catch (e) { setMsg({ err: true, text: e.message }); setPreview(null); }
    setBusy(false);
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const [h0, h1] = ANOMALY_LIMITS.hoursPct; const [c0, c1] = ANOMALY_LIMITS.costPct; const [d0, d1] = ANOMALY_LIMITS.equipDays;

  return (
    <form className="card" onSubmit={save}>
      <h2>Job alerts</h2>
      <p className="hint">A quiet alert to the owner when an open job is running high. Checked once an hour. Each alert is sent once per job and clears itself when the job is finished. Nothing is sent to customers.</p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
        <input type="checkbox" checked={f.enabled} onChange={set('enabled')} />
        Tell me when a job&rsquo;s hours, costs or equipment days run high
      </label>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <div className="field" style={{ width: 230 }}><label>Hours reach this share of the time allowed (%)</label><input type="number" min={h0} max={h1} value={f.hoursPct} onChange={set('hoursPct')} /></div>
        <div className="field" style={{ width: 230 }}><label>Costs reach this share of the estimate (%)</label><input type="number" min={c0} max={c1} value={f.costPct} onChange={set('costPct')} /></div>
        <div className="field" style={{ width: 230 }}><label>Equipment on site this many days</label><input type="number" min={d0} max={d1} value={f.equipDays} onChange={set('equipDays')} /></div>
      </div>
      <p className="hint">Time allowed comes from the estimate lines and the minutes per unit set in the Price list; jobs with no time rates get no hours alert. Costs are the purchases, hours and equipment days logged on the job&rsquo;s Costs tab, against the approved estimate.</p>
      {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <SaveButton save={saveS} idle="Save" className="primary" />
        <button type="button" className="secondary" disabled={busy} onClick={runPreview}>{busy ? 'Checking...' : 'Which jobs would be flagged now?'}</button>
      </div>
      <p className="hint">Save first, then check; the check sends nothing. After running update 042, the database needs your site address once (instructions at the bottom of that file).</p>
      {preview && (
        <div style={{ marginTop: 10 }}>
          <strong>{preview.items.length === 0 ? `No open job is over these limits (${preview.jobs} checked).` : `${preview.items.length} alert${preview.items.length === 1 ? '' : 's'} across ${preview.jobs} open job${preview.jobs === 1 ? '' : 's'}`}</strong>
          <ul style={{ paddingLeft: 18 }}>
            {preview.items.map((it, i) => <li key={i}>{it.title}: {it.body}{it.alreadySent ? ' (already sent)' : ''}</li>)}
          </ul>
        </div>
      )}
    </form>
  );
}
