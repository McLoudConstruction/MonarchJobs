'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import EvalEditor from '@/components/eval/EvalEditor';
import PropertyForm from '@/components/eval/PropertyForm';
import { getSupabase } from '@/lib/supabaseClient';
import { dayKey } from '@/lib/shiftClock';
import { displayPhone } from '@/lib/phone';
import { fmtDateTime } from '@/lib/format';
import { cleanEval } from '@/lib/evalSheet';
import {
  EVAL_STATUSES, EVAL_RANGES, filterEvals, groupByProperty, evalRowTitle, centsText, newEvalData,
} from '@/lib/evals';
import './evals.css';

const missingTable = (err) => !!err && (err.code === '42P01' || /does not exist|schema cache|Could not find the table/i.test(err.message || ''));
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
const dayText = (e) => {
  const day = e.eval_date || String(e.created_at || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
};

// The Evals tab on the Leads page: every unit evaluation, grouped under its property, filterable by property, status and date.
export default function EvalsSection({ staff }) {
  const [properties, setProperties] = useState(null);
  const [evals, setEvals] = useState(null);
  const [setup, setSetup] = useState(false);
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState({ propertyId: '', status: '', range: 'all', q: '' });
  const [openId, setOpenId] = useState(null);
  const [propForm, setPropForm] = useState(null); // { property, thenEval }
  const [chooser, setChooser] = useState(false);
  const today = dayKey(new Date());

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [p, e] = await Promise.all([
      sb.from('properties').select('*').order('name'),
      sb.from('evals').select('id,property_id,eval_date,status,total_cents,job_id,data,created_at').order('created_at', { ascending: false }).limit(1000),
    ]);
    const err = p.error || e.error;
    if (err) { if (missingTable(err)) setSetup(true); else setMsg({ err: true, text: err.message }); setProperties([]); setEvals([]); return; }
    setProperties((p.data || []).sort(byName));
    setEvals(e.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => filterEvals(evals || [], { ...f, today }), [evals, f, today]);
  const groups = useMemo(() => {
    const g = groupByProperty(filtered, properties || []);
    const filtersOn = f.status || f.q || f.range !== 'all';
    const shown = new Set(g.map((x) => x.property.id));
    // a property with no evals yet still shows (unless the list is narrowed by something other than the property)
    const empty = (properties || []).filter((p) => !shown.has(p.id) && (f.propertyId ? p.id === f.propertyId : !filtersOn))
      .map((p) => ({ property: p, evals: [], totalCents: 0, count: 0 }));
    return [...g, ...empty].sort((a, b) => byName(a.property, b.property));
  }, [filtered, properties, f]);

  async function createEval(property) {
    setMsg(null);
    const previous = (evals || []).find((e) => e.property_id === property.id) || null; // newest first: the last one filled in there
    const data = newEvalData({ property, previous, today });
    const { data: row, error } = await getSupabase().from('evals')
      .insert({ property_id: property.id, data, eval_date: today, total_cents: 0, created_by: staff.id })
      .select('id,property_id,eval_date,status,total_cents,job_id,data,created_at').single();
    if (error) { setMsg({ err: true, text: error.message }); return; }
    setEvals((list) => [row, ...(list || [])]);
    setOpenId(row.id);
  }

  const mergeProperty = (saved) => setProperties((list) => [...(list || []).filter((p) => p.id !== saved.id), saved].sort(byName));

  function newEval() {
    if (f.propertyId) { const p = properties.find((x) => x.id === f.propertyId); if (p) { createEval(p); return; } }
    if (properties.length === 0) { setPropForm({ property: null, thenEval: true }); return; }
    setChooser(true);
  }

  if (setup) return <div className="card"><h3>Evals</h3><p className="hint">Evals need migration 034 run once in the Supabase SQL Editor.</p></div>;
  if (!properties || !evals) return <p className="muted">Loading evals...</p>;

  const open = evals.find((e) => e.id === openId);
  if (open) {
    return (
      <EvalEditor key={open.id} row={open} properties={properties} isOwner={staff.role === 'owner'}
        onPropertySaved={mergeProperty}
        onClose={() => { setOpenId(null); load(); }}
        onDeleted={() => { setOpenId(null); load(); }} />
    );
  }

  const totalCents = filtered.reduce((s, e) => s + (Number(e.total_cents) || 0), 0);

  return (
    <div className="ev-section">
      <p className="sub">An evaluation sheet for each unit, kept under its property. Fill it in on the phone or iPad; it prices itself from the printed sheet.</p>

      <div className="ev-actions">
        <button type="button" className="primary" onClick={newEval}>New eval</button>
        <button type="button" className="secondary" onClick={() => setPropForm({ property: null, thenEval: false })}>Add property</button>
      </div>

      <div className="ev-filters">
        <select value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })} aria-label="Property">
          <option value="">All properties</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(EVAL_STATUSES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={f.range} onChange={(e) => setF({ ...f, range: e.target.value })} aria-label="Date">
          {EVAL_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <input type="search" placeholder="Search building, unit or notes" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search evals" />
      </div>
      {msg && <div className={`banner ${msg.err ? 'flag' : 'ok'}`}>{msg.text}</div>}

      {properties.length === 0 ? (
        <div className="card">
          <h3>Add your first property</h3>
          <p className="hint">Evals are kept under the apartment complex or site they are for, along with the property manager and maintenance supervisor.</p>
          <button type="button" className="primary" onClick={() => setPropForm({ property: null, thenEval: false })}>Add property</button>
        </div>
      ) : (
        <>
          <p className="meta ev-summary">{filtered.length} eval{filtered.length === 1 ? '' : 's'}{filtered.length > 0 && ` · ${centsText(totalCents)} total`}</p>
          {groups.length === 0 && <p className="muted">No evals match.</p>}
          {groups.map((g) => {
            const p = g.property;
            const contacts = [
              (p.manager_name || p.manager_phone) && `Manager: ${[p.manager_name, displayPhone(p.manager_phone)].filter(Boolean).join(' · ')}`,
              (p.maint_name || p.maint_phone) && `Maintenance: ${[p.maint_name, displayPhone(p.maint_phone)].filter(Boolean).join(' · ')}`,
            ].filter(Boolean);
            return (
              <section key={p.id} className="card ev-group">
                <div className="ev-group-head">
                  <div className="ev-group-title">
                    <h3>{p.name}</h3>
                    <span className="meta">{g.count} eval{g.count === 1 ? '' : 's'}{g.count > 0 && ` · ${centsText(g.totalCents)}`}</span>
                  </div>
                  {p.id !== 'none' && (
                    <div className="row">
                      <button type="button" className="secondary small" onClick={() => createEval(p)}>Add eval</button>
                      <button type="button" className="secondary small" onClick={() => setPropForm({ property: p, thenEval: false })}>Edit property</button>
                    </div>
                  )}
                </div>
                {(p.address || contacts.length > 0) && <p className="meta ev-group-meta">{[p.address, ...contacts].filter(Boolean).join('   ')}</p>}
                {g.evals.length === 0 && <p className="muted ev-none">No evals yet.</p>}
                {g.evals.map((e) => {
                  const d = cleanEval(e.data);
                  return (
                    <button key={e.id} type="button" className="ev-row" onClick={() => setOpenId(e.id)}>
                      <span className="ev-row-main">
                        <b>{evalRowTitle(e)}</b>
                        <span className="muted">{[dayText(e), d.replacement ? 'Replacement needed' : '', e.job_id ? 'On a work order' : ''].filter(Boolean).join(' · ') || fmtDateTime(e.created_at)}</span>
                      </span>
                      <span className={`badge ev-s-${e.status}`}>{EVAL_STATUSES[e.status]}</span>
                      <b className="ev-row-total">{e.total_cents > 0 ? centsText(e.total_cents) : ''}</b>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </>
      )}

      {propForm && (
        <PropertyForm key={propForm.property?.id || 'new'} open property={propForm.property} onClose={() => setPropForm(null)}
          onSaved={(saved) => {
            mergeProperty(saved);
            const next = propForm;
            setPropForm(null);
            if (next.thenEval) createEval(saved);
          }} />
      )}

      <PopupModal open={chooser} onClose={() => setChooser(false)} title="New eval for which property?">
        <div className="ev-choose">
          {properties.map((p) => (
            <button key={p.id} type="button" className="secondary ev-choose-btn" onClick={() => { setChooser(false); createEval(p); }}>
              <b>{p.name}</b>{p.address && <span className="muted">{p.address}</span>}
            </button>
          ))}
          <button type="button" className="secondary ev-choose-btn" onClick={() => { setChooser(false); setPropForm({ property: null, thenEval: true }); }}>
            <b>+ Add a new property</b>
          </button>
        </div>
      </PopupModal>
    </div>
  );
}
