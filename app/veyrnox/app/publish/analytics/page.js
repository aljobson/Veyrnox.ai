'use client';
import { tOr, pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { NETWORKS, listSocialAccounts } from '../../../../lib/socialConnectClient';
import { getSocialAnalytics } from '../../../../lib/socialAnalyticsClient';
import { analyticsCsv, contentTypePerformance, hashtagPerformance, metricChange, postAnalyticsCsv, postInteractions, previousRange, rangeForDays, summarize, summarizePortfolio, topContent, totalPostMetric, totalViews } from '../../../../../lib/social/analyticsSummary.js';
import { analyticsCapabilities, hasAnalytics } from '../../../../../lib/social/analyticsCapabilities.js';
import { FollowersChart } from './FollowersChart';
import { PostingInsights } from './PostingInsights';
import NetworkLogo from '../NetworkLogo';
import BrandSwitcher from '../BrandSwitcher';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const CAPABILITY_KEYS = {"Followers":"app.publish.analytics.followers","Subscribers":"app.publish.analytics.subscribers","Posts":"app.publish.analytics.posts","Videos":"app.publish.analytics.videos","Interactions":"app.publish.analytics.interactions","Reach":"app.publish.analytics.reach","Views":"app.publish.smartlink.views","Best time":"app.publish.analytics.bestTime","Impressions":"app.publish.analytics.impressions"};
const RANGES = [{ days: 7, key: 'app.publish.analytics.period7' }, { days: 30, key: 'app.publish.analytics.period30' }, { days: 90, key: 'app.publish.analytics.period90', paid: true }, { days: 365, key: 'app.publish.analytics.period365', paid: true }];

function useAnalyticsFormats() {
  const { t, locale } = useI18n();
  // English keeps the browser's locale, matching the original unqualified Intl calls.
  const whole = new Intl.NumberFormat(localeTag(locale));
  const oneDecimal = new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 1 });
  const dateLabel = new Intl.DateTimeFormat(localeTag(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const networkLabel = key => tOr(t, `app.publish.network.${key}`, NETWORKS.find(item => item.key === key)?.label || key);
  const metric = value => Number.isFinite(value) ? whole.format(value) : '—';
  const typeLabel = value => tOr(t, `app.publish.analytics.type.${value}`, value || t('app.publish.analytics.type.post'));
  function formatRange(range) {
    const from = new Date(`${range.from}T12:00:00Z`);
    const to = new Date(`${range.to}T12:00:00Z`);
    return Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) ? t('app.publish.analytics.validPeriod') : `${dateLabel.format(from)} – ${dateLabel.format(to)}`;
  }
  function changeLabel(value) {
    if (!Number.isFinite(value)) return t('app.publish.analytics.notComparable');
    if (value === 0) return t('app.publish.analytics.noChange');
    return `${value > 0 ? '+' : ''}${whole.format(value)}`;
  }
  return { t, locale, whole, oneDecimal, networkLabel, metric, typeLabel, formatRange, changeLabel };
}

