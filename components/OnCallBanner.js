'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { fmtDateTime } from '@/lib/format';
import { telHref, displayPhone } from '@/lib/phone';
import { staffName } from '@/lib/userDisplay';

// Top of the schedule (tech's My Day and the office schedule). Shows who is on call, and any emergency leads waiting for someone
// to take them, with the number to call and an "I've got it" button. Shows nothing when on-call is off.
export default function OnCallBanner({ staffId, people = [] }) {
  const [now, setNow] = useState(null);
  const [open, setOpen] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [a, b] = await Promise.all([sb.rpc('oncall_now'), sb.rpc('oncall_open')]);
    setNow(a.error ? null : (a.data || [])[0] || null);
    setOpen(b.error ? [] : b.data || []);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    const back = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [load]);

  async function claim(id) {
    setBusy(id); setErr('');
    const { error } = await getSupabase().rpc('oncall_claim', { p_lead: id });
    setBusy('');
    if (error) setErr('Could not save that. Try again.');
    load();
  }

  const mine = now && now.staff_id === staffId;
  const who = now && people.find((p) => p.id === now.staff_id);
  if (!now && !open.length) return null;
  return (
    <>
      {now && (mine || who) && (
        <div className={`banner ${mine ? 'ok' : ''}`} style={{ marginBottom: 8 }}>
          {mine ? `You are on call until ${fmtDateTime(now.until)}. Emergency leads will alert you.` : `On call: ${staffName(who)} until ${fmtDateTime(now.until)}${now.swapped ? ' (swapped)' : ''}.`}
        </div>
      )}
      {err && <div className="msg err">{err}</div>}
      {open.map((l) => (
        <div key={l.lead_id} className="banner flag" style={{ marginBottom: 8 }}>
          <strong>{l.escalated ? 'Emergency lead not picked up: ' : 'Emergency lead: '}{l.name}</strong>
          {[l.city, l.summary].filter(Boolean).length > 0 && <div style={{ fontWeight: 400 }}>{[l.city, l.summary].filter(Boolean).join(' · ')}</div>}
          <div className="row" style={{ marginTop: 6 }}>
            {l.phone && <a href={telHref(l.phone)}><button type="button" className="secondary">Call {displayPhone(l.phone)}</button></a>}
            <button type="button" className="primary" disabled={busy === l.lead_id} onClick={() => claim(l.lead_id)}>I&apos;ve got it</button>
          </div>
        </div>
      ))}
    </>
  );
}
