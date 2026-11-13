// How a room is named in logs and reports: "#2 Kitchen", or "Outside the rooms" for a spot that is in none.
import { roomTitle } from './sketch.js';

export function roomLabel(room) {
  if (!room) return 'Outside the rooms';
  const t = roomTitle(room);
  return room.num && !/^Room \d+$/.test(t) ? `#${room.num} ${t}` : t;
}
