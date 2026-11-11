'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { applyMention, filterPeople, mentionQuery, MAX_COMMENT_TEXT } from '@/lib/sketchComments';

// A text box where typing "@" lists the team, filtered as you type. Pick with the arrow keys + Enter/Tab, or tap a name.
// Ctrl/Cmd+Enter posts. `people` is [{ id, name, email }].
export default function MentionBox({ people, value, onChange, onSubmit, placeholder, rows = 3, autoFocus = false, id }) {
  const ref = useRef(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(null); // the @ position the person closed the list for

  const wantCaret = useRef(null); // where the caret goes once a picked name is in the text
  useLayoutEffect(() => {
    if (wantCaret.current == null || !ref.current) return;
    const c = wantCaret.current; wantCaret.current = null;
    ref.current.focus(); ref.current.setSelectionRange(c, c); setCaret(c);
  }, [value]);

  const q = mentionQuery(value, caret);
  const options = q && q.start !== dismissed ? filterPeople(people, q.query).slice(0, 6) : [];
  const open = options.length > 0;
  const shown = Math.min(active, Math.max(0, options.length - 1));

  function pick(p) {
    const r = applyMention(value, caret, p);
    onChange(r.text);
    setActive(0);
    wantCaret.current = r.caret;
  }
  function track(e) { setCaret(e.target.selectionStart ?? 0); }

  return (
    <div className="mention-box">
      <textarea
        ref={ref} id={id} rows={rows} autoFocus={autoFocus} maxLength={MAX_COMMENT_TEXT} value={value} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); track(e); setActive(0); setDismissed(null); }}
        onKeyUp={track} onClick={track} onSelect={track}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((shown + 1) % options.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((shown - 1 + options.length) % options.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[shown]); return; }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(q.start); return; }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit?.(); }
        }}
      />
      {open && (
        <ul className="mention-list" role="listbox" aria-label="Tag a teammate">
          {options.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === shown} className={i === shown ? 'on' : ''}
              onPointerDown={(e) => { e.preventDefault(); pick(p); }}>
              <strong>{p.name}</strong>{p.role ? <span className="muted"> {p.role}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
