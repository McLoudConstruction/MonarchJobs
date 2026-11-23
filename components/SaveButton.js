'use client';

import { saveLabel } from '@/lib/saveStatus';

// A Save button that shows "Saving..." then "Saved" (for 5 seconds) on itself. `save` comes from useSaveStatus().
export default function SaveButton({ save, idle, disabled = false, ...rest }) {
  return (
    <button {...rest} disabled={disabled || save.state === 'saving'} aria-live="polite">
      {saveLabel(save.state, idle)}
    </button>
  );
}
