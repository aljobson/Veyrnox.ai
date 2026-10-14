'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialAccounts, NETWORKS } from '../../../../lib/socialConnectClient';
import { listSocialInboxContacts, updateSocialInboxContact } from '../../../../lib/socialInboxClient';
import BrandSwitcher from '../BrandSwitcher';
import NetworkLogo from '../NetworkLogo';
import ContactProfileEditor from './ContactProfileEditor';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function label(network) { return NETWORKS.find((item) => item.key === network)?.label || network; }

export default function PublishContacts() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-8">
    <nav aria-label="Publish" className="mb-2 flex flex-wrap gap-4 text-sm">
      <Link href="/app/publish" className="text-vx-accent underline">Veyrnox Publish</Link>
      <Link href="/app/publish/inbox" className="text-vx-accent underline">Inbox</Link>
      <Link href="/app/publish/analytics" className="text-vx-accent underline">Analytics</Link>
    </nav>
    <h1 className="text-3xl font-black">Contacts</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">People who have messaged or commented across your connected accounts, with shared tags, consent status and private team notes.</p>
    {account && <BrandSwitcher />}
    {account ? <ContactsDashboard key={account} /> : <SignIn />}
  </Main></>;
}

function SignIn() { return <div><p className="mb-4 text-vx-fg-body">Sign in to open your contact directory.</p>
  <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button></div>; }

function ContactsDashboard() {
  const [accounts, setAccounts] = useState(null);
  const [brandRole, setBrandRole] = useState('viewer');
  const [paid, setPaid] = useState(null);
  const [enabled, setEnabled] = useState(null);
  const [filters, setFilters] = useState({ accountId: '', network: '', subscriptionStatus: '', search: '', tag: '' });
  const [draftSearch, setDraftSearch] = useState('');
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState('');
  const editable = ['owner', 'manager', 'editor', 'reviewer'].includes(brandRole);

  useEffect(() => {
    let active = true;
    listSocialAccounts().then((result) => { if (!active) return;
      setAccounts((result.accounts || []).filter((item) => item.status === 'active'));
      setBrandRole(result.brandRole || 'viewer'); setPaid(result.planTier === 'publish'); setEnabled(result.inboxEnabled === true);
    }).catch(() => { if (active) setError('Could not load contacts. Check your connection and try again.'); });
    return () => { active = false; };
  }, []);

  const load = useCallback(() => {
    if (paid !== true || enabled !== true) return;
    setError(''); setContacts(null);
    listSocialInboxContacts(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)))
      .then((result) => { setContacts(result.contacts || []); setBrandRole(result.brandRole || 'viewer'); })
      .catch(() => setError('Could not load contacts. Check your connection and try again.'));
  }, [enabled, filters, paid]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (error) return <p role="alert" className="text-sm text-vx-danger">{error}</p>;
  if (accounts === null || paid === null || enabled === null) return <p className="text-sm text-vx-fg-muted">Loading contacts…</p>;
  if (!enabled) return <p className="text-sm text-vx-fg-muted">The social inbox is not open yet.</p>;
  if (!paid) return <section className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6"><h2 className="text-2xl font-black">Unlock contact profiles</h2>
    <p className="mt-3 text-sm text-vx-fg-body">Cross-network contacts, consent status, tags and team notes are included with the $15 monthly Publish Plan.</p>
    <Link href="/app/publish/plan" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">View Publish Plan</Link></section>;

  return <div className="space-y-5">
    <section aria-label="Contact filters" className="rounded-2xl border border-vx-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Account<select className={input} value={filters.accountId} onChange={(event) => setFilters({ ...filters, accountId: event.target.value })}>
          <option value="">All accounts</option>{accounts.map((item) => <option key={item.id} value={item.id}>{label(item.network)} · {item.display_name || item.external_account_id}</option>)}
        </select></label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Network<select className={input} value={filters.network} onChange={(event) => setFilters({ ...filters, network: event.target.value })}>
          <option value="">All networks</option>{NETWORKS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select></label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Consent<select className={input} value={filters.subscriptionStatus} onChange={(event) => setFilters({ ...filters, subscriptionStatus: event.target.value })}>
          <option value="">Any status</option><option value="unknown">Unknown</option><option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed</option>
        </select></label>
        <form className="flex min-w-64 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); setFilters({ ...filters, search: draftSearch.trim() }); }}>
          <label className="grid flex-1 gap-1 text-xs font-bold text-vx-fg-muted">Search<input className={input} value={draftSearch} maxLength={100} placeholder="Name or account ID" onChange={(event) => setDraftSearch(event.target.value)} /></label>
          <button type="submit" className={`${button} self-end`}>Search</button>
        </form>
      </div>
    </section>
    {contacts === null ? <p className="text-sm text-vx-fg-muted">Loading directory…</p> : contacts.length === 0 ? <section className="rounded-2xl border border-vx-border p-6"><h2 className="font-bold">No contacts yet</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">Contacts appear after supported messages or comments arrive in your social inbox.</p></section>
      : <ul className="grid gap-4">{contacts.map((contact) => <li key={`${contact.account_id}:${contact.external_id}`} className="rounded-2xl border border-vx-border p-5">
        <div className="flex items-start gap-3"><NetworkLogo network={contact.network} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="truncate text-lg font-black">{contact.name || 'Social contact'}</h2><span className="text-xs text-vx-fg-muted">Last active {dateTime.format(new Date(contact.last_active_at))}</span></div>
          <p className="mt-1 text-sm text-vx-fg-muted">{label(contact.network)} · {contact.account_name || 'Account'} · {contact.thread_count} conversations · {contact.message_count} messages{contact.unread_count ? ` · ${contact.unread_count} unread` : ''}</p>
          <ContactProfileEditor key={`${contact.subscription_status}:${(contact.tags || []).join(',')}:${contact.notes || ''}`} contact={contact} editable={editable} onSave={async (profile) => { await updateSocialInboxContact({ accountId: contact.account_id, externalId: contact.external_id, ...profile }); load(); }} />
        </div></div>
      </li>)}</ul>}
  </div>;
}
