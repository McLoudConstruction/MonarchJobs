'use client';
import { useRef, useState } from 'react';
import { apiFetch } from '@/lib/useAuth';
import { shrinkToAvatar } from '@/lib/avatarClient';

// Round picture, or the person's initials when there is none.
export function AvatarCircle({ url, initials, className = '' }) {
  return <span className={className}>{url ? <img src={url} alt="" className="avatar-img" /> : initials}</span>;
}

// "Change photo" and "Remove photo" for your own account. onChanged(newPath | null) tells the shell.
export default function ProfilePhotoControl({ hasPhoto, onChanged, itemClass = 'shell-account-item' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setMsg('');
    try {
      const blob = await shrinkToAvatar(f);
      const fd = new FormData();
      fd.append('file', new File([blob], 'me.jpg', { type: 'image/jpeg' }));
      const r = await apiFetch('/api/account/photo', '', { method: 'POST', body: fd });
      onChanged(r.avatar_path);
    } catch (err) { setMsg(err.message || 'The picture did not save.'); }
    setBusy(false);
  }
  async function remove() {
    setBusy(true); setMsg('');
    try { await apiFetch('/api/account/photo', '', { method: 'DELETE' }); onChanged(null); }
    catch (err) { setMsg(err.message || 'Could not remove it.'); }
    setBusy(false);
  }
  return (
    <>
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
      <button type="button" role="menuitem" className={itemClass} disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Saving...' : hasPhoto ? 'Change my photo' : 'Add my photo'}</button>
      {hasPhoto && <button type="button" role="menuitem" className={itemClass} disabled={busy} onClick={remove}>Remove my photo</button>}
      {msg && <div className="msg err" style={{ margin: '4px 12px' }}>{msg}</div>}
    </>
  );
}
