'use client';

import { useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabaseClient';
import { countByKind, PHOTO_KINDS, PHOTO_KIND_KEYS } from '@/lib/jobDocs';
import { fmtDay } from '@/lib/format';
import { filterGrid, mergeWaiting, roomCounts, tagCounts, addTag, cleanTag, splitRoomValue } from '@/lib/photoMeta';
import { useWaitingPhotos } from '@/lib/offlineClient';
import { KindChips, PhotoGrid, UploadStatus } from '@/components/job/PhotoUi';
import LibraryUploadDialog from '@/components/job/LibraryUploadDialog';
import WaitingPhotos from '@/components/job/WaitingPhotos';

const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

// Photos tab: add pictures (camera or library), see them the moment they are taken (dimmed while they wait to upload),
// filter by folder, room, tag and who took them, select several to file, tag, move to a room or archive, and open one
// to caption, mark up, tag, download or archive.
export default function PhotosTab({
  photos, isOffice, uploader, onOpen, jobId = null, rooms = [], authorName = () => '', staffId = null,
  onTakePhoto = () => {}, onChanged = async () => {}, logEvent = async () => {},
}) {
  const [filter, setFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState(null);
  const [tagFilter, setTagFilter] = useState(null);
  const [who, setWho] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [library, setLibrary] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [tagText, setTagText] = useState('');
  const [bulkMsg, setBulkMsg] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const waiting = useWaitingPhotos(jobId);

  const all = useMemo(() => mergeWaiting(photos, waiting), [photos, waiting]);
  const counts = useMemo(() => countByKind(photos), [photos]);
  const archivedCount = useMemo(() => photos.filter((p) => p.archived_at).length, [photos]);
  const roomLabels = useMemo(() => new Map(rooms.map((r) => [r.value, r.label])), [rooms]);
  const roomChips = useMemo(() => roomCounts(all, rooms), [all, rooms]);
  const tags = useMemo(() => tagCounts(all), [all]);
  const authors = useMemo(() => [...new Set(photos.filter((p) => !p.archived_at && p.created_by).map((p) => p.created_by))], [photos]);
  const list = useMemo(
    () => filterGrid(all, { kind: filter, roomValue: roomFilter, tag: tagFilter, who: who || null, archived: showArchived })
      .sort((a, b) => new Date(b.taken_at) - new Date(a.taken_at)),
    [all, filter, roomFilter, tagFilter, who, showArchived],
  );
  const viewable = useMemo(() => list.filter((p) => !p._local), [list]);
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
  const filtering = filter !== 'all' || roomFilter || tagFilter || who;
  const pickedPhotos = useMemo(() => photos.filter((p) => picked.has(p.id)), [photos, picked]);

  function toggle(p) {
    setPicked((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; });
  }
  function stopSelecting() { setSelecting(false); setPicked(new Set()); setBulkMsg(null); setTagText(''); }
  const clearFilters = () => { setFilter('all'); setRoomFilter(null); setTagFilter(null); setWho(''); };

  // Several pictures at once. Each group of pictures that gets the same new values is one request.
  async function bulk(what, groups) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setBulkMsg({ err: true, text: 'This needs a signal. Try again when you are back online.' }); return; }
    setBulkBusy(true);
    setBulkMsg(null);
    let count = 0;
    for (const g of groups) {
      const { error } = await getSupabase().from('job_photos').update(g.fields).in('id', g.ids);
      if (error) { setBulkMsg({ err: true, text: error.message }); setBulkBusy(false); await onChanged(); return; }
      count += g.ids.length;
    }
    await logEvent('photos_changed', { what, count });
    await onChanged();
    setBulkBusy(false);
    setBulkMsg({ text: `${what[0].toUpperCase()}${what.slice(1)} ${count} ${count === 1 ? 'photo' : 'photos'}.` });
    setPicked(new Set());
  }
  const ids = [...picked];
  const setKind = (k) => k && bulk('filed', [{ ids, fields: { kind: k } }]);
  const setRoom = (v) => {
    if (v === '') return;
    const t = v === 'none' ? { sketchId: null, roomKey: null } : splitRoomValue(v);
    if (!t) return;
    return bulk(v === 'none' ? 'took out of a room' : 'placed in a room', [{ ids, fields: { sketch_id: t.sketchId, room_key: t.roomKey } }]);
  };
  function addTagToPicked() {
    const t = cleanTag(tagText);
    if (!t) return;
    const groups = new Map(); // new tag list -> ids
    for (const p of pickedPhotos) {
      const next = addTag(p.tags || [], t);
      if (next.length === (p.tags || []).length) continue; // already has it (or at the limit)
      const key = JSON.stringify(next);
      if (!groups.has(key)) groups.set(key, { ids: [], fields: { tags: next } });
      groups.get(key).ids.push(p.id);
    }
    setTagText('');
    if (!groups.size) { setBulkMsg({ text: 'Those photos already have that tag.' }); return; }
    return bulk('tagged', [...groups.values()]);
  }
  const archivePicked = () => {
    if (!window.confirm(`Archive ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}? Archived photos are kept and an owner can restore them.`)) return;
    return bulk('archived', [{ ids, fields: { archived_at: new Date().toISOString() } }]);
  };

  return (
    <>
      {jobId && <WaitingPhotos jobId={jobId} />}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{showArchived ? 'Archived photos' : 'Photos'} <span className="muted">({showArchived ? archivedCount : counts.all})</span></h2>
          <div className="row">
            <button type="button" className="primary small" onClick={onTakePhoto}>Take photo</button>
            <button type="button" className="secondary small" onClick={() => setLibrary(true)}>Choose from library</button>
          </div>
        </div>
        <UploadStatus uploader={uploader} />
        <div className="row" style={{ marginTop: 8 }}>
          {!showArchived && photos.length > 0 && (
            <button type="button" className={`${selecting ? 'primary' : 'secondary'} small`} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}>
              {selecting ? 'Done selecting' : 'Select'}
            </button>
          )}
          {isOffice && archivedCount > 0 && (
            <button type="button" className="secondary small" onClick={() => { setShowArchived(!showArchived); clearFilters(); stopSelecting(); }}>
              {showArchived ? 'Back to photos' : `Archived (${archivedCount})`}
            </button>
          )}
        </div>

        {!showArchived && (
          <>
            <KindChips value={filter} onChange={setFilter} counts={counts} includeAll />
            {(roomChips.rooms.length > 0) && (
              <div className="chips chips-sub" role="group" aria-label="Room">
                <button type="button" className={!roomFilter ? 'on' : ''} aria-pressed={!roomFilter} onClick={() => setRoomFilter(null)}>All rooms</button>
                {roomChips.rooms.map((r) => (
                  <button key={r.value} type="button" className={roomFilter === r.value ? 'on' : ''} aria-pressed={roomFilter === r.value} onClick={() => setRoomFilter(roomFilter === r.value ? null : r.value)}>
                    {r.label}<span className="chip-n">{r.count}</span>
                  </button>
                ))}
                {roomChips.none > 0 && (
                  <button type="button" className={roomFilter === 'none' ? 'on' : ''} aria-pressed={roomFilter === 'none'} onClick={() => setRoomFilter(roomFilter === 'none' ? null : 'none')}>
                    No room<span className="chip-n">{roomChips.none}</span>
                  </button>
                )}
              </div>
            )}
            {tags.length > 0 && (
              <div className="chips chips-sub" role="group" aria-label="Tags">
                {tags.slice(0, 14).map((t) => (
                  <button key={t.tag} type="button" className={`chip-tag${tagFilter?.toLowerCase() === t.tag.toLowerCase() ? ' on' : ''}`} aria-pressed={tagFilter?.toLowerCase() === t.tag.toLowerCase()} onClick={() => setTagFilter(tagFilter?.toLowerCase() === t.tag.toLowerCase() ? null : t.tag)}>
                    #{t.tag}<span className="chip-n">{t.count}</span>
                  </button>
                ))}
              </div>
            )}
            {(authors.length > 1) && (
              <div className="ph-filters">
                <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Taken by">
                  <option value="">Everyone</option>
                  {staffId && authors.includes(staffId) && <option value={staffId}>Me</option>}
                  {authors.filter((a) => a !== staffId).map((a) => <option key={a} value={a}>{authorName(a) || 'Someone'}</option>)}
                </select>
                {filtering && <button type="button" className="secondary small" onClick={clearFilters}>Clear filters</button>}
              </div>
            )}
            {authors.length <= 1 && filtering && <div className="ph-filters"><button type="button" className="secondary small" onClick={clearFilters}>Clear filters</button></div>}
          </>
        )}

        {days.map((d) => (
          <section key={d.key} className="ph-day">
            <div className="ph-day-head">
              <h3>{d.label}</h3>
              {selecting && (
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setPicked((s) => { const n = new Set(s); const mine = d.items.filter((p) => !p._local); const allOn = mine.every((p) => n.has(p.id)); mine.forEach((p) => (allOn ? n.delete(p.id) : n.add(p.id))); return n; })}
                >
                  Select day
                </button>
              )}
            </div>
            <PhotoGrid
              photos={d.items}
              roomLabels={roomLabels}
              selected={selecting ? picked : undefined}
              onToggle={selecting ? toggle : undefined}
              onOpen={(p) => onOpen(viewable, p.id)}
            />
          </section>
        ))}
        {list.length === 0 && (
          <p className="muted">
            {showArchived ? 'No archived photos.' : filtering ? 'No photos match those filters.' : 'No photos yet. Use Take photo or Choose from library.'}
          </p>
        )}

        {selecting && (
          <div className="ph-selectbar" role="region" aria-label="Selected photos">
            <strong>{picked.size} selected</strong>
            <select value="" disabled={!picked.size || bulkBusy} onChange={(e) => setKind(e.target.value)} aria-label="File in folder">
              <option value="">File in folder…</option>
              {PHOTO_KIND_KEYS.map((k) => <option key={k} value={k}>{PHOTO_KINDS[k]}</option>)}
            </select>
            <select value="" disabled={!picked.size || bulkBusy} onChange={(e) => setRoom(e.target.value)} aria-label="Put in a room">
              <option value="">Put in room…</option>
              <option value="none">No room</option>
              {rooms.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <input
              value={tagText}
              maxLength={30}
              placeholder="Add a tag"
              aria-label="Tag to add"
              style={{ width: 120 }}
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTagToPicked(); } }}
            />
            <button type="button" className="secondary small" disabled={!picked.size || !tagText.trim() || bulkBusy} onClick={addTagToPicked}>Tag</button>
            <button type="button" className="danger small" disabled={!picked.size || bulkBusy} onClick={archivePicked}>Archive</button>
            {bulkMsg && <span className={`msg ${bulkMsg.err ? 'err' : 'ok'}`} style={{ margin: 0, flexBasis: '100%' }}>{bulkMsg.text}</span>}
          </div>
        )}
      </div>
      <LibraryUploadDialog open={library} onClose={() => setLibrary(false)} uploader={uploader} rooms={rooms} />
    </>
  );
}
