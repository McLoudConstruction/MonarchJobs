'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { groupedTypesForRole, isTypeEnabled } from '@/lib/notificationTypes';

// The list of notification types a person can switch off. It applies to the bell and to push on every phone.
// Shown in a popup from the Notifications page, so it works for owner, office and techs alike.
export default function NotificationPreferences({ staff }) {
  const [prefs, setPrefs] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getSupabase().from('notification_preferences').select('type,enabled').eq('user_id', staff.id)
      .then(({ data, error }) => {
        if (error) { setErr(error.message); return; }
        setPrefs(Object.fromEntries((data || []).map((r) => [r.type, r.enabled])));
      });
  }, [staff.id]);

  async function toggle(type, enabled) {
    setErr('');
    setPrefs((p) => ({ ...p, [type]: enabled }));
    const { error } = await getSupabase().from('notification_preferences')
      .upsert({ user_id: staff.id, type, enabled }, { onConflict: 'user_id,type' });
    if (error) { setErr(error.message); setPrefs((p) => ({ ...p, [type]: !enabled })); }
  }

  const groups = groupedTypesForRole(staff.role);
  return (
    <div className="notif-prefs">
      <p className="hint">Turn off anything you do not want. This applies to the bell and to push on every phone.</p>
      {err && <div className="msg err">{err}</div>}
      {!prefs ? <p className="muted">Loading...</p> : groups.map((g) => (
        <div key={g.group} className="notif-pref-group">
          <div className="notif-pref-heading">{g.group}</div>
          {g.types.map((t) => (
            <label key={t.key} className="notif-pref-row">
              <input type="checkbox" checked={isTypeEnabled(prefs, t.key)} onChange={(e) => toggle(t.key, e.target.checked)} />
              <span><strong>{t.label}</strong><small>{t.hint}</small></span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
