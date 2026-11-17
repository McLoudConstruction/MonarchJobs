'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { validateNewUser, validateName } from '@/lib/newUser';
import { hasRealName, staffName } from '@/lib/userDisplay';
import './users.css';

const EMPTY = { full_name: '', email: '', role: 'tech' };

// What to show in the Status column. A deactivated person always reads "Inactive".
function statusFor(u, pendingKind) {
  if (!u.active) return { text: 'Inactive', cls: '', tip: 'Deactivated. Cannot sign in.' };
  if (pendingKind === 'invited') return { text: 'Invited', cls: 'wait', tip: 'Invite sent. Waiting for them to open the link.' };
  if (pendingKind === 'no_password') return { text: 'No password yet', cls: 'wait', tip: 'Has not chosen their own password yet.' };
  return { text: 'Active', cls: 'active', tip: '' };
}

export default function UsersSection({ currentUserId, token }) {
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState({}); // userId -> 'invited' | 'no_password'
  const [resending, setResending] = useState(null);
  const [working, setWorking] = useState(null); // id of the person a deactivate / delete is running for

  const load = useCallback(async () => {
    const { data } = await getSupabase()
      .from('staff_users')
      .select('id,email,full_name,role,active,created_at')
      .order('created_at');
    setUsers(data || []);
    try {
      const r = await apiFetch('/api/users', token);
      setPending(r.statuses || {});
    } catch { /* the list still works without the setup status */ }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function update(id, patch) {
    setMsg(null);
    const { error } = await getSupabase().from('staff_users').update(patch).eq('id', id);
    if (error) setMsg(error.message);
    else load();
  }

  async function rename(u, value) {
    if (value.trim() === (hasRealName(u.full_name) ? u.full_name : '')) return;
    const checked = validateName(value);
    if (checked.error) { setMsg(checked.error); load(); return; }
    await update(u.id, { full_name: checked.value });
  }

  async function resend(u) {
    setMsg(null);
    setResending(u.id);
    try {
      const r = await apiFetch(`/api/users/${u.id}/resend`, token, { method: 'POST' });
      setMsg({ ok: `A new email was sent to ${r.email || u.email}.` });
    } catch (err) {
      setMsg(err.message);
    } finally {
      setResending(null);
    }
  }

  async function deactivate(u) {
    const who = hasRealName(u.full_name) ? u.full_name : u.email;
    if (!window.confirm(`Deactivate ${who}? They will be blocked from the app right away. Their name stays on everything they did, and you can reactivate them any time.`)) return;
    setWorking(u.id);
    await update(u.id, { active: false });
    setWorking(null);
  }

  async function remove(u) {
    const who = hasRealName(u.full_name) ? u.full_name : u.email;
    const never = pending[u.id] === 'invited';
    if (!window.confirm(never
      ? `Delete the invite for ${who}? Their login is removed and the invite link stops working.`
      : `Permanently delete ${who}? Their login is removed for good and cannot be restored. Jobs, notes, photos and messages they added stay, but no longer show their name. (Leaving them deactivated keeps their name on everything.)`)) return;
    setMsg(null);
    setWorking(u.id);
    try {
      await apiFetch(`/api/users/${u.id}`, token, { method: 'DELETE' });
      setMsg({ ok: `${who} was deleted.` });
      load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setWorking(null);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function addUser(e) {
    e.preventDefault();
    setFormError('');
    setMsg(null);
    const checked = validateNewUser(form);
    if (checked.error) { setFormError(checked.error); return; }
    setBusy(true);
    try {
      await apiFetch('/api/users', token, { method: 'POST', body: JSON.stringify(checked.value) });
      setMsg({ ok: `${checked.value.full_name} was invited. An email with a link to choose their password is on its way to ${checked.value.email}.` });
      setForm(EMPTY);
      setAdding(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card users-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Users</h2>
        {!adding && <button className="primary" onClick={() => { setAdding(true); setMsg(null); }}>Invite user</button>}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Everyone signs in with their email and their own password, and appears in the app by name.
      </p>
      {msg && (typeof msg === 'string'
        ? <div className="msg err">{msg}</div>
        : <div className="msg ok">{msg.ok}</div>)}

      {adding && (
        <form className="card" onSubmit={addUser} style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Invite user</h3>
          <div className="field">
            <label htmlFor="nu-name">Full name</label>
            <input id="nu-name" type="text" autoComplete="off" value={form.full_name} onChange={set('full_name')} required />
          </div>
          <div className="field">
            <label htmlFor="nu-email">Email</label>
            <input id="nu-email" type="email" autoComplete="off" value={form.email} onChange={set('email')} required />
          </div>
          <div className="field">
            <label htmlFor="nu-role">Role</label>
            <select id="nu-role" value={form.role} onChange={set('role')}>
              <option value="owner">Owner</option>
              <option value="office">Office</option>
              <option value="tech">Tech</option>
            </select>
          </div>
          <p className="hint" style={{ marginBottom: 12 }}>We email them a link to choose their own password. Nothing for you to give them.</p>
          {formError && <div className="msg err">{formError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send invite'}</button>
            <button className="secondary" type="button" disabled={busy} onClick={() => { setAdding(false); setForm(EMPTY); setFormError(''); }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="users-scroll">
        <table className="table users-table">
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === currentUserId;
              const st = statusFor(u, pending[u.id]);
              const invited = pending[u.id] === 'invited';
              const busyRow = working === u.id;
              return (
                <tr key={u.id}>
                  <td className="u-name">
                    <input
                      key={`${u.id}-${u.full_name}`}
                      type="text"
                      defaultValue={hasRealName(u.full_name) ? u.full_name : ''}
                      placeholder={staffName(u)}
                      aria-label={`Name for ${staffName(u)}`}
                      onBlur={(e) => rename(u, e.target.value)}
                    />
                  </td>
                  <td>
                    <select value={u.role} disabled={self} onChange={(e) => update(u.id, { role: e.target.value })}>
                      <option value="owner">Owner</option>
                      <option value="office">Office</option>
                      <option value="tech">Tech</option>
                    </select>
                  </td>
                  <td><span className={`u-status ${st.cls}`} title={st.tip}>{st.text}{self ? ' (you)' : ''}</span></td>
                  <td className="u-actions">
                    {!self && u.active && pending[u.id] && (
                      <button type="button" className="secondary" disabled={resending === u.id} onClick={() => resend(u)}>{resending === u.id ? 'Sending...' : 'Resend email'}</button>
                    )}
                    {!self && u.active && !invited && <button type="button" className="secondary" disabled={busyRow} onClick={() => deactivate(u)}>Deactivate</button>}
                    {!self && !u.active && <button type="button" className="primary" disabled={busyRow} onClick={() => update(u.id, { active: true })}>Reactivate</button>}
                    {!self && (!u.active || invited) && <button type="button" className="danger" disabled={busyRow} onClick={() => remove(u)}>Delete</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
