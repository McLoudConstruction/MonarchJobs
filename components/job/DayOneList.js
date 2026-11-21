'use client';
import { useEffect, useMemo } from 'react';
import { dayOneList, dayOneProgress } from '@/lib/dayOne';

// The Day-1 checklist as a dialog. Items check themselves from the sketch.
export function useDayOne(plan) {
  const items = useMemo(() => dayOneList(plan), [plan]);
  return { items, ...dayOneProgress(items) };
}

export default function DayOneList({ items, onClose }) {
  const next = items.find((i) => !i.done);
  useEffect(() => { // the page behind stays put while the checklist is open
    const b = document.body;
    const prev = b.style.overflow;
    b.style.overflow = 'hidden';
    return () => { b.style.overflow = prev; };
  }, []);
  return (
    <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sketch-modal-card sk-dayone" role="dialog" aria-label="Day 1 checklist">
        <div className="sketch-pop-head"><strong>Day 1 checklist</strong><button type="button" className="sk-x" aria-label="Close" onClick={onClose}>{'×'}</button></div>
        <div className="sk-dayone-body">
        <p className="muted" style={{ margin: 0 }}>Items check themselves off as the sketch fills in. It is a guide: skip what does not apply.</p>
        <ul className="sk-dayone-list">
          {items.map((i) => (
            <li key={i.id} className={i.done ? 'done' : i === next ? 'next' : ''}>
              <span className="sk-dayone-box" aria-hidden="true">{i.done ? '✓' : ''}</span>
              <div><strong>{i.label}</strong>{!i.done && <div className="muted">{i.hint}</div>}</div>
            </li>
          ))}
        </ul>
        </div>
      </div>
    </div>
  );
}
