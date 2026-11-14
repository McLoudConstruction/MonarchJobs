// Drying chambers: rooms that share air and are dried together (a kitchen and the hall it opens to). Each chamber is sized and
// checked on its own, because a dehumidifier in one chamber does nothing for the next. Data only.
//   plan.chambers: [{ id, name, rooms: [room ids] }]  a room is in at most one chamber
export const MAX_CHAMBERS = 12;

export function cleanChambers(list, roomIds) {
  const taken = new Set();
  const out = [];
  const ids = new Set();
  for (const c of (Array.isArray(list) ? list : []).slice(0, MAX_CHAMBERS)) {
    if (!c || typeof c !== 'object') continue;
    const rooms = [];
    for (const r of Array.isArray(c.rooms) ? c.rooms : []) {
      const id = String(r);
      if (roomIds.has(id) && !taken.has(id)) { taken.add(id); rooms.push(id); }
    }
    if (!rooms.length) continue;
    let id = String(c.id || '').slice(0, 40) || `c${out.length + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);
    out.push({ id, name: String(c.name || '').trim().slice(0, 40) || `Chamber ${out.length + 1}`, rooms });
  }
  return out;
}

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8);

// A chamber made from some rooms, taking them out of any chamber they were in.
export function setChamber(chambers, { id = null, name = '', rooms }) {
  const mine = new Set(rooms);
  const rest = (chambers || []).map((c) => ({ ...c, rooms: c.rooms.filter((r) => !mine.has(r) || c.id === id) })).filter((c) => c.rooms.length);
  const next = { id: id || newId(), name: String(name || '').trim().slice(0, 40), rooms: [...mine] };
  const has = rest.some((c) => c.id === next.id);
  const list = has ? rest.map((c) => (c.id === next.id ? { ...next, name: next.name || c.name } : c)) : [...rest, { ...next, name: next.name || `Chamber ${rest.length + 1}` }];
  return list.slice(0, MAX_CHAMBERS);
}
export const removeChamber = (chambers, id) => (chambers || []).filter((c) => c.id !== id);
