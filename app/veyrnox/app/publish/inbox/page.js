'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialAccounts, NETWORKS } from '../../../../lib/socialConnectClient';
import { addSocialInboxNote, getSocialInboxThread, listSocialInbox, listSocialInboxSuggestions, replyToSocialInboxThread, updateSocialInboxThread } from '../../../../lib/socialInboxClient';
import NetworkLogo from '../NetworkLogo';
import BrandSwitcher from '../BrandSwitcher';
import InboxAnalytics from './InboxAnalytics';
import InboxReplySuggestions from './InboxReplySuggestions';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const states = [{ key: 'unresolved', label: 'Unresolved' }, { key: 'unread', label: 'Unread' }, { key: 'all', label: 'All' }, { key: 'resolved', label: 'Resolved' }];
const kinds = [{ key: '', label: 'All activity' }, { key: 'message', label: 'Messages' }, { key: 'comment', label: 'Comments' }, { key: 'review', label: 'Reviews' }];
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function label(network) { return NETWORKS.find((item) => item.key === network)?.label || network; }
function errorText(error, fallback) {
  if (error?.body?.error === 'publish_plan_required' || error?.body?.error === 'plan_required') return 'plan_required';
  return fallback;
}

export default function PublishInbox() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-8">
    <nav aria-label="Publish" className="mb-2 flex flex-wrap gap-4 text-sm">
      <Link href="/app/publish" className="text-vx-accent underline">Veyrnox Publish</Link>
      <Link href="/app/publish/calendar" className="text-vx-accent underline">Calendar</Link>
      <Link href="/app/publish/analytics" className="text-vx-accent underline">Analytics</Link>
      <Link href="/app/publish/contacts" className="text-vx-accent underline">Contacts</Link>
      <Link href="/app/publish/workflows" className="text-vx-accent underline">Workflows</Link>
    </nav>
    <h1 className="text-3xl font-black">Inbox</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">Read messages, comments and reviews across connected accounts. Switch to one account whenever you need its own inbox.</p>
    {account && <BrandSwitcher />}
    {account ? <InboxDashboard key={account} /> : <SignIn />}
  </Main></>;
}

function SignIn() {
  return <div><p className="mb-4 text-vx-fg-body">Sign in to open your social inbox.</p>
    <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button></div>;
}

