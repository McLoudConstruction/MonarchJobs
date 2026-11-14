'use client';

import { useWaitingPhotos, kick, getQueue } from '@/lib/offlineClient';
import { PHOTO_KINDS } from '@/lib/jobDocs';

const when = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

// Pictures taken on this phone that have not reached the server yet. They are safe here: they stay until the
// server has confirmed each one, whatever happens to the signal or the app.
export default function WaitingPhotos({ jobId }) {
  const items = useWaitingPhotos(jobId);
  if (!items.length) return null;
  const refused = items.filter((i) => i.state === 'blocked');

  async function saveToFiles(id) {
    const q = await getQueue();
    const got = await q?.bytesOf(id);
    if (!got) return;
    const url = URL.createObjectURL(got.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-photo-${id.slice(0, 8)}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function retry(id) { const q = await getQueue(); await q?.retry(id); kick({ force: true }); }

  return (
    <div className="card" role="status">
      <h2>Waiting to upload <span className="muted">({items.length})</span></h2>
      <p className="hint">
        {refused.length ? `${refused.length} could not be added to this job (see below). ` : ''}
        These pictures are saved on this phone. They upload by themselves once there is a signal; open the app to let them go.
      </p>
      <div className="ph-grid">
        {items.map((i) => (
          <div key={i.id} className="ph-thumb" title={i.lastError || ''}>
            {i.url && <img src={i.url} alt="" />}
            <span className={`ph-kind k-${i.kind}`}>{PHOTO_KINDS[i.kind]}</span>
            <span className="ph-status">{i.state === 'blocked' ? 'Needs attention' : i.attempts ? 'Waiting for signal' : 'Uploading...'}</span>
          </div>
        ))}
      </div>
      {refused.map((i) => (
        <div key={i.id} className="msg err" style={{ marginTop: 8 }}>
          Photo taken {when(i.takenAt)}: {i.lastError}
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="secondary small" onClick={() => retry(i.id)}>Try again</button>
            <button type="button" className="secondary small" onClick={() => saveToFiles(i.id)}>Save to my phone’s files</button>
          </div>
        </div>
      ))}
      <button type="button" className="secondary small" style={{ marginTop: 8 }} onClick={() => kick({ force: true })}>Upload now</button>
    </div>
  );
}
