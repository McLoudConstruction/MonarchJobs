'use client';

import { useEffect, useRef, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { KindChips } from '@/components/job/PhotoUi';
import { PHOTO_KINDS } from '@/lib/jobDocs';
import { splitRoomValue } from '@/lib/photoMeta';

// "Choose from library": pick the folder (photo type) first, then choose pictures. Each one shows
// here, with its own progress, as it uploads. Retry works for any that fail.
export default function LibraryUploadDialog({ open, onClose, uploader, rooms = [] }) {
  const [kind, setKind] = useState(null); // no folder is chosen until the person picks one
  const [room, setRoom] = useState(''); // optional: 'sketchId|roomId' for the pictures chosen next
  const [items, setItems] = useState([]); // { id, file, preview, kind, status, error }
  const input = useRef(null);
  const seq = useRef(0);
  const itemsRef = useRef([]);
  itemsRef.current = items;

  useEffect(() => { if (open) { setKind(null); setRoom(''); } }, [open]);
  // free the preview pictures when the dialog is closed or left
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.preview)), []);

  const busy = items.some((i) => i.status === 'waiting' || i.status === 'uploading');
  const done = items.filter((i) => ['done', 'queued', 'skipped'].includes(i.status)).length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  const failed = items.filter((i) => i.status === 'error');

  const patch = (file, fields) => setItems((list) => list.map((i) => (i.file === file ? { ...i, ...fields } : i)));
  const onItem = (file, status, payload) => patch(file, { status, error: status === 'error' ? payload : '' });

  function start(files, k, r = room) {
    const target = splitRoomValue(r);
    // a picture whose bytes are already on this job is skipped, so choosing the same photo twice never doubles it up
    uploader.upload(files, { kind: k, quiet: true, skipDuplicates: true, sketchId: target ? target.sketchId : null, roomKey: target ? target.roomKey : null, onItem });
  }
  function choose(files) {
    if (!kind) return;
    const added = files.map((file) => ({
      id: ++seq.current, file, preview: URL.createObjectURL(file), kind, room, status: 'waiting', error: '',
    }));
    setItems((list) => [...list, ...added]);
    start(files, kind);
  }
  function retry() {
    const files = failed.map((i) => i.file);
    setItems((list) => list.map((i) => (i.status === 'error' ? { ...i, status: 'waiting', error: '' } : i)));
    // retry each with the folder it was first chosen for
    for (const k of new Set(failed.map((i) => i.kind))) {
      for (const r of new Set(failed.filter((i) => i.kind === k).map((i) => i.room || ''))) start(failed.filter((i) => i.kind === k && (i.room || '') === r).map((i) => i.file), k, r);
    }
    void files;
  }
  function finish() {
    if (busy) return;
    items.forEach((i) => URL.revokeObjectURL(i.preview));
    setItems([]);
    onClose();
  }

  return (
    <PopupModal open={open} onClose={finish} title="Add photos from library">
      <div className="lib-dialog">
        <div className="field" style={{ marginTop: 0 }}>
          <label>Choose a folder</label>
          <KindChips value={kind} onChange={setKind} />
        </div>
        {rooms.length > 0 && (
          <div className="field">
            <label>Room (optional)</label>
            <select value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">No room</option>
              {rooms.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        )}
        <div className="row">
          <button type="button" className="primary" disabled={!kind} onClick={() => input.current?.click()}>
            {!kind ? 'Pick a folder first' : items.length ? `Add more to ${PHOTO_KINDS[kind]}` : `Choose photos for ${PHOTO_KINDS[kind]}`}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) choose(f); }}
          />
        </div>

        {items.length > 0 && (
          <>
            <p className="hint" role="status" style={{ margin: '12px 0 8px' }}>
              {busy ? `Saving... ${done} of ${items.length} done.` : `${done - skipped} of ${items.length} saved on this phone and uploading${skipped ? `, ${skipped} already on this job` : ''}${failed.length ? `, ${failed.length} NOT saved` : ''}.`}
            </p>
            <div className="ph-grid lib-grid">
              {items.map((i) => (
                <div key={i.id} className={`ph-thumb lib-item s-${i.status}`} title={i.error || i.file.name}>
                  <img src={i.preview} alt="" />
                  <span className={`ph-kind k-${i.kind}`}>{PHOTO_KINDS[i.kind]}</span>
                  <span className="ph-status">
                    {i.status === 'waiting' && 'Waiting'}
                    {i.status === 'uploading' && 'Uploading...'}
                    {i.status === 'done' && '✓ Added'}
                    {i.status === 'queued' && '✓ Saved on phone'}
                    {i.status === 'skipped' && 'Already added'}
                    {i.status === 'error' && 'Failed'}
                  </span>
                </div>
              ))}
            </div>
            {failed.length > 0 && !busy && (
              <div className="msg err">
                {failed.slice(0, 3).map((i) => <div key={i.id}>{i.file.name}: {i.error}</div>)}
                {failed.length > 3 && <div>and {failed.length - 3} more.</div>}
                <button type="button" className="secondary small" style={{ marginTop: 6 }} onClick={retry}>Retry failed</button>
              </div>
            )}
          </>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="secondary" onClick={finish} disabled={busy}>{items.length ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </PopupModal>
  );
}
