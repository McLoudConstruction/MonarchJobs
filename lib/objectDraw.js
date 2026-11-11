// Draws objects (doors, windows, cabinets, outlets...) on the sketch canvas.
import { OBJECT_TYPES, objectShownOn } from './objectTypes.js';
import { toScreen } from './sketch.js';

const STYLE = {
  Openings: { line: '#2f4858', fill: '#ffffff' },
  Cabinets: { line: '#8a5a2b', fill: '#f4e7d3' },
  Fixtures: { line: '#4b6a7d', fill: '#e3edf3' },
  Appliances: { line: '#4b6a7d', fill: '#e3edf3' },
  Structure: { line: '#5d5a52', fill: '#ece8df' },
  Electrical: { line: '#a86a0a', fill: '#fff4dc' },
  Ceiling: { line: '#6a4fa3', fill: '#f1ecfa' },
};

function rr(ctx, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}
const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };

// A door leaf and the arc it sweeps, hinged at (hx, 0) and swinging toward +y (dir mirrors it along the wall).
function leaf(ctx, hx, dir, len, px) {
  ctx.save();
  ctx.translate(hx, 0);
  ctx.scale(dir, 1);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, len); ctx.stroke();
  ctx.save();
  ctx.lineWidth = px;
  ctx.setLineDash([4 * px, 3 * px]);
  ctx.beginPath(); ctx.arc(0, 0, len, Math.PI / 2, 0, true); ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawWallItem(ctx, o, k, st) {
  const px = 1 / k;
  const w = o.w;
  // cut the wall line: blue inside the room, white outside
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-w / 2, -3.5 * px, w, 3.5 * px);
  ctx.fillStyle = '#eaf1f5'; ctx.fillRect(-w / 2, 0, w, 3.5 * px);
  ctx.strokeStyle = st.line; ctx.fillStyle = st.fill; ctx.lineWidth = 1.6 * px;
  const kind = OBJECT_TYPES[o.t].kind;
  if (o.f) ctx.scale(1, -1);
  if (o.m && ['door', 'dutch', 'pocket', 'barn'].includes(kind)) ctx.scale(-1, 1);
  if (kind === 'door') {
    leaf(ctx, -w / 2, 1, w, px);
    ctx.beginPath(); ctx.moveTo(w / 2, -4 * px); ctx.lineTo(w / 2, 4 * px); ctx.moveTo(-w / 2, -4 * px); ctx.lineTo(-w / 2, 4 * px); ctx.stroke();
  } else if (kind === 'double') {
    leaf(ctx, -w / 2, 1, w / 2, px);
    leaf(ctx, w / 2, -1, w / 2, px);
  } else if (kind === 'missing') { // no wall here: a dashed line shows where it was
    ctx.save(); ctx.strokeStyle = '#7a8a96'; ctx.lineWidth = 1.4 * px; ctx.setLineDash([7 * px, 5 * px]);
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(-w / 2, -5 * px); ctx.lineTo(-w / 2, 5 * px); ctx.moveTo(w / 2, -5 * px); ctx.lineTo(w / 2, 5 * px); ctx.stroke();
  } else if (kind === 'pocket') { // the leaf slides into the wall: shown dashed beside the opening
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
    ctx.save(); ctx.setLineDash([5 * px, 3 * px]); ctx.strokeRect(w / 2, -0.07, w, 0.14); ctx.restore();
    ctx.beginPath(); ctx.moveTo(-w / 2, -4 * px); ctx.lineTo(-w / 2, 4 * px); ctx.moveTo(w / 2, -4 * px); ctx.lineTo(w / 2, 4 * px); ctx.stroke();
  } else if (kind === 'bifold') {
    const n = w > 3.5 ? 4 : 2;
    ctx.beginPath(); ctx.moveTo(-w / 2, 0);
    for (let i = 1; i <= n; i += 1) ctx.lineTo(-w / 2 + (w * i) / n, i % 2 ? w * 0.09 : 0);
    ctx.stroke();
  } else if (kind === 'barn') { // a panel hung on a rail along the outside of the wall
    ctx.fillRect(-w / 2, -0.34, w, 0.12); ctx.strokeRect(-w / 2, -0.34, w, 0.12);
    ctx.beginPath(); ctx.moveTo(-w / 2 - 0.3, -0.42); ctx.lineTo(w * 1.5 + 0.3, -0.42); ctx.stroke();
  } else if (kind === 'dutch') { // a swing door in two halves
    leaf(ctx, -w / 2, 1, w, px);
    ctx.beginPath(); ctx.moveTo(-w / 2 - 0.12, w * 0.5); ctx.lineTo(-w / 2 + 0.12, w * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2, -4 * px); ctx.lineTo(w / 2, 4 * px); ctx.moveTo(-w / 2, -4 * px); ctx.lineTo(-w / 2, 4 * px); ctx.stroke();
  } else if (kind === 'slider') {
    ctx.fillRect(-w / 2, -0.14, w * 0.55, 0.12); ctx.strokeRect(-w / 2, -0.14, w * 0.55, 0.12);
    ctx.fillRect(-w * 0.05, 0.02, w * 0.55, 0.12); ctx.strokeRect(-w * 0.05, 0.02, w * 0.55, 0.12);
  } else if (kind === 'garage') {
    ctx.save(); ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(-w / 2, -0.25, w, 0.5);
    ctx.restore();
  } else if (kind === 'window') {
    ctx.fillRect(-w / 2, -0.17, w, 0.34); ctx.strokeRect(-w / 2, -0.17, w, 0.34);
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
  } else { // opening
    ctx.beginPath();
    ctx.moveTo(-w / 2, -0.3); ctx.lineTo(-w / 2, 0.3); ctx.moveTo(w / 2, -0.3); ctx.lineTo(w / 2, 0.3);
    ctx.stroke();
  }
}

