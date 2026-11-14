// A copy of the sketch kept on this device while changes are not yet saved to the server, so a dead battery, a lost signal or a
// closed tab does not lose a day's readings. Written a moment after each change, removed once the server has it.
//   stored: { plan, base: the server's updated_at the edits were made on, at: ISO time }
// On opening a sketch: if a copy exists and the server is still on the same version, the copy is restored and saved. If the
// server moved on (another device saved), the copy is kept aside and offered as a download, never silently dropped.

const KEY = (id) => `mj-sketch-backup:${id}`;
const ASIDE = (id) => `mj-sketch-aside:${id}`;
const timers = {};

const store = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function scheduleBackup(id, plan, base, delay = 700) {
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => writeBackup(id, plan, base), delay);
}

export function writeBackup(id, plan, base) {
  const s = store();
  if (!s) return false;
  try { s.setItem(KEY(id), JSON.stringify({ plan, base: base || null, at: new Date().toISOString() })); return true; } catch { return false; } // storage full or blocked: carry on without
}

export function clearBackup(id) {
  clearTimeout(timers[id]);
  const s = store();
  try { s?.removeItem(KEY(id)); } catch { /* nothing to do */ }
}

export function readBackup(id) {
  const s = store();
  if (!s) return null;
  try {
    const b = JSON.parse(s.getItem(KEY(id)) || 'null');
    return b && b.plan && typeof b.plan === 'object' ? b : null;
  } catch { return null; }
}

// What to do with a copy found on opening: 'none', 'restore' (server unchanged since the copy's base) or 'aside' (server moved on).
export function backupAction(backup, serverStamp, serverPlan) {
  if (!backup) return 'none';
  if (JSON.stringify(backup.plan) === JSON.stringify(serverPlan)) return 'none';
  return backup.base && serverStamp && backup.base === serverStamp ? 'restore' : 'aside';
}

// Keeps a copy that could not be restored, so it can be downloaded.
export function setAside(id, backup) {
  const s = store();
  try { if (s && backup) s.setItem(ASIDE(id), JSON.stringify(backup)); s?.removeItem(KEY(id)); } catch { /* nothing to do */ }
}
export function readAside(id) {
  const s = store();
  try { return JSON.parse(s?.getItem(ASIDE(id)) || 'null'); } catch { return null; }
}
export function clearAside(id) { try { store()?.removeItem(ASIDE(id)); } catch { /* nothing to do */ } }
