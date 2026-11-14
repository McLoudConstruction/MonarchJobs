// The business logo as a JPEG for a PDF (the PDF writer takes JPEG only). Browser only. Transparent areas become white.
// Returns { bytes: Uint8Array, w, h } or null when there is no logo or it cannot be read.
export async function logoAsJpeg(url, maxSide = 600) {
  if (!url || typeof document === 'undefined') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)); const h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), w, h } : null;
  } catch { return null; }
}
