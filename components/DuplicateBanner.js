'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { duplicateArgs, duplicateKey, bannerText, visibleMatches } from '@/lib/duplicateCheck';

// On the new-lead form: once a phone number, an email, or a street and zip are typed, look for a customer or an open lead
// that already matches and offer it, so the same person is not entered twice. A customer can be used to fill in the form;
// an open lead opens in a new tab so nothing typed here is lost. "Not the same" hides a match for this form.
export default function DuplicateBanner({ value, linkedCustomerId, onUseCustomer }) {
  const [matches, setMatches] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const args = duplicateArgs(value);
  const key = duplicateKey(args);

  useEffect(() => {
    if (!key || linkedCustomerId) { setMatches([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      getSupabase().rpc('find_duplicate_customers', JSON.parse(key)).then(({ data, error }) => {
        if (live) setMatches(error ? [] : data || []); // before migration 040 there is simply no hint
      });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [key, linkedCustomerId]);

  const shown = visibleMatches(matches, dismissed);
  if (!shown.length) return null;
  const hide = (m) => setDismissed((d) => new Set([...d, `${m.kind}:${m.id}`]));

  return (
    <div className="dup-banner" role="status">
      <strong>This may be someone we already know</strong>
      <ul>
        {shown.map((m) => (
          <li key={`${m.kind}:${m.id}`}>
            <span className="dup-text">{bannerText(m)}</span>
            <span className="dup-actions">
              {m.kind === 'customer'
                ? <button type="button" className="secondary small" onClick={() => onUseCustomer?.(m.id)}>Use this customer</button>
                : <a className="secondary small button-like" href={`/leads/${m.id}`} target="_blank" rel="noreferrer">Open lead</a>}
              <button type="button" className="linklike" onClick={() => hide(m)}>Not the same</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
