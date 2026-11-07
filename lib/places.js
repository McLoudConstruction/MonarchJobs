// Server-side helpers for Google Places (New). The API key lives only in the GOOGLE_MAPS_API_KEY
// environment variable and is sent from the server; it never reaches the browser.

export function placesKey() {
  return (process.env.GOOGLE_MAPS_API_KEY || '').trim() || null;
}

function comp(components, type, short) {
  const c = (components || []).find((x) => (x.types || []).includes(type));
  if (!c) return '';
  return short ? c.shortText || c.longText || '' : c.longText || c.shortText || '';
}

// Turns Google's addressComponents into the fields on a lead / customer address.
export function parseAddressComponents(components) {
  return {
    street: [comp(components, 'street_number'), comp(components, 'route')].filter(Boolean).join(' '),
    city: comp(components, 'locality') || comp(components, 'sublocality') || comp(components, 'postal_town') || comp(components, 'administrative_area_level_2'),
    state: comp(components, 'administrative_area_level_1', true),
    zip: comp(components, 'postal_code'),
  };
}

// Keeps only what the suggestion list shows.
export function simplifySuggestions(body) {
  return (body?.suggestions || [])
    .filter((s) => s.placePrediction?.placeId)
    .map((s) => {
      const p = s.placePrediction;
      return {
        placeId: p.placeId,
        main: p.structuredFormat?.mainText?.text || p.text?.text || '',
        secondary: p.structuredFormat?.secondaryText?.text || '',
      };
    });
}

export function validSessionToken(t) {
  return typeof t === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(t);
}
