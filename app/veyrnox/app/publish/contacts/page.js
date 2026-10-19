'use client';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { tOr, pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialAccounts, NETWORKS } from '../../../../lib/socialConnectClient';
import { importSocialInboxContacts, listSocialInboxContacts, updateSocialInboxContact } from '../../../../lib/socialInboxClient';
import BrandSwitcher from '../BrandSwitcher';
import NetworkLogo from '../NetworkLogo';
import ContactProfileEditor from './ContactProfileEditor';
import ContactImportPanel from './ContactImportPanel';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
function label(network) { return NETWORKS.find((item) => item.key === network)?.label || network; }

export default function PublishContacts() {
  const { t } = useI18n();

  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-8">
    <nav aria-label={t("label.Publish")} className="mb-2 flex flex-wrap gap-4 text-sm">
      <Link href="/app/publish" className="text-vx-accent underline">Veyrnox.ai Publish</Link>
      <Link href="/app/publish/inbox" className="text-vx-accent underline">{t("app.publish.inbox.title")}</Link>
      <Link href="/app/publish/analytics" className="text-vx-accent underline">{t("publish.f7.name")}</Link>
    </nav>
    <h1 data-testid="publish-contacts-title" className="text-3xl font-black">{t("app.publish.nav.contacts")}</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">{t("app.publish.contacts.intro")}</p>
    {account && <BrandSwitcher />}
    {account ? <ContactsDashboard key={account} /> : <SignIn />}
  </Main></>;
}

function SignIn() {
  const { t } = useI18n();
 return <div><p className="mb-4 text-vx-fg-body">{t("app.publish.contacts.signIn")}</p>
  <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button></div>; }

