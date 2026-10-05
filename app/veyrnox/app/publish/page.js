'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../_components/NavBar';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { getSession, onSessionChange } from '../../../lib/authClient';
import {
  NETWORKS, listSocialAccounts, connectNetwork, disconnectSocialAccount,
} from '../../../lib/socialConnectClient';
import { Composer, ScheduledPosts } from './Composer';
import { DraftReview } from './DraftReview';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const noJob = () => null;
const currentJob = () => new URLSearchParams(window.location.search).get('job');
const subscribeLocation = (listener) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
// Free tier: one connected account (ADR-0063). The database enforces it (0169);
// this only saves a wasted OAuth round trip.
const FREE_ACCOUNT_LIMIT = 1;

export default function Publish() {
  const initialJobId = useSyncExternalStore(subscribeLocation, currentJob, noJob);
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><div className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
    <h1 className="text-3xl font-black mb-2">Veyrnox Publish</h1>
    <p className="text-sm text-vx-fg-muted mb-6">Connect your social accounts to schedule posts from Veyrnox. <Link href="/app/publish/analytics" className="text-vx-accent underline">See your analytics</Link></p>
    {account ? <PublishControls key={account} initialJobId={initialJobId} /> : <div className="text-vx-fg-body">
      <p className="mb-4">Sign in to connect a social account.</p>
      <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>
    </div>}
  </div></>;
}

function PublishControls({ initialJobId }) {
  const [accounts, setAccounts] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [connecting, setConnecting] = useState(null);
  const [connectError, setConnectError] = useState('');
  const [disconnecting, setDisconnecting] = useState(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(null);
  const [postsRefreshToken, setPostsRefreshToken] = useState(0);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await listSocialAccounts();
      setAccounts(res.accounts || []);
    } catch {
      setLoadError('Could not load your connected accounts. Check your connection and try again.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function onConnect(network) {
    setConnecting(network); setConnectError('');
    try {
      await connectNetwork(network); // navigates away on success; only returns on failure
    } catch {
      setConnectError(`Could not start connecting ${networkLabel(network)}. Check your connection and try again.`);
      setConnecting(null);
    }
  }

  async function onDisconnect(accountId) {
    setConfirmDisconnect(null);
    setDisconnecting(accountId);
    try {
      await disconnectSocialAccount(accountId);
      await load();
    } catch {
      setLoadError('Could not disconnect that account. Try again.');
    } finally {
      setDisconnecting(null);
    }
  }

  const active = (accounts || []).filter((a) => a.status === 'active');
  const byNetwork = new Map(active.map((a) => [a.network, a]));
  const atLimit = active.length >= FREE_ACCOUNT_LIMIT;

  return <div className="space-y-6">
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">Connected accounts</h2>
      {accounts === null && !loadError && <p className="text-sm text-vx-fg-muted">Loading…</p>}
      {loadError && <p role="alert" className="text-sm text-vx-danger mb-3">{loadError}</p>}
      {accounts !== null && active.length === 0 && !loadError && (
        <p className="text-sm text-vx-fg-muted">No accounts connected yet.</p>
      )}
      <ul className="space-y-3">
        {active.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-vx-border p-3">
            <div className="flex items-center gap-3 min-w-0">
              {a.avatar_url
                ? <img src={a.avatar_url} alt="" className="h-9 w-9 rounded-full shrink-0" />
                : <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-vx-panel text-vx-fg-muted text-xs font-bold shrink-0">
                    {networkLabel(a.network)[0]}
                  </span>}
              <div className="min-w-0">
                <div className="text-sm font-bold text-vx-fg truncate">{a.display_name || a.external_account_id}</div>
                <div className="text-xs text-vx-fg-muted">{networkLabel(a.network)} · {a.status}</div>
              </div>
            </div>
            <button
              type="button"
              disabled={disconnecting === a.id}
              className={button}
              onClick={() => setConfirmDisconnect(a)}
            >
              {disconnecting === a.id ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </li>
        ))}
      </ul>
    </section>

    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-1">Connect an account</h2>
      <p className="text-sm text-vx-fg-muted mb-4">Instagram, LinkedIn, X and YouTube publish directly. TikTok posts land as a draft in your TikTok inbox to finish there, until our app clears TikTok&apos;s review.</p>
      {connectError && <p role="alert" className="text-sm text-vx-danger mb-3">{connectError}</p>}
      {atLimit && <p className="text-sm text-vx-fg-muted mb-3">Your plan connects one account. Disconnect it to connect a different one.</p>}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {NETWORKS.map((n) => {
          const connected = byNetwork.get(n.key);
          return (
            <li key={n.key} className="flex items-center justify-between gap-3 rounded-xl border border-vx-border p-3">
              <span className="text-sm font-bold text-vx-fg">{n.label}</span>
              {n.live ? (
                connected
                  ? <span className="text-xs font-bold text-vx-accent">Connected</span>
                  : <button type="button" disabled={connecting != null || atLimit} className={button} onClick={() => onConnect(n.key)}>
                      {connecting === n.key ? 'Connecting…' : 'Connect'}
                    </button>
              ) : (
                <span className="text-xs font-semibold text-vx-fg-muted rounded-full border border-vx-border px-3 py-1">Coming soon</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>

    {confirmDisconnect && (
      <ConfirmDialog
        title={`Disconnect ${confirmDisconnect.display_name || networkLabel(confirmDisconnect.network)}?`}
        body="Scheduled posts to this account will stop going out. You can reconnect it any time."
        confirmLabel="Disconnect"
        tone="danger"
        onCancel={() => setConfirmDisconnect(null)}
        onConfirm={() => onDisconnect(confirmDisconnect.id)}
      />
    )}

    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-1">Drafts to review</h2>
      <p className="text-sm text-vx-fg-muted mb-4">Nothing here is posted until you approve its batch.</p>
      <DraftReview onApproved={() => setPostsRefreshToken((n) => n + 1)} />
    </section>

    <section className="rounded-2xl border border-vx-border p-5">
      <h2 id="schedule" className="font-bold mb-4 scroll-mt-6">Schedule a post</h2>
      <Composer key={initialJobId || 'library'} initialJobId={initialJobId} accounts={accounts} onScheduled={() => setPostsRefreshToken((n) => n + 1)} />
    </section>

    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">Scheduled &amp; published</h2>
      <ScheduledPosts refreshToken={postsRefreshToken} />
    </section>
  </div>;
}

function networkLabel(key) {
  return NETWORKS.find((n) => n.key === key)?.label || key;
}
