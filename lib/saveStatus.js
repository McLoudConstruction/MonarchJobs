'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Save buttons show their own status: "Saving..." while it works, "Saved" for 5 seconds, then the normal label again.
export const SAVED_MS = 5000;

export const saveLabel = (state, idle) => (state === 'saving' ? 'Saving...' : state === 'saved' ? 'Saved' : idle);

// const save = useSaveStatus();
//   <form onSubmit={save.track(handler)}> ... <SaveButton save={save} idle="Save" />
// track() wraps a save handler. The handler returns false when it did not save (a check failed, or an error), anything else
// when it did; a failed save goes straight back to the normal label (the page's own error message says what happened).
export function useSaveStatus() {
  const [state, setState] = useState('idle');
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; clearTimeout(timer.current); }, []);
  const track = useCallback((fn) => async (...args) => {
    clearTimeout(timer.current);
    setState('saving');
    let ok = false;
    try {
      ok = (await fn(...args)) !== false;
    } finally {
      if (alive.current) {
        setState(ok ? 'saved' : 'idle');
        if (ok) timer.current = setTimeout(() => { if (alive.current) setState('idle'); }, SAVED_MS);
      }
    }
    return ok;
  }, []);
  return { state, track };
}
