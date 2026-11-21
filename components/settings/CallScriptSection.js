'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { MAX_SCRIPT_CHARS, STARTER_SCRIPTS, parseScript, promptCount } from '@/lib/callScript';

// Owner: the prompts shown beside the new-lead form while the office is on the phone, one box for carpet calls and one
// for restoration calls. One prompt per line; a line starting with "# " is a heading.
export default function CallScriptSection() {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    getSupabase().from('settings').select('call_script_carpet,call_script_restoration').eq('id', 1).maybeSingle()
      .then(({ data, error }) => { if (error || !data) setMissing(true); else setF(data); });
  }, []);

  if (missing) return <div className="card"><h2>Call script</h2><p className="muted">This needs database update 040. Run it in Supabase, then reload.</p></div>;
  if (!f) return <div className="card"><h2>Call script</h2><p className="muted">Loading...</p></div>;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const starter = (k, kind) => {
    if ((f[k] || '').trim() && !window.confirm('Replace what is written here with the starter prompts?')) return;
    setF({ ...f, [k]: STARTER_SCRIPTS[kind] });
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const row = { call_script_carpet: f.call_script_carpet.trim(), call_script_restoration: f.call_script_restoration.trim() };
    const { error } = await getSupabase().from('settings').update(row).eq('id', 1);
    setBusy(false);
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setF({ ...f, ...row });
    setMsg({ text: 'Saved. The script shows beside the new-lead form.' });
  }

  const box = (k, kind, title) => (
    <div className="field">
      <label>{title} <span className="muted">({promptCount(parseScript(f[k]))} prompts)</span></label>
      <textarea className="sig-notes" rows={9} maxLength={MAX_SCRIPT_CHARS} value={f[k]} onChange={set(k)}
        placeholder={'# Greeting\nThank the caller and give the business name.\nGet their name and best phone number.'} />
      <div className="row"><button type="button" className="linklike" onClick={() => starter(k, kind)}>Start from example prompts</button></div>
    </div>
  );

  return (
    <form className="card" onSubmit={save}>
      <h2>Call script</h2>
      <p className="hint">Prompts the office sees beside the new-lead form while on the phone, so every call asks the same things. Write one prompt per line. Start a line with # to make a heading. Leave a box empty to show no script for that kind of call.</p>
      {box('call_script_carpet', 'carpet', 'Carpet calls')}
      {box('call_script_restoration', 'restoration', 'Restoration calls')}
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
    </form>
  );
}
