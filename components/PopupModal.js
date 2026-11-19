'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// A centered dialog over a dimmed page. Closes on Escape, on a tap outside, or with the X.
// A form that is being filled in passes closeOnOverlay={false}, so a stray tap outside does not throw away what was typed.
export default function PopupModal({ open, onClose, title, children, wide = false, closeOnOverlay = true }) {
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
    <div className="popup-overlay" onClick={closeOnOverlay ? onClose : undefined}>
      <div className={`popup-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
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
