'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { staffName } from '@/lib/userDisplay';
import { fmtDateTime } from '@/lib/format';

// Owner: on-call swap requests waiting for an answer. Approving picks who covers (the person suggested, or anyone else) and puts
// the swap on the calendar; either way the person who asked is told.
export default function SwapRequests({ people, onChanged }) {
  const [rows, setRows] = useState([]);
  const [pick, setPick] = useState({});
  const [reply, setReply] = useState({});
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().from('oncall_swap_requests').select('id,requester_id,starts_at,ends_at,cover_id,note,created_at').eq('status', 'pending').order('created_at');
    setRows(error ? [] : data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = (id) => { const x = people.find((q) => q.id === id); return x ? staffName(x) : 'Someone'; };
  async function decide(r, approve) {
    setMsg(null);
    const cover = pick[r.id] ?? r.cover_id ?? '';
    if (approve && !cover) { setMsg({ err: true, text: 'Pick who covers before approving.' }); return; }
    const { error } = await getSupabase().rpc('oncall_swap_decide', { p_id: r.id, p_approve: approve, p_cover: approve ? cover : null, p_note: (reply[r.id] || '').trim() });
    if (error) {
      const t = error.message || '';
      setMsg({ err: true, text: t.includes('ALREADY_DECIDED') ? 'That request was already answered.' : t.includes('BAD_COVER') ? 'That person cannot cover this swap.' : t.includes('NEEDS_COVER') ? 'Pick who covers before approving.' : 'Could not save that. Try again.' });
    } else setMsg({ err: false, text: approve ? 'Approved. It is on the calendar as a swap.' : 'Declined. They have been told.' });
    load();
    onChanged?.();
  }

  if (rows.length === 0 && !msg) return null;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>Swap requests waiting{rows.length ? ` (${rows.length})` : ''}</h3>
      {msg && <div className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</div>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
            <div><strong>{nameOf(r.requester_id)}</strong> · {fmtDateTime(r.starts_at)} to {fmtDateTime(r.ends_at)}{r.note ? ` · ${r.note}` : ''}</div>
            <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <select style={{ flex: '1 1 180px', minWidth: 0 }} aria-label="Who covers" value={pick[r.id] ?? r.cover_id ?? ''} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                <option value="">Who covers...</option>
                {people.filter((p) => p.id !== r.requester_id).map((p) => <option key={p.id} value={p.id}>{staffName(p)}{p.id === r.cover_id ? ' (suggested)' : ''}</option>)}
              </select>
              <input style={{ flex: '1 1 180px', minWidth: 0 }} aria-label="Reply (optional)" placeholder="Reply (optional)" maxLength={200} value={reply[r.id] || ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} />
              <button type="button" className="primary" onClick={() => decide(r, true)}>Approve</button>
              <button type="button" className="secondary" onClick={() => decide(r, false)}>Decline</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