function downloadCsv(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const defaultReport = { days: 30, compare: false, account: '', includeContent: true, title: '', accent: '#38bdf8' };
const subscribeLocation = () => () => {};
const readLocationSearch = () => window.location.search;
const readServerSearch = () => '';

function reportOptions(search) {
  if (!search) return defaultReport;
  const query = new URLSearchParams(search);
  const days = [7, 30, 90, 365].includes(Number(query.get('days'))) ? Number(query.get('days')) : 30;
  const title = (query.get('reportTitle') || '').slice(0, 100);
  const accent = /^#[0-9a-f]{6}$/i.test(query.get('accent') || '') ? query.get('accent').toLowerCase() : '#38bdf8';
  return { days, compare: query.get('compare') === '1', account: query.get('account') || '', includeContent: query.get('content') !== '0', title, accent };
}

export default function PublishAnalytics() {
  const { t } = useAnalyticsFormats();
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
    <p className="text-sm mb-2"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox.ai Publish</Link></p>
    <h1 className="text-3xl font-black mb-2">{t("publish.f7.name")}</h1>
    <p className="text-sm text-vx-fg-muted mb-4">{t("app.publish.analytics.intro")}</p>
    {account && <BrandSwitcher />}
    {account ? <Dashboard key={account} /> : <div className="text-vx-fg-body">
      <p className="mb-4">{t("app.publish.analytics.signIn")}</p>
      <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button>
    </div>}
  </Main></>;
}

function Dashboard() {
  const search = useSyncExternalStore(subscribeLocation, readLocationSearch, readServerSearch);
  return <DashboardView key={search} report={reportOptions(search)} />;
}

function DashboardView({ report }) {
  const { t, networkLabel, formatRange } = useAnalyticsFormats();
  const [accounts, setAccounts] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [chosenId, setChosenId] = useState('');
  const [range, setRange] = useState(() => rangeForDays(report.days));
  const [presetDays, setPresetDays] = useState(report.days);
  const [comparePrevious, setComparePrevious] = useState(report.compare);
  const [planTier, setPlanTier] = useState(null);

  useEffect(() => {
    let active = true;
    listSocialAccounts()
      .then(async (res) => {
        if (!active) return;
        const nextAccounts = (res.accounts || []).filter((a) => a.status === 'active');
        setAccounts(nextAccounts);
        const supported = nextAccounts.filter((item) => hasAnalytics(item.network));
        setChosenId(supported.some((item)=>item.id===report.account) ? report.account : supported.length > 1 ? 'all' : supported[0]?.id || nextAccounts[0]?.id || '');
        setPlanTier(res.plansEnabled === true ? (res.planTier || 'free') : 'legacy');
      })
      .catch(() => { if (active) setLoadError(t("app.publish.loadFailed")); });
    return () => { active = false; };
  }, [report.account, t]);

  if (loadError) return <p role="alert" className="text-sm text-vx-danger">{loadError}</p>;
  if (accounts === null) return <p className="text-sm text-vx-fg-muted">{t("cinema.titlePage.loading")}</p>;
  if (accounts.length === 0) {
    return <p className="text-sm text-vx-fg-body">
      {t("app.publish.connect.empty")}{' '}<Link href="/app/publish" className="text-vx-accent underline">{t("app.publish.analytics.connectOne")}</Link>{' '}{t("app.publish.analytics.seeNumbers")}</p>;
  }

  if (planTier === null) return <p className="text-sm text-vx-fg-muted">{t("app.publish.analytics.loadingPlan")}</p>;
  if (planTier === 'free') return <section className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6">
    <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">{t("publish.plan.colPlan")}</p>
    <h2 className="mt-2 text-2xl font-black">{t("app.publish.analytics.unlock")}</h2>
    <p className="mt-3 text-sm text-vx-fg-body">{t("app.publish.analytics.planIncludes")}</p>
    <Link href="/app/publish/plan" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">{t("app.publish.smartlink.viewPlan")}</Link>
  </section>;

  const selected = accounts.find((a) => a.id === chosenId) || accounts[0];
  const supportedAccounts = accounts.filter((item) => hasAnalytics(item.network));
  const showPortfolio = chosenId === 'all' && supportedAccounts.length > 1;
  const ranges = RANGES.filter((range) => !range.paid || planTier === 'publish');
  const comparisonRange = comparePrevious ? previousRange(range) : null;
  return <div className="space-y-6">
    {report.title&&<section className="rounded-2xl border border-vx-border p-5" style={{borderInlineStartColor:report.accent,borderInlineStartWidth:4}}><p className="text-xs font-bold uppercase tracking-widest text-vx-fg-muted">{t("app.publish.analytics.savedReport")}</p><h2 className="mt-1 text-2xl font-black">{report.title}</h2></section>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="inline-flex items-center gap-2 text-sm font-bold text-vx-fg">
        {showPortfolio ? <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-vx-accent/15 text-vx-accent">Σ</span> : <NetworkLogo network={selected.network} />}
        <span className="sr-only">{t("app.publish.analytics.account")}</span>
        <select
          value={showPortfolio ? 'all' : selected.id}
          onChange={(e) => setChosenId(e.target.value)}
          className="rounded-full border border-vx-border bg-transparent px-4 py-2 text-sm font-bold"
        >
          {supportedAccounts.length > 1 && <option value="all">{t("app.publish.analytics.allAccounts")}</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{networkLabel(a.network)} · {a.display_name || a.external_account_id}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("app.publish.analytics.rangePresets")}>
        {ranges.map((r) => (
          <button
            key={r.days}
            type="button"
            aria-pressed={presetDays === r.days}
            className={`${button} ${presetDays === r.days ? 'bg-vx-accent text-black border-vx-accent' : ''}`}
            onClick={() => { setRange(rangeForDays(r.days)); setPresetDays(r.days); }}
          >{t(r.key)}</button>
        ))}
      </div>
    </div>
    <section className="rounded-2xl border border-vx-border p-4" aria-label={t("app.publish.analytics.customPeriod")}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-bold">{t("app.publish.analytics.from")}<input type="date" value={range.from} min={rangeForDays(366).from} max={range.to}
          onChange={(event) => { if (event.target.value) { setRange((current) => ({ ...current, from: event.target.value })); setPresetDays(0); } }}
          className="mt-1 block rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" /></label>
        <label className="text-sm font-bold">{t("app.publish.analytics.to")}<input type="date" value={range.to} min={range.from} max={rangeForDays(1).to}
          onChange={(event) => { if (event.target.value) { setRange((current) => ({ ...current, to: event.target.value })); setPresetDays(0); } }}
          className="mt-1 block rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" /></label>
        <label className="inline-flex items-center gap-2 rounded-full border border-vx-border px-4 py-2 text-sm font-bold">
          <input type="checkbox" checked={comparePrevious} onChange={(event) => setComparePrevious(event.target.checked)} />{t("app.publish.analytics.compare")}</label>
      </div>
      <p className="mt-2 text-xs text-vx-fg-muted">{t('app.publish.analytics.showing', { range: formatRange(range), comparison: comparisonRange ? t('app.publish.analytics.comparing', { range: formatRange(comparisonRange) }) : '' })}</p>
    </section>
    {showPortfolio
      ? <PortfolioAnalytics key={`all:${range.from}:${range.to}:${comparePrevious}`} accounts={supportedAccounts} range={range} comparisonRange={comparisonRange} includeContent={report.includeContent} />
      : hasAnalytics(selected.network)
      ? <AccountAnalytics key={`${selected.id}:${range.from}:${range.to}:${comparePrevious}`} account={selected} range={range} comparisonRange={comparisonRange} includeContent={report.includeContent} />
      : <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-body">
          {t('app.publish.analytics.unavailable', { network: networkLabel(selected.network) })}
        </p>}
    <CapabilityMatrix accounts={accounts} />
  </div>;
}

function PortfolioAnalytics({ accounts, range, comparisonRange, includeContent }) {
  const { t, locale, whole } = useAnalyticsFormats();
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

  if (result === null) return <p className="text-sm text-vx-fg-muted">{t("app.publish.analytics.loadingAccounts")}</p>;
  if (result.summary.accounts === 0) return <p role="alert" className="text-sm text-vx-danger">{t("app.publish.analytics.accountsFailed")}</p>;
  const summary = result.summary;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-black">{t("app.publish.analytics.portfolio")}</h2>
        <p className="text-sm text-vx-fg-muted">{t(pluralKey(t, locale, 'app.publish.analytics.supported', summary.accounts), { count: locale === 'en' ? summary.accounts : whole.format(summary.accounts) })}</p>
      </div>
      <button type="button" className={button} onClick={() => downloadCsv(analyticsCsv(summary.rows), ['veyrnox-analytics', range.from, 'to', range.to].join('-') + '.csv')}>{t("app.publish.analytics.exportCsv")}</button>
    </div>
    {result.failed > 0 && <p role="status" className="rounded-xl border border-vx-border p-3 text-sm text-vx-fg-body">{t(pluralKey(t, locale, 'app.publish.analytics.failed', result.failed), { count: locale === 'en' ? result.failed : whole.format(result.failed) })}</p>}
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Stat label={t("app.publish.analytics.audience")} value={summary.followers === null ? '—' : whole.format(summary.followers)} note={t("app.publish.analytics.audienceNote")} />
      <Stat label={t("app.publish.analytics.content")} value={whole.format(summary.posts)} note={t("app.publish.analytics.contentNote")} />
      <Stat label={t("app.publish.analytics.interactions")} value={whole.format(summary.interactions)} note={t("app.publish.analytics.interactionsNote")} />
      <Stat label={t("app.publish.analytics.reach")} value={summary.reach === null ? '—' : whole.format(summary.reach)} note={t("app.publish.analytics.reachNote")} />
      <Stat label={t("app.publish.analytics.impressions")} value={summary.impressions === null ? '—' : whole.format(summary.impressions)} note={t("app.publish.analytics.impressionsNote")} />
      <Stat label={t("app.publish.smartlink.views")} value={summary.views === null ? '—' : whole.format(summary.views)} note={t("app.publish.analytics.viewsNote")} />
      <Stat label={t("app.publish.analytics.attention")} value={whole.format(summary.staleAccounts)} note={t("app.publish.analytics.attentionNote")} />
    </dl>
    {result.comparison && <>
      {result.comparison.missing > 0 && <p role="status" className="rounded-xl border border-vx-border p-3 text-sm text-vx-fg-body">{t(pluralKey(t, locale, 'app.publish.analytics.missing', result.comparison.missing), { count: locale === 'en' ? result.comparison.missing : whole.format(result.comparison.missing) })}</p>}
      <ComparisonCards current={result.comparison.current} previous={result.comparison.previous} />
    </>}
    {includeContent&&<section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">{t("app.publish.analytics.accounts")}</h2>
      <PortfolioTable rows={summary.rows} />
    </section>}
  </div>;
}

function PortfolioTable({ rows }) {
  const { t, whole, networkLabel } = useAnalyticsFormats();
  return <div className="overflow-x-auto"><table className="w-full text-sm">
    <thead><tr className="text-start text-xs text-vx-fg-muted">
      <th scope="col" className="pb-2 pe-3 font-bold">{t("app.publish.analytics.account")}</th><th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.audience")}</th>
      <th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.content")}</th><th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.interactions")}</th>
      <th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.reach")}</th><th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.impressions")}</th><th scope="col" className="pb-2 font-bold text-end">{t("app.publish.smartlink.views")}</th>
    </tr></thead>
    <tbody>{rows.map((row) => <tr key={row.account.id} className="border-t border-vx-border">
      <td className="py-3 pe-3"><span className="inline-flex items-center gap-2 font-bold"><NetworkLogo network={row.account.network} />{row.account.display_name || row.account.external_account_id}</span><span className="block text-xs font-normal text-vx-fg-muted">{networkLabel(row.account.network)} · {row.failing ? t("app.publish.analytics.updateFailed") : row.lastOkAt ? t("app.publish.analytics.updatedState") : t("app.publish.analytics.awaitingSync")}</span></td>
      <td className="py-3 pe-3 text-end tabular-nums">{row.summary.followers === null ? '—' : whole.format(row.summary.followers)}</td>
      <td className="py-3 pe-3 text-end tabular-nums">{whole.format(row.summary.posts)}</td>
      <td className="py-3 pe-3 text-end tabular-nums">{whole.format(row.summary.interactions)}</td>
      <td className="py-3 pe-3 text-end tabular-nums">{row.reach === null ? '—' : whole.format(row.reach)}</td>
      <td className="py-3 pe-3 text-end tabular-nums">{row.impressions === null ? '—' : whole.format(row.impressions)}</td>
      <td className="py-3 text-end tabular-nums">{row.views === null ? '—' : whole.format(row.views)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function ComparisonCards({ current, previous, compact = false }) {
  const { t, whole, changeLabel } = useAnalyticsFormats();
  const candidates = [
    [t("app.publish.analytics.content"), 'posts'], [t("app.publish.analytics.interactions"), 'interactions'], [t("app.publish.analytics.reach"), 'reach'],
    [t("app.publish.analytics.impressions"), 'impressions'], [t("app.publish.smartlink.views"), 'views'],
  ];
  const metrics = candidates.filter(([, key]) => Number.isFinite(current[key]) || Number.isFinite(previous[key]));
  return <section className="rounded-2xl border border-vx-border p-5" aria-labelledby={compact ? 'account-period-comparison' : 'period-comparison'}>
    <h2 id={compact ? 'account-period-comparison' : 'period-comparison'} className="font-bold">{t("app.publish.analytics.compared")}</h2>
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {metrics.map(([label, key]) => {
        const change = metricChange(current[key], previous[key]);
        return <div key={key} className="rounded-xl bg-vx-panel p-3">
          <dt className="text-xs font-bold text-vx-fg-muted">{label}</dt>
          <dd className="mt-1 font-black tabular-nums">{changeLabel(change)}</dd>
          <dd className="text-xs text-vx-fg-muted">{t('app.publish.analytics.previous', { value: Number.isFinite(previous[key]) ? whole.format(previous[key]) : '—' })}</dd>
        </div>;
      })}
    </dl>
  </section>;
}

function AccountAnalytics({ account, range, comparisonRange, includeContent }) {
  const { t, locale, whole, oneDecimal, metric } = useAnalyticsFormats();
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
      if (current.status === 'rejected') setError(t("app.publish.analytics.accountFailed"));
      else setData({ current: current.value, previous: previous.status === 'fulfilled' ? previous.value : null });
    });
    return () => { active = false; };
  }, [accountId, range.from, range.to, comparisonRange?.from, comparisonRange?.to, attempt, t]);

  if (error) return <div>
    <p role="alert" className="text-sm text-vx-danger mb-3">{error}</p>
    <button type="button" className={button} onClick={() => { setError(''); setAttempt((n) => n + 1); }}>{t("recovery.retry")}</button>
  </div>;
  if (data === null) return <p className="text-sm text-vx-fg-muted">{t("cinema.titlePage.loading")}</p>;

  const currentData = data.current;
  const summary = summarize(currentData);
  const previousSummary = data.previous ? summarize(data.previous) : null;
  const youtube = network === 'youtube';
  const tiktok = network === 'tiktok';
  const twitter = network === 'twitter';
  const videoNetwork = youtube || tiktok;
  const audienceLabel = youtube ? t("app.publish.analytics.subscribers") : t("app.publish.analytics.followers");
  const channelMetrics = currentData.evolution.at(-1)?.metrics || {};
  const twitch = network === 'twitch';
  const neverSynced = !currentData.sync?.last_ok_at;
  if (neverSynced && currentData.evolution.length === 0) {
    return <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-body">
      {currentData.sync?.failing
        ? <>{t("app.publish.analytics.unreadable")}{' '}
          <Link data-testid="publish-analytics-reconnect" href="/app/publish" className="font-bold text-vx-accent underline underline-offset-4">{t("app.publish.analytics.reconnect")}</Link>{' '}{t("app.publish.analytics.permissions")}</>
        : t('app.publish.analytics.awaitNumbers')}
    </p>;
  }

  const failing = currentData.sync?.failing && <p role="status" className="text-sm text-vx-fg-muted">
    {t("app.publish.analytics.stale")}{' '}
    <Link data-testid="publish-analytics-reconnect" href="/app/publish" className="font-bold text-vx-accent underline underline-offset-4">{t("app.publish.analytics.reconnect")}</Link>{' '}{t("app.publish.analytics.permissions")}</p>;
  const updated = currentData.sync?.last_ok_at && <p className="text-xs text-vx-fg-muted">
    {t('app.publish.analytics.updated', { date: new Date(currentData.sync.last_ok_at).toLocaleString(localeTag(locale)) })}
  </p>;

  // Twitch reports a view count per video and nothing else, so it gets its own
  // view: no followers, interactions or engagement are shown or invented.
  if (twitch) {
    return <div className="space-y-6">
      {failing}
      <dl className="grid grid-cols-2 gap-3">
        <Stat label={t("app.publish.analytics.videos")} value={whole.format(currentData.posts.length)} note={t("app.publish.analytics.latest20")} />
        <Stat label={t("app.publish.smartlink.views")} value={whole.format(totalViews(currentData.posts))} note={t("app.publish.analytics.lifetimeViews")} />
      </dl>
      {previousSummary && <ComparisonCards current={{ posts: summary.posts, interactions: summary.interactions, views: totalViews(currentData.posts) }} previous={{ posts: previousSummary.posts, interactions: previousSummary.interactions, views: totalViews(data.previous.posts) }} compact />}
      {includeContent&&<section className="rounded-2xl border border-vx-border p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">{t("app.publish.analytics.periodVideos")}</h2><ExportAccountButton account={account} data={currentData} /></div>
        <PostsTable posts={currentData.posts} withViews viewsOnly />
      </section>}
      <p className="text-xs text-vx-fg-muted">{t("app.publish.analytics.twitchPolicy")}</p>
      {updated}
    </div>;
  }

  return <div className="space-y-6">
    {failing}
    <dl className={`grid grid-cols-2 ${videoNetwork ? 'sm:grid-cols-3' : 'sm:grid-cols-4'} gap-3`}>
      <Stat label={audienceLabel} value={summary.followers === null ? '—' : whole.format(summary.followers)}
        note={summary.followersChange === null ? null : t('app.publish.analytics.periodChange', { change: `${summary.followersChange >= 0 ? '+' : ''}${whole.format(summary.followersChange)}` })} />
      <Stat label={videoNetwork ? t("app.publish.analytics.videos") : t("app.publish.analytics.posts")} value={whole.format(summary.posts)} />
      <Stat label={t("app.publish.analytics.interactions")} value={whole.format(summary.interactions)}
        note={twitter ? t("app.publish.analytics.xInteractions") : tiktok ? t("app.publish.analytics.tiktokInteractions") : summary.hasInsights ? t("app.publish.analytics.insightInteractions") : t("app.publish.analytics.basicInteractions")} />
      <Stat label={t("app.publish.analytics.engagement")} value={summary.engagementPer1000 === null ? '—' : oneDecimal.format(summary.engagementPer1000)}
        note={youtube ? t("app.publish.analytics.subscriberEngagement") : tiktok ? t("app.publish.analytics.videoEngagement") : t("app.publish.analytics.postEngagement")} />
      {youtube && <Stat label={t("app.publish.analytics.channelViews")} value={metric(channelMetrics.views)} note={t("app.publish.analytics.lifetimeTotal")} />}
      {tiktok && <Stat label={t("app.publish.analytics.accountLikes")} value={metric(channelMetrics.likes)} note={t("app.publish.analytics.lifetimeTotal")} />}
      {twitter && <Stat label={t("app.publish.analytics.impressions")} value={metric(totalPostMetric(currentData.posts, 'impressions'))} note={t("app.publish.analytics.forPeriodPosts")} />}
      {videoNetwork && <Stat label={t("app.publish.analytics.publicVideos")} value={metric(channelMetrics.posts_count)} note={youtube ? t("app.publish.analytics.channelTotal") : t("app.publish.analytics.accountTotal")} />}
    </dl>
    {previousSummary && <ComparisonCards current={{ posts: summary.posts, interactions: summary.interactions, reach: totalPostMetric(currentData.posts, 'reach'), impressions: totalPostMetric(currentData.posts, 'impressions'), views: totalPostMetric(currentData.posts, 'views') }} previous={{ posts: previousSummary.posts, interactions: previousSummary.interactions, reach: totalPostMetric(data.previous.posts, 'reach'), impressions: totalPostMetric(data.previous.posts, 'impressions'), views: totalPostMetric(data.previous.posts, 'views') }} />}

    {includeContent&&<>
      <section className="rounded-2xl border border-vx-border p-5">
        <h2 className="font-bold mb-4">{audienceLabel}</h2>
        <FollowersChart series={summary.series} label={audienceLabel} />
      </section>
      <section className="rounded-2xl border border-vx-border p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">{videoNetwork ? t('app.publish.analytics.periodVideos') : t('app.publish.analytics.periodPosts')}</h2><ExportAccountButton account={account} data={currentData} /></div>
        <PostsTable posts={currentData.posts} withInsights={summary.hasInsights} withImpressions={summary.hasImpressions} withViews={summary.hasViews} withShares={tiktok || twitter} />
      </section>
    </>}

    {includeContent&&<ContentPerformance posts={currentData.posts} />}

    {currentData.postingInsightsEnabled && <PostingInsights accountId={accountId} />}
    {youtube && <p className="text-xs text-vx-fg-muted">{t("app.publish.analytics.youtubePolicy")}</p>}
    {tiktok && <p className="text-xs text-vx-fg-muted">{t("app.publish.analytics.tiktokPolicy")}</p>}
    {twitter && <p className="text-xs text-vx-fg-muted">{t("app.publish.analytics.xPolicy")}</p>}
    {updated}
  </div>;
}

