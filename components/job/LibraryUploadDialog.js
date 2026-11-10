'use client';

import { useEffect, useRef, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import { KindChips } from '@/components/job/PhotoUi';
import { PHOTO_KINDS } from '@/lib/jobDocs';

// "Choose from library": pick the folder (photo type) first, then choose pictures. Each one shows
// here, with its own progress, as it uploads. Retry works for any that fail.
export default function LibraryUploadDialog({ open, onClose, uploader, defaultKind }) {
  const [kind, setKind] = useState(defaultKind);
  const [items, setItems] = useState([]); // { id, file, preview, kind, status, error }
  const input = useRef(null);
  const seq = useRef(0);
  const itemsRef = useRef([]);
  itemsRef.current = items;

  useEffect(() => { if (open) setKind(defaultKind); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // free the preview pictures when the dialog is closed or left
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.preview)), []);

  const busy = items.some((i) => i.status === 'waiting' || i.status === 'uploading');
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error');

  const patch = (file, fields) => setItems((list) => list.map((i) => (i.file === file ? { ...i, ...fields } : i)));
  const onItem = (file, status, payload) => patch(file, { status, error: status === 'error' ? payload : '' });

  function start(files, k) {
    uploader.upload(files, { kind: k, quiet: true, onItem });
  }
  function choose(files) {
    const added = files.map((file) => ({
      id: ++seq.current, file, preview: URL.createObjectURL(file), kind, status: 'waiting', error: '',
    }));
    setItems((list) => [...list, ...added]);
    start(files, kind);
  }
  function retry() {
    const files = failed.map((i) => i.file);
    setItems((list) => list.map((i) => (i.status === 'error' ? { ...i, status: 'waiting', error: '' } : i)));
    // retry each with the folder it was first chosen for
    for (const k of new Set(failed.map((i) => i.kind))) start(failed.filter((i) => i.kind === k).map((i) => i.file), k);
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
          <label>Put these photos in</label>
          <KindChips value={kind} onChange={setKind} />
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={() => input.current?.click()}>
            {items.length ? `Add more to ${PHOTO_KINDS[kind]}` : `Choose photos for ${PHOTO_KINDS[kind]}`}
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
              {busy ? `Uploading... ${done} of ${items.length} done. Keep this window open.` : `${done} of ${items.length} uploaded${failed.length ? `, ${failed.length} failed` : ''}.`}
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
