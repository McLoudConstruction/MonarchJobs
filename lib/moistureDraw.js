// Drawing moisture points: a numbered pin coloured by where it stands, with the latest reading beside it.
import { MOISTURE_COLORS, TREND_MARK, goalFor, moistureStatus, valueText, airText } from './moisture.js';

const PIN_R = 11;
const LABEL_MIN_SCALE = 6; // pixels per foot; zoomed out further than this only the pins show

function labelLines(p, status) {
  if (!status.latest) return ['No reading'];
  const first = `${valueText(p, status.latest)}${status.trend ? ` ${TREND_MARK[status.trend]}` : ''}`;
  const air = airText(status.latest);
  return air ? [first, air] : [first];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// opts: { selection: {kind, id}|null, surface: 'all'|'floor'|'wall'|'ceiling', labels: bool, W: canvas width, select: colour }
export function drawMoisture(ctx, view, plan, { selection = null, surface = 'all', labels = true, W = Infinity, select = '#54e9de' } = {}) {
  for (const p of plan.moisture || []) {
    const chosen = selection?.kind === 'moisture' && selection.id === p.id;
    if (surface !== 'all' && p.surface !== surface && !chosen) continue;
    const st = moistureStatus(p, goalFor(plan, p));
    const color = MOISTURE_COLORS[st.state];
    const x = p.x * view.scale + view.ox;
    const y = p.y * view.scale + view.oy;

    if (labels && (view.scale >= LABEL_MIN_SCALE || chosen)) {
      const lines = labelLines(p, st);
      ctx.font = '600 12px -apple-system, sans-serif';
      const w1 = ctx.measureText(lines[0]).width;
      ctx.font = '11px -apple-system, sans-serif';
      const w2 = lines[1] ? ctx.measureText(lines[1]).width : 0;
      const bw = Math.max(w1, w2) + 12;
      const bh = lines.length * 14 + 6;
      const left = x + PIN_R + 4 + bw > W && x - PIN_R - 4 - bw > 0; // no room on the right: put it on the left
      const bx = left ? x - PIN_R - 4 - bw : x + PIN_R + 4;
      const by = y - bh / 2;
      ctx.save();
      roundRect(ctx, bx, by, bw, bh, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1f2933';
      ctx.font = '600 12px -apple-system, sans-serif';
      ctx.fillText(lines[0], bx + 6, by + 3 + 7);
      if (lines[1]) {
        ctx.fillStyle = '#52606d';
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillText(lines[1], bx + 6, by + 3 + 21);
      }
      ctx.restore();
    }

    if (chosen) {
      ctx.strokeStyle = select;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, PIN_R + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, PIN_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${p.n > 99 ? 9 : 11}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.n), x, y + 0.5);
  }
}
