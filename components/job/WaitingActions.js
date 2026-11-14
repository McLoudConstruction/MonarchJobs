'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getOps, onQueueChange, kick } from '@/lib/offlineClient';
import { fmtDateTime } from '@/lib/format';

const LABEL = { on_the_way: 'On the way', started: 'Started the visit', finished: 'Finished the visit' };
const describe = (o) => (o.type === 'visit_status' ? LABEL[o.payload.action] || 'Visit update' : `Note${o.payload.row?.category ? ` (${o.payload.row.category})` : ''}`);

// Taps and notes saved on this phone that the server has not accepted yet.
export default function WaitingActions() {
  const [list, setList] = useState([]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => { const o = await getOps(); if (o) { const l = await o.list(); if (alive) setList(l); } };
    refresh();
    const off = onQueueChange(refresh);
    return () => { alive = false; off(); };
  }, []);
  if (!list.length) return null;
  const act = async (fn, id) => { const o = await getOps(); await o[fn](id); kick({ force: true }); };
  return (
    <div className="card">
      <h2>Taps and notes waiting</h2>
      {list.map((o) => (
        <div key={o.opId} className="list-item">
          <div className="title">{describe(o)} {o.state === 'blocked' && <span className="badge off">Needs attention</span>}</div>
          <div className="meta">Made {fmtDateTime(o.at)}{o.lastError ? ` · ${o.lastError}` : ''}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <Link href={`/jobs/${o.jobId}`} className="secondary small">Open job</Link>
            {o.state === 'blocked' && <button type="button" className="secondary small" onClick={() => act('retry', o.opId)}>Try again</button>}
            {o.state === 'blocked' && <button type="button" className="danger small" onClick={() => act('discard', o.opId)}>Discard</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
