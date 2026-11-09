'use client';

import PlacesAutocompleteInput from '@/components/PlacesAutocompleteInput';

// Street, unit, city, state and ZIP. Typing in the street field offers address suggestions, and
// picking one fills in the rest. onChange receives the fields that changed, e.g. { city: 'Lee's Summit' }.
export default function AddressFields({ values, onChange, required = false, extra = null }) {
  const v = (k) => values[k] ?? '';
  return (
    <div className="grid2">
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label>Street address{required ? ' *' : ''}</label>
        <PlacesAutocompleteInput
          value={v('street')}
          onChange={(e) => onChange({ street: e.target.value })}
          onPlaceSelected={(p) => onChange({
            street: p.street || v('street'),
            ...(p.city ? { city: p.city } : {}),
            ...(p.state ? { state: p.state } : {}),
            ...(p.zip ? { zip: p.zip } : {}),
          })}
          required={required}
          placeholder="Start typing the address"
        />
      </div>
      <div className="field"><label>Unit / suite</label><input value={v('unit')} onChange={(e) => onChange({ unit: e.target.value })} /></div>
      <div className="field"><label>City</label><input value={v('city')} onChange={(e) => onChange({ city: e.target.value })} /></div>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div className="field" style={{ width: 90 }}><label>State</label><input value={v('state')} maxLength={2} onChange={(e) => onChange({ state: e.target.value.toUpperCase() })} /></div>
        <div className="field" style={{ flex: 1 }}><label>ZIP</label><input value={v('zip')} inputMode="numeric" onChange={(e) => onChange({ zip: e.target.value })} /></div>
      </div>
      {extra}
    </div>
  );
}
