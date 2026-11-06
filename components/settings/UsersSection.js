'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabase } from '@/lib/supabaseClient';

export default function UsersSection({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState(null);

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

  return (
    <div className="card">
      <h2>Users</h2>
      <p className="hint">
        Add a person in Supabase (Authentication, Add user). They appear here as inactive. Activate them and choose a role.
      </p>
      {msg && <div className="msg err">{msg}</div>}
      <table className="table">
        <thead><tr><th>Email</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>
          {users.map((u) => {
            const self = u.id === currentUserId;
            return (
              <tr key={u.id}>
                <td>{u.email}{self ? ' (you)' : ''}</td>
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
