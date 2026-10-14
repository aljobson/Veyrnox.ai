'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { NETWORKS, listSocialAccounts } from '../../../../lib/socialConnectClient';
import { getSocialAnalytics } from '../../../../lib/socialAnalyticsClient';
import { getPublishPlan } from '../../../../lib/publishPlanClient';
import { analyticsCsv, contentTypePerformance, hashtagPerformance, metricChange, postAnalyticsCsv, postInteractions, previousRange, rangeForDays, summarize, summarizePortfolio, topContent, totalPostMetric, totalViews } from '../../../../../lib/social/analyticsSummary.js';
import { analyticsCapabilities, hasAnalytics } from '../../../../../lib/social/analyticsCapabilities.js';
import { FollowersChart } from './FollowersChart';
import { PostingInsights } from './PostingInsights';
import NetworkLogo from '../NetworkLogo';
import BrandSwitcher from '../BrandSwitcher';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const RANGES = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days', paid: true }, { days: 365, label: '12 months', paid: true }];
const whole = new Intl.NumberFormat();
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const dateLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function networkLabel(key) {
  return NETWORKS.find((n) => n.key === key)?.label || key;
}

function formatRange(range) {
  const from = new Date(`${range.from}T12:00:00Z`);
  const to = new Date(`${range.to}T12:00:00Z`);
  return Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) ? 'Choose a valid period' : `${dateLabel.format(from)} – ${dateLabel.format(to)}`;
}

function changeLabel(value) {
  if (!Number.isFinite(value)) return 'Not comparable';
  if (value === 0) return 'No change';
  return `${value > 0 ? '+' : ''}${whole.format(value)}`;
}

function downloadCsv(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PublishAnalytics() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
    <p className="text-sm mb-2"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox Publish</Link></p>
    <h1 className="text-3xl font-black mb-2">Analytics</h1>
    <p className="text-sm text-vx-fg-muted mb-4">How your connected accounts and their posts are doing.</p>
    {account && <BrandSwitcher />}
    {account ? <Dashboard key={account} /> : <div className="text-vx-fg-body">
      <p className="mb-4">Sign in to see your analytics.</p>
      <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>
    </div>}
  </Main></>;
}

