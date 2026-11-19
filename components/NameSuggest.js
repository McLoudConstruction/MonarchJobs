'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { displayPhone } from '@/lib/phone';
import { customerSearchArgs } from '@/lib/customerSearch';

// A name input that suggests customers already on file as the office types, right under the field. Picking one
// calls onPick(customerId), which fills in their info. Nothing is shown until two letters are typed, and the list
// goes away on pick, Escape, or leaving the field. It never moves the page: the list floats over what is below.
export default function NameSuggest({ value, nameValue, linkedId, onChange, onPick, autoFocus = false }) {
  const [matches, setMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const focused = useRef(false);
  const args = customerSearchArgs({ first_name: nameValue.first_name, last_name: nameValue.last_name, company_name: nameValue.company_name });
  const key = args ? args.p_name : '';

  useEffect(() => {
    if (linkedId || !key) { setMatches([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      getSupabase().rpc('search_customers', { p_name: key, p_phone: '', p_email: '' })
        .then(({ data }) => { if (live) { setMatches((data || []).slice(0, 6)); setActive(-1); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key, linkedId]);

  const shown = open && focused.current && !linkedId && matches.length > 0;
  const pick = (m) => { setOpen(false); setMatches([]); onPick(m.id); };

  return (
    <div className="name-suggest">
      <input
        value={value}
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={shown}
        aria-autocomplete="list"
        onChange={(e) => { setOpen(true); onChange(e); }}
        onFocus={() => { focused.current = true; setOpen(true); }}
        onBlur={() => { focused.current = false; setOpen(false); }}
        onKeyDown={(e) => {
          if (!shown) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? matches.length - 1 : a - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(matches[active]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
      />
      {shown && (
        <ul className="name-suggest-list" role="listbox">
          {matches.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
              <strong>{m.display_name}</strong>
              <span>{[m.phone && displayPhone(m.phone), m.email].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
