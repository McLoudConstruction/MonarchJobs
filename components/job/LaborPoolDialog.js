'use client';

import { useEffect, useMemo, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import SignaturePad from '@/components/SignaturePad';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { toLocalInput, fromLocalInput } from '@/lib/format';
import { staffName } from '@/lib/userDisplay';
import { validateLabor, suggestNames, nameKey, entryMinutes, minutesText, MAX_ENTRIES } from '@/lib/laborPool';
import './labor.css';

let rowSeq = 0;
const newRow = (name = '') => { rowSeq += 1; return { id: `r${rowSeq}`, name, custom: false, start: '', end: '' }; };

// The hours most helpers worked: ending at the nearest quarter hour, starting an hour before. Staff change them.
function defaultHours() {
  const end = new Date();
  end.setMinutes(Math.floor(end.getMinutes() / 15) * 15, 0, 0);
  return { start: toLocalInput(new Date(end.getTime() - 60 * 60000)), end: toLocalInput(end) };
}

// "Add labor pool": names and times for people who are not on the staff list (day labor, a borrowed crew), certified by the signed-in
// staff member's signature. Names come from the pool of earlier helpers (tap one) or are typed new, and are kept in the pool for
// next time. Hours are entered once for the whole crew; a person who worked different hours gets their own.
export default function LaborPoolDialog({ open, onClose, jobId, token, staff, onSaved }) {
  const [pool, setPool] = useState([]);
  const [hours, setHours] = useState(defaultHours);
  const [rows, setRows] = useState(() => [newRow()]);
  const [focus, setFocus] = useState('');
  const [sig, setSig] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHours(defaultHours()); setRows([newRow()]); setSig(null); setMsg(null); setFocus('');
    getSupabase().from('labor_pool_people').select('id,name,active').eq('active', true).order('name')
      .then(({ data, error }) => { if (!error) setPool(data || []); });
  }, [open]);

  const typed = rows.map((r) => r.name);
  const quick = useMemo(() => suggestNames(pool, '', typed, 12), [pool, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : [newRow()]));
  const addPerson = (name = '') => setRows((rs) => {
    if (rs.length >= MAX_ENTRIES) return rs;
    // a tapped pool name fills the empty row at the end instead of leaving a blank one behind
    const last = rs[rs.length - 1];
    if (name && last && !last.name.trim()) return [...rs.slice(0, -1), { ...last, name }];
    return [...rs, newRow(name)];
  });

  function build() {
    return rows.filter((r) => r.name.trim() || r.custom).map((r) => {
      const s = r.custom ? r.start : hours.start; const e = r.custom ? r.end : hours.end;
      let started = ''; let ended = '';
      try { started = s ? fromLocalInput(s) : ''; ended = e ? fromLocalInput(e) : ''; } catch { /* left blank: the check says so */ }
      return { name: r.name, started_at: started, ended_at: ended };
    });
  }
  const entries = build();
  const totalMin = entries.reduce((n, e) => n + entryMinutes(e), 0);

  async function save(ev) {
    ev.preventDefault();
    setMsg(null);
    const checked = validateLabor({ entries, signature: sig });
    if (checked.error) { setMsg({ err: true, text: checked.error }); return; }
    setBusy(true);
    try {
      await apiFetch(`/api/jobs/${jobId}/labor`, token, { method: 'POST', body: JSON.stringify({ action: 'add', entries: checked.value.map(({ name, started_at, ended_at }) => ({ name, started_at, ended_at })), signature: sig }) });
      onSaved?.();
      onClose();
    } catch (e) { setMsg({ err: true, text: e.message || 'Could not save. Try again.' }); }
    setBusy(false);
  }

  return (
    <PopupModal open={open} onClose={() => { if (!busy) onClose(); }} title="Add labor pool" wide closeOnOverlay={false}>
      <form className="lp-form" onSubmit={save}>
        <p className="hint" style={{ marginTop: 0 }}>For helpers who are not on the staff list. Enter who worked and when, then sign to certify it. Names are kept so repeat helpers are one tap next time.</p>

        <div className="lp-hours">
          <div className="field"><label htmlFor="lp-start">Started</label><input id="lp-start" type="datetime-local" value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} required /></div>
          <div className="field"><label htmlFor="lp-end">Finished</label><input id="lp-end" type="datetime-local" value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} required /></div>
        </div>

        {quick.length > 0 && (
          <div className="lp-quick" aria-label="Earlier helpers">
            <span className="muted">Tap to add:</span>
            {quick.map((p) => <button key={p.id} type="button" className="secondary small" onClick={() => addPerson(p.name)}>{p.name}</button>)}
          </div>
        )}

        <div className="lp-rows">
          {rows.map((r, i) => {
            const matches = focus === r.id && r.name.trim().length >= 1 ? suggestNames(pool, r.name, typed.filter((_, j) => j !== i), 5).filter((p) => nameKey(p.name) !== nameKey(r.name)) : [];
            const mins = entryMinutes(entries.find((e) => nameKey(e.name) === nameKey(r.name) && r.name.trim()) || {});
            return (
              <div key={r.id} className="lp-row">
                <div className="lp-line">
                  <div className="field lp-name">
                    <label htmlFor={`lp-n-${r.id}`}>Name {rows.length > 1 ? i + 1 : ''}</label>
                    <input id={`lp-n-${r.id}`} value={r.name} maxLength={80} autoComplete="off" placeholder="First and last name"
                      onFocus={() => setFocus(r.id)} onBlur={() => setTimeout(() => setFocus((f) => (f === r.id ? '' : f)), 150)}
                      onChange={(e) => set(r.id, { name: e.target.value })} />
                    {matches.length > 0 && (
                      <div className="lp-suggest" role="listbox" aria-label="Earlier helpers">
                        {matches.map((p) => <button key={p.id} type="button" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => { set(r.id, { name: p.name }); setFocus(''); }}>{p.name}</button>)}
                      </div>
                    )}
                  </div>
                  <span className="lp-mins muted">{mins ? minutesText(mins) : ''}</span>
                  <button type="button" className="secondary small lp-x" aria-label={`Remove ${r.name || 'this row'}`} onClick={() => remove(r.id)}>Remove</button>
                </div>
                <label className="lp-custom"><input type="checkbox" checked={r.custom} onChange={(e) => set(r.id, { custom: e.target.checked, start: r.start || hours.start, end: r.end || hours.end })} /> Different hours</label>
                {r.custom && (
                  <div className="lp-hours">
                    <div className="field"><label htmlFor={`lp-s-${r.id}`}>Started</label><input id={`lp-s-${r.id}`} type="datetime-local" value={r.start} onChange={(e) => set(r.id, { start: e.target.value })} required /></div>
                    <div className="field"><label htmlFor={`lp-e-${r.id}`}>Finished</label><input id={`lp-e-${r.id}`} type="datetime-local" value={r.end} onChange={(e) => set(r.id, { end: e.target.value })} required /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" className="secondary small" disabled={rows.length >= MAX_ENTRIES} onClick={() => addPerson()}>+ Add another person</button>

        <div className="lp-sign">
          <div className="field">
            <label>Your signature{staff ? ` (${staffName(staff)})` : ''}</label>
            <SignaturePad onChange={setSig} />
          </div>
          <p className="hint" style={{ margin: 0 }}>By signing, you certify that the names and times above are correct.{totalMin > 0 && <> Total labor pool time: <strong>{minutesText(totalMin)}</strong>.</>}</p>
        </div>

        {msg && <div className={`msg${msg.err ? ' err' : ''}`} role={msg.err ? 'alert' : 'status'}>{msg.text}</div>}
        <div className="row lp-actions">
          <button className="primary big" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Sign and save'}</button>
          <button className="secondary big" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </PopupModal>
  );
}
