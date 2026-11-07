'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabaseClient';
import { displayPhone } from '@/lib/phone';

// Search box in the top bar: type a name, phone, address or job number and go straight there.
// Press "/" anywhere outside a text field to focus it. Techs only see jobs (that is all they can open).
export default function JobJumpSearch({ role }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const seqRef = useRef(0);
  const office = role === 'owner' || role === 'office';

  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    // characters that mean something inside a PostgREST filter
    const term = q.replace(/[%,()*\\:"']/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length < 2) { setResults([]); setSearching(false); return undefined; }
    setSearching(true);
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      const sb = getSupabase();
      const digits = term.replace(/\D/g, '');
      const queries = [];
      if (office) {
        const phoneBit = digits.length >= 3 ? `,phone.ilike.%${digits}%` : '';
        queries.push(sb.from('leads').select('id,name,phone,address,status').or(`name.ilike.%${term}%,address.ilike.%${term}%${phoneBit}`).order('created_at', { ascending: false }).limit(5));
        queries.push(sb.from('customers').select('id,display_name,phone').or(`display_name.ilike.%${term}%${digits.length >= 3 ? `,phone.ilike.%${digits}%` : ''}`).limit(4));
      }
      if (/^\d+$/.test(term)) {
        queries.push(sb.from('jobs').select('id,job_number,customer:customers(display_name),address:addresses(street,city)').eq('job_number', Number(term)).limit(3));
      }
      const res = await Promise.all(queries);
      if (seq !== seqRef.current) return;
      const out = [];
      let i = 0;
      if (office) {
        (res[i++].data || []).forEach((l) => out.push({ key: `l${l.id}`, href: `/leads/${l.id}`, main: l.name || 'Lead', sub: `Lead · ${[displayPhone(l.phone), l.address].filter(Boolean).join(' · ')}` }));
        (res[i++].data || []).forEach((c) => out.push({ key: `c${c.id}`, href: `/customers/${c.id}`, main: c.display_name, sub: `Customer${c.phone ? ` · ${displayPhone(c.phone)}` : ''}` }));
      }
      if (/^\d+$/.test(term)) {
        (res[i++].data || []).forEach((j) => out.push({ key: `j${j.id}`, href: `/jobs/${j.id}`, main: `#${j.job_number} ${j.customer?.display_name || ''}`, sub: `Job${j.address ? ` · ${[j.address.street, j.address.city].filter(Boolean).join(', ')}` : ''}` }));
      }
      setResults(out);
      setActive(0);
      setSearching(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q, office]);

  function go(r) {
    setOpen(false);
    setQ('');
    router.push(r.href);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]); }
  }

  return (
    <div className="jump-search" ref={wrapRef}>
      <div className="jump-search-box">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="M13.5 13.5L17 17" /></svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={office ? 'Find a lead, customer or job #' : 'Find a job #'}
          aria-label="Search"
        />
        <span className="jump-search-hint">/</span>
      </div>
      {open && q.trim().length >= 2 && (
        <div className="jump-search-panel">
          {results.map((r, i) => (
            <button type="button" key={r.key} className={`jump-search-row ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
              <span className="jump-search-main">{r.main}</span>
              <span className="jump-search-sub">{r.sub}</span>
            </button>
          ))}
          {results.length === 0 && <div className="jump-search-empty">{searching ? 'Searching…' : 'No matches.'}</div>}
        </div>
      )}
    </div>
  );
}
