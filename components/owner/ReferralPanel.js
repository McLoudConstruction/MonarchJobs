'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { referralStatus, STATUS_LABELS, summarize } from '@/lib/referral';
import './owner.css';

// Owner: who sent whom, which rewards are owed, and a tap to mark one paid. Friends who were already customers, or who
// are the person who referred them, are tagged on the lead but never appear here.
export default function ReferralPanel() {
  const [state, setState] = useState({ loading: true, rows: [], reward: '', enabled: false, error: '' });
  const [busy, setBusy] = useState(0);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [{ data: settings }, ref] = await Promise.all([
      sb.from('settings').select('referral_enabled,referral_reward_text').eq('id', 1).maybeSingle(),
      sb.from('referrals').select('id,lead_id,voided,paid_at,paid_note,created_at,lead:leads(first_name,last_name),referrer:customers(display_name)').order('created_at', { ascending: false }).limit(200),
    ]);
    if (ref.error) {
      const gone = /does not exist|schema cache/i.test(ref.error.message);
      setState({ loading: false, rows: [], reward: '', enabled: false, error: gone ? 'Referrals need the latest database update (044). Run it in Supabase, then reload.' : ref.error.message });
      return;
    }
    const ids = (ref.data || []).map((r) => r.lead_id);
    const jobs = ids.length ? (await sb.from('jobs').select('lead_id,status').in('lead_id', ids)).data || [] : [];
    const byLead = new Map();
    for (const j of jobs) { // a finished job wins over an open one
      const cur = byLead.get(j.lead_id);
      if (!cur || ['completed', 'closed'].includes(j.status)) byLead.set(j.lead_id, j.status);
    }
    const rows = (ref.data || []).map((r) => ({
      ...r,
      friend: `${r.lead?.first_name || ''} ${r.lead?.last_name || ''}`.trim() || 'Friend',
      referrerName: r.referrer?.display_name || 'A customer',
      status: referralStatus({ voided: r.voided, paid_at: r.paid_at, jobStatus: byLead.get(r.lead_id) }),
    }));
    setState({ loading: false, rows, reward: settings?.referral_reward_text || '', enabled: !!settings?.referral_enabled, error: '' });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function change(id, patch) {
    setBusy(id);
    const { error } = await getSupabase().from('referrals').update(patch).eq('id', id);
    setBusy(0);
    if (error) setState((s) => ({ ...s, error: error.message })); else load();
  }
  function markPaid(r) {
    const note = window.prompt('Mark this reward as paid. Add a note if you like (for example "$25 credit on the next invoice").', '');
    if (note === null) return;
    change(r.id, { paid_at: new Date().toISOString(), paid_note: note.trim().slice(0, 300) });
  }

  const counts = useMemo(() => summarize(state.rows), [state.rows]);
  if (state.loading) return null;

  return (
    <section className="card" aria-label="Referrals">
      <h2>Referrals</h2>
      {state.error && <div className="msg err">{state.error}</div>}
      {!state.error && (
        <p className="hint">
          {state.enabled ? 'The program is on.' : 'The program is off. Turn it on in Settings, Outreach.'}{' '}
          {state.reward ? `Reward: ${state.reward}.` : 'No reward wording is set; the owner decides what each reward is.'}
          {state.rows.length > 0 && ` ${counts.earned} owed, ${counts.waiting} waiting for a job, ${counts.paid} paid.`}
        </p>
      )}
      {!state.error && state.rows.length === 0 && <p className="muted">Nobody has used a referral link yet.</p>}
      {state.rows.length > 0 && (
        <table className="own-table">
          <thead><tr><th>Friend</th><th>Sent by</th><th>Date</th><th>Status</th><th /></tr></thead>
          <tbody>
            {state.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.friend}</td>
                <td>{r.referrerName}</td>
                <td>{new Date(r.created_at).toLocaleDateString()}</td>
                <td>{STATUS_LABELS[r.status]}{r.status === 'paid' && r.paid_note ? ` (${r.paid_note})` : ''}</td>
                <td>
                  {r.status === 'earned' && <button type="button" className="primary small" disabled={busy === r.id} onClick={() => markPaid(r)}>Mark paid</button>}{' '}
                  {r.status === 'paid' && <button type="button" className="secondary small" disabled={busy === r.id} onClick={() => change(r.id, { paid_at: null, paid_note: '' })}>Undo</button>}
                  {(r.status === 'waiting' || r.status === 'earned') && <button type="button" className="secondary small" disabled={busy === r.id} onClick={() => change(r.id, { voided: true })}>Do not count</button>}
                  {r.status === 'void' && <button type="button" className="secondary small" disabled={busy === r.id} onClick={() => change(r.id, { voided: false })}>Count again</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