function Dashboard() {
  const [accounts, setAccounts] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [chosenId, setChosenId] = useState('');
  const [range, setRange] = useState(() => rangeForDays(30));
  const [presetDays, setPresetDays] = useState(30);
  const [comparePrevious, setComparePrevious] = useState(false);
  const [planTier, setPlanTier] = useState(null);

  useEffect(() => {
    let active = true;
    listSocialAccounts()
      .then(async (res) => {
        if (!active) return;
        const nextAccounts = (res.accounts || []).filter((a) => a.status === 'active');
        setAccounts(nextAccounts);
        const supported = nextAccounts.filter((item) => hasAnalytics(item.network));
        setChosenId(supported.length > 1 ? 'all' : supported[0]?.id || nextAccounts[0]?.id || '');
        if (res.plansEnabled === true) {
          try { const plan = await getPublishPlan(); if (active) setPlanTier(plan.entitlement?.tier || 'free'); }
          catch { if (active) setPlanTier('free'); }
        } else if (active) setPlanTier('legacy');
      })
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

  if (planTier === null) return <p className="text-sm text-vx-fg-muted">Loading your plan…</p>;
  if (planTier === 'free') return <section className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6">
    <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">Publish Plan</p>
    <h2 className="mt-2 text-2xl font-black">Unlock analytics</h2>
    <p className="mt-3 text-sm text-vx-fg-body">Analytics, CSV exports, cross-account reporting and best-time recommendations are included with the Publish Plan.</p>
    <Link href="/app/publish/plan" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">View Publish Plan</Link>
  </section>;

  const selected = accounts.find((a) => a.id === chosenId) || accounts[0];
  const supportedAccounts = accounts.filter((item) => hasAnalytics(item.network));
  const showPortfolio = chosenId === 'all' && supportedAccounts.length > 1;
  const ranges = RANGES.filter((range) => !range.paid || planTier === 'publish');
  const comparisonRange = comparePrevious ? previousRange(range) : null;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="inline-flex items-center gap-2 text-sm font-bold text-vx-fg">
        {showPortfolio ? <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-vx-accent/15 text-vx-accent">Σ</span> : <NetworkLogo network={selected.network} />}
        <span className="sr-only">Account</span>
        <select
          value={showPortfolio ? 'all' : selected.id}
          onChange={(e) => setChosenId(e.target.value)}
          className="rounded-full border border-vx-border bg-transparent px-4 py-2 text-sm font-bold"
        >
          {supportedAccounts.length > 1 && <option value="all">All supported accounts</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{networkLabel(a.network)} · {a.display_name || a.external_account_id}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range presets">
        {ranges.map((r) => (
          <button
            key={r.days}
            type="button"
            aria-pressed={presetDays === r.days}
            className={`${button} ${presetDays === r.days ? 'bg-vx-accent text-black border-vx-accent' : ''}`}
            onClick={() => { setRange(rangeForDays(r.days)); setPresetDays(r.days); }}
          >{r.label}</button>
        ))}
      </div>
    </div>
    <section className="rounded-2xl border border-vx-border p-4" aria-label="Custom analytics period">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-bold">From<input type="date" value={range.from} min={rangeForDays(366).from} max={range.to}
          onChange={(event) => { if (event.target.value) { setRange((current) => ({ ...current, from: event.target.value })); setPresetDays(0); } }}
          className="mt-1 block rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" /></label>
        <label className="text-sm font-bold">To<input type="date" value={range.to} min={range.from} max={rangeForDays(1).to}
          onChange={(event) => { if (event.target.value) { setRange((current) => ({ ...current, to: event.target.value })); setPresetDays(0); } }}
          className="mt-1 block rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" /></label>
        <label className="inline-flex items-center gap-2 rounded-full border border-vx-border px-4 py-2 text-sm font-bold">
          <input type="checkbox" checked={comparePrevious} onChange={(event) => setComparePrevious(event.target.checked)} />Compare with previous period
        </label>
      </div>
      <p className="mt-2 text-xs text-vx-fg-muted">Showing {formatRange(range)}{comparisonRange ? ` · comparing with ${formatRange(comparisonRange)}` : ''}. Up to 12 months.</p>
    </section>
    {showPortfolio
      ? <PortfolioAnalytics key={`all:${range.from}:${range.to}:${comparePrevious}`} accounts={supportedAccounts} range={range} comparisonRange={comparisonRange} />
      : hasAnalytics(selected.network)
      ? <AccountAnalytics key={`${selected.id}:${range.from}:${range.to}:${comparePrevious}`} account={selected} range={range} comparisonRange={comparisonRange} />
      : <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-body">
          Analytics for {networkLabel(selected.network)} are not available yet. Instagram, YouTube, TikTok, X and Twitch are supported today.
        </p>}
    <CapabilityMatrix accounts={accounts} />
  </div>;
}

function PortfolioAnalytics({ accounts, range, comparisonRange }) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all(accounts.map(async (account) => {
      const [current, previous] = await Promise.allSettled([
        getSocialAnalytics({ accountId: account.id, ...range }),
        comparisonRange ? getSocialAnalytics({ accountId: account.id, ...comparisonRange }) : Promise.resolve(null),
      ]);
      return { account, current, previous };
    })).then((settled) => {
        if (!active) return;
        const entries = settled.filter((item) => item.current.status === 'fulfilled').map((item) => ({ account: item.account, data: item.current.value }));
        const matched = settled.filter((item) => item.current.status === 'fulfilled' && item.previous.status === 'fulfilled' && item.previous.value);
        const comparison = comparisonRange ? {
          current: summarizePortfolio(matched.map((item) => ({ account: item.account, data: item.current.value }))),
          previous: summarizePortfolio(matched.map((item) => ({ account: item.account, data: item.previous.value }))),
          missing: entries.length - matched.length,
        } : null;
        setResult({ summary: summarizePortfolio(entries), comparison, failed: settled.length - entries.length });
      });
    return () => { active = false; };
  }, [accounts, range.from, range.to, comparisonRange?.from, comparisonRange?.to]);

  if (result === null) return <p className="text-sm text-vx-fg-muted">Loading all accounts…</p>;
  if (result.summary.accounts === 0) return <p role="alert" className="text-sm text-vx-danger">Could not load analytics for your accounts. Check your connection and try again.</p>;
  const summary = result.summary;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-black">Portfolio summary</h2>
        <p className="text-sm text-vx-fg-muted">{summary.accounts} supported {summary.accounts === 1 ? 'account' : 'accounts'} · unsupported metrics stay blank.</p>
      </div>
      <button type="button" className={button} onClick={() => downloadCsv(analyticsCsv(summary.rows), `veyrnox-analytics-${range.from}-to-${range.to}.csv`)}>Export CSV</button>
    </div>
    {result.failed > 0 && <p role="status" className="rounded-xl border border-vx-border p-3 text-sm text-vx-fg-body">{result.failed} {result.failed === 1 ? 'account could' : 'accounts could'} not be loaded. The totals below include the others.</p>}
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Stat label="Audience" value={summary.followers === null ? '—' : whole.format(summary.followers)} note="Followers and subscribers reported by providers" />
      <Stat label="Content" value={whole.format(summary.posts)} note="Posts and videos in this period" />
      <Stat label="Interactions" value={whole.format(summary.interactions)} note="Likes, comments, saves and shares where supplied" />
      <Stat label="Reach" value={summary.reach === null ? '—' : whole.format(summary.reach)} note="Only providers that report reach" />
      <Stat label="Impressions" value={summary.impressions === null ? '—' : whole.format(summary.impressions)} note="Only providers that report impressions" />
      <Stat label="Views" value={summary.views === null ? '—' : whole.format(summary.views)} note="Only providers that report views" />
      <Stat label="Needs attention" value={whole.format(summary.staleAccounts)} note="Failed or awaiting a first sync" />
    </dl>
    {result.comparison && <>
      {result.comparison.missing > 0 && <p role="status" className="rounded-xl border border-vx-border p-3 text-sm text-vx-fg-body">Previous-period data was unavailable for {result.comparison.missing} {result.comparison.missing === 1 ? 'account' : 'accounts'}; the comparison includes only matched accounts.</p>}
      <ComparisonCards current={result.comparison.current} previous={result.comparison.previous} />
    </>}
    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">Accounts</h2>
      <PortfolioTable rows={summary.rows} />
    </section>
  </div>;
}

function PortfolioTable({ rows }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <thead><tr className="text-left text-xs text-vx-fg-muted">
      <th scope="col" className="pb-2 pr-3 font-bold">Account</th><th scope="col" className="pb-2 pr-3 font-bold text-right">Audience</th>
      <th scope="col" className="pb-2 pr-3 font-bold text-right">Content</th><th scope="col" className="pb-2 pr-3 font-bold text-right">Interactions</th>
      <th scope="col" className="pb-2 pr-3 font-bold text-right">Reach</th><th scope="col" className="pb-2 pr-3 font-bold text-right">Impressions</th><th scope="col" className="pb-2 font-bold text-right">Views</th>
    </tr></thead>
    <tbody>{rows.map((row) => <tr key={row.account.id} className="border-t border-vx-border">
      <td className="py-3 pr-3"><span className="inline-flex items-center gap-2 font-bold"><NetworkLogo network={row.account.network} />{row.account.display_name || row.account.external_account_id}</span><span className="block text-xs font-normal text-vx-fg-muted">{networkLabel(row.account.network)} · {row.failing ? 'update failed' : row.lastOkAt ? 'updated' : 'awaiting first sync'}</span></td>
      <td className="py-3 pr-3 text-right tabular-nums">{row.summary.followers === null ? '—' : whole.format(row.summary.followers)}</td>
      <td className="py-3 pr-3 text-right tabular-nums">{whole.format(row.summary.posts)}</td>
      <td className="py-3 pr-3 text-right tabular-nums">{whole.format(row.summary.interactions)}</td>
      <td className="py-3 pr-3 text-right tabular-nums">{row.reach === null ? '—' : whole.format(row.reach)}</td>
      <td className="py-3 pr-3 text-right tabular-nums">{row.impressions === null ? '—' : whole.format(row.impressions)}</td>
      <td className="py-3 text-right tabular-nums">{row.views === null ? '—' : whole.format(row.views)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function ComparisonCards({ current, previous, compact = false }) {
  const candidates = [
    ['Content', 'posts'], ['Interactions', 'interactions'], ['Reach', 'reach'],
    ['Impressions', 'impressions'], ['Views', 'views'],
  ];
  const metrics = candidates.filter(([, key]) => Number.isFinite(current[key]) || Number.isFinite(previous[key]));
  return <section className="rounded-2xl border border-vx-border p-5" aria-labelledby={compact ? 'account-period-comparison' : 'period-comparison'}>
    <h2 id={compact ? 'account-period-comparison' : 'period-comparison'} className="font-bold">Compared with previous period</h2>
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {metrics.map(([label, key]) => {
        const change = metricChange(current[key], previous[key]);
        return <div key={key} className="rounded-xl bg-vx-panel p-3">
          <dt className="text-xs font-bold text-vx-fg-muted">{label}</dt>
          <dd className="mt-1 font-black tabular-nums">{changeLabel(change)}</dd>
          <dd className="text-xs text-vx-fg-muted">Previous: {Number.isFinite(previous[key]) ? whole.format(previous[key]) : '—'}</dd>
        </div>;
      })}
    </dl>
  </section>;
}

function AccountAnalytics({ account, range, comparisonRange }) {
  const { id: accountId, network } = account;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getSocialAnalytics({ accountId, ...range }),
      comparisonRange ? getSocialAnalytics({ accountId, ...comparisonRange }) : Promise.resolve(null),
    ]).then(([current, previous]) => {
      if (!active) return;
      if (current.status === 'rejected') setError('Could not load analytics for this account. Check your connection and try again.');
      else setData({ current: current.value, previous: previous.status === 'fulfilled' ? previous.value : null });
    });
    return () => { active = false; };
  }, [accountId, range.from, range.to, comparisonRange?.from, comparisonRange?.to, attempt]);

  if (error) return <div>
    <p role="alert" className="text-sm text-vx-danger mb-3">{error}</p>
    <button type="button" className={button} onClick={() => { setError(''); setAttempt((n) => n + 1); }}>Try again</button>
  </div>;
  if (data === null) return <p className="text-sm text-vx-fg-muted">Loading…</p>;

  const currentData = data.current;
  const summary = summarize(currentData);
  const previousSummary = data.previous ? summarize(data.previous) : null;
  const youtube = network === 'youtube';
  const tiktok = network === 'tiktok';
  const twitter = network === 'twitter';
  const videoNetwork = youtube || tiktok;
  const audienceLabel = youtube ? 'Subscribers' : 'Followers';
  const channelMetrics = currentData.evolution.at(-1)?.metrics || {};
  const twitch = network === 'twitch';
  const neverSynced = !currentData.sync?.last_ok_at;
  if (neverSynced && currentData.evolution.length === 0) {
    return <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-body">
      {currentData.sync?.failing
        ? 'We could not read this account’s numbers. Reconnecting it in Veyrnox Publish usually fixes this.'
        : 'No numbers yet. The first ones arrive within a few hours of connecting an account.'}
    </p>;
  }

  const failing = currentData.sync?.failing && <p role="status" className="text-sm text-vx-fg-muted">
    The latest update for this account failed, so these numbers may be out of date. Reconnecting it in Veyrnox Publish usually fixes this.
  </p>;
  const updated = currentData.sync?.last_ok_at && <p className="text-xs text-vx-fg-muted">
    Updated {new Date(currentData.sync.last_ok_at).toLocaleString()}. Numbers refresh every few hours.
  </p>;

  // Twitch reports a view count per video and nothing else, so it gets its own
  // view: no followers, interactions or engagement are shown or invented.
  if (twitch) {
    return <div className="space-y-6">
      {failing}
      <dl className="grid grid-cols-2 gap-3">
        <Stat label="Videos" value={whole.format(currentData.posts.length)} note="In this period, from your latest 20" />
        <Stat label="Views" value={whole.format(totalViews(currentData.posts))} note="Lifetime views of those videos" />
      </dl>
      {previousSummary && <ComparisonCards current={{ posts: summary.posts, interactions: summary.interactions, views: totalViews(currentData.posts) }} previous={{ posts: previousSummary.posts, interactions: previousSummary.interactions, views: totalViews(data.previous.posts) }} compact />}
      <section className="rounded-2xl border border-vx-border p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Videos in this period</h2><ExportAccountButton account={account} data={currentData} /></div>
        <PostsTable posts={currentData.posts} withViews viewsOnly />
      </section>
      <p className="text-xs text-vx-fg-muted">Twitch shares a view count for each of your latest 20 videos. Follower, subscriber, like and comment numbers are not available.</p>
      {updated}
    </div>;
  }

  return <div className="space-y-6">
    {failing}
    <dl className={`grid grid-cols-2 ${videoNetwork ? 'sm:grid-cols-3' : 'sm:grid-cols-4'} gap-3`}>
      <Stat label={audienceLabel} value={summary.followers === null ? '—' : whole.format(summary.followers)}
        note={summary.followersChange === null ? null : `${summary.followersChange >= 0 ? '+' : ''}${whole.format(summary.followersChange)} in this period`} />
      <Stat label={videoNetwork ? 'Videos' : 'Posts'} value={whole.format(summary.posts)} />
      <Stat label="Interactions" value={whole.format(summary.interactions)}
        note={twitter ? 'Likes, replies, bookmarks, reposts and quotes' : tiktok ? 'Likes, comments and shares' : summary.hasInsights ? 'Likes, comments, saves and shares' : 'Likes and comments'} />
      <Stat label="Engagement" value={summary.engagementPer1000 === null ? '—' : oneDecimal.format(summary.engagementPer1000)}
        note={youtube ? 'Interactions per video, per 1,000 subscribers' : tiktok ? 'Interactions per video, per 1,000 followers' : 'Interactions per post, per 1,000 followers'} />
      {youtube && <Stat label="Channel views" value={metric(channelMetrics.views)} note="Lifetime total" />}
      {tiktok && <Stat label="Account likes" value={metric(channelMetrics.likes)} note="Lifetime total" />}
      {twitter && <Stat label="Impressions" value={metric(totalPostMetric(currentData.posts, 'impressions'))} note="For posts in this period" />}
      {videoNetwork && <Stat label="Public videos" value={metric(channelMetrics.posts_count)} note={youtube ? 'Channel total' : 'Account total'} />}
    </dl>
    {previousSummary && <ComparisonCards current={{ posts: summary.posts, interactions: summary.interactions, reach: totalPostMetric(currentData.posts, 'reach'), impressions: totalPostMetric(currentData.posts, 'impressions'), views: totalPostMetric(currentData.posts, 'views') }} previous={{ posts: previousSummary.posts, interactions: previousSummary.interactions, reach: totalPostMetric(data.previous.posts, 'reach'), impressions: totalPostMetric(data.previous.posts, 'impressions'), views: totalPostMetric(data.previous.posts, 'views') }} />}

    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">{audienceLabel}</h2>
      <FollowersChart series={summary.series} label={audienceLabel} />
    </section>

    <section className="rounded-2xl border border-vx-border p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">{videoNetwork ? 'Videos' : 'Posts'} in this period</h2><ExportAccountButton account={account} data={currentData} /></div>
      <PostsTable posts={currentData.posts} withInsights={summary.hasInsights} withImpressions={summary.hasImpressions} withViews={summary.hasViews} withShares={tiktok || twitter} />
    </section>

    <ContentPerformance posts={currentData.posts} />

    {currentData.postingInsightsEnabled && <PostingInsights accountId={accountId} />}
    {youtube && <p className="text-xs text-vx-fg-muted">YouTube subscriber counts are rounded. Video metrics are lifetime totals for videos published in this period. The latest 50 uploads refresh each round.</p>}
    {tiktok && <p className="text-xs text-vx-fg-muted">TikTok video metrics cover public videos only. Video metrics are lifetime totals for videos published in this period. The latest 50 public videos refresh each round. Missing numbers may need additional permissions: reconnect in Veyrnox Publish after analytics access is enabled.</p>}
    {twitter && <p className="text-xs text-vx-fg-muted">X metrics cover the latest 100 original posts. Replies and reposts are excluded. Reposts and quotes appear together as shares.</p>}
    {updated}
  </div>;
}

function ContentPerformance({ posts }) {
  const [rankingMetric, setRankingMetric] = useState('interactions');
  if (!posts.length) return null;
  const formats = contentTypePerformance(posts);
  const metricOptions = [
    ['interactions', 'Interactions'], ['reach', 'Reach'], ['impressions', 'Impressions'], ['views', 'Views'],
    ['likes', 'Likes'], ['comments', 'Comments'], ['saves', 'Saves'], ['shares', 'Shares'],
  ].filter(([key]) => key === 'interactions' || posts.some((post) => Number.isFinite(post.metrics?.[key])));
  const effectiveMetric = metricOptions.some(([key]) => key === rankingMetric) ? rankingMetric : 'interactions';
  const leaders = topContent(posts, effectiveMetric);
  const hashtags = hashtagPerformance(posts);
  return <section className="rounded-2xl border border-vx-border p-5 space-y-6" aria-labelledby="content-performance-heading">
    <div><h2 id="content-performance-heading" className="font-bold">Content performance</h2><p className="mt-1 text-sm text-vx-fg-muted">Compare formats, find your strongest posts and see which hashtags accompany engagement. Metrics are lifetime totals reported by the platform.</p></div>
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="text-left text-xs text-vx-fg-muted"><th scope="col" className="pb-2 pr-3">Format</th><th scope="col" className="pb-2 pr-3 text-right">Posts</th><th scope="col" className="pb-2 pr-3 text-right">Interactions / post</th><th scope="col" className="pb-2 pr-3 text-right">Reach</th><th scope="col" className="pb-2 text-right">Views</th></tr></thead>
      <tbody>{formats.map((row) => <tr key={row.type} className="border-t border-vx-border"><td className="py-2 pr-3 font-bold capitalize">{row.type}</td><td className="py-2 pr-3 text-right tabular-nums">{whole.format(row.posts)}</td><td className="py-2 pr-3 text-right tabular-nums">{oneDecimal.format(row.interactionsPerPost)}</td><td className="py-2 pr-3 text-right tabular-nums">{metric(row.reach)}</td><td className="py-2 text-right tabular-nums">{metric(row.views)}</td></tr>)}</tbody>
    </table></div>
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Top content</h3><label className="text-sm font-bold">Rank by <select value={effectiveMetric} onChange={(event) => setRankingMetric(event.target.value)} className="ml-2 rounded-full border border-vx-border bg-transparent px-3 py-2 font-normal">{metricOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <ol className="mt-3 divide-y divide-vx-border">{leaders.map(({ post, value }, index) => <li key={post.id || `${post.published_at}:${index}`} className="flex items-start gap-3 py-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-vx-accent/15 text-sm font-black text-vx-accent">{index + 1}</span><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm text-vx-fg-body">{post.caption || 'No caption'}</p><p className="mt-1 text-xs text-vx-fg-muted">{post.type || 'post'} · {new Date(post.published_at).toLocaleDateString()}</p></div><strong className="tabular-nums">{whole.format(value)}</strong></li>)}</ol>
    </div>
    {hashtags.length > 0 && <div><h3 className="font-bold">Hashtag performance</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-vx-fg-muted"><th scope="col" className="pb-2 pr-3">Hashtag</th><th scope="col" className="pb-2 pr-3 text-right">Posts</th><th scope="col" className="pb-2 text-right">Interactions / post</th></tr></thead><tbody>{hashtags.map((row) => <tr key={row.hashtag} className="border-t border-vx-border"><td className="py-2 pr-3 font-bold">{row.hashtag}</td><td className="py-2 pr-3 text-right tabular-nums">{whole.format(row.posts)}</td><td className="py-2 text-right tabular-nums">{oneDecimal.format(row.interactionsPerPost)}</td></tr>)}</tbody></table></div></div>}
  </section>;
}

function ExportAccountButton({ account, data }) {
  return <button type="button" className={button} onClick={() => downloadCsv(postAnalyticsCsv(account, data.posts), `veyrnox-${account.network}-content.csv`)}>Export CSV</button>;
}

function CapabilityMatrix({ accounts }) {
  return <section className="rounded-2xl border border-vx-border p-5" aria-labelledby="analytics-coverage">
    <h2 id="analytics-coverage" className="text-lg font-black">Analytics coverage</h2>
    <p className="mt-1 text-sm text-vx-fg-muted">Metrics vary by network. Veyrnox leaves unavailable values blank instead of estimating them.</p>
    <ul className="mt-4 divide-y divide-vx-border">
      {accounts.map((account) => {
        const capabilities = analyticsCapabilities(account.network);
        return <li key={account.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2 font-bold"><NetworkLogo network={account.network} />{account.display_name || account.external_account_id}</span>
          <span className="text-sm text-vx-fg-muted">{capabilities.length ? capabilities.join(' · ') : `${networkLabel(account.network)} analytics are in development`}</span>
        </li>;
      })}
    </ul>
  </section>;
}

function Stat({ label, value, note }) {
  return <div className="rounded-2xl border border-vx-border p-4">
    <dt className="text-xs font-bold text-vx-fg-muted">{label}</dt>
    <dd className="text-2xl font-black text-vx-fg mt-1 tabular-nums">{value}</dd>
    {note && <dd className="text-xs text-vx-fg-muted mt-1">{note}</dd>}
  </div>;
}

function PostsTable({ posts, withInsights, withImpressions, withViews, withShares, viewsOnly }) {
  if (posts.length === 0) return <p className="text-sm text-vx-fg-muted">No posts in this period.</p>;
  return <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-vx-fg-muted">
          <th scope="col" className="pb-2 pr-3 font-bold">Published</th>
          <th scope="col" className="pb-2 pr-3 font-bold">Post</th>
          {withInsights && <th scope="col" className="pb-2 pr-3 font-bold text-right">Reach</th>}
          {withImpressions && <th scope="col" className="pb-2 pr-3 font-bold text-right">Impressions</th>}
          {withViews && <th scope="col" className="pb-2 pr-3 font-bold text-right">Views</th>}
          {!viewsOnly && <th scope="col" className="pb-2 pr-3 font-bold text-right">Likes</th>}
          {!viewsOnly && <th scope="col" className="pb-2 pr-3 font-bold text-right">Comments</th>}
          {withShares && <th scope="col" className="pb-2 pr-3 font-bold text-right">Shares</th>}
          {!viewsOnly && <th scope="col" className="pb-2 font-bold text-right">Interactions</th>}
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
            {withImpressions && <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.impressions)}</td>}
            {withViews && <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.views)}</td>}
            {!viewsOnly && <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.likes)}</td>}
            {!viewsOnly && <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.comments)}</td>}
            {withShares && <td className="py-2 pr-3 text-right tabular-nums">{metric(p.metrics?.shares)}</td>}
            {!viewsOnly && <td className="py-2 text-right tabular-nums font-bold">{whole.format(postInteractions(p))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

function metric(value) {
  return Number.isFinite(value) ? whole.format(value) : '—';
}
