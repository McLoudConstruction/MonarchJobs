'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadGoogleMapsPlaces } from '@/lib/googleMapsLoader';

// A plain text input with a small suggestion list under it, using Google's Places (New) data call.
// Picking a suggestion fills in the street, city, state and ZIP through onPlaceSelected.
// Same approach as the McLoud Jobs address field.
const DEBOUNCE_MS = 250;

let placesLib = null;
async function getPlacesLib() {
  if (placesLib) return placesLib;
  placesLib = await window.google.maps.importLibrary('places');
  return placesLib;
}

const textOf = (f) => (!f ? '' : typeof f === 'string' ? f : f.text || '');

function componentValue(components, type, short) {
  const c = (components || []).find((x) => (x.types || []).includes(type));
  if (!c) return '';
  return short ? c.shortText || c.longText || '' : c.longText || c.shortText || '';
}

async function parsePlace(place) {
  await place.fetchFields({ fields: ['addressComponents', 'displayName'] });
  const comps = place.addressComponents || [];
  return {
    street: [componentValue(comps, 'street_number'), componentValue(comps, 'route')].filter(Boolean).join(' '),
    city: componentValue(comps, 'locality') || componentValue(comps, 'sublocality') || componentValue(comps, 'administrative_area_level_2'),
    state: componentValue(comps, 'administrative_area_level_1', true),
    zip: componentValue(comps, 'postal_code'),
  };
}

export default function PlacesAutocompleteInput({ value, onChange, onPlaceSelected, ...rest }) {
  const [ready, setReady] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const tokenRef = useRef(null);
  const timerRef = useRef(null);
  const reqRef = useRef(0);
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsPlaces().then((ok) => { if (!cancelled) setReady(ok); });
    return () => { cancelled = true; clearTimeout(timerRef.current); };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const update = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setRect({ top: r.bottom + 2, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  async function fetchSuggestions(text) {
    const id = ++reqRef.current;
    try {
      const { AutocompleteSuggestion, AutocompleteSessionToken } = await getPlacesLib();
      if (!tokenRef.current) tokenRef.current = new AutocompleteSessionToken();
      const { suggestions: results } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: text,
        includedRegionCodes: ['us'],
        sessionToken: tokenRef.current,
      });
      if (id !== reqRef.current) return;
      const list = (results || []).filter((s) => s.placePrediction);
      setSuggestions(list);
      setOpen(list.length > 0);
    } catch {
      if (id !== reqRef.current) return;
      setSuggestions([]);
      setOpen(false);
    }
  }

  function handleChange(e) {
    const text = e.target.value;
    onChange(e);
    if (!ready) return;
    clearTimeout(timerRef.current);
    if (text.trim().length < 3) {
      reqRef.current++;
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(() => fetchSuggestions(text), DEBOUNCE_MS);
  }

  async function pick(s) {
    setOpen(false);
    setSuggestions([]);
    try {
      const parsed = await parsePlace(s.placePrediction.toPlace());
      onPlaceSelected?.(parsed);
    } finally {
      tokenRef.current = null; // a session ends when a place is chosen
    }
  }

  return (
    <div ref={wrapRef}>
      <input
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        {...rest}
      />
      {open && rect && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 4000, background: '#fff',
          border: '1px solid var(--border)', borderRadius: 8, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        }}>
          {suggestions.map((s, i) => {
            const p = s.placePrediction;
            return (
              <div key={p.placeId || i} onMouseDown={() => pick(s)}
                style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{textOf(p.mainText) || textOf(p.text)}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{textOf(p.secondaryText)}</div>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
