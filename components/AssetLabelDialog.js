'use client';
// Print asset labels: choose where on the sheet the first label goes (so a part-used sheet can be finished), then download the PDF.
import { useState } from 'react';
import { assetLabelsPdf, PER_SHEET } from '@/lib/assetLabels';
import { logoAsJpeg } from '@/lib/logoJpeg';
import { logoUrl } from '@/lib/branding';
import { assetTag } from '@/lib/assets';

export default function AssetLabelDialog({ assets, settings, onClose }) {
  const [startAt, setStartAt] = useState(1);
  const [outline, setOutline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sheets = Math.ceil((assets.length + startAt - 1) / PER_SHEET);

  async function print() {
    setBusy(true); setErr('');
    try {
      const logo = await logoAsJpeg(logoUrl(settings?.logo_path));
      const pdf = assetLabelsPdf(assets, { origin: window.location.origin, prefix: settings?.asset_prefix, business: settings?.business_name || '', logo, startAt, outline });
      const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = assets.length === 1 ? `${assetTag(settings?.asset_prefix, assets[0].asset_no)}-label.pdf` : 'equipment-asset-labels.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      onClose();
    } catch (e) { setErr('Could not make the labels. Try again.'); }
    setBusy(false);
  }

  return (
    <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sketch-modal-card asset-labels" role="dialog" aria-label="Print labels">
        <div className="sketch-pop-head"><strong>Print {assets.length} label{assets.length === 1 ? '' : 's'}</strong><button type="button" className="sk-x" aria-label="Close" onClick={onClose}>{'×'}</button></div>
        <p className="muted" style={{ margin: 0 }}>Made for 2 x 4 inch labels, 10 to a sheet (Avery 5163 size; the weatherproof film sheets of this size work too). Print at 100% or "actual size", not "fit to page".</p>
        <label className="sk-field">First label goes in position (1 to {PER_SHEET}, left to right, top to bottom)
          <select value={startAt} onChange={(e) => setStartAt(Number(e.target.value))}>
            {Array.from({ length: PER_SHEET }, (_, i) => <option key={i} value={i + 1}>{i + 1}{i === 0 ? ' (a fresh sheet)' : ''}</option>)}
          </select>
        </label>
        <label className="sk-check"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} /> Draw a thin outline (for a test print on plain paper)</label>
        <div className="muted">{sheets} sheet{sheets === 1 ? '' : 's'}</div>
        {err && <div className="msg err">{err}</div>}
        <button type="button" className="primary" disabled={busy} onClick={print}>{busy ? 'Making the PDF...' : 'Download PDF'}</button>
      </div>
    </div>
  );
}
