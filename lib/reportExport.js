// Builds the moisture report PDF from a saved plan. This is the code the sketch editor's export buttons used to hold
// inline; it lives here so the job's Reports tab can make the same PDFs without opening the editor. Browser only
// (it draws the floor plan on a canvas). The result is the PDF as bytes.
import { drawPlan } from './sketchDraw.js';
import { fitView, hitRoom, planBounds, roomTitle } from './sketch.js';
import { flattenFloors } from './floors.js';
import { dayView } from './moistureDays.js';
import { unitAt } from './equipment.js';
import { buildEquipment } from './equipmentLog.js';
import { renderMoistureReport } from './moistureReport.js';

const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const W = 900; // a smaller canvas keeps the pins and room names readable on the page

async function snapshot(plan, extra) {
  const b = planBounds(plan);
  if (!b) return null;
  const H = Math.round(clampN(900 * ((b.maxY - b.minY + 4) / Math.max(b.maxX - b.minX + 4, 4)), 300, 800));
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  drawPlan(ctx, plan, fitView(b, W, H, 60), { W, H, surface: 'all', plain: true, grid: false, comments: false, hiddenAreas: null, moistLabels: false, ...extra });
  const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.9));
  return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), w: W, h: H } : null;
}

// plan: the whole saved plan (all days). variant: full | summary | equipment | carrier. info: the report header lines.
export async function buildMoistureReportPdf(wholePlan, { variant = 'full', title = '', info = {} } = {}) {
  const full = flattenFloors(wholePlan); // a sketch with several floors is drawn floor by floor, side by side
  const ds = full.days || [];
  const lastDay = ds.length ? ds[ds.length - 1].id : null;
  const plan = dayView(full, lastDay); // the plan as of the latest day, every layer, numbered pins
  const planImage = await snapshot(plan, { moisture: true });
  const peak = buildEquipment(full).peak; // the equipment as placed on its busiest day
  const equipImage = peak ? await snapshot(full, { moisture: false, equipment: true, equipDay: peak.day.id }) : null;
  const roomImages = [];
  if (variant === 'carrier') { // one map per room that has readings or equipment, the room itself in focus
    const withStuff = full.rooms.filter((r) => full.moisture.some((m) => hitRoom(full, m.x, m.y)?.id === r.id)
      || (full.equipment || []).some((u) => { const s = unitAt(full, u, lastDay); return s.state !== 'none' && hitRoom(full, s.x, s.y)?.id === r.id; }));
    for (const r of withStuff.slice(0, 40)) {
      const image = await snapshot(plan, { moisture: true, equipment: true, equipDay: lastDay, focusRoom: r.id, moistLabels: true });
      if (image) roomImages.push({ id: r.id, name: roomTitle(r), image });
    }
  }
  return renderMoistureReport(full, { title, planImage, equipImage, roomImages, variant, info, preparedAt: new Date() });
}
