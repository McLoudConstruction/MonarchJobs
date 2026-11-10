'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// A centered dialog over a dimmed page. Closes on Escape, on a tap outside, or with the X.
export default function PopupModal({ open, onClose, title, children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="popup-overlay" onClick={onClose}>
      <div className="popup-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="popup-head">
          <h2>{title}</h2>
          <button type="button" className="popup-x" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
