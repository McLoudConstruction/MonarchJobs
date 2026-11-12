'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { FilePick, PhotoGrid, UploadStatus } from '@/components/job/PhotoUi';
import CameraCapture from '@/components/job/CameraCapture';

// The photos on an update being written: the ones chosen so far, plus ways to add more (pick from
// the job's photos, take them now with the same camera as the Photos tab, or choose from the phone's library).
export default function PhotoAttach({ photos, ids, onChange, uploader, onOpen }) {
  const [pickOpen, setPickOpen] = useState(false);
  const [draft, setDraft] = useState(new Set());
  const [cameraOpen, setCameraOpen] = useState(false);
  // the camera stays open across shots, so each finished upload adds to the latest list, not the one from when it was taken
  const latest = useRef(ids);
  latest.current = ids;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const chosen = ids.map((i) => byId.get(i)).filter(Boolean);
  const available = photos.filter((p) => !p.archived_at).sort((a, b) => new Date(b.taken_at) - new Date(a.taken_at));

  async function addFiles(files) {
    const rows = await uploader.upload(files, { kind: 'during' });
    if (rows.length) onChange([...ids, ...rows.map((r) => r.id)]);
  }
  function addTaken(rows) {
    if (!mounted.current || !rows.length) return;
    latest.current = [...latest.current, ...rows.map((r) => r.id)];
    onChange(latest.current);
  }
  function open() { setDraft(new Set(ids)); setPickOpen(true); }
  function toggle(p) { const n = new Set(draft); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setDraft(n); }
  function done() {
    // keep the order already chosen, then add new picks in the order shown
    const kept = ids.filter((i) => draft.has(i));
    const added = available.filter((p) => draft.has(p.id) && !ids.includes(p.id)).map((p) => p.id);
    onChange([...kept, ...added]);
    setPickOpen(false);
  }

  return (
    <div className="field">
      <label>Photos ({ids.length})</label>
      {chosen.length > 0 && (
        <div className="ph-chosen">
          <PhotoGrid photos={chosen} onOpen={(p) => onOpen?.(chosen, p.id)} />
          <div className="row" style={{ marginTop: 6 }}>
            {chosen.map((p, i) => (
              <button key={p.id} type="button" className="secondary small" onClick={() => onChange(ids.filter((x) => x !== p.id))} aria-label={`Remove photo ${i + 1} from this update`}>Remove {i + 1}</button>
            ))}
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="secondary" onClick={() => setCameraOpen(true)}>Take photo</button>
        <FilePick label="Choose from library" onFiles={addFiles} disabled={uploader.busy} />
        <button type="button" className="secondary" onClick={open} disabled={!available.length}>Pick from job photos</button>
      </div>
      <UploadStatus uploader={uploader} />
      <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} uploader={uploader} fixedKind="during" onUploaded={addTaken} />
      <PopupModal open={pickOpen} onClose={() => setPickOpen(false)} title="Pick photos">
        <div style={{ padding: '0 16px 16px', maxHeight: '70vh', overflow: 'auto' }}>
          <PhotoGrid photos={available} selected={draft} onToggle={toggle} />
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="primary" onClick={done}>Use {draft.size} photo{draft.size === 1 ? '' : 's'}</button>
            <button type="button" className="secondary" onClick={() => setPickOpen(false)}>Cancel</button>
          </div>
        </div>
      </PopupModal>
    </div>
  );
}
