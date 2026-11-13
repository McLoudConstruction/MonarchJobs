// Drawing equipment: a small coloured tag with the type's letters and the unit's number ("AM 3") at the spot it was placed.
import { EQUIPMENT_TYPES, equipmentOnPlan, unitCode } from './equipment.js';

const TAG_H = 20;
const FAINT = 0.32;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// opts: { day: the day shown (null: as it stands now), selection: {kind, id}|null, faint: bool (the readings are being worked on, so
//         equipment sits back), inside: (x, y) => bool|null (only units in the room zoomed into), select: colour }
// Units picked up on the day shown are drawn as a dashed outline.
export function drawEquipment(ctx, view, plan, { day = null, selection = null, faint = false, inside = null, select = '#54e9de' } = {}) {
  const chosen = (u) => selection?.kind === 'equipment' && selection.id === u.id;
  const list = equipmentOnPlan(plan, day)
    .filter((r) => !inside || inside(r.x, r.y))
    .sort((a, b) => Number(chosen(a.u)) - Number(chosen(b.u))); // the selected tag goes last, so nothing hides it
  ctx.save();
  ctx.font = '700 11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of list) {
    const ty = EQUIPMENT_TYPES[r.u.t] || EQUIPMENT_TYPES.other;
    const x = r.x * view.scale + view.ox;
    const y = r.y * view.scale + view.oy;
    const text = unitCode(r.u);
    const w = Math.max(34, ctx.measureText(text).width + 14);
    const gone = r.state === 'out';
    ctx.globalAlpha = faint && !chosen(r.u) ? FAINT : 1;
    if (chosen(r.u)) {
      roundRect(ctx, x - w / 2 - 4, y - TAG_H / 2 - 4, w + 8, TAG_H + 8, 9);
      ctx.strokeStyle = select;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    roundRect(ctx, x - w / 2, y - TAG_H / 2, w, TAG_H, 6);
    if (gone) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = ty.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ty.color;
    } else {
      ctx.fillStyle = ty.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
    }
    ctx.fillText(text, x, y + 0.5);
  }
  ctx.restore();
}