function drawWallPoint(ctx, o, k, st) {
  const px = 1 / k;
  const u = Math.max(0.32, 6 * px);
  ctx.strokeStyle = st.line; ctx.fillStyle = st.fill; ctx.lineWidth = 1.6 * px;
  if (o.f) ctx.scale(1, -1);
  const kind = OBJECT_TYPES[o.t].kind;
  if (kind === 'panel') {
    const w = Math.max(o.w, 10 * px);
    const d = Math.max(o.d, 6 * px);
    ctx.fillStyle = '#f3dcae';
    ctx.fillRect(-w / 2, 0, w, d); ctx.strokeRect(-w / 2, 0, w, d);
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, d); ctx.moveTo(w / 2, 0); ctx.lineTo(-w / 2, d); ctx.stroke();
    return;
  }
  circle(ctx, 0, u, u); ctx.fill(); ctx.stroke();
  if (kind === 'outlet') {
    ctx.beginPath();
    ctx.moveTo(-u * 0.38, u * 0.55); ctx.lineTo(-u * 0.38, u * 1.45);
    ctx.moveTo(u * 0.38, u * 0.55); ctx.lineTo(u * 0.38, u * 1.45);
    ctx.stroke();
  } else { // switch: a toggle stem
    ctx.beginPath(); ctx.moveTo(0, u); ctx.lineTo(u * 0.9, u * 2.1); ctx.stroke();
  }
}

