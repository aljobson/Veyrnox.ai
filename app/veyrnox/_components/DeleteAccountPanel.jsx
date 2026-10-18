'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from './ConfirmDialog';
import { signOut } from '../../lib/authClient';
import { BLOCKER_COPY, prepareDeletion, confirmDeletion } from '../_lib/accountDeletion';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const RETRYABLE = new Set(['deletion_incomplete', 'deletion_unavailable', 'network_error', 'gateway_error']);

export function DeleteAccountPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  async function start() {
    setBusy(true); setError(''); setTyped('');
    try { setPlan(await prepareDeletion()); }
    catch (err) {
      setError(err.code === 'rate_limited' ? 'Too many attempts. Wait a while and try again.' : 'We could not check your account. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  async function erase() {
    setBusy(true); setError('');
    try {
      await confirmDeletion(plan.token);
      await signOut();
      router.replace('/');
    } catch (err) {
      if (err.code === 'confirmation_expired' || err.code === 'confirmation_invalid') { setPlan(null); setError('That confirmation expired. Start again.'); }
      else if (err.code === 'deletion_blocked') setPlan({ state: 'blocked', blockers: err.body?.blockers || [], credits: plan.credits });
      else setError(RETRYABLE.has(err.code) ? 'Deletion did not finish. Press Delete my account again to complete it.' : 'That did not complete. Try again.');
      setBusy(false);
    }
  }

  const ready = plan?.state === 'ready';
  return <section className="rounded-2xl border border-vx-danger/50 p-5">
    <h2 className="font-bold mb-2">Delete account</h2>
    <p className="text-sm text-vx-fg-muted mb-4">Permanently delete your account, library, chats and Publish connections. Unused Credits are forfeited and nothing is refunded. Payment records we must keep (see our Privacy Policy) stay without your name.</p>
    <button type="button" disabled={busy} className={button} onClick={start}>Delete my account…</button>
    {plan?.state === 'unavailable' && <p role="status" className="mt-4 text-sm text-vx-fg-body">In-app deletion is not switched on yet. Email <a className="underline" href="mailto:privacy@veyrnox.com?subject=Veyrnox.ai%20account%20deletion%20request">privacy@veyrnox.com</a> and we will delete it for you.</p>}
    {plan?.state === 'blocked' && <div role="status" className="mt-4 text-sm text-vx-fg-body">
      <p className="mb-2">We cannot delete your account yet:</p>
      <ul className="list-disc pl-5 space-y-1">{(plan.blockers.length ? plan.blockers : ['unknown']).map(b => <li key={b}>{BLOCKER_COPY[b] || 'Contact support@veyrnox.com for help.'}</li>)}</ul>
    </div>}
    {error && <p role="alert" className="mt-4 text-sm text-vx-danger">{error}</p>}
    {ready && <ConfirmDialog tone="danger" title="Delete your account?" confirmLabel={busy ? 'Deleting…' : 'Delete my account'}
      body={<>This cannot be undone. {plan.credits > 0 ? `You will lose ${plan.credits.toLocaleString()} Credits. ` : ''}Type DELETE to confirm.
        <input aria-label="Type DELETE to confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" className="block w-full rounded-lg border border-vx-border bg-vx-panel p-3 mt-3" /></>}
      onCancel={() => { if (!busy) setPlan(null); }}
      onConfirm={() => { if (typed.trim() === 'DELETE' && !busy) erase(); }} />}
  </section>;
}
