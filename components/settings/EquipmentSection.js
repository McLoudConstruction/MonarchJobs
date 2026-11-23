'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { assetTag } from '@/lib/assets';
import SaveButton from '@/components/SaveButton';
import { useSaveStatus } from '@/lib/saveStatus';

// Owner: the prefix printed before the number on every equipment label.
export default function EquipmentSection() {
  const [prefix, setPrefix] = useState(null);
  const [msg, setMsg] = useState(null);
  const saveS = useSaveStatus();

  useEffect(() => {
    getSupabase().from('settings').select('asset_prefix').eq('id', 1).maybeSingle().then(({ data }) => setPrefix(data?.asset_prefix || 'EQ'));
  }, []);

  async function save(e) {
    e.preventDefault();
    const p = (prefix || '').trim();
    if (!/^[A-Za-z0-9]{1,6}$/.test(p)) { setMsg({ err: true, text: 'The prefix is 1 to 6 letters or numbers.' }); return false; }
    const { error } = await getSupabase().from('settings').update({ asset_prefix: p.toUpperCase() }).eq('id', 1);
    if (error) { setMsg({ err: true, text: error.message }); return false; }
    setPrefix(p.toUpperCase());
    setMsg({ text: 'Prefix saved. Labels printed earlier keep the old prefix on paper, so reprint them if you change it.' });
    return true;
  }

  if (prefix === null) return <div className="card"><p className="muted">Loading...</p></div>;
  return (
    <form className="card" onSubmit={saveS.track(save)}>
      <h2>Equipment</h2>
      <label className="field">Asset number prefix
        <input value={prefix} maxLength={6} onChange={(e) => setPrefix(e.target.value)} style={{ maxWidth: 140 }} />
      </label>
      <p className="hint">Printed before the number on every asset label, for example {assetTag((prefix || 'EQ').trim() || 'EQ', 12)}. 1 to 6 letters or numbers.</p>
      {msg && <div className={`msg${msg.err ? ' err' : ''}`}>{msg.text}</div>}
      <SaveButton save={saveS} idle="Save prefix" className="primary" />
    </form>
  );
}
