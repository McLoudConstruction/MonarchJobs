'use client';
// Drying status for each chamber, with the equipment still standing in it. A chamber that reached its goal gets a one-tap
// pick-up. One that has not shows where it stands; the owner can still pick up early (with a reason, asked on tap).
import { useMemo } from 'react';
import { chamberStatus, chamberLine } from '@/lib/chamberDry';
import { dateText } from '@/lib/moistureDays';
import { unitCode } from '@/lib/equipment';

export default function PullPrompt({ plan, onPickUp, canEdit = true, isOwner = false }) {
  const list = useMemo(() => chamberStatus(plan).filter((c) => c.units.length > 0 || c.state === 'dry'), [plan]);
  if (!list.length || !(plan.days || []).length) return null;
  return (
    <div className="sk-pull" role="status">
      {list.map((c) => {
        const s = { roomId: c.id, roomName: c.name, units: c.units, dehus: c.dehus, unitDays: c.unitDays };
        return (
          <div key={c.id} className="sk-pull-card">
            <strong>{c.state === 'dry' ? `${c.name} is dry` : c.name}</strong>
            <div className="muted">
              {c.state === 'dry' && <>Reached the standard {c.dryDay ? dateText(c.dryDay.date) : ''}. </>}
              {c.state === 'drying' && <>{chamberLine(c).replace(`${c.name}: `, '')}. Still drying. </>}
              {c.state === 'no_readings' && <>No readings in this chamber yet, so it cannot be called dry. </>}
              {c.units.length > 0 && <>{c.units.map(unitCode).join(', ')} {c.units.length === 1 ? 'is' : 'are'} there{c.state === 'dry' && c.unitDays > 0 ? `; that is ${c.unitDays} equipment-day${c.unitDays === 1 ? '' : 's'} since it dried` : ''}.</>}
              {c.state === 'dry' && c.dehus > 0 ? ' Check first that a dehumidifier here is not also drying a chamber that is still wet.' : ''}
            </div>
            {canEdit && c.units.length > 0 && c.state === 'dry' && <button type="button" className="secondary small" onClick={() => onPickUp(s)}>Pick up {c.units.length === 1 ? 'it' : `all ${c.units.length}`}</button>}
            {canEdit && c.units.length > 0 && c.state !== 'dry' && isOwner && <button type="button" className="secondary small" onClick={() => onPickUp(s)}>Pick up early (reason needed)</button>}
          </div>
        );
      })}
    </div>
  );
}
