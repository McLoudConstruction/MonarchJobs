// The first-visit checklist for a water loss: what is normally done on Day 1, checked off from what is on the sketch.
// Advice only; nothing is blocked. Pure and tested.
import { sizePlan } from './equipmentSizing.js';
import { sortedReadings } from './moisture.js';
import { hitRoom } from './sketch.js';

// [{ id, label, done, hint }] in the order the work is usually done
export function dayOneList(plan) {
  const wetRooms = sizePlan(plan);
  const hasWater = wetRooms.wet;
  const roomsWet = wetRooms.rooms.map((r) => r.id);
  const reads = (plan.moisture || []).filter((p) => p.kind === 'reading');
  const roomsRead = new Set(reads.map((p) => hitRoom(plan, p.x, p.y)?.id).filter(Boolean));
  const stds = Object.keys(plan.standards || {}).length + (plan.moisture || []).filter((p) => p.kind === 'standard' && sortedReadings(p).length).length;
  const air = (plan.moisture || []).filter((p) => p.kind === 'air' && sortedReadings(p).length).length;
  const items = [
    { id: 'rooms', label: 'Draw the rooms', done: (plan.rooms || []).length > 0, hint: 'Sketch tab: draw each room or use By size.' },
    { id: 'source', label: 'Mark the source of the loss', done: (plan.sources || []).length > 0, hint: 'Sketch tab: Source tool, where the water came from.' },
    { id: 'water', label: 'Mark the affected areas', done: hasWater, hint: 'Sketch tab: Water tool over what got wet.' },
    { id: 'ceil', label: 'Set ceiling heights in the wet rooms', done: hasWater && wetRooms.assumed === 0, hint: 'Select the room and set its ceiling height, so sizing is not guessed.', skip: !hasWater },
    { id: 'standard', label: 'Take dry standard readings', done: stds > 0, hint: 'Moisture tab: a reading in an unaffected area of each material.' },
    { id: 'points', label: 'Put a moisture point in every wet room', done: hasWater && roomsWet.every((id) => roomsRead.has(id)), hint: 'Moisture tab: tap in each wet room and log the reading.', skip: !hasWater },
    { id: 'air', label: 'Take an air reading (humidity and temperature)', done: air > 0, hint: 'Moisture tab: an Air point, inside and, if you can, outside.' },
    { id: 'equipment', label: 'Place the drying equipment', done: wetRooms.air.now + wetRooms.dehu.now > 0, hint: 'Equipment mode: air movers and a dehumidifier, sized from the panel.', skip: !hasWater },
    { id: 'sized', label: 'Check the equipment against the sizing', done: hasWater && wetRooms.air.status === 'ok' && (wetRooms.dehu.status === 'ok' || wetRooms.dehu.status === 'unrated'), hint: 'The equipment panel says if air movers or the dehumidifier fall short.', skip: !hasWater },
  ].filter((i) => !i.skip);
  return items;
}

export const dayOneProgress = (items) => ({ done: items.filter((i) => i.done).length, total: items.length });
