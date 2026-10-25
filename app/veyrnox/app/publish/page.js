'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { getSession, onSessionChange } from '../../../lib/authClient';
import {
  NETWORKS, CATALOGUE_NETWORKS, listSocialAccounts, connectNetwork, disconnectSocialAccount,
} from '../../../lib/socialConnectClient';
import { Composer, ScheduledPosts } from './Composer';
import { DraftReview } from './DraftReview';
import NetworkLogo from './NetworkLogo';
import BlueskyConnect from './BlueskyConnect';
import { ApprovalRequests } from './ApprovalRequests';
import BrandSwitcher from './BrandSwitcher';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const noJob = () => null;
const currentJob = () => new URLSearchParams(window.location.search).get('job');
const currentUpload = () => new URLSearchParams(window.location.search).get('upload');
const subscribeLocation = (listener) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';

export default function Publish() {
  const { t } = useI18n();
  const initialJobId = useSyncExternalStore(subscribeLocation, currentJob, noJob);
  const initialUploadId = useSyncExternalStore(subscribeLocation, currentUpload, noJob);
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
    <h1 className="text-3xl font-black mb-2">Veyrnox.ai Publish</h1>
    <p className="text-sm text-vx-fg-muted mb-4">{t("app.publish.lead")}{' '}<Link href="/app/publish/analytics" className="text-vx-accent underline">{t("app.publish.analytics")}</Link>.</p>
    {account && <BrandSwitcher />}
    <ul data-assistant-target="publish.accounts" aria-label={t("app.publish.platforms")} className="flex flex-wrap gap-3 mb-6">
      {CATALOGUE_NETWORKS.map((n) => <li key={n.key} className="inline-flex items-center gap-2 rounded-full border border-vx-border px-3 py-2 text-sm font-bold text-vx-fg">
        <NetworkLogo network={n.key} />{tOr(t, `app.publish.network.${n.key}`, n.label)}
      </li>)}
    </ul>
    {account ? <PublishControls key={account} initialJobId={initialJobId} initialUploadId={initialUploadId} /> : <div className="text-vx-fg-body">
      <p className="mb-4">{t("app.publish.signIn")}</p>
      <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button>
    </div>}
  </Main></>;
}