function ContentPerformance({ posts }) {
  const { t, locale, whole, oneDecimal, metric, typeLabel } = useAnalyticsFormats();
  const [rankingMetric, setRankingMetric] = useState('interactions');
  if (!posts.length) return null;
  const formats = contentTypePerformance(posts);
  const metricOptions = [
    ['interactions', t("app.publish.analytics.interactions")], ['reach', t("app.publish.analytics.reach")], ['impressions', t("app.publish.analytics.impressions")], ['views', t("app.publish.smartlink.views")],
    ['likes', t("app.publish.analytics.likes")], ['comments', t("cinema.comments.comments")], ['saves', 'Saves'], ['shares', t("app.publish.analytics.shares")],
  ].filter(([key]) => key === 'interactions' || posts.some((post) => Number.isFinite(post.metrics?.[key])));
  const effectiveMetric = metricOptions.some(([key]) => key === rankingMetric) ? rankingMetric : 'interactions';
  const leaders = topContent(posts, effectiveMetric);
  const hashtags = hashtagPerformance(posts);
  return <section className="rounded-2xl border border-vx-border p-5 space-y-6" aria-labelledby="content-performance-heading">
    <div><h2 id="content-performance-heading" className="font-bold">{t("app.publish.analytics.performance")}</h2><p className="mt-1 text-sm text-vx-fg-muted">{t("app.publish.analytics.performanceIntro")}</p></div>
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="text-start text-xs text-vx-fg-muted"><th scope="col" className="pb-2 pe-3">{t("app.publish.analytics.format")}</th><th scope="col" className="pb-2 pe-3 text-end">{t("app.publish.analytics.posts")}</th><th scope="col" className="pb-2 pe-3 text-end">{t("app.publish.analytics.perPost")}</th><th scope="col" className="pb-2 pe-3 text-end">{t("app.publish.analytics.reach")}</th><th scope="col" className="pb-2 text-end">{t("app.publish.smartlink.views")}</th></tr></thead>
      <tbody>{formats.map((row) => <tr key={typeLabel(row.type)} className="border-t border-vx-border"><td className="py-2 pe-3 font-bold capitalize">{typeLabel(row.type)}</td><td className="py-2 pe-3 text-end tabular-nums">{whole.format(row.posts)}</td><td className="py-2 pe-3 text-end tabular-nums">{oneDecimal.format(row.interactionsPerPost)}</td><td className="py-2 pe-3 text-end tabular-nums">{metric(row.reach)}</td><td className="py-2 text-end tabular-nums">{metric(row.views)}</td></tr>)}</tbody>
    </table></div>
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">{t("app.publish.analytics.topContent")}</h3><label className="text-sm font-bold">{t("app.publish.analytics.rankBy")}{' '}<select value={effectiveMetric} onChange={(event) => setRankingMetric(event.target.value)} className="ms-2 rounded-full border border-vx-border bg-transparent px-3 py-2 font-normal">{metricOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <ol className="mt-3 divide-y divide-vx-border">{leaders.map(({ post, value }, index) => <li key={post.id || `${post.published_at}:${index}`} className="flex items-start gap-3 py-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-vx-accent/15 text-sm font-black text-vx-accent">{locale === 'en' ? index + 1 : whole.format(index + 1)}</span><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm text-vx-fg-body">{post.caption || t("app.publish.analytics.noCaption")}</p><p className="mt-1 text-xs text-vx-fg-muted">{typeLabel(post.type)} · {new Date(post.published_at).toLocaleDateString(localeTag(locale))}</p></div><strong className="tabular-nums">{whole.format(value)}</strong></li>)}</ol>
    </div>
    {hashtags.length > 0 && <div><h3 className="font-bold">{t("app.publish.analytics.hashtagPerformance")}</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-start text-xs text-vx-fg-muted"><th scope="col" className="pb-2 pe-3">{t("app.publish.analytics.hashtag")}</th><th scope="col" className="pb-2 pe-3 text-end">{t("app.publish.analytics.posts")}</th><th scope="col" className="pb-2 text-end">{t("app.publish.analytics.perPost")}</th></tr></thead><tbody>{hashtags.map((row) => <tr key={row.hashtag} className="border-t border-vx-border"><td className="py-2 pe-3 font-bold">{row.hashtag}</td><td className="py-2 pe-3 text-end tabular-nums">{whole.format(row.posts)}</td><td className="py-2 text-end tabular-nums">{oneDecimal.format(row.interactionsPerPost)}</td></tr>)}</tbody></table></div></div>}
  </section>;
}

