'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { loadPhotoSettings } from '@/lib/photoSettings';

// Owner choice: also keep the full-size picture from the camera (the app always keeps a web-sized copy).
export default function PhotoSection() {
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadPhotoSettings().then((s) => setOn(s.keepOriginals)); }, []);

  async function change(next) {
    setBusy(true);
    setMsg(null);
    const { error } = await getSupabase().from('settings').update({ keep_original_photos: next }).eq('id', 1);
    setBusy(false);
    if (error) { setMsg({ err: true, text: /keep_original_photos/.test(error.message) ? 'Run the latest database update first (migration 018).' : error.message }); return; }
    setOn(next);
    await loadPhotoSettings();
    setMsg({ text: next ? 'On. New photos will also keep the full-size picture.' : 'Off. New photos keep the web-sized copy only.' });
  }

  return (
    <div className="card">
      <h2>Photos</h2>
      <p className="hint">Every photo is saved as a web-sized copy. You can also keep the full-size picture straight from the camera, which is sharper for printing or insurance but uses several times more storage.</p>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} />
        <span>Keep full-size originals (uses more storage)</span>
      </label>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`} style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  );
}
