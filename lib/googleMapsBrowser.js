// Loads the Google Maps script in the browser once. Uses the browser key (NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY), which is
// limited to the Maps JavaScript API and this website in Google Cloud. The server key is never sent to the browser.
let loading = null;

export const browserKey = () => (process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY || '').trim();

export function loadGoogleMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Maps load in the browser only.'));
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  const key = browserKey();
  if (!key) return Promise.reject(new Error('The map is not set up: add NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY in Vercel, then redeploy.'));
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const done = () => (window.google?.maps?.Map ? resolve(window.google.maps) : reject(new Error('Google Maps did not load.')));
      window.__monarchMapsReady = done;
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__monarchMapsReady&v=weekly`;
      s.async = true;
      s.onerror = () => { loading = null; reject(new Error('Google Maps could not be reached.')); };
      document.head.appendChild(s);
      // Google calls this when the key is wrong or not allowed for this website
      window.gm_authFailure = () => { loading = null; reject(new Error('Google refused the map key. Check that Maps JavaScript API is on and the key allows this website.')); };
    });
  }
  return loading;
}
