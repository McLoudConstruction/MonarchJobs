'use client';

import { useMemo, useState } from 'react';
import PopupModal from '@/components/PopupModal';
import PhotoAttach from '@/components/job/PhotoAttach';
import { PhotoGrid } from '@/components/job/PhotoUi';
import { getSupabase } from '@/lib/supabaseClient';
import { INTERNAL_CATEGORIES } from '@/lib/jobDocs';
import { fmtDateTime } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { apiFetch } from '@/lib/useAuth';

const blank = (kind) => ({ id: null, kind, category: kind === 'internal' ? INTERNAL_CATEGORIES[0] : '', title: '', body: '', next_steps: '', photo_ids: [] });

function SendDialog({ update, recipients, token, jobId, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function send(manual) {
    setBusy(true);
    setErr('');
    try {
      const body = await apiFetch(`/api/jobs/${jobId}/updates/${update.id}/send`, token, { method: 'POST', body: JSON.stringify({ manual }) });
      setResult(body);
      if (body.ok) await onDone();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  async function copy(link) {
    try { await navigator.clipboard.writeText(link); setErr(''); } catch { setErr('Could not copy. Select the link and copy it.'); }
  }

  return (
    <PopupModal open onClose={onClose} title={result?.ok ? 'Update sent' : 'Send to customer'}>
      {!result && (
        <>
          <p className="hint">The customer gets a text and an email with a link to this update and its photos. They do not need to sign in.</p>
          {recipients.length === 0 && <div className="msg err">No customer or contact has a mobile number or email on file. Add one, or use "I will send it myself" below.</div>}
          {recipients.map((r, i) => (
            <div key={i} className="list-item"><div className="title">{r.name || 'Contact'}</div><div className="meta">{[r.phone && displayPhone(r.phone), r.email].filter(Boolean).join(' · ')}</div></div>
          ))}
          {err && <div className="msg err">{err}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="primary" disabled={busy || recipients.length === 0} onClick={() => send(false)}>{busy ? 'Sending...' : 'Send now'}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => send(true)}>I will send it myself</button>
            <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
      {result && (
        <>
          {result.ok && !result.manual && <div className="msg ok">Sent.</div>}
          {result.ok && result.manual && <div className="msg ok">Marked as sent. Share this link with the customer yourself.</div>}
          {!result.ok && <div className="msg err">Nothing was delivered, so the update is still a draft. Check Settings &gt; Integrations, or use "I will send it myself".</div>}
          {(result.results || []).map((r, i) => (
            <div key={i} className="list-item">
              <div className="title">{r.name || 'Contact'}</div>
              <div className="meta">Text: {r.sms.detail || r.sms.status} · Email: {r.email.detail || r.email.status}</div>
            </div>
          ))}
          {result.ok && result.link && (
            <div className="field"><label>Link</label>
              <input readOnly value={result.link} onFocus={(e) => e.target.select()} />
              <div className="row" style={{ marginTop: 6 }}><button type="button" className="secondary small" onClick={() => copy(result.link)}>Copy link</button></div>
            </div>
          )}
          {err && <div className="msg err">{err}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            {!result.ok && <button type="button" className="secondary" onClick={() => setResult(null)}>Back</button>}
            <button type="button" className="primary" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </PopupModal>
  );
}

// Updates tab. Internal notes are for staff only. Progress updates are written for the customer:
// saved as a draft, then sent as a link by text and email.
export default function UpdatesTab({ jobId, updates, photos, isOffice, staff, token, authorName, logEvent, onReload, uploader, onOpenPhotos, recipients, baseUrl }) {
  const [mode, setMode] = useState('internal'); // internal | progress
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(null);
  const [copied, setCopied] = useState('');

  const counts = useMemo(() => ({
    internal: updates.filter((u) => u.kind === 'internal').length,
    progress: updates.filter((u) => u.kind === 'progress').length,
  }), [updates]);
  const list = useMemo(
    () => updates.filter((u) => u.kind === mode).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [updates, mode],
  );
  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const canEdit = (u) => u.status !== 'sent' && (isOffice || u.created_by === staff.id);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function openNew(kind, seed = {}) {
    setMode(kind);
    setErr('');
    setForm({ ...blank(kind), ...seed });
  }

  async function save(e) {
    e.preventDefault();
    setErr('');
    const body = form.body.trim();
    if (!body && form.photo_ids.length === 0) { setErr('Write something or add a photo first.'); return; }
    setSaving(true);
    const sb = getSupabase();
    const fields = {
      category: form.kind === 'internal' ? form.category : '',
      title: form.kind === 'progress' ? form.title.trim() : '',
      body,
      next_steps: form.kind === 'progress' ? form.next_steps.trim() : '',
      photo_ids: form.photo_ids,
    };
    let error;
    if (form.id) {
      ({ error } = await sb.from('job_updates').update(fields).eq('id', form.id));
    } else {
      ({ error } = await sb.from('job_updates').insert({
        job_id: jobId, kind: form.kind, status: form.kind === 'internal' ? 'posted' : 'draft', ...fields,
      }));
      if (!error) await logEvent(form.kind === 'internal' ? 'update_posted' : 'progress_update_saved', { category: fields.category });
    }
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setForm(null);
    await onReload();
  }

  async function remove(u) {
    if (!window.confirm(u.kind === 'internal' ? 'Delete this internal update? The photos stay on the job.' : 'Delete this draft? The photos stay on the job.')) return;
    const { error } = await getSupabase().from('job_updates').delete().eq('id', u.id);
    if (error) { setErr(error.message); return; }
    await logEvent('update_deleted', { kind: u.kind });
    await onReload();
  }

  async function copyLink(u) {
    const link = `${baseUrl}/u/${u.share_token}`;
    try { await navigator.clipboard.writeText(link); setCopied(u.id); setTimeout(() => setCopied(''), 2000); } catch { window.prompt('Copy this link:', link); }
  }

  return (
    <>
      <div className="seg" role="tablist" aria-label="Update type">
        <button type="button" role="tab" aria-selected={mode === 'internal'} className={mode === 'internal' ? 'on' : ''} onClick={() => setMode('internal')}>Internal notes ({counts.internal})</button>
        <button type="button" role="tab" aria-selected={mode === 'progress'} className={mode === 'progress' ? 'on' : ''} onClick={() => setMode('progress')}>Progress updates ({counts.progress})</button>
      </div>

      {!form && (
        <div className="card">
          {mode === 'internal' ? (
            <>
              <h2>Internal notes</h2>
              <p className="hint">Quick notes and photos for the team. Customers never see these.</p>
              <button type="button" className="primary" onClick={() => openNew('internal')}>New internal note</button>
            </>
          ) : (
            <>
              <h2>Progress updates</h2>
              <p className="hint">Tell the customer how the job is going, with photos. Save a draft, then send it as a link by text and email.</p>
              <button type="button" className="primary" onClick={() => openNew('progress')}>New progress update</button>
            </>
          )}
        </div>
      )}

      {form && (
        <form className="card" onSubmit={save}>
          <h2>{form.id ? 'Edit' : 'New'} {form.kind === 'internal' ? 'internal note' : 'progress update'}</h2>
          {form.kind === 'internal' ? (
            <>
              <div className="field"><label>Category</label>
                <select value={form.category} onChange={set('category')}>
                  {INTERNAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  {form.category && !INTERNAL_CATEGORIES.includes(form.category) && <option value={form.category}>{form.category}</option>}
                </select>
              </div>
              <div className="field"><label>Note</label><textarea value={form.body} onChange={set('body')} maxLength={5000} placeholder="What happened, what you found, what is needed" /></div>
            </>
          ) : (
            <>
              <div className="field"><label>Title (optional)</label><input value={form.title} onChange={set('title')} maxLength={120} placeholder="Progress update" /></div>
              <div className="field"><label>What we did</label><textarea value={form.body} onChange={set('body')} maxLength={5000} placeholder="Written for the customer: plain words, no shorthand" /></div>
              <div className="field"><label>What happens next (optional)</label><textarea value={form.next_steps} onChange={set('next_steps')} maxLength={2000} placeholder="Next visit, drying check, what we need from you" /></div>
            </>
          )}
          <PhotoAttach photos={photos} ids={form.photo_ids} onChange={(photo_ids) => setForm((f) => ({ ...f, photo_ids }))} uploader={uploader} onOpen={onOpenPhotos} />
          {err && <div className="msg err">{err}</div>}
          <div className="row">
            <button className="primary" disabled={saving || uploader.busy}>{saving ? 'Saving...' : form.kind === 'internal' ? (form.id ? 'Save changes' : 'Post note') : 'Save draft'}</button>
            <button type="button" className="secondary" onClick={() => { setForm(null); setErr(''); }}>Cancel</button>
          </div>
        </form>
      )}

      {!form && err && <div className="msg err">{err}</div>}

      <div className="card">
        <h2>{mode === 'internal' ? 'Notes' : 'Updates'}</h2>
        {list.map((u) => {
          const pics = (u.photo_ids || []).map((i) => photoById.get(i)).filter(Boolean);
          return (
            <div key={u.id} className="list-item update-item">
              <div className="title">
                {u.kind === 'internal'
                  ? <span className="badge off">{u.category || 'Note'}</span>
                  : <><span className={`badge ${u.status === 'sent' ? 'live' : 'off'}`}>{u.status === 'sent' ? 'Sent' : 'Draft'}</span> {u.title || 'Progress update'}</>}
              </div>
              <div className="meta">{fmtDateTime(u.created_at)} · {authorName(u.created_by) || 'staff'}</div>
              {u.body && <p className="update-body">{u.body}</p>}
              {u.next_steps && <p className="update-body"><strong>Next:</strong> {u.next_steps}</p>}
              {pics.length > 0 && <PhotoGrid photos={pics} onOpen={(p) => onOpenPhotos(pics, p.id)} />}
              {u.kind === 'progress' && u.status === 'sent' && (
                <div className="meta" style={{ marginTop: 6 }}>
                  Sent {fmtDateTime(u.sent_at)}{u.delivery?.manual ? ' (by hand)' : ''} · {u.view_count ? `viewed ${u.view_count} time${u.view_count === 1 ? '' : 's'}, last ${fmtDateTime(u.last_viewed_at)}` : 'not viewed yet'}
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                {canEdit(u) && <button type="button" className="secondary small" onClick={() => { setMode(u.kind); setErr(''); setForm({ id: u.id, kind: u.kind, category: u.category, title: u.title, body: u.body, next_steps: u.next_steps, photo_ids: u.photo_ids || [] }); }}>Edit</button>}
                {canEdit(u) && <button type="button" className="danger small" onClick={() => remove(u)}>Delete</button>}
                {u.kind === 'internal' && <button type="button" className="secondary small" onClick={() => openNew('progress', { body: u.body, photo_ids: u.photo_ids || [] })}>Use in a progress update</button>}
                {u.kind === 'progress' && u.status === 'draft' && isOffice && <button type="button" className="primary small" onClick={() => setSending(u)}>Send to customer</button>}
                {u.kind === 'progress' && u.status === 'sent' && <button type="button" className="secondary small" onClick={() => copyLink(u)}>{copied === u.id ? 'Copied' : 'Copy link'}</button>}
                {u.kind === 'progress' && u.status === 'sent' && isOffice && <button type="button" className="secondary small" onClick={() => setSending(u)}>Send again</button>}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="muted">{mode === 'internal' ? 'No internal notes yet.' : 'No progress updates yet.'}</p>}
      </div>

      {sending && (
        <SendDialog update={sending} recipients={recipients} token={token} jobId={jobId} onClose={() => setSending(null)} onDone={onReload} />
      )}
    </>
  );
}
