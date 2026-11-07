'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/useAuth';

// Generic credential panel driven by a field list. Secrets are write-only: after saving, only
// the last 4 characters are shown and a blank input keeps the stored value.
export default function IntegrationPanel({ provider, title, status, fields, token, onChanged, help, plainBadge = false }) {
  const [values, setValues] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const badge = !status?.configured
    ? <span className="badge off">Not connected</span>
    : plainBadge
      ? <span className="badge live">Connected</span>
      : <span className={`badge ${status.mode === 'live' ? 'live' : 'test'}`}>Connected ({status.mode === 'live' ? 'live' : 'test mode'})</span>;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/api/integrations/credentials', token, { method: 'PUT', body: JSON.stringify({ provider, values }) });
      setValues({});
      setMsg({ text: 'Saved.' });
      onChanged();
    } catch (err) {
      setMsg({ err: true, text: err.message });
    }
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch('/api/integrations/test', token, { method: 'POST', body: JSON.stringify({ provider }) });
      setMsg({ err: !r.ok, text: r.message });
    } catch (err) {
      setMsg({ err: true, text: err.message });
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(`Remove all saved ${title} keys?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/integrations/credentials?provider=${provider}`, token, { method: 'DELETE' });
      setMsg({ text: 'Removed.' });
      onChanged();
    } catch (err) {
      setMsg({ err: true, text: err.message });
    }
    setBusy(false);
  }

  function placeholder(f) {
    if (f.secret && status?.present?.[f.name]) return `Saved (ends in ${status.secretLast4?.[f.name] || '....'}). Leave blank to keep.`;
    return f.placeholder || '';
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{title}</h2>
        {badge}
      </div>
      <p className="hint">{help}</p>

      {status?.webhookUrl && (
        <div className="field">
          <label>Webhook URL (paste into {title})</label>
          <div className="copybox">{status.webhookUrl}</div>
        </div>
      )}

      {fields.map((f) => (
        <div className="field" key={f.name}>
          <label htmlFor={`${provider}-${f.name}`}>{f.label}</label>
          {f.options ? (
            <select
              id={`${provider}-${f.name}`}
              value={values[f.name] ?? status?.public?.[f.name] ?? f.options[0]}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            >
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              id={`${provider}-${f.name}`}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={placeholder(f)}
              value={values[f.name] ?? (f.secret ? '' : status?.public?.[f.name] ?? '')}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            />
          )}
        </div>
      ))}

      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? 'Working...' : 'Save'}</button>
        <button type="button" className="secondary" disabled={busy || !status?.configured} onClick={test}>Test connection</button>
        <button type="button" className="danger" disabled={busy || !status?.updatedAt} onClick={remove}>Remove keys</button>
      </div>
    </form>
  );
}