function ContactsDashboard() {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(localeTag(locale), { useGrouping: false });
  const dateTime = new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' });
  const [accounts, setAccounts] = useState(null);
  const [brandRole, setBrandRole] = useState('viewer');
  const [paid, setPaid] = useState(null);
  const [enabled, setEnabled] = useState(null);
  const [filters, setFilters] = useState({ accountId: '', network: '', subscriptionStatus: '', search: '', tag: '' });
  const [draftSearch, setDraftSearch] = useState('');
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState('');
  const editable = ['owner', 'manager', 'editor', 'reviewer'].includes(brandRole);
  const canImport = ['owner', 'manager', 'editor'].includes(brandRole);

  useEffect(() => {
    let active = true;
    listSocialAccounts().then((result) => { if (!active) return;
      setAccounts((result.accounts || []).filter((item) => item.status === 'active'));
      setBrandRole(result.brandRole || 'viewer'); setPaid(result.planTier === 'publish'); setEnabled(result.inboxEnabled === true);
    }).catch(() => { if (active) setError(t("app.publish.contacts.failed")); });
    return () => { active = false; };
  }, []);

  const load = useCallback(() => {
    if (paid !== true || enabled !== true) return;
    setError(''); setContacts(null);
    listSocialInboxContacts(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)))
      .then((result) => { setContacts(result.contacts || []); setBrandRole(result.brandRole || 'viewer'); })
      .catch(() => setError(t("app.publish.contacts.failed")));
  }, [enabled, filters, paid]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (error) return <p role="alert" className="text-sm text-vx-danger">{error}</p>;
  if (accounts === null || paid === null || enabled === null) return <p className="text-sm text-vx-fg-muted">{t("app.publish.contacts.loading")}</p>;
  if (!enabled) return <p className="text-sm text-vx-fg-muted">{t("app.publish.inbox.notOpen")}</p>;
  if (!paid) return <section className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6"><h2 className="text-2xl font-black">{t("app.publish.contacts.unlock")}</h2>
    <p className="mt-3 text-sm text-vx-fg-body">{t("app.publish.contacts.plan")}</p>
    <Link href="/app/publish/plan" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">{t("app.publish.smartlink.viewPlan")}</Link></section>;

  return <div className="space-y-5">
    {canImport && <ContactImportPanel accounts={accounts.map((item) => ({ id: item.id,
      label: `${label(item.network)} · ${item.display_name || item.external_account_id}` }))}
      onImport={async (selectedAccountId, importedContacts, source) => {
        const result = await importSocialInboxContacts(selectedAccountId, importedContacts, source);
        load(); return result;
      }} />}
    <section aria-label={t("app.publish.contacts.filters")} className="rounded-2xl border border-vx-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.analytics.account")}<select className={input} value={filters.accountId} onChange={(event) => setFilters({ ...filters, accountId: event.target.value })}>
          <option value="">{t("app.publish.contacts.allAccounts")}</option>{accounts.map((item) => <option key={item.id} value={item.id}>{label(item.network)} · {item.display_name || item.external_account_id}</option>)}
        </select></label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.calendar.network")}<select data-testid="publish-contacts-network" className={input} value={filters.network} onChange={(event) => setFilters({ ...filters, network: event.target.value })}>
          <option value="">{t("app.publish.calendar.allNetworks")}</option>{NETWORKS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select></label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.contacts.consent")}<select className={input} value={filters.subscriptionStatus} onChange={(event) => setFilters({ ...filters, subscriptionStatus: event.target.value })}>
          <option value="">{t("app.publish.contacts.anyStatus")}</option><option value="unknown">{t("app.publish.contacts.unknown")}</option><option value="subscribed">{t("app.publish.contacts.subscribed")}</option><option value="unsubscribed">{t("app.publish.contacts.unsubscribed")}</option>
        </select></label>
        <form className="flex min-w-64 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); setFilters({ ...filters, search: draftSearch.trim() }); }}>
          <label className="grid flex-1 gap-1 text-xs font-bold text-vx-fg-muted">{t("ui.search")}<input className={input} value={draftSearch} maxLength={100} placeholder={t("app.publish.contacts.search")} onChange={(event) => setDraftSearch(event.target.value)} /></label>
          <button type="submit" className={`${button} self-end`}>{t("ui.search")}</button>
        </form>
      </div>
    </section>
    {contacts === null ? <p className="text-sm text-vx-fg-muted">{t("app.publish.contacts.loadingDirectory")}</p> : contacts.length === 0 ? <section className="rounded-2xl border border-vx-border p-6"><h2 data-testid="publish-contacts-empty" className="font-bold">{t("app.publish.contacts.empty")}</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">{t("app.publish.contacts.emptyHelp")}</p></section>
      : <ul className="grid gap-4">{contacts.map((contact) => <li key={`${contact.account_id}:${contact.external_id}`} className="rounded-2xl border border-vx-border p-5">
        <div className="flex items-start gap-3"><NetworkLogo network={contact.network} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="truncate text-lg font-black">{contact.name || t("app.publish.contacts.fallbackName")}</h2><span className="text-xs text-vx-fg-muted">{t('app.publish.contacts.active', { date: dateTime.format(new Date(contact.last_active_at)) })}</span></div>
          <p className="mt-1 text-sm text-vx-fg-muted">{tOr(t, `app.publish.network.${contact.network}`, label(contact.network))} · {contact.account_name || t("app.publish.analytics.account")} · {t(pluralKey(t, locale, 'app.publish.contacts.conversations', contact.thread_count), { count: number.format(contact.thread_count) })} · {t(pluralKey(t, locale, 'app.publish.contacts.messages', contact.message_count), { count: number.format(contact.message_count) })}{contact.unread_count ? t(pluralKey(t, locale, 'app.publish.contacts.unread', contact.unread_count), { count: number.format(contact.unread_count) }) : ''}</p>
          <ContactProfileEditor key={`${contact.subscription_status}:${(contact.tags || []).join(',')}:${contact.notes || ''}`} contact={contact} editable={editable} onSave={async (profile) => { await updateSocialInboxContact({ accountId: contact.account_id, externalId: contact.external_id, ...profile }); load(); }} />
        </div></div>
      </li>)}</ul>}
  </div>;
}
