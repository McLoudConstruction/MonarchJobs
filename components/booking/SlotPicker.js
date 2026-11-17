'use client';

import { useState } from 'react';
import { fmtSlotDay, fmtSlotRange } from '@/lib/booking';
import './booking.css';

const FIRST_PAGE = 7;

// The open appointment times, a day at a time. days: [{ date, slots: [{ start, end }] }] from the server.
// value is the chosen slot's start (ISO). Big buttons: used on an iPad in front of a customer.
export default function SlotPicker({ days, tz, value, onPick, empty }) {
  const [shown, setShown] = useState(FIRST_PAGE);
  if (!days.length) return <p className="hint">{empty || 'There are no open times right now.'}</p>;
  return (
    <div>
      {days.slice(0, shown).map((day) => (
        <div key={day.date} className="bk-slot-day">
          <h3>{fmtSlotDay(day.date)}</h3>
          <div className="bk-slots">
            {day.slots.map((s) => (
              <button
                key={s.start}
                type="button"
                className={`bk-slot${value === s.start ? ' on' : ''}`}
                aria-pressed={value === s.start}
                onClick={() => onPick(s.start)}
              >
                {fmtSlotRange(s.start, s.end, tz)}
              </button>
            ))}
          </div>
        </div>
      ))}
      {days.length > shown && (
        <button type="button" className="secondary big" style={{ width: '100%' }} onClick={() => setShown(shown + FIRST_PAGE)}>Show more days</button>
      )}
    </div>
  );
}
