'use client';

import { useRef } from 'react';
import { PHOTO_KINDS, PHOTO_KIND_KEYS } from '@/lib/jobDocs';
import { useSignedUrls } from '@/lib/useSignedUrls';

// A button that opens the camera or the photo library. capture asks a phone for the camera.
export function FilePick({ label, onFiles, capture = false, multiple = true, className = 'secondary', disabled = false }) {
  const ref = useRef(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.click()}>{label}</button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple={multiple && !capture}
        {...(capture ? { capture: 'environment' } : {})}
        style={{ display: 'none' }}
        onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }}
      />
    </>
  );
}

export function UploadStatus({ uploader }) {
  if (!uploader.busy && !uploader.errors.length) return null;
  return (
    <div className={`msg ${uploader.errors.length && !uploader.busy ? 'err' : 'ok'}`} role="status">
      {uploader.busy && <div>Uploading picture {Math.min(uploader.done + 1, uploader.total)} of {uploader.total}... keep this page open.</div>}
      {uploader.errors.map((e, i) => <div key={i}>{e}</div>)}
      {!uploader.busy && uploader.errors.length > 0 && <button type="button" className="secondary small" style={{ marginTop: 6 }} onClick={uploader.clearErrors}>Dismiss</button>}
    </div>
  );
}

export function KindChips({ value, onChange, counts, includeAll = false }) {
  const keys = includeAll ? ['all', ...PHOTO_KIND_KEYS] : PHOTO_KIND_KEYS;
  return (
    <div className="chips" role="group" aria-label="Photo type">
      {keys.map((k) => (
        <button key={k} type="button" className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>
          {k === 'all' ? 'All' : PHOTO_KINDS[k]}{counts ? <span className="chip-n">{counts[k] || 0}</span> : null}
        </button>
      ))}
    </div>
  );
}

// A grid of small pictures. selectable: shows a check and calls onToggle instead of onOpen.
export function PhotoGrid({ photos, onOpen, selected, onToggle }) {
  const urls = useSignedUrls(photos.map((p) => p.thumb_path || p.storage_path));
  return (
    <div className="ph-grid">
      {photos.map((p) => {
        const url = urls[p.thumb_path || p.storage_path];
        const on = selected?.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className={`ph-thumb${on ? ' picked' : ''}`}
            onClick={() => (onToggle ? onToggle(p) : onOpen?.(p))}
            aria-label={`${PHOTO_KINDS[p.kind] || 'Photo'}${p.caption ? `: ${p.caption}` : ''}`}
            aria-pressed={onToggle ? !!on : undefined}
          >
            {url ? <img src={url} alt={p.caption || ''} loading="lazy" /> : <span className="ph-wait" />}
            <span className={`ph-kind k-${p.kind}`}>{PHOTO_KINDS[p.kind] || 'Other'}</span>
            {on && <span className="ph-check" aria-hidden="true">&#10003;</span>}
            {p.caption && !onToggle && <span className="ph-cap">{p.caption}</span>}
          </button>
        );
      })}
    </div>
  );
}
