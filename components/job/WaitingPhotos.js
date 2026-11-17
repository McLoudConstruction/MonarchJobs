'use client';

import { useWaitingPhotos, useQueueStats, kick, getQueue } from '@/lib/offlineClient';

const when = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

// One line above the photo grid for pictures taken on this phone that have not reached the server yet. The pictures
// themselves show in the grid (dimmed, with a status). They are safe on the phone until the server has confirmed each
// one, whatever happens to the signal or the app. Refused pictures are listed here with what to do.
export default function WaitingPhotos({ jobId }) {
  const items = useWaitingPhotos(jobId);
  const stats = useQueueStats();
  if (!items.length) return null;
  const refused = items.filter((i) => i.state === 'blocked');
  const waiting = items.length - refused.length;
  const offline = stats.online === false;

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
    <div role="status">
      <div className={`ph-waitbar${refused.length ? ' is-warn' : ''}`}>
        <span className="grow">
          {waiting > 0 && <strong>{waiting} {waiting === 1 ? 'photo' : 'photos'} waiting to upload. </strong>}
          {refused.length > 0 && <strong>{refused.length} could not be added. </strong>}
          {offline ? 'No signal: they are saved on this phone and will go up by themselves when you have one. ' : 'They are saved on this phone. '}
          Open the app to let them go.
        </span>
        {waiting > 0 && <button type="button" className="secondary small" onClick={() => kick({ force: true })}>Upload now</button>}
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
    </div>
  );
}
