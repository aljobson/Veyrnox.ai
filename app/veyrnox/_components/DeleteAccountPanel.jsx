'use client';
import { useI18n } from '../../../components/I18nProvider';

import { tOr, pluralKey } from '../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { signOut } from '../../lib/authClient';
import { BLOCKER_COPY, prepareDeletion, confirmDeletion } from '../_lib/accountDeletion';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const UNKNOWN_BLOCKER = 'unknown';
const RETRYABLE = new Set(['deletion_incomplete', 'deletion_unavailable', 'network_error', 'gateway_error']);

export function DeleteAccountPanel() {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  async function start() {
    setBusy(true); setError(''); setTyped('');
    try { setPlan(await prepareDeletion()); }
    catch (err) {
      setError(err.code === 'rate_limited' ? t("app.account.delete.limited") : t("app.account.delete.checkFailed"));
    } finally { setBusy(false); }
  }

  async function erase() {
    setBusy(true); setError('');
    try {
      await confirmDeletion(plan.token);
      await signOut();
      window.location.assign('/');
    } catch (err) {
      if (err.code === 'confirmation_expired' || err.code === 'confirmation_invalid') { setPlan(null); setError(t("app.account.delete.expired")); }
      else if (err.code === 'deletion_blocked') setPlan({ state: 'blocked', blockers: err.body?.blockers || [], credits: plan.credits });
      else setError(RETRYABLE.has(err.code) ? t("app.account.delete.incomplete") : t("app.account.delete.failed"));
      setBusy(false);
    }
  }

  const ready = plan?.state === 'ready';
  return <section className="rounded-2xl border border-vx-danger/50 p-5">
    <h2 className="font-bold mb-2">{t("app.account.delete.title")}</h2>
    <p className="text-sm text-vx-fg-muted mb-4">{t("app.account.delete.policy")}</p>
    <button type="button" disabled={busy} className={button} onClick={start}>{t("app.account.delete.start")}</button>
    {plan?.state === 'unavailable' && <p role="status" className="mt-4 text-sm text-vx-fg-body">{t("app.account.delete.emailBefore")}<a className="underline" href="mailto:privacy@veyrnox.com?subject=Veyrnox.ai%20account%20deletion%20request">{t("app.account.delete.email")}</a>{t("app.account.delete.emailAfter")}</p>}
    {plan?.state === 'blocked' && <div role="status" className="mt-4 text-sm text-vx-fg-body">
      <p className="mb-2">{t("app.account.delete.blocked")}</p>
      <ul className="list-disc ps-5 space-y-1">{(plan.blockers.length ? plan.blockers : [UNKNOWN_BLOCKER]).map(b => <li key={b}>{tOr(t, `app.account.delete.blocker.${b}`, BLOCKER_COPY[b] || t('app.account.delete.help'))}</li>)}</ul>
    </div>}
    {error && <p role="alert" className="mt-4 text-sm text-vx-danger">{error}</p>}
    {ready && <ConfirmDialog tone="danger" title={t("app.account.delete.confirm")} confirmLabel={busy ? t("app.account.delete.deleting") : t("app.account.delete.action")}
      body={<>{t("app.account.delete.undo")}{plan.credits > 0 ? t(pluralKey(t, locale, 'app.account.delete.lose', plan.credits), {count: plan.credits.toLocaleString(localeTag(locale))}) : ''}{t("app.account.delete.type")}<input aria-label={t("app.account.delete.typeLabel")} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" className="block w-full rounded-lg border border-vx-border bg-vx-panel p-3 mt-3" /></>}
      onCancel={() => { if (!busy) setPlan(null); }}
      onConfirm={() => { if (typed.trim() === 'DELETE' && !busy) erase(); }} />}
  </section>;
}
