// Server only. The shift clock's writes (the browser can only read shifts; see migration 025).
import { shiftTooShort, MIN_SHIFT_MINUTES } from './shiftClock.js';

export async function openShiftFor(admin, staffId) {
  const { data } = await admin.from('shifts').select('*').eq('staff_id', staffId).is('ended_at', null).is('voided_at', null).maybeSingle();
  return data || null;
}
export async function openBreakFor(admin, shiftId) {
  const { data } = await admin.from('shift_breaks').select('*').eq('shift_id', shiftId).is('ended_at', null).is('voided_at', null).maybeSingle();
  return data || null;
}
const uniq = (e) => /duplicate|unique/i.test(e?.message || '');

// action: 'in' | 'out' | 'break_start' | 'break_end'. Returns { ok, shift, brk } or { error, status }.
export async function shiftAction(admin, staffId, action, now = new Date()) {
  const at = now.toISOString();
  const open = await openShiftFor(admin, staffId);
  if (action === 'in') {
    if (open) return { error: 'You are already clocked in.', status: 409 };
    const { data, error } = await admin.from('shifts').insert({ staff_id: staffId, started_at: at, source: 'self' }).select('*').maybeSingle();
    if (error) return uniq(error) ? { error: 'You are already clocked in.', status: 409 } : { error: error.message, status: 500 };
    return { ok: true, shift: data };
  }
  if (!open) return { error: 'You are not clocked in.', status: 409 };
  const brk = await openBreakFor(admin, open.id);
  if (action === 'break_start') {
    if (brk) return { error: 'You are already on a break.', status: 409 };
    const { data, error } = await admin.from('shift_breaks').insert({ shift_id: open.id, staff_id: staffId, started_at: at }).select('*').maybeSingle();
    if (error) return uniq(error) ? { error: 'You are already on a break.', status: 409 } : { error: error.message, status: 500 };
    return { ok: true, shift: open, brk: data };
  }
  if (action === 'break_end') {
    if (!brk) return { error: 'You are not on a break.', status: 409 };
    const end = new Date(Math.max(now.getTime(), new Date(brk.started_at).getTime() + 1000)).toISOString();
    const { data, error } = await admin.from('shift_breaks').update({ ended_at: end }).eq('id', brk.id).is('ended_at', null).select('*').maybeSingle();
    if (error) return { error: error.message, status: 500 };
    return { ok: true, shift: open, brk: data };
  }
  if (action === 'out') {
    // Under five minutes is a mis-tap: the shift (and any break inside it) is discarded, not recorded.
    if (shiftTooShort(open.started_at, at)) {
      const { error } = await admin.from('shifts').delete().eq('id', open.id).is('ended_at', null); // breaks and change requests go with it (on delete cascade)
      if (error) return { error: error.message, status: 500 };
      return { ok: true, discarded: true, minutes: MIN_SHIFT_MINUTES };
    }
    if (brk) await admin.from('shift_breaks').update({ ended_at: new Date(Math.max(now.getTime(), new Date(brk.started_at).getTime() + 1000)).toISOString() }).eq('id', brk.id).is('ended_at', null); // clocking out ends a break
    const end = new Date(Math.max(now.getTime(), new Date(open.started_at).getTime() + 1000)).toISOString();
    const { data, error } = await admin.from('shifts').update({ ended_at: end }).eq('id', open.id).is('ended_at', null).select('*').maybeSingle();
    if (error) return { error: error.message, status: 500 };
    return { ok: true, shift: data };
  }
  return { error: 'Unknown action.', status: 400 };
}
