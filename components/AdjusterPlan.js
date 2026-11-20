'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { drawPlan } from '@/lib/sketchDraw';
import { fitView, planBounds } from '@/lib/sketch';
import { dayView, dayName, dateText } from '@/lib/moistureDays';
import { buildEquipment } from '@/lib/equipmentLog';

// The floor plan on the read-only adjuster page: the same picture the drying report draws (rooms, water, readings coloured wet or
// dry, equipment), drawn here in the browser from the plan the server already cleaned of names and notes. A day picker shows the
// readings as they stood on that day; the equipment picture shows the busiest day. Nothing on it can be edited.
const W = 900;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function PlanCanvas({ plan, extra, label }) {
  const ref = useRef(null);
  const b = useMemo(() => planBounds(plan), [plan]);
  const H = b ? Math.round(clamp(900 * ((b.maxY - b.minY + 4) / Math.max(b.maxX - b.minX + 4, 4)), 300, 800)) : 300;
  useEffect(() => {
    const c = ref.current;
    if (!c || !b) return;
    const ctx = c.getContext('2d');
    drawPlan(ctx, plan, fitView(b, W, H, 60), { W, H, surface: 'all', plain: true, grid: false, comments: false, hiddenAreas: null, moistLabels: false, ...extra });
  }, [plan, extra, b, H]);
  if (!b) return null;
  return <canvas ref={ref} width={W} height={H} role="img" aria-label={label} className="adj-plan-canvas" />;
}

export default function AdjusterPlan({ plan }) {
  const days = plan?.days || [];
  const [dayId, setDayId] = useState(days.length ? days[days.length - 1].id : null);
  const shown = useMemo(() => (dayId ? dayView(plan, dayId) : plan), [plan, dayId]);
  const equip = useMemo(() => buildEquipment(plan), [plan]);
  const hasPins = (plan?.moisture || []).length > 0;
  const hasRooms = (plan?.rooms || []).length > 0;
  const planExtra = useMemo(() => ({ moisture: true, ...(dayId ? { equipment: true, equipDay: dayId } : {}) }), [dayId]);
  const equipExtra = useMemo(() => (equip.peak ? { moisture: false, equipment: true, equipDay: equip.peak.day.id } : null), [equip]);
  if (!hasRooms) return null;
  return (
    <div className="adj-room">
      <h3>Floor plan</h3>
      {days.length > 1 && hasPins && (
        <label className="adj-day-pick">Readings as of{' '}
          <select value={dayId || ''} onChange={(e) => setDayId(e.target.value)}>
            {days.map((d) => <option key={d.id} value={d.id}>{dayName(days, d.id)} · {dateText(d.date)}</option>)}
          </select>
        </label>
      )}
      <div className="adj-plan-wrap"><PlanCanvas plan={shown} extra={planExtra} label="Floor plan with moisture readings" /></div>
      {hasPins && <p className="hint adj-legend"><span className="adj-key adj-dry-bg" /> Dry <span className="adj-key adj-wet-bg" /> Still wet. Numbers match the readings table below.</p>}
      {equipExtra && (
        <>
          <h3>Equipment placement</h3>
          <p className="hint" style={{ marginTop: 0 }}>As placed on the busiest day, {dayName(days, equip.peak.day.id)} ({dateText(equip.peak.day.date)}).</p>
          <div className="adj-plan-wrap"><PlanCanvas plan={plan} extra={equipExtra} label="Floor plan with equipment placement" /></div>
        </>
      )}
    </div>
  );
}
