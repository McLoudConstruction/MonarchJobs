'use client';
// Browser side of the job packet: read the job's invoices, payments, signed estimate and signed inspections, turn each
// signature (a PNG data URL) into JPEG bytes, and render the packet.
import { getSupabase } from './supabaseClient';
import { renderJobPacket, packetContents } from './jobPacket';

async function signatureToJpeg(dataUrl) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('signature'));
    i.src = dataUrl;
  });
  const w = Math.max(1, Math.min(600, img.naturalWidth));
  const h = Math.max(1, Math.round(img.naturalHeight * (w / img.naturalWidth)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; // a drawn signature is transparent, which a JPEG would turn black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
  if (!blob) throw new Error('signature');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

// What the packet would hold right now (cheap; for the button's hint).
export async function loadPacketData(jobId) {
  const sb = getSupabase();
  const [inv, est, insp] = await Promise.all([
    sb.from('invoices').select('*, lines:invoice_lines(*), payments(*)').eq('job_id', jobId).order('invoice_number'),
    sb.from('estimates').select('id,status,approved_at,signatures:estimate_signatures(*)').eq('job_id', jobId).maybeSingle(),
    sb.from('job_inspections').select('id,kind,data,signer_name,signature_png,signed_at,customer_absent').eq('job_id', jobId),
  ]);
  if (inv.error) throw new Error('The invoices could not be read.');
  const sigs = (est.data?.signatures || []).slice().sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)));
  const invoices = (inv.data || []).map((i) => ({ ...i, lines: (i.lines || []).slice().sort((a, b) => a.sort_order - b.sort_order) }));
  return {
    invoices,
    estimate: est.data && sigs[0] ? { ...est.data, signature: sigs[0] } : null,
    inspections: insp.data || [],
  };
}

export async function buildJobPacket(jobId, info) {
  const data = await loadPacketData(jobId);
  const c = packetContents(data);
  if (c.empty) throw new Error('Nothing has been invoiced or signed on this job yet.');
  const signatures = new Map();
  const tasks = [];
  if (c.estimate?.signature?.signature_png) tasks.push(['estimate', c.estimate.signature.signature_png]);
  for (const r of [c.pre, c.post]) if (r?.signature_png) tasks.push([r.id, r.signature_png]);
  for (const [key, url] of tasks) { try { signatures.set(key, await signatureToJpeg(url)); } catch { /* the packet says the image is not available */ } }
  return renderJobPacket({ info, ...data, signatures, preparedAt: new Date() });
}