function drawPoint(ctx, o, k, st) {
  const px = 1 / k;
  const kind = OBJECT_TYPES[o.t].kind;
  ctx.strokeStyle = st.line; ctx.fillStyle = st.fill; ctx.lineWidth = 1.5 * px;
  if (kind === 'vent') {
    const w = Math.max(o.w, 12 * px);
    const d = Math.max(o.d, 8 * px);
    ctx.fillRect(-w / 2, -d / 2, w, d); ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.beginPath();
    for (let i = -1; i <= 1; i += 1) { ctx.moveTo(-w / 2 + (i + 1) * (w / 3), -d / 2); ctx.lineTo(-w / 2 + (i + 1) * (w / 3) + w * 0.1, d / 2); }
    ctx.stroke();
    return;
  }
  const R = Math.max(o.w / 2, kind === 'recessed' ? 4 * px : kind === 'fan' ? 9 * px : 7 * px);
  circle(ctx, 0, 0, R); ctx.fill(); ctx.stroke();
  if (kind === 'fan') {
    for (let i = 0; i < 4; i += 1) {
      ctx.save(); ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
      ctx.beginPath(); ctx.ellipse(R * 0.52, 0, R * 0.38, R * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    circle(ctx, 0, 0, R * 0.14); ctx.fillStyle = st.line; ctx.fill();
  } else if (kind === 'light') {
    ctx.beginPath(); ctx.moveTo(-R * 0.65, -R * 0.65); ctx.lineTo(R * 0.65, R * 0.65); ctx.moveTo(R * 0.65, -R * 0.65); ctx.lineTo(-R * 0.65, R * 0.65); ctx.stroke();
  } else if (kind === 'recessed') {
    circle(ctx, 0, 0, R * 0.35); ctx.fillStyle = st.line; ctx.fill();
  } else { // detector
    circle(ctx, 0, 0, R * 0.55); ctx.stroke();
  }
}

function drawBox(ctx, o, k, st) {
  const px = 1 / k;
  const { w, d } = o;
  const kind = OBJECT_TYPES[o.t].kind;
  ctx.strokeStyle = st.line; ctx.fillStyle = st.fill; ctx.lineWidth = 1.6 * px;
  if (kind === 'circle') {
    const r = Math.min(w, d) / 2;
    circle(ctx, 0, 0, r); ctx.fill(); ctx.stroke();
    return;
  }
  if (kind === 'upper') {
    ctx.save(); ctx.setLineDash([6 * px, 4 * px]);
    ctx.fillStyle = 'rgba(244,231,211,0.45)';
    ctx.fillRect(-w / 2, -d / 2, w, d); ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.restore();
    return;
  }
  if (kind === 'tub') { rr(ctx, -w / 2, -d / 2, w, d, Math.min(0.5, d / 3)); ctx.fill(); ctx.stroke(); rr(ctx, -w / 2 + 0.2, -d / 2 + 0.2, w - 0.4, d - 0.4, Math.min(0.6, d / 3)); ctx.stroke(); return; }
  if (kind === 'toilet') {
    ctx.fillRect(-w / 2, -d / 2, w, d * 0.32); ctx.strokeRect(-w / 2, -d / 2, w, d * 0.32);
    ctx.beginPath(); ctx.ellipse(0, d * 0.16, w * 0.46, d * 0.34, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    return;
  }
  ctx.fillRect(-w / 2, -d / 2, w, d); ctx.strokeRect(-w / 2, -d / 2, w, d);
  ctx.beginPath();
  if (kind === 'cabinet') {
    const n = Math.max(1, Math.round(w / 1.5));
    for (let i = 1; i < n; i += 1) { const x = -w / 2 + (w * i) / n; ctx.moveTo(x, d / 2 - Math.min(0.4, d / 3)); ctx.lineTo(x, d / 2); }
  } else if (kind === 'island') {
    ctx.rect(-w / 2 + 0.25, -d / 2 + 0.25, w - 0.5, d - 0.5);
  } else if (kind === 'sink') {
    const bw = w / 2 - 0.25;
    ctx.ellipse(0, 0.05, Math.min(bw, w * 0.36), Math.min(d * 0.33, 0.6), 0, 0, Math.PI * 2);
  } else if (kind === 'shower') {
    ctx.moveTo(-w / 2, -d / 2); ctx.lineTo(w / 2, d / 2); ctx.moveTo(w / 2, -d / 2); ctx.lineTo(-w / 2, d / 2);
    ctx.moveTo(0.12, 0); ctx.arc(0, 0, 0.12, 0, Math.PI * 2);
  } else if (kind === 'range') {
    const r = Math.min(w, d) * 0.16;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const cx = sx * w * 0.22; const cy = sy * d * 0.22; ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2); }
  } else if (kind === 'round') {
    const r = Math.min(w, d) * 0.34;
    ctx.moveTo(r, 0.1); ctx.arc(0, 0.1, r, 0, Math.PI * 2);
  } else if (kind === 'fireplace') {
    ctx.fillStyle = '#d9d2c3';
    ctx.rect(-w / 2 + 0.4, -d / 2 + 0.3, w - 0.8, d - 0.6);
  } else if (kind === 'stairs') {
    const n = Math.max(3, Math.round(d / 0.9));
    for (let i = 1; i < n; i += 1) { const y = -d / 2 + (d * i) / n; ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); }
    const dir = o.f ? 1 : -1; // the arrow points up the stairs
    ctx.moveTo(0, -dir * d * 0.38); ctx.lineTo(0, dir * d * 0.38);
    ctx.moveTo(-0.25, dir * d * 0.38 - dir * 0.4); ctx.lineTo(0, dir * d * 0.38); ctx.lineTo(0.25, dir * d * 0.38 - dir * 0.4);
  } else if (kind === 'column') {
    ctx.moveTo(-w / 2, -d / 2); ctx.lineTo(w / 2, d / 2); ctx.moveTo(w / 2, -d / 2); ctx.lineTo(-w / 2, d / 2);
  }
  ctx.stroke();
}

