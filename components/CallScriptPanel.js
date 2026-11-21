'use client';

import { useState } from 'react';
import { promptCount } from '@/lib/callScript';

// The owner's call script, beside the new-lead form. Prompts can be ticked off as they are asked (just for this call;
// nothing is saved). Collapses to a single bar so it never gets in the way.
export default function CallScriptPanel({ items }) {
  const [done, setDone] = useState(() => new Set());
  const [open, setOpen] = useState(true);
  const total = promptCount(items);
  const toggle = (id) => setDone((d) => { const n = new Set(d); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <aside className="call-script card" aria-label="Call script">
      <button type="button" className="call-script-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="call-script-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="call-script-title">Call script</span>
        <span className="call-script-count">{done.size} of {total}</span>
      </button>
      {open && (
        <div className="call-script-body">
          {items.map((it) => (it.type === 'heading'
            ? <h3 key={it.id} className="call-script-group">{it.text}</h3>
            : (
              <label key={it.id} className={`call-script-item${done.has(it.id) ? ' done' : ''}`}>
                <input type="checkbox" checked={done.has(it.id)} onChange={() => toggle(it.id)} />
                <span>{it.text}</span>
              </label>
            )))}
        </div>
      )}
    </aside>
  );
}
