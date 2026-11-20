'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { addressLine, JOB_TYPES } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { logoUrl } from '@/lib/branding';
import CenterCard from '@/components/CenterCard';
import AdjusterPlan from '@/components/AdjusterPlan';

// The adjuster's read-only view of the drying. No sign-in; the secret link is the access. Shows readings,
// equipment and dehumidifier performance and the floor plan, never staff names, notes or photos.
const STATE = { dry: ['Dry', 'adj-dry'], wet: ['Wet', 'adj-wet'] };

function View() {
  const { token } = useParams();
  const preview = useSearchParams().get('preview') === '1';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/public/adjuster/${token}${preview ? '?preview=1' : ''}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('This link is not available.');
        setData(body);
      })
      .catch((e) => setError(e.message));
  }, [token, preview]);

  if (error) return <CenterCard><h2 className="auth-welcome">Link unavailable</h2><p className="hint auth-sub">{error} It may have expired or been turned off. Please ask the contractor for a new one.</p></CenterCard>;
  if (!data) return <div className="center-wrap"><p>Loading...</p></div>;

  const b = data.business || {};
  const contact = [displayPhone(b.phone), b.email].filter(Boolean).join(' · ');
  return (
    <div className="page customer-page adj-page" style={{ maxWidth: 900 }}>
      {logoUrl(b.logo_path) && <img src={logoUrl(b.logo_path)} alt={b.business_name || 'Logo'} style={{ display: 'block', maxWidth: '100%', maxHeight: 90, objectFit: 'contain', margin: '0 0 12px' }} />}
      <h1>{b.business_name || 'Drying report'}</h1>
      <p className="sub">{contact}</p>
      <div className="card">
        <h2>Drying report</h2>
        {data.job && <p className="hint" style={{ margin: 0 }}>{data.job.customer} · Job #{data.job.job_number} · {JOB_TYPES[data.job.job_type]} · {addressLine(data.job.address)}</p>}
      </div>
      {data.sketches.length === 0 && <div className="card"><p className="hint" style={{ margin: 0 }}>No readings or equipment have been recorded yet.</p></div>}
      {data.sketches.map((s) => (
        <section key={s.name} className="card">
          <h2>{s.name}</h2>
          {s.hasData && (
            <p className={`adj-status ${s.status.allDry ? 'adj-dry' : s.status.wet ? 'adj-wet' : ''}`}>
              {s.status.allDry ? `All ${s.status.total} points are dry${s.status.dryDay ? `, reached ${s.status.dryDay}` : ''}.` : `${s.status.dry} of ${s.status.total} points dry as of ${s.status.lastDate}; ${s.status.wet} still wet.`}
            </p>
          )}
          {s.plan && <AdjusterPlan plan={s.plan} />}
          {s.rooms.map((r) => (
            <div key={r.name} className="adj-room">
              <h3>{r.name} <span className="muted">{r.allDry ? `· dry ${r.dryDay}` : `· ${r.dry} of ${r.points} dry`}</span></h3>
              <div className="adj-scroll">
                <table className="adj-table">
                  <thead><tr><th>Pt</th><th>Material</th><th>Standard</th>{s.days.map((d) => <th key={d.name}>{d.name}<br /><span className="muted">{d.date}</span></th>)}<th>Status</th></tr></thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <tr key={row.n}>
                        <td>{row.n}</td><td>{row.what}</td><td>{row.goal ?? '-'}</td>
                        {row.cells.map((c, i) => <td key={i}>{c ?? '-'}</td>)}
                        <td className={STATE[row.state] ? STATE[row.state][1] : ''}>{STATE[row.state] ? STATE[row.state][0] : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {s.equipment && (
            <div className="adj-room">
              <h3>Equipment</h3>
              <p className="hint">{s.equipment.peak ? `Most at once: ${s.equipment.peak}. ` : ''}{s.equipment.onSite}. {s.equipment.unitDays} equipment-days in all.</p>
              <div className="adj-scroll">
                <table className="adj-table">
                  <thead><tr><th>Unit</th><th>Equipment</th><th>Where</th><th>Placed</th><th>Picked up</th><th>Days</th></tr></thead>
                  <tbody>
                    {s.equipment.units.map((u) => <tr key={u.code}><td><strong>{u.code}</strong></td><td>{u.type}{u.label ? ` (${u.label})` : ''}</td><td>{u.where}</td><td>{u.placed}</td><td>{u.pickedUp || 'On site'}</td><td>{u.days}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {s.dehu.length > 0 && (
            <div className="adj-room">
              <h3>Dehumidifier performance</h3>
              <div className="adj-scroll">
                <table className="adj-table">
                  <thead><tr><th>Unit</th><th>Day</th><th>In RH / temp</th><th>In gpp</th><th>Out RH / temp</th><th>Out gpp</th><th>Drop (gpp)</th></tr></thead>
                  <tbody>
                    {s.dehu.map((h, i) => (
                      <tr key={i}>
                        <td>{h.unit}</td><td>{h.day}</td>
                        <td>{h.inRh ?? '-'}% / {h.inTemp ?? '-'}°F</td><td>{h.inGpp ?? '-'}</td>
                        <td>{h.outRh ?? '-'}% / {h.outTemp ?? '-'}°F</td><td>{h.outGpp ?? '-'}</td>
                        <td className={h.state === 'low' ? 'adj-wet' : h.state === 'ok' ? 'adj-dry' : ''}><strong>{h.drop ?? '-'}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      ))}
      <div className="card"><p className="hint" style={{ margin: 0 }}>Read only. Questions? {contact || 'Contact the contractor who sent this link.'}</p></div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="center-wrap"><p>Loading...</p></div>}><View /></Suspense>;
}
