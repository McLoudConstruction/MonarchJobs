// Draws a sketch onto a 2D canvas context. Shared by the editor and the PNG export.
// Only uses the context it is handed (no DOM), so it also runs against a stand-in in tests.
import { fmtFeet, roomSizeText, roomAreaText, toScreen, toWorld } from './sketch.js';

const INK = '#2f4858';
const SELECT = '#c0572b';
export const TEXT_HEIGHT_FT = 1.4;

function drawGrid(ctx, view, W, H) {
  const { scale } = view;
  const step = scale >= 14 ? 1 : scale >= 5 ? 5 : 0;
  if (!step) return;
  const a = toWorld(view, 0, 0);
  const b = toWorld(view, W, H);
  ctx.lineWidth = 1;
  for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) {
    const sx = Math.round(x * scale + view.ox) + 0.5;
    ctx.strokeStyle = Math.abs(x % 5) < 1e-9 ? '#dcd8cf' : '#efede7';
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
  }
  for (let y = Math.floor(a.y / step) * step; y <= b.y; y += step) {
    const sy = Math.round(y * scale + view.oy) + 0.5;
    ctx.strokeStyle = Math.abs(y % 5) < 1e-9 ? '#dcd8cf' : '#efede7';
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
  }
}

function drawStroke(ctx, view, pts, color, width = 2.5) {
  if (!pts.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const first = toScreen(view, pts[0][0], pts[0][1]);
  if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(first.x, first.y, width / 2 + 0.5, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i += 1) {
    const p = toScreen(view, pts[i][0], pts[i][1]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawText(ctx, view, m, selected) {
  const px = Math.max(9, TEXT_HEIGHT_FT * view.scale);
  const p = toScreen(view, m.x, m.y);
  ctx.font = `700 ${px}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = m.color;
  ctx.fillText(m.text, p.x, p.y);
  if (selected) {
    const w = ctx.measureText(m.text).width;
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(p.x - 3, p.y - px, w + 6, px + 6);
    ctx.setLineDash([]);
  }
}

function drawRoom(ctx, view, r, { selected, count, ghost }) {
  const tl = toScreen(view, r.x, r.y);
  const w = r.w * view.scale;
  const h = r.h * view.scale;
  ctx.fillStyle = ghost ? 'rgba(47,72,88,0.06)' : '#eaf1f5';
  ctx.fillRect(tl.x, tl.y, w, h);
  ctx.strokeStyle = selected ? SELECT : INK;
  ctx.lineWidth = selected ? 3 : 2;
  if (ghost) ctx.setLineDash([6, 4]);
  ctx.strokeRect(tl.x, tl.y, w, h);
  ctx.setLineDash([]);

  // text, kept inside the room
  ctx.save();
  ctx.beginPath();
  ctx.rect(tl.x + 1, tl.y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
  ctx.clip();
  const fs = Math.min(18, Math.max(10, view.scale * 1.15));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  const lines = [];
  if (r.label) lines.push({ t: r.label, bold: true });
  if (w > 70 && h > 36) lines.push({ t: roomSizeText(r), bold: false });
  if (w > 70 && h > 54) lines.push({ t: roomAreaText(r), bold: false });
  const lh = fs * 1.25;
  let y = tl.y + h / 2 - ((lines.length - 1) * lh) / 2;
  for (const ln of lines) {
    ctx.font = `${ln.bold ? 700 : 500} ${fs}px -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(ln.t, tl.x + w / 2, y);
    y += lh;
  }
  ctx.restore();

  if (count > 0) {
    const cx = tl.x + w - 13;
    const cy = tl.y + 13;
    ctx.fillStyle = SELECT;
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), cx, cy + 0.5);
  }
  if (selected) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 2;
    ctx.fillRect(tl.x + w - 7, tl.y + h - 7, 14, 14);
    ctx.strokeRect(tl.x + w - 7, tl.y + h - 7, 14, 14);
  }
}

// opts: { W, H, selection: {kind,id}|null, counts: {roomId: n}, draft: {...}|null, grid: bool }
export function drawPlan(ctx, plan, view, opts = {}) {
  const { W, H, selection = null, counts = {}, draft = null, grid = true } = opts;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (grid) drawGrid(ctx, view, W, H);
  for (const r of plan.rooms) {
    drawRoom(ctx, view, r, { selected: selection?.kind === 'room' && selection.id === r.id, count: counts[r.id] || 0 });
  }
  for (const m of plan.marks) {
    const selected = selection?.kind === 'mark' && selection.id === m.id;
    if (m.type === 'pen') drawStroke(ctx, view, m.pts, selected ? SELECT : m.color, selected ? 3.5 : 2.5);
    else drawText(ctx, view, m, selected);
  }
  if (draft?.type === 'room') {
    drawRoom(ctx, view, { id: 'draft', label: '', x: draft.x, y: draft.y, w: draft.w, h: draft.h }, { selected: false, count: 0, ghost: true });
    const tl = toScreen(view, draft.x, draft.y);
    ctx.font = '600 12px -apple-system, sans-serif';
    ctx.fillStyle = SELECT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${fmtFeet(draft.w)} × ${fmtFeet(draft.h)}`, tl.x, tl.y - 4);
  } else if (draft?.type === 'pen') {
    drawStroke(ctx, view, draft.pts, draft.color);
  }
}
