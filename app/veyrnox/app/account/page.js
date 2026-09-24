'use client';
import { useState, useSyncExternalStore } from 'react';
import { AppNav } from '../../_components/NavBar';
import { MfaPanel } from '../../_components/MfaPanel';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { getSession, onSessionChange } from '../../../lib/authClient';
import { requestPasswordCode, changePassword, revokeSessions } from '../../../lib/accountSecurity';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';

export default function Account() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
    <h1 className="text-3xl font-black mb-6">Account & security</h1>
    {account ? <AccountControls key={account} /> : <div className="text-vx-fg-body">
      <p className="mb-4">Sign in to manage your account. If you forgot your password, use the email sign-in option, then return here to set a new password.</p>
      <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>
    </div>}
  </main></>;
}
function AccountControls() {
  const [password, setPassword] = useState('');
  const [nonce, setNonce] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  async function run(action, success) {
    setBusy(true); setMessage(''); setError('');
    try { await action(); setMessage(success); }
    catch { setError('That did not complete. Check your code and connection, then try again.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    <MfaPanel />
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-2">Set a new password</h2>
      <p className="text-sm text-vx-fg-muted mb-4">First request a verification code, then enter it with your new password.</p>
      <button type="button" disabled={busy} className={button} onClick={() => run(requestPasswordCode, 'Check your account email for a verification code.')}>Email me a code</button>
      <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); run(async () => { await changePassword(password, nonce); setPassword(''); setNonce(''); }, 'Password updated.'); }}>
        <label className="block text-sm">New password<input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} className="block w-full rounded-lg border border-vx-border bg-vx-panel p-3 mt-1" /></label>
        <label className="block text-sm">Email verification code<input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,10}" value={nonce} onChange={e => setNonce(e.target.value.trim())} className="block w-full rounded-lg border border-vx-border bg-vx-panel p-3 mt-1" /></label>
        <button type="submit" disabled={busy} className={button}>Update password</button>
      </form>
    </section>
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-2">Signed-in devices</h2>
      <p className="text-sm text-vx-fg-muted mb-4">End other sign-ins, or sign out everywhere. Other devices may retain access until their current access expires.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} className={button} onClick={() => setConfirm('others')}>Sign out other devices</button>
        <button type="button" disabled={busy} className={button} onClick={() => setConfirm('global')}>Sign out everywhere</button>
      </div>
    </section>
    {message && <p role="status" className="text-sm text-vx-accent">{message}</p>}
    {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-2">Your data</h2>
      <p className="text-sm text-vx-fg-muted mb-4">Request an export or account deletion by email. These links open a draft; your request is submitted when you send it. Replies and progress arrive by email. Some payment records must be retained as described in our Privacy Policy.</p>
      <div className="flex flex-wrap gap-4 text-sm underline">
        <a href="mailto:privacy@veyrnox.com?subject=Veyrnox.ai%20data%20export%20request">Request data export</a>
        <a href="mailto:privacy@veyrnox.com?subject=Veyrnox.ai%20account%20deletion%20request">Request account deletion</a>
        <a href="/legal/privacy">Privacy Policy</a>
      </div>
    </section>
    {confirm && <ConfirmDialog title={confirm === 'global' ? 'Sign out everywhere?' : 'Sign out other devices?'} body="Those devices will need to sign in again. Your credits and library remain on your account." confirmLabel="Sign out" onCancel={() => setConfirm(null)} onConfirm={() => { const scope = confirm; setConfirm(null); run(() => revokeSessions(scope), 'Other sign-ins have been ended.'); }} />}
  </div>;
}
