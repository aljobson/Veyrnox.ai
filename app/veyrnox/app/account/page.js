'use client';
import { useI18n } from '../../../../components/I18nProvider';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { MfaPanel } from '../../_components/MfaPanel';
import { PasskeyPanel } from '../../_components/PasskeyPanel';
import { ReferralPanel } from '../../_components/ReferralPanel';
import { OAuthGrantsPanel } from '../../_components/OAuthGrantsPanel';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { DeleteAccountPanel } from '../../_components/DeleteAccountPanel';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient';
import { requestPasswordCode, changePassword, revokeSessions } from '../../../lib/accountSecurity';

const currentAccount = () => getStoredUserId() || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';

export default function Account() {
  const { t } = useI18n();
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
    <h1 className="text-3xl font-black mb-6">{t("label.Account & security")}</h1>
    {account ? <AccountControls key={account} /> : <div className="text-vx-fg-body">
      <p className="mb-4">{t("app.account.signInHelp")}</p>
      <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button>
    </div>}
  </Main></>;
}
function AccountControls() {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [nonce, setNonce] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  async function run(action, success) {
    setBusy(true); setMessage(''); setError('');
    try { await action(); setMessage(success); }
    catch { setError(t("app.account.actionFailed")); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-2">{t("app.account.billing")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.account.billingHelp")}</p>
      <Link href="/app/credits#credit-subscriptions" className={button}>{t("app.account.manageBilling")}</Link>
    </section>
    <MfaPanel />
    <PasskeyPanel />
    <OAuthGrantsPanel />
    <ReferralPanel />
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 data-testid="account-password-heading" className="font-bold mb-2">{t("app.account.setPassword")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.account.passwordHelp")}</p>
      <button type="button" disabled={busy} className={button} onClick={() => run(requestPasswordCode, t("app.account.checkEmail"))}>{t("app.account.emailCode")}</button>
      <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); run(async () => { await changePassword(password, nonce); setPassword(''); setNonce(''); }, t("app.account.passwordUpdated")); }}>
        <label className="block text-sm">{t("app.account.newPassword")}<input data-testid="account-new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} className="block w-full rounded-lg border border-vx-border bg-vx-panel p-3 mt-1" /></label>
        <label className="block text-sm">{t("app.account.verificationCode")}<input data-testid="account-verification-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,10}" value={nonce} onChange={e => setNonce(e.target.value.trim())} className="block w-full rounded-lg border border-vx-border bg-vx-panel p-3 mt-1" /></label>
        <button data-testid="account-update-password" type="submit" disabled={busy} className={button}>{t("app.account.updatePassword")}</button>
      </form>
    </section>
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-2">{t("app.account.devices")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.account.devicesHelp")}</p>
      <div className="flex flex-wrap gap-3">
        <button data-testid="account-sign-out-others" type="button" disabled={busy} className={button} onClick={() => setConfirm('others')}>{t("app.account.signOutOthers")}</button>
        <button type="button" disabled={busy} className={button} onClick={() => setConfirm('global')}>{t("app.account.signOutEverywhere")}</button>
      </div>
    </section>
    {message && <p role="status" className="text-sm text-vx-accent">{message}</p>}
    {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-2">{t("app.account.contentDecisions")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.account.contentHelp")}</p>
      <div className="flex flex-wrap gap-4 text-sm underline">
        <a href="/app/account/appeals">{t("app.account.appeals")}</a>
        <a href="/app/account/report">{t("app.account.report")}</a>
      </div>
    </section>
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-2">{t("app.account.data")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.account.exportHelp")}</p>
      <div className="flex flex-wrap gap-4 text-sm underline">
        <a href="mailto:privacy@veyrnox.com?subject=Veyrnox.ai%20data%20export%20request">{t("app.account.export")}</a>
        <a href="/legal/privacy">{t("label.Privacy Policy")}</a>
      </div>
    </section>
    <DeleteAccountPanel />
    {confirm && <ConfirmDialog title={confirm === 'global' ? t("app.account.signOutEverywhereConfirm") : t("app.account.signOutOthersConfirm")} body={t("app.account.signOutHelp")} confirmLabel={t("public.account.signOut")} onCancel={() => setConfirm(null)} onConfirm={() => { const scope = confirm; setConfirm(null); run(() => revokeSessions(scope), t("app.account.sessionsEnded")); }} />}
  </div>;
}
