'use client';

import { useState } from 'react';

const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';

export default function ContactProfileEditor({ contact, editable, onSave }) {
  const [tags, setTags] = useState((contact.tags || []).join(', '));
  const [status, setStatus] = useState(contact.subscription_status || 'unknown');
  const [notes, setNotes] = useState(contact.notes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  if (!editable) return <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
    <p><strong>Consent status:</strong> <span className="capitalize">{status}</span></p>
    <p><strong>Tags:</strong> {tags || 'None'}</p>
    {notes && <p className="sm:col-span-2"><strong>Private notes:</strong> {notes}</p>}
  </div>;

  async function save() {
    const normalized = [...new Set(tags.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length > 10 || normalized.some((value) => value.length > 32 || !/^[a-z0-9][a-z0-9 _-]*$/.test(value))) {
      setError('Use up to 10 tags with letters, numbers, spaces, hyphens or underscores.'); return;
    }
    setSaving(true); setSaved(false); setError('');
    try { await onSave({ tags: normalized, subscriptionStatus: status, notes }); setTags(normalized.join(', ')); setSaved(true); }
    catch { setError('Could not save this contact. Try again.'); }
    finally { setSaving(false); }
  }

  return <div className="mt-4 grid gap-3 sm:grid-cols-2">
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Consent status
      <select className={input} value={status} onChange={(event) => { setStatus(event.target.value); setSaved(false); }}>
        <option value="unknown">Unknown</option><option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed</option>
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Tags
      <input className={input} value={tags} maxLength={329} placeholder="customer, vip" onChange={(event) => { setTags(event.target.value); setSaved(false); }} />
    </label>
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted sm:col-span-2">Private notes
      <textarea className={`${input} min-h-24 resize-y`} value={notes} maxLength={2000} placeholder="Context for your team" onChange={(event) => { setNotes(event.target.value); setSaved(false); }} />
    </label>
    <div className="flex items-center gap-3 sm:col-span-2">
      <button type="button" className={button} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save contact'}</button>
      {saved && <span role="status" className="text-sm font-bold text-vx-success">Saved</span>}
      {error && <span role="alert" className="text-sm text-vx-danger">{error}</span>}
    </div>
  </div>;
}