// Selection outline in the object's own frame.
function outline(ctx, o, k, select) {
  const px = 1 / k;
  const t = OBJECT_TYPES[o.t];
  ctx.strokeStyle = select; ctx.lineWidth = 2.5 * px; ctx.setLineDash([]);
  if (t.mode === 'wall') {
    ctx.strokeRect(-o.w / 2 - 0.15, -0.35, o.w + 0.3, 0.7);
  } else if (t.mode === 'wallpoint') {
    circle(ctx, 0, Math.max(0.32, 6 * px), Math.max(0.55, 11 * px)); ctx.stroke();
  } else if (t.mode === 'point') {
    circle(ctx, 0, 0, Math.max(Math.max(o.w, o.d) / 2, 8 * px) + 4 * px); ctx.stroke();
  } else {
    ctx.strokeRect(-o.w / 2 - 3 * px, -o.d / 2 - 3 * px, o.w + 6 * px, o.d + 6 * px);
  }
}

const labelText = (o) => o.label || OBJECT_TYPES[o.t].label;

export function drawObjects(ctx, view, plan, { selection = null, surface = 'all', select = '#14b8a6', hoverGhost = null } = {}) {
  const k = view.scale;
  const draw = (o, selected, ghost) => {
    const t = OBJECT_TYPES[o.t];
    const st = STYLE[t.group] || STYLE.Structure;
    const c = toScreen(view, o.x, o.y);
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.55;
    ctx.translate(c.x, c.y);
    ctx.rotate((o.r * Math.PI) / 180);
    ctx.scale(k, k);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.save();
    if (t.mode === 'wall') drawWallItem(ctx, o, k, st);
    else if (t.mode === 'wallpoint') drawWallPoint(ctx, o, k, st);
    else if (t.mode === 'point') drawPoint(ctx, o, k, st);
    else drawBox(ctx, o, k, st);
    ctx.restore();
    if (selected) outline(ctx, o, k, select);
    ctx.restore();
    // box items say what they are, upright
    if (t.mode === 'box' && t.kind !== 'upper' && o.w * k > 46 && o.d * k > 18 && !['stairs', 'circle', 'tub', 'shower', 'toilet', 'range', 'round', 'sink', 'column'].includes(t.kind)) {
      ctx.font = '600 10px -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      const txt = labelText(o);
      if (ctx.measureText(txt).width > o.w * k - 6) return;
      ctx.strokeText(txt, c.x, c.y); ctx.fillStyle = st.line; ctx.fillText(txt, c.x, c.y);
    }
  };
  for (const o of plan.objects || []) {
    const selected = selection?.kind === 'object' && selection.id === o.id;
    if (objectShownOn(o, surface) || selected) draw(o, selected, false);
  }
  if (hoverGhost) draw(hoverGhost, false, true);
}
