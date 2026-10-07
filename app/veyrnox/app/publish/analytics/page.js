'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { NETWORKS, listSocialAccounts } from '../../../../lib/socialConnectClient';
import { getSocialAnalytics } from '../../../../lib/socialAnalyticsClient';
import { postInteractions, rangeForDays, summarize } from '../../../../../lib/social/analyticsSummary.js';
import { FollowersChart } from './FollowersChart';
import { PostingInsights } from './PostingInsights';
import NetworkLogo from '../NetworkLogo';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
// Networks the analytics sweep has a fetcher for (lib/socialAnalyticsSweep.js).
const ANALYTICS_NETWORKS = new Set(['instagram', 'youtube', 'tiktok']);
const RANGES = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }];
const whole = new Intl.NumberFormat();
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function networkLabel(key) {
  return NETWORKS.find((n) => n.key === key)?.label || key;
}

export default function PublishAnalytics() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><div className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
    <p className="text-sm mb-2"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox Publish</Link></p>
    <h1 className="text-3xl font-black mb-2">Analytics</h1>
    <p className="text-sm text-vx-fg-muted mb-6">How your connected accounts and their posts are doing.</p>
    {account ? <Dashboard key={account} /> : <div className="text-vx-fg-body">
      <p className="mb-4">Sign in to see your analytics.</p>
      <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>
    </div>}
  </div></>;
}

function Dashboard() {
  const [accounts, setAccounts] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [chosenId, setChosenId] = useState('');
  const [days, setDays] = useState(30);

  useEffect(() => {
    let active = true;
    listSocialAccounts()
      .then((res) => { if (active) setAccounts((res.accounts || []).filter((a) => a.status === 'active')); })
      .catch(() => { if (active) setLoadError('Could not load your connected accounts. Check your connection and try again.'); });
    return () => { active = false; };
  }, []);

  if (loadError) return <p role="alert" className="text-sm text-vx-danger">{loadError}</p>;
  if (accounts === null) return <p className="text-sm text-vx-fg-muted">Loading…</p>;
  if (accounts.length === 0) {
    return <p className="text-sm text-vx-fg-body">
      No accounts connected yet. <Link href="/app/publish" className="text-vx-accent underline">Connect one in Veyrnox Publish</Link> to see its numbers here.
    </p>;
  }

  const selected = accounts.find((a) => a.id === chosenId) || accounts[0];
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="inline-flex items-center gap-2 text-sm font-bold text-vx-fg">
        <NetworkLogo network={selected.network} />
        <span className="sr-only">Account</span>
        <select
          value={selected.id}
          onChange={(e) => setChosenId(e.target.value)}
          className="rounded-full border border-vx-border bg-transparent px-4 py-2 text-sm font-bold"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{networkLabel(a.network)} · {a.display_name || a.external_account_id}</option>
          ))}
        </select>
      </label>
      <div className="flex gap-2" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            aria-pressed={days === r.days}
            className={`${button} ${days === r.days ? 'bg-vx-accent text-black border-vx-accent' : ''}`}
            onClick={() => setDays(r.days)}
          >{r.label}</button>
        ))}
      </div>
    </div>
    {ANALYTICS_NETWORKS.has(selected.network)
      ? <AccountAnalytics key={`${selected.id}:${days}`} accountId={selected.id} network={selected.network} days={days} />
      : <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-body">
          Analytics for {networkLabel(selected.network)} are not available yet. Instagram, YouTube and TikTok are supported today.
        </p>}
  </div>;
}

