'use client';

import { useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { apiFetch } from '@/lib/useAuth';

// Owner only. Deleting is permanent, so the owner types the job number to confirm.
export default function DeleteJobCard({ jobId, job, token }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const close = () => { if (!busy) { setOpen(false); setTyped(''); setErr(''); } };
  const ok = typed.trim() === String(job.job_number);

  async function remove(e) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setErr('');
    try {
      await apiFetch(`/api/jobs/${jobId}`, token, { method: 'DELETE', body: JSON.stringify({ confirm: typed.trim() }) });
      window.location.assign('/jobs');
    } catch (ex) {
      setErr(ex?.message || 'Could not delete the job. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="card delete-job-card">
      <h2>Delete job</h2>
      <p className="muted" style={{ marginTop: 0 }}>Removes this job with its visits, sketch, readings, photos and notes. This cannot be undone.</p>
      <button type="button" className="danger" onClick={() => setOpen(true)}>Delete job</button>
      <PopupModal open={open} onClose={close} title={`Delete job #${job.job_number}?`} closeOnOverlay={false}>
        <form onSubmit={remove}>
          <p style={{ marginTop: 0 }}>Everything on this job is deleted for good, and equipment on it goes back to available. A job with a sent or paid invoice cannot be deleted.</p>
          <div className="field">
            <label htmlFor="del-job-confirm">Type {job.job_number} to confirm</label>
            <input id="del-job-confirm" inputMode="numeric" autoComplete="off" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          {err && <div className="msg err">{err}</div>}
          <div className="row">
            <button type="submit" className="danger" disabled={!ok || busy}>{busy ? 'Deleting...' : 'Delete job'}</button>
            <button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button>
          </div>
        </form>
      </PopupModal>
    </div>
  );
}
