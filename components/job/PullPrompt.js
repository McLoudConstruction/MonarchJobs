'use client';
// Rooms that have dried but still have drying equipment standing in them, with a one-tap pick-up.
import { useMemo } from 'react';
import { pullSuggestions } from '@/lib/pullPrompt';
import { dateText } from '@/lib/moistureDays';
import { unitCode } from '@/lib/equipment';

export default function PullPrompt({ plan, onPickUp, canEdit = true }) {
  const list = useMemo(() => pullSuggestions(plan), [plan]);
  if (!list.length) return null;
  return (
    <div className="sk-pull" role="status">
      {list.map((s) => (
        <div key={s.roomId} className="sk-pull-card">
          <strong>{s.roomName} is dry</strong>
          <div className="muted">
            Reached the standard {dateText(s.dryDay.date)}. {s.units.map(unitCode).join(', ')} {s.units.length === 1 ? 'is' : 'are'} still there
            {s.unitDays > 0 ? `; that is ${s.unitDays} equipment-day${s.unitDays === 1 ? '' : 's'} since it dried` : ''}.
            {s.dehus > 0 ? ' Check first that a dehumidifier here is not also drying a room that is still wet.' : ''}
          </div>
          {canEdit && <button type="button" className="secondary small" onClick={() => onPickUp(s)}>Pick up {s.units.length === 1 ? 'it' : `all ${s.units.length}`}</button>}
        </div>
      ))}
    </div>
  );
}
