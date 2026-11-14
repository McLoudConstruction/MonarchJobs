'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { startRunner, useQueueStats, kick } from '@/lib/offlineClient';
import { rememberUser } from '@/lib/offlineRemote';
import { warmUpcoming } from '@/lib/warmJobs';
import { getSupabase } from '@/lib/supabaseClient';

// Mounted once in the app shell. Remembers who is signed in (so waiting pictures know whose they are with no signal),
// keeps the upload queue running, and shows a one-line status whenever something is waiting or the phone is offline.
export default function OfflineBanner({ staff }) {
  const s = useQueueStats();

  useEffect(() => { rememberUser({ id: staff.id, email: staff.email }); }, [staff.id, staff.email]);
  useEffect(() => startRunner(), []);
  // keep the app's pages on the phone so it opens with no signal, and save today's jobs while there is signal
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    const warm = () => warmUpcoming(getSupabase(), staff).catch(() => {});
    const t = setTimeout(warm, 4000);
    window.addEventListener('online', warm);
    return () => { clearTimeout(t); window.removeEventListener('online', warm); };
  }, [staff]);

  const opsWaiting = (s.ops || 0) + (s.opsBlocked || 0);
  const waiting = s.pending + s.blocked + opsWaiting;
  if (!waiting && s.online && !s.others) return null;

  let text;
  let tone = 'ok';
  if (s.others) { text = `${s.others} picture${s.others === 1 ? '' : 's'} on this phone belong${s.others === 1 ? 's' : ''} to someone else. They will upload when that person signs in.`; tone = 'err'; }
  else if (s.blocked) { text = `${s.blocked} picture${s.blocked === 1 ? '' : 's'} could not be added and need${s.blocked === 1 ? 's' : ''} attention.`; tone = 'err'; }
  else if (s.opsBlocked) { text = `${s.opsBlocked} saved action${s.opsBlocked === 1 ? ' was' : 's were'} refused by the server and need attention.`; tone = 'err'; }
  else if (s.signinNeeded) { text = 'Sign in again to finish uploading your pictures. They are safe on this phone.'; tone = 'err'; }
  else if (!s.online) text = `You are offline.${s.ops ? ` ${s.ops} tap${s.ops === 1 ? ' or note is' : 's or notes are'} saved and will send when you have signal.` : ''}${s.pending ? ` ${s.pending} picture${s.pending === 1 ? ' is' : 's are'} saved on this phone and will upload when you have signal.` : ' Anything you take is saved on this phone.'}`;
  else text = s.pending ? `Uploading ${s.pending} picture${s.pending === 1 ? '' : 's'}...` : `Sending ${s.ops} saved tap${s.ops === 1 ? '' : 's'} or note${s.ops === 1 ? '' : 's'}...`;

  return (
    <div className={`msg ${tone}`} role="status" style={{ margin: '0 0 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1 }}>{text}</span>
      {(s.pending > 0 || s.ops > 0) && s.online && <button type="button" className="secondary small" onClick={() => kick({ force: true })}>Send now</button>}
      {waiting > 0 && <Link href="/queue" className="secondary small" style={{ textDecoration: 'underline' }}>Details</Link>}
    </div>
  );
}
