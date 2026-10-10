'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { getSession, onSessionChange } from '../../../lib/authClient';
import {
  NETWORKS, listSocialAccounts, connectNetwork, disconnectSocialAccount,
} from '../../../lib/socialConnectClient';
import { Composer, ScheduledPosts } from './Composer';
import { DraftReview } from './DraftReview';
import NetworkLogo from './NetworkLogo';
import BlueskyConnect from './BlueskyConnect';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const noJob = () => null;
const currentJob = () => new URLSearchParams(window.location.search).get('job');
const subscribeLocation = (listener) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';

export default function Publish() {
  const initialJobId = useSyncExternalStore(subscribeLocation, currentJob, noJob);
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
    <h1 className="text-3xl font-black mb-2">Veyrnox Publish</h1>
    <p className="text-sm text-vx-fg-muted mb-6">Connect your social accounts to schedule posts from Veyrnox. <Link href="/app/publish/analytics" className="text-vx-accent underline">See your analytics</Link></p>
    <ul aria-label="Social platforms" className="flex flex-wrap gap-3 mb-6">
      {NETWORKS.map((n) => <li key={n.key} className="inline-flex items-center gap-2 rounded-full border border-vx-border px-3 py-2 text-sm font-bold text-vx-fg">
        <NetworkLogo network={n.key} />{n.label}
      </li>)}
    </ul>
    {account ? <PublishControls key={account} initialJobId={initialJobId} /> : <div className="text-vx-fg-body">
      <p className="mb-4">Sign in to connect a social account.</p>
      <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>
    </div>}
  </Main></>;
}

function PublishControls({ initialJobId }) {
  const [accounts, setAccounts] = useState(null);
  const [accountLimit, setAccountLimit] = useState(1);
  const [youtubeVisibilityEnabled, setYoutubeVisibilityEnabled] = useState(false);
  const [uploadsEnabled, setUploadsEnabled] = useState(false);
  const [networks, setNetworks] = useState([]);
  const [blueskyOpen, setBlueskyOpen] = useState(false);
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
      setAccountLimit(res.accountLimit === 5 ? 5 : 1);
      setUploadsEnabled(res.uploadsEnabled === true);
      setYoutubeVisibilityEnabled(res.youtubeVisibilityEnabled === true);
      setNetworks(res.networks || []);
    } catch (err) {
      setLoadError(err.body?.error === 'publish_not_open' ? 'Publish is not available for this account yet.'
        : 'Could not load your connected accounts. Check your connection and try again.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function onConnect(network) {
    if (network === 'bluesky') { setBlueskyOpen(true); return; }
    setConnecting(network); setConnectError('');
    try {
      await connectNetwork(network); // navigates away on success; only returns on failure
    } catch (err) {
      setConnectError(err.body?.error?.endsWith('_not_configured')
        ? `${networkLabel(network)} needs setup before it can be connected.`
        : `Could not start connecting ${networkLabel(network)}. Check your connection and try again.`);
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
  const atLimit = active.length >= accountLimit;

  return <div className="space-y-6">
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">Connected accounts</h2>
      {accountLimit === 5 && <p className="text-sm text-vx-fg-muted mb-3">Basic scheduling is free for up to five connected accounts.</p>}
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
                    <NetworkLogo network={a.network} />
                  </span>}
              <div className="min-w-0">
                <div className="text-sm font-bold text-vx-fg truncate">{a.display_name || a.external_account_id}</div>
                <div className="flex items-center gap-1.5 text-xs text-vx-fg-muted"><NetworkLogo network={a.network} className="h-3.5 w-3.5" />{networkLabel(a.network)} · {a.status}</div>
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
      <p className="text-sm text-vx-fg-muted mb-4">Choose a platform to connect. Facebook uses Pages, Pinterest uses boards and Google Business Profile uses business locations. TikTok delivers a draft to your inbox. Twitch connects for video statistics.</p>
      {connectError && <p role="alert" className="text-sm text-vx-danger mb-3">{connectError}</p>}
      {atLimit && <p className="text-sm text-vx-fg-muted mb-3">{accountLimit === 5 ? 'You have reached the five-account free limit. Disconnect an account to connect another.' : 'Your plan connects one account. Disconnect it to connect a different one.'}</p>}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {NETWORKS.map((n) => {
          const connected = byNetwork.get(n.key);
          const readiness = networks.find((item) => item.key === n.key);
          return (
            <li key={n.key} className="flex items-center justify-between gap-3 rounded-xl border border-vx-border p-3">
              <div><span className="inline-flex items-center gap-3 text-sm font-bold text-vx-fg"><NetworkLogo network={n.key} className="h-6 w-6" />{n.label}</span>
                {n.note && <p className="mt-1 text-xs text-vx-fg-muted">{n.note}</p>}</div>
              {n.live ? (
                connected
                  ? <span className="text-xs font-bold text-vx-accent">Connected</span>
                  : <button type="button" data-testid={`social-connect-${n.key}`} disabled={connecting != null || atLimit || readiness?.available !== true} className={button} onClick={() => onConnect(n.key)}>
                      {connecting === n.key ? 'Connecting…' : !readiness ? 'Loading…' : readiness.status === 'not_released' ? 'Coming soon' : readiness.status === 'setup_required' ? 'Setup required' : readiness.status === 'testing_disabled' ? 'Testing not enabled' : 'Connect'}
                    </button>
              ) : (
                <span className="text-xs font-semibold text-vx-fg-muted rounded-full border border-vx-border px-3 py-1">Coming soon</span>
              )}
            </li>
          );
        })}
      </ul>
      {blueskyOpen && <div className="mt-4"><BlueskyConnect onCancel={() => setBlueskyOpen(false)} onConnected={async () => { setBlueskyOpen(false); await load(); }} /></div>}
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
      <h2 id="schedule" className="font-bold mb-4 scroll-mt-6">Create a post</h2>
      <Composer youtubeVisibilityEnabled={youtubeVisibilityEnabled} key={initialJobId || 'library'} initialJobId={initialJobId} accounts={accounts} uploadsEnabled={uploadsEnabled} onScheduled={() => setPostsRefreshToken((n) => n + 1)} />
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
