'use client';

// The only chrome on a screen opened from Quick Actions: a Back arrow (returns to the Quick Action Screen),
// the name of the screen, and an Exit button (leaves Quick Actions altogether, to the job's normal pages).
// No breadcrumbs, no tabs.
export default function QaPageBar({ title, jobNumber, onBack, onExit }) {
  return (
    <header className="qa-pagebar">
      <button type="button" className="qa-pagebar-back" aria-label="Back to quick actions" onClick={onBack}>
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <div className="qa-pagebar-title">
        <div className="qa-pagebar-job">Job #{jobNumber}</div>
        <h1>{title}</h1>
      </div>
      <button type="button" className="qa-pagebar-exit" aria-label="Exit quick actions" onClick={onExit}>Exit</button>
    </header>
  );
}
