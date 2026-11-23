'use client';

import { useEffect, useState } from 'react';
import AuthGate from '@/components/AuthGate';
import ShiftClock from '@/components/ShiftClock';
import WeekTimeClock from '@/components/WeekTimeClock';
import TimeOffTab from '@/components/time/TimeOffTab';
import OnCallTab from '@/components/time/OnCallTab';

const TABS = [['clock', 'Clock'], ['timeoff', 'Time off'], ['oncall', 'On call']];
const validTab = (id) => (TABS.some(([k]) => k === id) ? id : 'clock');

// A person's own time: the clock (clock in and out, the whole week, a way to ask the owner for a change), time off requests,
// and on call with swap requests. The tab is kept in the address (#timeoff, #oncall) so notifications can open it.
function TimeInner({ staff }) {
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState('clock');
  useEffect(() => {
    const fromHash = () => setTab(validTab(window.location.hash.replace('#', '')));
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const open = (id) => { setTab(id); window.history.replaceState(null, '', `#${id}`); };
  return (
    <>
      <div className="page-head"><h1>Time</h1></div>
      <div className="tabs">
        {TABS.map(([k, label]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => open(k)}>{label}</button>)}
      </div>
      {tab === 'clock' && (
        <>
          <ShiftClock staff={staff} hideWeek onChanged={() => setTick((n) => n + 1)} />
          <WeekTimeClock staff={staff} refreshKey={tick} />
        </>
      )}
      {tab === 'timeoff' && <TimeOffTab staff={staff} />}
      {tab === 'oncall' && <OnCallTab staff={staff} />}
    </>
  );
}

export default function TimeClockPage() {
  return <AuthGate>{({ staff }) => <TimeInner staff={staff} />}</AuthGate>;
}