function AccountAnalytics({ accountId, network, days }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getSocialAnalytics({ accountId, ...rangeForDays(days) })
      .then((res) => { if (active) setData(res); })
      .catch(() => { if (active) setError('Could not load analytics for this account. Check your connection and try again.'); });
    return () => { active = false; };
  }, [accountId, days, attempt]);

  if (error) return <div>
    <p role="alert" className="text-sm text-vx-danger mb-3">{error}</p>
    <button type="button" className={button} onClick={() => { setError(''); setAttempt((n) => n + 1); }}>Try again</button>
  </div>;
  if (data === null) return <p className="text-sm text-vx-fg-muted">Loading…</p>;

  const summary = summarize(data);
  const youtube = network === 'youtube';
  const tiktok = network === 'tiktok';
  const videoNetwork = youtube || tiktok;
  const audienceLabel = youtube ? 'Subscribers' : 'Followers';
  const channelMetrics = data.evolution.at(-1)?.metrics || {};
  const neverSynced = !data.sync?.last_ok_at;
  if (neverSynced && data.evolution.length === 0) {
    return <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-body">
      {data.sync?.failing
        ? 'We could not read this account’s numbers. Reconnecting it in Veyrnox Publish usually fixes this.'
        : 'No numbers yet. The first ones arrive within a few hours of connecting an account.'}
    </p>;
  }

  return <div className="space-y-6">
    {data.sync?.failing && <p role="status" className="text-sm text-vx-fg-muted">
      The latest update for this account failed, so these numbers may be out of date. Reconnecting it in Veyrnox Publish usually fixes this.
    </p>}
    <dl className={`grid grid-cols-2 ${videoNetwork ? 'sm:grid-cols-3' : 'sm:grid-cols-4'} gap-3`}>
      <Stat label={audienceLabel} value={summary.followers === null ? '—' : whole.format(summary.followers)}
        note={summary.followersChange === null ? null : `${summary.followersChange >= 0 ? '+' : ''}${whole.format(summary.followersChange)} in this period`} />
      <Stat label={videoNetwork ? 'Videos' : 'Posts'} value={whole.format(summary.posts)} />
      <Stat label="Interactions" value={whole.format(summary.interactions)}
        note={tiktok ? 'Likes, comments and shares' : summary.hasInsights ? 'Likes, comments, saves and shares' : 'Likes and comments'} />
      <Stat label="Engagement" value={summary.engagementPer1000 === null ? '—' : oneDecimal.format(summary.engagementPer1000)}
        note={youtube ? 'Interactions per video, per 1,000 subscribers' : tiktok ? 'Interactions per video, per 1,000 followers' : 'Interactions per post, per 1,000 followers'} />
      {youtube && <Stat label="Channel views" value={metric(channelMetrics.views)} note="Lifetime total" />}
      {tiktok && <Stat label="Account likes" value={metric(channelMetrics.likes)} note="Lifetime total" />}
      {videoNetwork && <Stat label="Public videos" value={metric(channelMetrics.posts_count)} note={youtube ? 'Channel total' : 'Account total'} />}
    </dl>

    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">{audienceLabel}</h2>
      <FollowersChart series={summary.series} label={audienceLabel} />
    </section>

    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">{videoNetwork ? 'Videos' : 'Posts'} in this period</h2>
      <PostsTable posts={data.posts} withInsights={summary.hasInsights} withViews={summary.hasViews} withShares={tiktok} />
    </section>

    {data.postingInsightsEnabled && <PostingInsights accountId={accountId} />}
    {youtube && <p className="text-xs text-vx-fg-muted">YouTube subscriber counts are rounded. Video metrics are lifetime totals for videos published in this period. The latest 50 uploads refresh each round.</p>}
    {tiktok && <p className="text-xs text-vx-fg-muted">TikTok video metrics cover public videos only. Video metrics are lifetime totals for videos published in this period. The latest 50 public videos refresh each round. Missing numbers may need additional permissions: reconnect in Veyrnox Publish after analytics access is enabled.</p>}
    {data.sync?.last_ok_at && <p className="text-xs text-vx-fg-muted">
      Updated {new Date(data.sync.last_ok_at).toLocaleString()}. Numbers refresh every few hours.
    </p>}
  </div>;
}

function Stat({ label, value, note }) {
  return <div className="rounded-2xl border border-vx-border p-4">
    <dt className="text-xs font-bold text-vx-fg-muted">{label}</dt>
    <dd className="text-2xl font-black text-vx-fg mt-1 tabular-nums">{value}</dd>
    {note && <dd className="text-xs text-vx-fg-muted mt-1">{note}</dd>}
  </div>;
}

function PostsTable({ posts, withInsights, withViews, withShares }) {
  if (posts.length === 0) return <p className="text-sm text-vx-fg-muted">No posts in this period.</p>;
  return <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-vx-fg-muted">
          <th scope="col" className="pb-2 pr-3 font-bold">Published</th>
          <th scope="col" className="pb-2 pr-3 font-bold">Post</th>
          {withInsights && <th scope="col" className="pb-2 pr-3 font-bold text-right">Reach</th>}
          {withViews && <th scope="col" className="pb-2 pr-3 font-bold text-right">Views</th>}
          <th scope="col" className="pb-2 pr-3 font-bold text-right">Likes</th>
          <th scope="col" className="pb-2 pr-3 font-bold text-right">Comments</th>
          {withShares && <th scope="col" className="pb-2 pr-3 font-bold text-right">Shares</th>}
          <th scope="col" className="pb-2 font-bold text-right">Interactions</th>
        </tr>
      </thead>
      <tbody>
        {posts.map((p) => (
          <tr key={p.id} className="border-t border-vx-border align-top">
            <td className="py-2 pr-3 whitespace-nowrap text-vx-fg-muted">{new Date(p.published_at).toLocaleDateString()}</td>
            <td className="py-2 pr-3 max-w-[320px]">
              <span className="line-clamp-2 text-vx-fg-body">{p.caption || 'No caption'}</span>
              <span className="text-xs text-vx-fg-muted">
                {p.type || 'post'}
                {/* Stored links are https-only (0188); checked again before use as an href. */}
                {typeof p.permalink === 'string' && p.permalink.startsWith('https://') && (
                  <> · <a href={p.permalink} target="_blank" rel="noreferrer" className="underline">view</a></>
                )}
              </span>
            </td>
            {withInsights && <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.reach)}</td>}
            {withViews && <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.views)}</td>}
            <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.likes)}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.comments)}</td>
            {withShares && <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.shares)}</td>}
            <td className="py-2 text-right tabular-nums font-bold">{whole.format(postInteractions(p))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

function metric(value) {
  return Number.isFinite(value) ? whole.format(value) : '—';
}
