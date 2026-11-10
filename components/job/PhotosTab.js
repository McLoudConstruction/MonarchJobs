'use client';

import { useMemo, useState } from 'react';
import { countByKind, filterPhotos } from '@/lib/jobDocs';
import { fmtDay } from '@/lib/format';
import { FilePick, KindChips, PhotoGrid, UploadStatus } from '@/components/job/PhotoUi';

const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

// Photos tab: add pictures (camera or library) as Before / During / After / Damage / Other, filter,
// open one to caption, mark up, move to a room, download or archive.
export default function PhotosTab({ photos, isOffice, uploader, onOpen }) {
  const [filter, setFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  // the first pictures on a job are most often "before"
  const [addKind, setAddKind] = useState(photos.length ? 'during' : 'before');

  const counts = useMemo(() => countByKind(photos), [photos]);
  const archivedCount = useMemo(() => photos.filter((p) => p.archived_at).length, [photos]);
  const list = useMemo(
    () => filterPhotos(photos, { kind: filter, archived: showArchived }).sort((a, b) => new Date(b.taken_at) - new Date(a.taken_at)),
    [photos, filter, showArchived],
  );
  const days = useMemo(() => {
    const out = [];
    for (const p of list) {
      const k = dayKey(p.taken_at);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(p);
      else out.push({ key: k, label: fmtDay(new Date(p.taken_at)), items: [p] });
    }
    return out;
  }, [list]);

  const add = (files) => uploader.upload(files, { kind: addKind });

  return (
    <>
      <div className="card">
        <h2>Add photos</h2>
        <p className="hint">Pictures are shrunk on your phone and kept on the job for good. Choose what they show, then take or pick them.</p>
        <div className="field" style={{ marginTop: 0 }}>
          <label>These photos are</label>
          <KindChips value={addKind} onChange={setAddKind} />
        </div>
        <div className="row">
          <FilePick label="Take photo" capture onFiles={add} className="primary" />
          <FilePick label="Choose from library" onFiles={add} />
        </div>
        <UploadStatus uploader={uploader} />
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{showArchived ? 'Archived photos' : 'Photos'} <span className="muted">({showArchived ? archivedCount : counts.all})</span></h2>
          {isOffice && archivedCount > 0 && (
            <button type="button" className="secondary small" onClick={() => { setShowArchived(!showArchived); setFilter('all'); }}>
              {showArchived ? 'Back to photos' : `Archived (${archivedCount})`}
            </button>
          )}
        </div>
        {!showArchived && <KindChips value={filter} onChange={setFilter} counts={counts} includeAll />}
        {days.map((d) => (
          <section key={d.key} className="ph-day">
            <h3>{d.label}</h3>
            <PhotoGrid photos={d.items} onOpen={(p) => onOpen(list, p.id)} />
          </section>
        ))}
        {list.length === 0 && (
          <p className="muted">
            {showArchived ? 'No archived photos.' : filter === 'all' ? 'No photos yet. Take the first one above.' : 'No photos of this type yet.'}
          </p>
        )}
      </div>
    </>
  );
}