function PublishControls({ initialJobId, initialUploadId }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? value : Number(value).toLocaleString(localeTag(locale));
  const networkName = value => tOr(t, `app.publish.network.${value}`, networkLabel(value));
  const [accounts, setAccounts] = useState(null);
  const [accountLimit, setAccountLimit] = useState(null);
  const [youtubeVisibilityEnabled, setYoutubeVisibilityEnabled] = useState(false);
  const [carouselEnabled, setCarouselEnabled] = useState(false);
  const [uploadsEnabled, setUploadsEnabled] = useState(false);
  const [plansEnabled, setPlansEnabled] = useState(false);
  const [inboxEnabled, setInboxEnabled] = useState(false);
  const [smartlinksEnabled, setSmartlinksEnabled] = useState(false);
  const [contentPresetsEnabled, setContentPresetsEnabled] = useState(false);
  const [queuesEnabled, setQueuesEnabled] = useState(false);
  const [approvalsEnabled, setApprovalsEnabled] = useState(false);
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [variantsEnabled, setVariantsEnabled] = useState(false);
  const [reportsEnabled, setReportsEnabled] = useState(false);
  const [customerApiEnabled, setCustomerApiEnabled] = useState(false);
  const [customerWebhooksEnabled, setCustomerWebhooksEnabled] = useState(false);
  const [adsEnabled, setAdsEnabled] = useState(false);
  const [commerceEnabled, setCommerceEnabled] = useState(false);
  const [rssAutolistsEnabled, setRssAutolistsEnabled] = useState(false);
  const [brandRole, setBrandRole] = useState('owner');
  const [planTier, setPlanTier] = useState('free');
  const [networks, setNetworks] = useState([]);
  const [blueskyOpen, setBlueskyOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [connecting, setConnecting] = useState(null);
  const [connectError, setConnectError] = useState('');
  const [disconnecting, setDisconnecting] = useState(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(null);
  const [postsRefreshToken, setPostsRefreshToken] = useState(0);
  const [reusablePost, setReusablePost] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await listSocialAccounts();
      setAccountLimit(res.accountLimit === 5 ? 5 : 1);
      setUploadsEnabled(res.uploadsEnabled === true);
      setCarouselEnabled(res.carouselEnabled === true);
      setYoutubeVisibilityEnabled(res.youtubeVisibilityEnabled === true);
      setPlansEnabled(res.plansEnabled === true);
      setInboxEnabled(res.inboxEnabled === true);
      setSmartlinksEnabled(res.smartlinksEnabled === true);
      setContentPresetsEnabled(res.contentPresetsEnabled === true);
      setQueuesEnabled(res.queuesEnabled === true);
      setApprovalsEnabled(res.approvalsEnabled === true);
      setTeamsEnabled(res.teamsEnabled === true);
      setVariantsEnabled(res.variantsEnabled === true);
      setReportsEnabled(res.reportsEnabled === true);
      setCustomerApiEnabled(res.customerApiEnabled === true);
      setCustomerWebhooksEnabled(res.customerWebhooksEnabled === true);
      setAdsEnabled(res.adsEnabled === true);
      setCommerceEnabled(res.commerceEnabled === true);
      setRssAutolistsEnabled(res.rssAutolistsEnabled === true);
      setBrandRole(res.brandRole || 'owner');
      setPlanTier(res.planTier === 'publish' ? 'publish' : 'free');
      setNetworks(res.networks || []);
      // Accounts are the render gate. Commit them after their entitlement data
      // so capacity and feature copy can never be built from placeholder state.
      setAccounts(res.accounts || []);
    } catch (err) {
      setLoadError(err.body?.error === 'publish_not_open' ? t("app.publish.notAvailable")
        : t("app.publish.loadFailed"));
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  async function onConnect(network) {
    if (network === 'bluesky') { setBlueskyOpen(true); return; }
    setConnecting(network); setConnectError('');
    try {
      await connectNetwork(network); // navigates away on success; only returns on failure
    } catch (err) {
      setConnectError(err.body?.error?.endsWith('_not_configured')
        ? t('app.publish.connect.setup', { network: networkName(network) })
        : t('app.publish.connect.failed', { network: networkName(network) }));
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
      setLoadError(t("app.publish.connect.disconnectFailed"));
    } finally {
      setDisconnecting(null);
    }
  }

  if (accounts === null) return <div className="space-y-6">
    <section className="rounded-2xl border border-vx-border p-5" aria-labelledby="connected-accounts-heading">
      <h2 id="connected-accounts-heading" className="font-bold">{t("app.publish.accounts")}</h2>
      {loadError ? <>
        <p role="alert" className="mt-3 text-sm text-vx-danger">{loadError}</p>
        <button type="button" className={`${button} mt-4`} onClick={load}>{t("recovery.retry")}</button>
      </> : <p role="status" className="mt-3 text-sm text-vx-fg-muted">{t("app.publish.loadingAccounts")}</p>}
    </section>
  </div>;

  const active = accounts.filter((a) => a.status === 'active');
  const byNetwork = new Map(active.map((a) => [a.network, a]));
  const atLimit = active.length >= accountLimit;
  const paid = !plansEnabled || planTier === 'publish';
  const canPublish = ['owner', 'manager', 'editor'].includes(brandRole);
  const canReviewDrafts = ['owner', 'manager', 'reviewer'].includes(brandRole);
  const canManageAccounts = brandRole === 'owner';

  return <div className="space-y-6">
    <section className="rounded-2xl border border-vx-border p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold">{t("app.publish.accounts")}</h2>
        <div className="flex flex-wrap gap-4">
          {inboxEnabled && <><Link href="/app/publish/inbox" className="text-sm font-bold text-vx-accent underline">{t("app.publish.nav.inbox")}</Link><Link href="/app/publish/contacts" className="text-sm font-bold text-vx-accent underline">{t("app.publish.nav.contacts")}</Link></>}
          {smartlinksEnabled && <Link href="/app/publish/smartlink" className="text-sm font-bold text-vx-accent underline">{t("publish.f8.name")}</Link>}
          {reportsEnabled && paid && <Link href="/app/publish/reports" className="text-sm font-bold text-vx-accent underline">{t("app.publish.nav.reports")}</Link>}
          {adsEnabled && paid && <Link href="/app/publish/ads" className="text-sm font-bold text-vx-accent underline">{t("presets.cat.ADS")}</Link>}
          {commerceEnabled && paid && <Link href="/app/publish/commerce" className="text-sm font-bold text-vx-accent underline">{t("app.publish.nav.commerce")}</Link>}
          {(customerApiEnabled || customerWebhooksEnabled) && paid && ['owner', 'manager'].includes(brandRole) && <Link href="/app/publish/developer" className="text-sm font-bold text-vx-accent underline">{t("dev.api.kicker")}</Link>}
          {queuesEnabled && paid && <Link href="/app/publish/queues" className="text-sm font-bold text-vx-accent underline">{t("app.publish.nav.queues")}</Link>}
          {rssAutolistsEnabled && queuesEnabled && paid && <Link href="/app/publish/autolists" className="text-sm font-bold text-vx-accent underline">{t("app.publish.nav.autolists")}</Link>}
          {teamsEnabled && paid && ['owner', 'manager'].includes(brandRole) && <Link href="/app/publish/team" className="text-sm font-bold text-vx-accent underline">{t("app.publish.nav.team")}</Link>}
          {teamsEnabled && paid && ['owner', 'manager'].includes(brandRole) && <Link href="/app/publish/activity" className="text-sm font-bold text-vx-accent underline">{t("app.publish.nav.activity")}</Link>}
          {plansEnabled && canManageAccounts && <Link href="/app/publish/plan" className="text-sm font-bold text-vx-accent underline">{t("app.publish.plan.heading")}</Link>}
        </div>
      </div>
      <p className="text-sm text-vx-fg-muted mb-3">
        {paid ? t(canManageAccounts ? 'app.publish.connect.yourPlan' : 'app.publish.connect.brandPlan', { count: number(accountLimit) }) : t("app.publish.connect.freeIncluded")}
      </p>
      {!canManageAccounts && <p role="status" className="mb-3 rounded-xl bg-vx-panel p-3 text-sm">{t('app.publish.connect.roleInfo', { role: tOr(t, `app.publish.role.${brandRole}`, brandRole) })}</p>}
      {accounts === null && !loadError && <p className="text-sm text-vx-fg-muted">{t("cinema.titlePage.loading")}</p>}
      {loadError && <p role="alert" className="text-sm text-vx-danger mb-3">{loadError}</p>}
      {accounts !== null && active.length === 0 && !loadError && (
        <p className="text-sm text-vx-fg-muted">{t("app.publish.connect.empty")}</p>
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
                <div className="flex items-center gap-1.5 text-xs text-vx-fg-muted"><NetworkLogo network={a.network} className="h-3.5 w-3.5" />{networkName(a.network)} · {tOr(t, `app.publish.connect.status.${a.status}`, a.status)}</div>
              </div>
            </div>
            {canManageAccounts && <button
              type="button"
              disabled={disconnecting === a.id}
              className={button}
              onClick={() => setConfirmDisconnect(a)}
            >
              {disconnecting === a.id ? t("app.publish.connect.disconnecting") : t("app.publish.connect.disconnect")}
            </button>}
          </li>
        ))}
      </ul>
    </section>

    {approvalsEnabled && paid && ['owner', 'manager', 'editor'].includes(brandRole) && <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-1">{t("app.publish.connect.requests")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.publish.connect.requestsIntro")}</p>
      <ApprovalRequests refreshToken={postsRefreshToken} />
    </section>}

    {canManageAccounts && <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-1">{t("app.publish.connect.heading")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.publish.connect.intro")}</p>
      {connectError && <p role="alert" className="text-sm text-vx-danger mb-3">{connectError}</p>}
      {atLimit && <p className="text-sm text-vx-fg-muted mb-3">
        {paid ? t('app.publish.connect.limit', { count: number(accountLimit) }) : <>{t("app.publish.connect.free")}{' '}<Link href="/app/publish/plan" className="font-bold text-vx-accent underline">{t("app.publish.connect.upgrade")}</Link>.</>}
      </p>}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CATALOGUE_NETWORKS.map((n) => {
          const connected = byNetwork.get(n.key);
          const readiness = networks.find((item) => item.key === n.key);
          return (
            <li key={n.key} className="flex items-center justify-between gap-3 rounded-xl border border-vx-border p-3">
              <div><span className="inline-flex items-center gap-3 text-sm font-bold text-vx-fg"><NetworkLogo network={n.key} className="h-6 w-6" />{tOr(t, `app.publish.network.${n.key}`, n.label)}</span>
                {n.note && <p className="mt-1 text-xs text-vx-fg-muted">{tOr(t, `app.publish.networkNote.${n.key}`, n.note)}</p>}</div>
              {n.live ? (
                connected
                  ? <span className="text-xs font-bold text-vx-accent">{t("app.publish.connect.connected")}</span>
                  : <button type="button" data-testid={`social-connect-${n.key}`} disabled={connecting != null || atLimit || readiness?.available !== true} className={button} onClick={() => onConnect(n.key)}>
                      {connecting === n.key ? t("oauth.connecting") : !readiness ? t("cinema.titlePage.loading") : readiness.status === 'not_released' ? t("app.publish.connect.soon") : readiness.status === 'setup_required' ? t("app.publish.connect.required") : readiness.status === 'testing_disabled' ? t("app.publish.connect.testing") : t("app.publish.connect.connect")}
                    </button>
              ) : (
                <span className="text-xs font-semibold text-vx-fg-muted rounded-full border border-vx-border px-3 py-1">{t("app.publish.connect.soon")}</span>
              )}
            </li>
          );
        })}
      </ul>
      {blueskyOpen && <div className="mt-4"><BlueskyConnect onCancel={() => setBlueskyOpen(false)} onConnected={async () => { setBlueskyOpen(false); await load(); }} /></div>}
    </section>}

    {confirmDisconnect && (
      <ConfirmDialog
        title={t('app.publish.connect.confirm', { name: confirmDisconnect.display_name || networkName(confirmDisconnect.network) })}
        body={t("app.publish.connect.confirmBody")}
        confirmLabel={t("app.publish.connect.disconnect")}
        tone="danger"
        onCancel={() => setConfirmDisconnect(null)}
        onConfirm={() => onDisconnect(confirmDisconnect.id)}
      />
    )}

    {canReviewDrafts && <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-1">{t("app.publish.connect.review")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.publish.connect.reviewIntro")}</p>
      <DraftReview onApproved={() => setPostsRefreshToken((n) => n + 1)} />
    </section>}

    {canPublish && <section className="rounded-2xl border border-vx-border p-5">
      <h2 id="schedule" className="font-bold mb-4 scroll-mt-6">{t("label.Create a post")}</h2>
      <Composer carouselEnabled={carouselEnabled} variantsEnabled={variantsEnabled && paid} approvalsEnabled={approvalsEnabled && paid} queuesEnabled={queuesEnabled && paid} presetsEnabled={contentPresetsEnabled && paid} multiAccountEnabled={paid} scheduleEnabled={paid} youtubeVisibilityEnabled={youtubeVisibilityEnabled} key={initialJobId || initialUploadId || 'library'} initialJobId={initialJobId} initialUploadId={initialUploadId} reusablePost={reusablePost} accounts={accounts} uploadsEnabled={uploadsEnabled} onScheduled={() => setPostsRefreshToken((n) => n + 1)} />
    </section>}

    <section className="rounded-2xl border border-vx-border p-5">
      <h2 className="font-bold mb-4">{t("app.publish.connect.scheduled")}</h2>
      <ScheduledPosts refreshToken={postsRefreshToken} scheduleEnabled={paid} onReuse={canPublish ? (post) => { setReusablePost({ ...post, reuseKey: Date.now() }); document.getElementById('schedule')?.scrollIntoView({ behavior: 'smooth' }); } : undefined} />
    </section>
  </div>;
}

function networkLabel(key) {
  return NETWORKS.find((n) => n.key === key)?.label || key;
}
