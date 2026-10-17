'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialActivity } from '../../../../lib/socialActivityClient';
import BrandSwitcher from '../BrandSwitcher';
import { activityLabel, activityLoadError } from '../../../_lib/publishPresentation';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold';
const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function PublishActivityPage() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-8">
    <nav aria-label="Publish" className="mb-2 flex flex-wrap gap-4 text-sm"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox.ai Publish</Link><Link href="/app/publish/team" className="text-vx-accent underline">Team</Link></nav>
    <h1 className="text-3xl font-black">Activity</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">See who changed publishing settings, conversations, approvals and team access for this brand.</p>
    {account && <BrandSwitcher />}
    {account ? <Activity key={account} /> : <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>}
  </Main></>;
}

function Activity() {
  const [events, setEvents] = useState(null); const [error, setError] = useState(null);
  const [cursor, setCursor] = useState(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => { let active = true; listSocialActivity().then((result) => { if (active) { setEvents(result.events || []); setCursor(result.next_cursor); setNotice(result.notice || ''); } })
    .catch((next) => { if (active) setError(activityLoadError(next)); });
    return () => { active = false; }; }, []);
  async function older() {
    setBusy(true); setError(null);
    try {
      const result = await listSocialActivity(50, cursor);
      setEvents((current) => [...current, ...(result.events || []).filter((event) => !current.some((item) => item.source === event.source && item.id === event.id))]);
      setCursor(result.next_cursor); setNotice(result.notice || '');
    } catch (next) { setError(activityLoadError(next, true)); }
    finally { setBusy(false); }
  }
  if (error && events === null) return <ActivityError error={error} boxed />;
  if (events === null) return <p className="text-sm text-vx-fg-muted">Loading activity…</p>;
  return <div className="space-y-4">
    {notice && <p role="status" className="text-sm text-vx-fg-muted">{notice}</p>}
    {events.length === 0 ? <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-muted">No brand activity has been recorded yet.</p> : <ol className="divide-y divide-vx-border rounded-2xl border border-vx-border">{events.map((event) => <li key={`${event.source}-${event.id}`} className="flex flex-wrap items-start justify-between gap-3 p-4">
    <div><p className="font-bold">{activityLabel(event.action)}</p><p className="mt-1 break-all text-sm text-vx-fg-muted">{event.actor_email} · {event.source}</p></div>
    <time className="text-xs text-vx-fg-muted" dateTime={event.created_at}>{time.format(new Date(event.created_at))}</time>
  </li>)}</ol>}
    {error && <ActivityError error={error} />}
    {cursor ? <button type="button" disabled={busy} className={`${button} disabled:opacity-50`} onClick={older}>{busy ? 'Loading…' : 'Load older activity'}</button>
      : events.length > 0 && !notice && <p className="text-sm text-vx-fg-muted">Showing all {events.length} recorded events.</p>}
  </div>;
}

function ActivityError({ error, boxed = false }) {
  return <p role="alert" className={`text-sm text-vx-danger${boxed ? ' rounded-xl border border-vx-danger/40 p-4' : ''}`}>
    {error.message}
    {error.planHref && <>{' '}<Link href={error.planHref} className="font-bold underline underline-offset-4">View Publish Plan</Link></>}
  </p>;
}