function InboxDashboard() {
  const [accounts, setAccounts] = useState(null);
  const [brandRole, setBrandRole] = useState('owner');
  const [enabled, setEnabled] = useState(null);
  const [workflowsEnabled, setWorkflowsEnabled] = useState(false);
  const [paid, setPaid] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [state, setState] = useState('unresolved');
  const [kind, setKind] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('');
  const [tag, setTag] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [listing, setListing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const canTriage = ['owner', 'manager', 'editor', 'reviewer'].includes(brandRole);
  const canReply = ['owner', 'manager', 'editor'].includes(brandRole);

  useEffect(() => {
    let active = true;
    listSocialAccounts().then((accountResult) => {
      if (!active) return;
      setAccounts((accountResult.accounts || []).filter((item) => item.status === 'active'));
      setBrandRole(accountResult.brandRole || 'owner');
      setEnabled(accountResult.inboxEnabled === true);
      setWorkflowsEnabled(accountResult.inboxWorkflowsEnabled === true);
      setPaid(accountResult.planTier === 'publish');
    }).catch(() => { if (active) setError('Could not load the inbox. Check your connection and try again.'); });
    return () => { active = false; };
  }, []);

  const load = useCallback(() => {
    if (paid !== true || enabled !== true) return;
    setError('');
    listSocialInbox({ accountId: accountId || undefined, state, kind: kind || undefined, search: search || undefined,
      assignee: assignee || undefined, priority: priority || undefined, tag: tag || undefined })
      .then((result) => setListing(result))
      .catch((nextError) => setError(errorText(nextError, 'Could not load conversations. Check your connection and try again.')));
  }, [accountId, assignee, enabled, kind, paid, priority, search, state, tag]);
  useEffect(() => { load(); }, [load, refresh]);

  if (error && error !== 'plan_required') return <p role="alert" className="text-sm text-vx-danger">{error}</p>;
  if (accounts === null || paid === null || enabled === null) return <p className="text-sm text-vx-fg-muted">Loading your inbox…</p>;
  if (!enabled) return <p className="text-sm text-vx-fg-muted">The social inbox is not open yet.</p>;
  if (!paid || error === 'plan_required') return <Upgrade />;

  async function choose(thread) {
    setSelected({ loading: true, summary: thread });
    try {
      const detail = await getSocialInboxThread(thread.id);
      const suggestions = workflowsEnabled ? await listSocialInboxSuggestions(thread.id).then((result) => result.suggestions || []).catch(() => []) : [];
      setSelected({ ...detail, suggestions });
      if (canTriage && thread.unread_count > 0) {
        await updateSocialInboxThread(thread.id, 'read');
        setRefresh((value) => value + 1);
      }
    } catch { setSelected({ error: true, summary: thread }); }
  }

  async function act(action, value) {
    if (!selected?.thread) return;
    try {
      await updateSocialInboxThread(selected.thread.id, action, value);
      const detail = await getSocialInboxThread(selected.thread.id);
      setSelected(detail); setRefresh((value) => value + 1);
    } catch { setError('That conversation could not be updated. Try again.'); }
  }

  return <div className="space-y-5">
    <InboxAnalytics accountId={accountId} />
    <section aria-label="Inbox filters" className="rounded-2xl border border-vx-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Account
          <select className={input} value={accountId} onChange={(event) => { setAccountId(event.target.value); setSelected(null); }}>
            <option value="">All connected accounts</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{label(account.network)} · {account.display_name || account.external_account_id}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Activity
          <select className={input} value={kind} onChange={(event) => { setKind(event.target.value); setSelected(null); }}>
            {kinds.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Assigned to
          <select className={input} value={assignee} onChange={(event) => { setAssignee(event.target.value); setSelected(null); }}>
            <option value="">Anyone</option><option value="unassigned">Unassigned</option>
            {(listing?.members || []).map((member) => <option key={member.user_id} value={member.user_id}>{member.email}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Priority
          <select className={input} value={priority} onChange={(event) => { setPriority(event.target.value); setSelected(null); }}>
            <option value="">Any priority</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Tag
          <select className={input} value={tag} onChange={(event) => { setTag(event.target.value); setSelected(null); }}>
            <option value="">Any tag</option>{(listing?.tags || []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setSelected(null); }}>
          <label className="grid min-w-52 flex-1 gap-1 text-xs font-bold text-vx-fg-muted">Search
            <input className={input} value={searchDraft} maxLength={100} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Name, subject or message" />
          </label>
          <button className={`${button} self-end`} type="submit">Search</button>
        </form>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Conversation state">
        {states.map((item) => <button key={item.key} type="button" aria-pressed={state === item.key}
          className={`${button} ${state === item.key ? 'border-vx-accent bg-vx-accent text-black' : ''}`}
          onClick={() => { setState(item.key); setSelected(null); }}>{item.label}{listing?.counts?.[item.key] !== undefined ? ` (${listing.counts[item.key]})` : ''}</button>)}
      </div>
    </section>

    <div className="grid min-h-[520px] overflow-hidden rounded-2xl border border-vx-border md:grid-cols-[360px_1fr]">
      <section aria-label="Conversations" className="border-b border-vx-border md:border-r md:border-b-0">
        {listing === null && <p className="p-5 text-sm text-vx-fg-muted">Loading conversations…</p>}
        {listing?.threads?.length === 0 && <Empty accountId={accountId} />}
        <ul>{(listing?.threads || []).map((thread) => <li key={thread.id} className="border-b border-vx-border last:border-b-0">
          <button type="button" onClick={() => choose(thread)} className={`w-full p-4 text-left hover:bg-vx-panel focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent ${selected?.thread?.id === thread.id || selected?.summary?.id === thread.id ? 'bg-vx-panel' : ''}`}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5"><NetworkLogo network={thread.network} /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{thread.participant_name || 'Social user'}</strong>
                {thread.unread_count > 0 && <span className="rounded-full bg-vx-accent px-2 py-0.5 text-xs font-black text-black">{thread.unread_count}</span>}</span>
                <span className="mt-1 block truncate text-xs text-vx-fg-muted">{label(thread.network)} · {thread.kind} · {thread.account_name || 'Account'}</span>
                <span className="mt-2 block text-sm text-vx-fg-body line-clamp-2">{thread.preview || thread.subject || 'Media activity'}</span>
                <span className="mt-2 flex flex-wrap gap-1">{thread.priority !== 'normal' && <span className="rounded-full border border-vx-border px-2 py-0.5 text-[11px] font-bold capitalize">{thread.priority}</span>}
                  {thread.assigned_email && <span className="rounded-full border border-vx-border px-2 py-0.5 text-[11px]">{thread.assigned_email}</span>}
                  {(thread.tags || []).map((item) => <span key={item} className="rounded-full bg-vx-panel px-2 py-0.5 text-[11px]">{item}</span>)}</span>
                <span className="mt-2 block text-xs text-vx-fg-muted">{dateTime.format(new Date(thread.latest_message_at))}{thread.status === 'resolved' ? ' · Resolved' : ''}</span>
              </span>
            </div>
          </button>
        </li>)}</ul>
      </section>
      <Conversation key={selected?.thread?.id || selected?.summary?.id || 'empty'} selected={selected} members={listing?.members || []} canTriage={canTriage} canReply={canReply} onAction={act} onReplied={async () => {
        if (!selected?.thread) return;
        const detail = await getSocialInboxThread(selected.thread.id);
        const suggestions = workflowsEnabled ? await listSocialInboxSuggestions(selected.thread.id).then((result) => result.suggestions || []).catch(() => []) : [];
        setSelected({ ...detail, suggestions }); setRefresh((value) => value + 1);
      }} />
    </div>
  </div>;
}

function Upgrade() {
  return <section className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6">
    <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">Publish Plan</p>
    <h2 className="mt-2 text-2xl font-black">Unlock the social inbox</h2>
    <p className="mt-3 text-sm text-vx-fg-body">The unified inbox, per-account views, conversation status and supported replies are included with the $15 monthly Publish Plan.</p>
    <Link href="/app/publish/plan" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">View Publish Plan</Link>
  </section>;
}

function Empty({ accountId }) {
  return <div className="p-6"><h2 className="font-bold">Nothing in this view</h2>
    <p className="mt-2 text-sm text-vx-fg-muted">{accountId ? 'This account has no matching conversations yet.' : 'Connected-platform conversations will appear here as their inbox permissions are approved and enabled.'}</p></div>;
}

function Conversation({ selected, members, canTriage, canReply, onAction, onReplied }) {
  const [replyDraft, setReplyDraft] = useState('');
  if (!selected) return <section className="grid place-items-center p-8 text-center"><div><h2 className="font-bold">Choose a conversation</h2><p className="mt-2 text-sm text-vx-fg-muted">Open a message, comment or review to read its history and respond where supported.</p></div></section>;
  if (selected.loading) return <p className="p-6 text-sm text-vx-fg-muted">Loading conversation…</p>;
  if (selected.error) return <p role="alert" className="p-6 text-sm text-vx-danger">Could not load this conversation. Try again.</p>;
  const { thread, messages } = selected;
  return <section className="flex min-h-[520px] flex-col" aria-label={`Conversation with ${thread.participant_name || 'social user'}`}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-vx-border p-4">
      <div><h2 className="flex items-center gap-2 font-bold"><NetworkLogo network={thread.network} />{thread.participant_name || 'Social user'}</h2>
        <p className="mt-1 text-xs text-vx-fg-muted">{label(thread.network)} · {thread.kind} · {thread.account_name || 'Account'}</p></div>
      <div className="flex gap-2">{canTriage && <button type="button" className={button} onClick={() => onAction(thread.status === 'resolved' ? 'reopen' : 'resolve')}>{thread.status === 'resolved' ? 'Reopen' : 'Resolve'}</button>}
        {thread.provider_url && <a className={button} href={thread.provider_url} target="_blank" rel="noreferrer">Open on {label(thread.network)}</a>}</div>
    </header>
    {canTriage && <Workflow key={`${thread.id}:${(thread.tags || []).join('|')}`} thread={thread} members={members} onAction={onAction} />}
    <ol className="flex-1 space-y-3 overflow-y-auto p-4">{messages.map((message) => <li key={message.id} className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.direction === 'outbound' ? 'bg-vx-accent text-black' : 'bg-vx-panel text-vx-fg'}`}>
        <p className="whitespace-pre-wrap text-sm">{message.body || 'Media attachment'}</p>
        <p className={`mt-2 text-xs ${message.direction === 'outbound' ? 'text-black/70' : 'text-vx-fg-muted'}`}>{dateTime.format(new Date(message.sent_at))}{message.delivery_status === 'failed' ? ' · Failed' : ''}</p>
      </div>
    </li>)}</ol>
    {canReply && <InboxReplySuggestions threadId={thread.id} suggestions={selected.suggestions || []} onUse={setReplyDraft} onChanged={onReplied} />}
    <Notes thread={thread} notes={selected.notes || []} canWrite={canTriage} onAdded={onReplied} />
    {canReply ? <Reply thread={thread} body={replyDraft} onBodyChange={setReplyDraft} onReplied={onReplied} /> : <div className="border-t border-vx-border p-4"><p className="text-sm text-vx-fg-muted">Your team role can read this conversation{canTriage ? ' and manage its workflow' : ''}, but cannot reply.</p></div>}
  </section>;
}

function Workflow({ thread, members, onAction }) {
  const [tags, setTags] = useState((thread.tags || []).join(', '));
  return <section aria-label="Conversation workflow" className="grid gap-3 border-b border-vx-border bg-vx-panel/40 p-4 sm:grid-cols-3">
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Assigned to
      <select className={input} value={thread.assigned_user_id || ''} onChange={(event) => onAction(event.target.value ? 'assign' : 'unassign', event.target.value ? { userId: event.target.value } : undefined)}>
        <option value="">Unassigned</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.email}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">Priority
      <select className={input} value={thread.priority || 'normal'} onChange={(event) => onAction('priority', { priority: event.target.value })}>
        <option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
      </select>
    </label>
    <form className="grid gap-1" onSubmit={(event) => { event.preventDefault(); onAction('tags', { tags: tags.split(',').map((item) => item.trim()).filter(Boolean) }); }}>
      <label className="text-xs font-bold text-vx-fg-muted" htmlFor={`tags-${thread.id}`}>Tags, separated by commas</label>
      <div className="flex gap-2"><input id={`tags-${thread.id}`} className={`${input} min-w-0 flex-1`} value={tags} maxLength={320} onChange={(event) => setTags(event.target.value)} />
        <button type="submit" className={button}>Save</button></div>
    </form>
  </section>;
}

function Notes({ thread, notes, canWrite, onAdded }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); if (!note.trim() || busy) return;
    setBusy(true); setError('');
    try { await addSocialInboxNote(thread.id, note.trim()); setNote(''); await onAdded(); }
    catch { setError('The internal note could not be saved. Try again.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Internal notes" className="border-t border-vx-border bg-vx-panel/30 p-4">
    <h3 className="text-sm font-black">Internal notes</h3>
    {notes.length === 0 ? <p className="mt-2 text-xs text-vx-fg-muted">No team notes yet.</p> : <ol className="mt-3 space-y-2">{notes.map((item) => <li key={item.id} className="rounded-xl border border-vx-border bg-vx-bg p-3"><p className="whitespace-pre-wrap text-sm">{item.body}</p><p className="mt-2 text-xs text-vx-fg-muted">{item.actor_email} · {dateTime.format(new Date(item.created_at))}</p></li>)}</ol>}
    {canWrite && <form onSubmit={submit} className="mt-3 flex gap-2"><input className={`${input} min-w-0 flex-1`} value={note} maxLength={2000} placeholder="Add a note for your team" onChange={(event) => setNote(event.target.value)} />
      <button type="submit" className={button} disabled={busy || !note.trim()}>{busy ? 'Saving…' : 'Add note'}</button></form>}
    {error && <p role="alert" className="mt-2 text-sm text-vx-danger">{error}</p>}
  </section>;
}

function Reply({ thread, body, onBodyChange, onReplied }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!thread.can_reply) return <div className="border-t border-vx-border p-4"><p className="text-sm text-vx-fg-muted">Read only for this connection. Replies become available after the platform grants its comment-management permission.</p></div>;
  async function submit(event) {
    event.preventDefault(); if (!body.trim() || busy) return;
    setBusy(true); setError('');
    try { await replyToSocialInboxThread(thread.id, body.trim()); onBodyChange(''); await onReplied(); }
    catch { setError('The reply was not delivered. Check the connected account and try again.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="border-t border-vx-border p-4">
    <label className="grid gap-2 text-sm font-bold">Reply<textarea className={`${input} min-h-24 resize-y font-normal`} value={body} maxLength={8000} onChange={(event) => onBodyChange(event.target.value)} /></label>
    <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-vx-fg-muted">{body.length}/8000</span><button type="submit" className={`${button} border-vx-accent bg-vx-accent text-black`} disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send reply'}</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-vx-danger">{error}</p>}
  </form>;
}
