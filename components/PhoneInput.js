'use client';

import { formatPhone } from '@/lib/phone';

// A phone field that formats as (xxx) xxx-xxxx while typing. Works like a normal input: it calls
// onChange with an event whose target.value is already formatted, so existing handlers just work.
export default function PhoneInput({ value, onChange, ...rest }) {
  return (
    <input
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      placeholder="(816) 555-1212"
      maxLength={14}
      {...rest}
      value={formatPhone(value)}
      onChange={(e) => {
        e.target.value = formatPhone(e.target.value);
        onChange(e);
      }}
    />
  );
}
