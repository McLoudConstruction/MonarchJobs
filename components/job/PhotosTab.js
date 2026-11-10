'use client';

import { useMemo, useState } from 'react';
import { countByKind, filterPhotos } from '@/lib/jobDocs';
import { fmtDay } from '@/lib/format';
import { KindChips, PhotoGrid, UploadStatus } from '@/components/job/PhotoUi';
import LibraryUploadDialog from '@/components/job/LibraryUploadDialog';

const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

// Photos tab: add pictures (camera or library, folder chosen in a popup), filter,
// open one to caption, mark up, move to a room, download or archive.
export default function PhotosTab({ photos, isOffice, uploader, onOpen }) {
  const [filter, setFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [dlg, setDlg] = useState(null); // null | 'camera' | 'library'

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

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{showArchived ? 'Archived photos' : 'Photos'} <span className="muted">({showArchived ? archivedCount : counts.all})</span></h2>
          <div className="row">
            <button type="button" className="primary small" onClick={() => setDlg('camera')}>Take photo</button>
            <button type="button" className="secondary small" onClick={() => setDlg('library')}>Choose from library</button>
          </div>
        </div>
        <UploadStatus uploader={uploader} />
        {isOffice && archivedCount > 0 && (
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="secondary small" onClick={() => { setShowArchived(!showArchived); setFilter('all'); }}>
              {showArchived ? 'Back to photos' : `Archived (${archivedCount})`}
            </button>
          </div>
        )}
        {!showArchived && <KindChips value={filter} onChange={setFilter} counts={counts} includeAll />}
        {days.map((d) => (
          <section key={d.key} className="ph-day">
            <h3>{d.label}</h3>
            <PhotoGrid photos={d.items} onOpen={(p) => onOpen(list, p.id)} />
          </section>
        ))}
        {list.length === 0 && (
          <p className="muted">
            {showArchived ? 'No archived photos.' : filter === 'all' ? 'No photos yet. Use Take photo or Choose from library.' : 'No photos of this type yet.'}
          </p>
        )}
      </div>
      <LibraryUploadDialog open={!!dlg} camera={dlg === 'camera'} onClose={() => setDlg(null)} uploader={uploader} />
    </>
  );
}
