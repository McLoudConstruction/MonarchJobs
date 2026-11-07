import { getSupabase } from '@/lib/supabaseClient';

// Loads the Google Maps script (Places library) once, however many address fields are on the page.
// Resolves to false and never throws when no key is saved yet, so every caller can fall back to a
// plain input. A failed attempt is not remembered: add the key in Settings and the next field
// that mounts tries again, with no redeploy.
let loadPromise = null;

async function fetchConfiguredKey() {
  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const res = await fetch('/api/integrations/google-maps-key', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const body = await res.json();
    return body.apiKey || null;
  } catch {
    return null;
  }
}

export function loadGoogleMapsPlaces() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.google?.maps?.places?.AutocompleteSuggestion) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const apiKey = await fetchConfiguredKey();
    if (!apiKey) {
      loadPromise = null;
      return false;
    }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        loadPromise = null;
        resolve(false);
      };
      document.head.appendChild(script);
    });
  })();
  return loadPromise;
}
