'use client';

import { useState } from 'react';
import AuthGate from '@/components/AuthGate';
import ShiftClock from '@/components/ShiftClock';
import WeekTimeClock from '@/components/WeekTimeClock';

// A person's own time clock: clock in and out at the top, the whole week below, and a way to ask the owner for a change.
function TimeClockInner({ staff }) {
  const [tick, setTick] = useState(0);
  return (
    <>
      <div className="page-head"><h1>Time clock</h1></div>
      <ShiftClock staff={staff} hideWeek onChanged={() => setTick((n) => n + 1)} />
      <WeekTimeClock staff={staff} refreshKey={tick} />
    </>
  );
}

export default function TimeClockPage() {
  return <AuthGate>{({ staff }) => <TimeClockInner staff={staff} />}</AuthGate>;
}
