'use client';
import { useState } from 'react';
import { ChevronUpIcon, FolderIcon, CheckIcon } from './photoIcons';

// Bottom sheet listing the photo folders, and the pill on the camera screen that opens it.
export function FolderSheet({ open, onClose, title = 'Save photos to', options, value, onPick }) {
  if (!open) return null;
  return (
    <div className="dest-backdrop" onClick={onClose} role="presentation">
      <div className="dest-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dest-sheet-title">{title}</div>
        <div className="dest-sheet-list">
          {options.map((o) => (
            <button key={o.value} type="button" className="dest-row" onClick={() => { onPick(o.value); onClose(); }}>
              <FolderIcon size={18} />
              <span className="dest-row-label">{o.label}</span>
              {o.value === value && <CheckIcon size={18} />}
            </button>
          ))}
        </div>
        <button type="button" className="dest-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// destination: { options: [{value,label}], value (or null), setValue(v), sheetOpen, setSheetOpen(bool) }
export default function FolderPicker({ destination }) {
  const { options, value, setValue, sheetOpen, setSheetOpen } = destination;
  const current = options.find((o) => o.value === value);
  const label = current ? current.label : 'Choose folder';
  return (
    <>
      <button type="button" className="dest-pill dest-pill-camera" onClick={() => setSheetOpen(true)} aria-haspopup="dialog"
        aria-label={current ? `Photos are going into ${label}. Change folder.` : 'Choose a folder for these photos'}>
        <FolderIcon size={18} />
        <span className="dest-pill-label">{label}</span>
        <ChevronUpIcon size={16} />
      </button>
      <FolderSheet open={sheetOpen} onClose={() => setSheetOpen(false)} options={options} value={value} onPick={setValue} />
    </>
  );
}
