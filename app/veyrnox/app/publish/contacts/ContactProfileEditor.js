'use client';
import { useI18n } from '../../../../../components/I18nProvider';

import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { useState } from 'react';

const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';

export default function ContactProfileEditor({ contact, editable, onSave }) {
  const { t } = useI18n();
  const [tags, setTags] = useState((contact.tags || []).join(', '));
  const [status, setStatus] = useState(contact.subscription_status || 'unknown');
  const [notes, setNotes] = useState(contact.notes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  if (!editable) return <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
    <p><strong>{t("app.publish.contactProfile.consent")}</strong> <span className="capitalize">{tOr(t, `app.publish.contactProfile.status.${status}`, status)}</span></p>
    <p><strong>{t("app.publish.contactProfile.tagsLabel")}</strong> {tags || t("app.publish.contactProfile.none")}</p>
    {notes && <p className="sm:col-span-2"><strong>{t("app.publish.contactProfile.notesLabel")}</strong> {notes}</p>}
  </div>;

  async function save() {
    const normalized = [...new Set(tags.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length > 10 || normalized.some((value) => value.length > 32 || !/^[a-z0-9][a-z0-9 _-]*$/.test(value))) {
      setError(t("app.publish.contactProfile.limit")); return;
    }
    setSaving(true); setSaved(false); setError('');
    try { await onSave({ tags: normalized, subscriptionStatus: status, notes }); setTags(normalized.join(', ')); setSaved(true); }
    catch { setError(t("app.publish.contactProfile.failed")); }
    finally { setSaving(false); }
  }

  return <div className="mt-4 grid gap-3 sm:grid-cols-2">
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.contactImport.consent")}<select className={input} value={status} onChange={(event) => { setStatus(event.target.value); setSaved(false); }}>
        <option value="unknown">{t("app.publish.contacts.unknown")}</option><option value="subscribed">{t("app.publish.contacts.subscribed")}</option><option value="unsubscribed">{t("app.publish.contacts.unsubscribed")}</option>
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.contactProfile.tags")}<input className={input} value={tags} maxLength={329} placeholder={t("app.publish.contactProfile.example")} onChange={(event) => { setTags(event.target.value); setSaved(false); }} />
    </label>
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted sm:col-span-2">{t("app.publish.contactImport.notes")}<textarea className={`${input} min-h-24 resize-y`} value={notes} maxLength={2000} placeholder={t("app.publish.contactProfile.context")} onChange={(event) => { setNotes(event.target.value); setSaved(false); }} />
    </label>
    <div className="flex items-center gap-3 sm:col-span-2">
      <button type="button" className={button} disabled={saving} onClick={save}>{saving ? t("social.saving") : t("app.publish.contactProfile.save")}</button>
      {saved && <span role="status" className="text-sm font-bold text-vx-success">{t("cinema.socialCinema.saved")}</span>}
      {error && <span role="alert" className="text-sm text-vx-danger">{error}</span>}
    </div>
  </div>;
}
