'use client';
import { useI18n } from '../../../../../components/I18nProvider';

import { pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useState } from 'react';
import { parseContactCsv } from '../../../../../lib/social/contactCsv';

const INPUT_MODES = ['manual', 'csv'];
const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';

export default function ContactImportPanel({ accounts, onImport }) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState('manual');
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [externalId, setExternalId] = useState(''); const [name, setName] = useState('');
  const [tags, setTags] = useState(''); const [subscriptionStatus, setSubscriptionStatus] = useState('unknown');
  const [notes, setNotes] = useState(''); const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault(); setError(''); setMessage('');
    if (!accountId) { setError(t("app.publish.contactImport.accountRequired")); return; }
    let contacts;
    try {
      if (mode === 'csv') {
        if (!file || file.size > 32768) throw new Error(t("app.publish.contactImport.fileSize"));
        contacts = parseContactCsv(await file.text());
      } else {
        contacts = [{ externalId: externalId.trim(), name: name.trim(),
          tags: [...new Set(tags.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))],
          subscriptionStatus, notes: notes.trim() }];
      }
      setBusy(true); const result = await onImport(accountId, contacts, mode);
      setMessage(t(pluralKey(t, locale, 'app.publish.contactImport.imported', result.imported), { count: locale === 'en' ? String(result.imported) : new Intl.NumberFormat(localeTag(locale)).format(result.imported) }));
      if (mode === 'manual') { setExternalId(''); setName(''); setTags(''); setSubscriptionStatus('unknown'); setNotes(''); }
      else setFile(null);
    } catch (nextError) { setError(nextError?.message || t("app.publish.contactImport.failed")); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-vx-border p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">{t("app.publish.contactImport.title")}</h2>
      <p className="mt-1 text-sm text-vx-fg-muted">{t("app.publish.contactImport.help")}</p></div>
      <div role="group" aria-label={t("app.publish.contactImport.method")} className="flex gap-2">
        {INPUT_MODES.map((item) => <button type="button" key={item} className={`${button} ${mode === item ? 'border-vx-accent bg-vx-accent text-black' : ''}`}
          aria-pressed={mode === item} onClick={() => { setMode(item); setError(''); setMessage(''); }}>{item === 'manual' ? t("app.publish.contactImport.one") : t("app.publish.contactImport.csv")}</button>)}
      </div></div>
    <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
      <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.contactImport.account")}<select className={input} required value={accountId} onChange={(event) => setAccountId(event.target.value)}>
        <option value="">{t("app.publish.contactImport.choose")}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
      </select></label>
      {mode === 'manual' ? <>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.contactImport.handle")}<input className={input} required maxLength={256} value={externalId} onChange={(event) => setExternalId(event.target.value)} /></label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.autolists.name")}<input className={input} required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.contactImport.consent")}<select className={input} value={subscriptionStatus} onChange={(event) => setSubscriptionStatus(event.target.value)}>
          <option value="unknown">{t("app.publish.contacts.unknown")}</option><option value="subscribed">{t("app.publish.contacts.subscribed")}</option><option value="unsubscribed">{t("app.publish.contacts.unsubscribed")}</option>
        </select></label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted sm:col-span-2">{t("app.publish.inbox.tagsHint")}<input className={input} value={tags} maxLength={329} onChange={(event) => setTags(event.target.value)} /></label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted sm:col-span-2">{t("app.publish.contactImport.notes")}<textarea className={`${input} min-h-20 resize-y`} value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} /></label>
      </> : <div className="sm:col-span-2"><label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.contactImport.file")}<input type="file" accept=".csv,text/csv" required className={input}
        onChange={(event) => { setFile(event.target.files?.[0] || null); setError(''); setMessage(''); }} /></label>
        <p className="mt-2 text-xs text-vx-fg-muted">{t("app.publish.contactImport.headers")}</p></div>}
      <div className="flex items-center gap-3 sm:col-span-2"><button type="submit" disabled={busy} className={button}>{busy ? t("app.publish.contactImport.importing") : mode === 'manual' ? t("app.publish.contactImport.add") : t("app.publish.contactImport.import")}</button>
        {message && <span role="status" className="text-sm font-bold text-vx-success">{message}</span>}{error && <span role="alert" className="text-sm text-vx-danger">{error}</span>}</div>
    </form>
  </section>;
}