function ExportAccountButton({ account, data }) {
  const { t } = useAnalyticsFormats();
  return <button type="button" className={button} onClick={() => downloadCsv(postAnalyticsCsv(account, data.posts), `veyrnox-${account.network}-content.csv`)}>{t("app.publish.analytics.exportCsv")}</button>;
}

function CapabilityMatrix({ accounts }) {
  const { t, networkLabel } = useAnalyticsFormats();
  return <section className="rounded-2xl border border-vx-border p-5" aria-labelledby="analytics-coverage">
    <h2 id="analytics-coverage" className="text-lg font-black">{t("app.publish.analytics.coverage")}</h2>
    <p className="mt-1 text-sm text-vx-fg-muted">{t("app.publish.analytics.coverageIntro")}</p>
    <ul className="mt-4 divide-y divide-vx-border">
      {accounts.map((account) => {
        const capabilities = analyticsCapabilities(account.network);
        return <li key={account.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2 font-bold"><NetworkLogo network={account.network} />{account.display_name || account.external_account_id}</span>
          <span className="text-sm text-vx-fg-muted">{capabilities.length ? capabilities.map(capability => tOr(t, CAPABILITY_KEYS[capability], capability)).join(' · ') : t('app.publish.analytics.inDevelopment', { network: networkLabel(account.network) })}</span>
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
  const { t, locale, whole, metric, typeLabel } = useAnalyticsFormats();
  if (posts.length === 0) return <p className="text-sm text-vx-fg-muted">{t("app.publish.analytics.noPosts")}</p>;
  return <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-start text-xs text-vx-fg-muted">
          <th scope="col" className="pb-2 pe-3 font-bold">{t("cinema.creatorWorkspace.published")}</th>
          <th scope="col" className="pb-2 pe-3 font-bold">{t("app.publish.analytics.post")}</th>
          {withInsights && <th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.reach")}</th>}
          {withImpressions && <th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.impressions")}</th>}
          {withViews && <th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.smartlink.views")}</th>}
          {!viewsOnly && <th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.likes")}</th>}
          {!viewsOnly && <th scope="col" className="pb-2 pe-3 font-bold text-end">{t("cinema.comments.comments")}</th>}
          {withShares && <th scope="col" className="pb-2 pe-3 font-bold text-end">{t("app.publish.analytics.shares")}</th>}
          {!viewsOnly && <th scope="col" className="pb-2 font-bold text-end">{t("app.publish.analytics.interactions")}</th>}
        </tr>
      </thead>
      <tbody>
        {posts.map((p) => (
          <tr key={p.id} className="border-t border-vx-border align-top">
            <td className="py-2 pe-3 whitespace-nowrap text-vx-fg-muted">{new Date(p.published_at).toLocaleDateString(localeTag(locale))}</td>
            <td className="py-2 pe-3 max-w-[320px]">
              <span className="line-clamp-2 text-vx-fg-body">{p.caption || t("app.publish.analytics.noCaption")}</span>
              <span className="text-xs text-vx-fg-muted">
                {typeLabel(p.type)}
                {/* Stored links are https-only (0188); checked again before use as an href. */}
                {typeof p.permalink === 'string' && p.permalink.startsWith('https://') && (
                  <> · <a href={p.permalink} target="_blank" rel="noreferrer" className="underline">{t("app.publish.composer.view")}</a></>
                )}
              </span>
            </td>
            {withInsights && <td className="py-2 pe-3 text-end tabular-nums">{metric(p.metrics?.reach)}</td>}
            {withImpressions && <td className="py-2 pe-3 text-end tabular-nums">{metric(p.metrics?.impressions)}</td>}
            {withViews && <td className="py-2 pe-3 text-end tabular-nums">{metric(p.metrics?.views)}</td>}
            {!viewsOnly && <td className="py-2 pe-3 text-end tabular-nums">{metric(p.metrics?.likes)}</td>}
            {!viewsOnly && <td className="py-2 pe-3 text-end tabular-nums">{metric(p.metrics?.comments)}</td>}
            {withShares && <td className="py-2 pe-3 text-end tabular-nums">{metric(p.metrics?.shares)}</td>}
            {!viewsOnly && <td className="py-2 text-end tabular-nums font-bold">{whole.format(postInteractions(p))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}
