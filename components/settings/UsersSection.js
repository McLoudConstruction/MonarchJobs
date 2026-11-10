'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { apiFetch } from '@/lib/useAuth';
import { validateNewUser, validateName } from '@/lib/newUser';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordRules';
import { hasRealName, staffName } from '@/lib/userDisplay';

const EMPTY = { full_name: '', email: '', role: 'tech', password: '' };

export default function UsersSection({ currentUserId, token }) {
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    const { data } = await getSupabase()
      .from('staff_users')
      .select('id,email,full_name,role,active,created_at')
      .order('created_at');
    setUsers(data || []);
  }, []);

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
      setMsg({ ok: `${checked.value.full_name} was added. They can sign in now with their email and the password you set.` });
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
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Users</h2>
        {!adding && <button className="primary" onClick={() => { setAdding(true); setMsg(null); }}>Add user</button>}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Everyone signs in with their email and a password, and appears in the app by name.
      </p>
      {msg && (typeof msg === 'string'
        ? <div className="msg err">{msg}</div>
        : <div className="msg ok">{msg.ok}</div>)}

      {adding && (
        <form className="card" onSubmit={addUser} style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Add user</h3>
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
          <div className="field">
            <label htmlFor="nu-pw">Temporary password</label>
            <input id="nu-pw" type="text" autoComplete="off" value={form.password} onChange={set('password')} required />
            <div className="note">At least {MIN_PASSWORD_LENGTH} characters. Give it to them directly; they can change it with Forgot password on the sign-in page.</div>
          </div>
          {formError && <div className="msg err">{formError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Adding...' : 'Add user'}</button>
            <button className="secondary" type="button" disabled={busy} onClick={() => { setAdding(false); setForm(EMPTY); setFormError(''); }}>Cancel</button>
          </div>
        </form>
      )}

      <table className="table">
        <thead><tr><th>Name</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>
          {users.map((u) => {
            const self = u.id === currentUserId;
            return (
              <tr key={u.id}>
                <td>
                  <input
                    key={`${u.id}-${u.full_name}`}
                    type="text"
                    defaultValue={hasRealName(u.full_name) ? u.full_name : ''}
                    placeholder={staffName(u)}
                    aria-label={`Name for ${staffName(u)}`}
                    onBlur={(e) => rename(u, e.target.value)}
                  />
                  {self ? ' (you)' : ''}
                </td>
                <td>
                  <select value={u.role} disabled={self} onChange={(e) => update(u.id, { role: e.target.value })}>
                    <option value="owner">Owner</option>
                    <option value="office">Office</option>
                    <option value="tech">Tech</option>
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={u.active} disabled={self} onChange={(e) => update(u.id, { active: e.target.checked })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
