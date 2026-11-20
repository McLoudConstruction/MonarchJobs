'use client';

import { useState } from 'react';
import MapLink from '@/components/MapLink';
import { displayPhone, telHref } from '@/lib/phone';
import { quickActions } from '@/lib/quickActions';
import './quickactions.css';

// Full-screen list of big buttons for everything the tech can do on this job right now (like Drive Mode in McLoudJobs).
// Shows the customer, a tappable address (opens the maps app) and phone, then the actions for this kind of job and where the job is.
// `run(key)` does the action (it may throw; the message shows here). The screen closes after an action that moves to another screen.
export default function QuickActionScreen({ open, onClose, job, customerName, visitStatus, clock, service, tabs, hasSketch, run, badges = {} }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  if (!open) return null;

  const actions = quickActions({ service, visitStatus, jobStatus: job.status, clock, tabs, hasSketch });
  const groups = [['now', 'Next'], ['work', 'On the job'], ['job', 'Job']];
  const phone = job.customer?.phone;

  async function go(a) {
    setErr('');
    setBusy(a.key);
    try {
      await run(a.key);
      onClose();
    } catch (e) {
      setErr(e?.message || 'That did not work. Try again.');
    }
    setBusy('');
  }

  return (
    <div className="qa-screen" role="dialog" aria-modal="true" aria-label="Quick actions">
      <div className="qa-head">
        <div className="qa-title">
          <div className="qa-job">Job #{job.job_number}</div>
          <div className="qa-customer">{customerName}</div>
        </div>
        <button type="button" className="qa-close" aria-label="Close quick actions" onClick={onClose}>&times;</button>
      </div>
      <div className="qa-body">
        <div className="qa-site">
          <div className="qa-address"><MapLink address={job.address} /></div>
          {job.address?.gate_code && <div>Gate code: <strong>{job.address.gate_code}</strong></div>}
          {job.address?.warnings && <div>Pets: <strong>{job.address.warnings}</strong></div>}
          {job.address?.access_notes && <div className="muted">{job.address.access_notes}</div>}
          {phone && <a className="qa-call" href={telHref(phone)}>Call {displayPhone(phone)}</a>}
          {job.loss_summary && <div className="qa-loss">{job.loss_summary}</div>}
        </div>
        {err && <div className="msg err">{err}</div>}
        {groups.map(([g, title]) => {
          const list = actions.filter((a) => a.group === g);
          if (!list.length) return null;
          return (
            <section key={g}>
              <h3 className="qa-group">{title}</h3>
              <div className="qa-grid">
                {list.map((a) => (
                  <button key={a.key} type="button" className={`qa-btn${g === 'now' ? ' now' : ''}`} disabled={!!busy} onClick={() => go(a)}>
                    <span className="qa-label">{busy === a.key ? 'Working...' : a.label}{badges[a.key] > 0 && <i className="qa-badge">{badges[a.key] > 99 ? '99+' : badges[a.key]}</i>}</span>
                    <span className="qa-hint">{a.hint}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
