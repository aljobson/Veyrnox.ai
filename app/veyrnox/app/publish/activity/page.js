'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialActivity } from '../../../../lib/socialActivityClient';
import BrandSwitcher from '../BrandSwitcher';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold';
const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const labels = {
  connected: 'Connected an account', disconnected: 'Disconnected an account', created_post: 'Created a post',
  rescheduled_post: 'Rescheduled a post', post_rescheduled: 'Rescheduled a post', approved_draft: 'Approved drafts',
  approve_drafts: 'Approved drafts', discarded_draft: 'Discarded drafts', discard_drafts: 'Discarded drafts',
  save_content_preset: 'Saved a content preset', delete_content_preset: 'Deleted a content preset',
  save_publish_queue: 'Saved a posting queue', delete_publish_queue: 'Deleted a posting queue', queue_social_post: 'Queued a post',
  save_smartlink: 'Saved the SmartLink', read: 'Marked a conversation read', unread: 'Marked a conversation unread',
  resolve: 'Resolved a conversation', reopen: 'Reopened a conversation', reply_created: 'Sent an inbox reply',
  invited: 'Invited a team member', accepted: 'Joined the team', role_changed: 'Changed a team role', removed: 'Removed a team member',
  invite_revoked: 'Revoked a team invitation', requested: 'Requested approval', approved: 'Approved a post',
  rejected: 'Rejected a post', canceled: 'Canceled an approval',
};

export default function PublishActivityPage() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-8">
    <nav aria-label="Publish" className="mb-2 flex flex-wrap gap-4 text-sm"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox Publish</Link><Link href="/app/publish/team" className="text-vx-accent underline">Team</Link></nav>
    <h1 className="text-3xl font-black">Activity</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">See who changed publishing settings, conversations, approvals and team access for this brand.</p>
    {account && <BrandSwitcher />}
    {account ? <Activity /> : <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>}
  </Main></>;
}

function Activity() {
  const [events, setEvents] = useState(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; listSocialActivity().then((result) => { if (active) setEvents(result.events || []); })
    .catch((next) => { if (active) setError(next?.status === 403 ? 'Your role cannot view the brand activity log.' : 'Could not load brand activity. Try again.'); });
    return () => { active = false; }; }, []);
  if (error) return <p role="alert" className="rounded-xl border border-vx-danger/40 p-4 text-sm text-vx-danger">{error}</p>;
  if (events === null) return <p className="text-sm text-vx-fg-muted">Loading activity…</p>;
  if (events.length === 0) return <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-muted">No brand activity has been recorded yet.</p>;
  return <ol className="divide-y divide-vx-border rounded-2xl border border-vx-border">{events.map((event) => <li key={`${event.source}-${event.id}`} className="flex flex-wrap items-start justify-between gap-3 p-4">
    <div><p className="font-bold">{labels[event.action] || event.action.replaceAll('_', ' ')}</p><p className="mt-1 text-sm text-vx-fg-muted">{event.actor_email} · {event.source}</p></div>
    <time className="text-xs text-vx-fg-muted" dateTime={event.created_at}>{time.format(new Date(event.created_at))}</time>
  </li>)}</ol>;
}
