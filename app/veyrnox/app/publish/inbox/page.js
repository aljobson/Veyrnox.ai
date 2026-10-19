'use client';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

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
const states = [{ key: 'unresolved', labelKey: 'app.publish.inbox.state.unresolved' }, { key: 'unread', labelKey: 'app.publish.inbox.state.unread' }, { key: 'all', labelKey: 'presets.cat.ALL' }, { key: 'resolved', labelKey: 'app.publish.inbox.state.resolved' }];
const kinds = [{ key: '', labelKey: 'app.publish.inbox.allActivity' }, { key: 'message', labelKey: 'app.publish.inbox.messages' }, { key: 'comment', labelKey: 'cinema.comments.comments' }, { key: 'review', labelKey: 'app.publish.inbox.reviews' }];


function useInboxI18n() {
  const { t, locale } = useI18n();
  const dateTime = new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' });
  const label = network => tOr(t, `app.publish.network.${network}`, NETWORKS.find(item => item.key === network)?.label || network);
  const kindLabel = kind => tOr(t, `app.publish.inbox.kind.${kind}`, kind);
  const priorityLabel = priority => tOr(t, `app.publish.inbox.priorityValue.${priority}`, priority);
  const number = value => locale === 'en' ? value : Number(value).toLocaleString(localeTag(locale));
  return { t, dateTime, label, kindLabel, priorityLabel, number };
}
function errorText(error, fallback) {
  if (error?.body?.error === 'publish_plan_required' || error?.body?.error === 'plan_required') return 'plan_required';
  return fallback;
}

export default function PublishInbox() {
  const { t } = useI18n();
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-8">
    <nav aria-label={t("label.Publish")} className="mb-2 flex flex-wrap gap-4 text-sm">
      <Link href="/app/publish" className="text-vx-accent underline">Veyrnox.ai Publish</Link>
      <Link href="/app/publish/calendar" className="text-vx-accent underline">{t("app.publish.inbox.calendar")}</Link>
      <Link href="/app/publish/analytics" className="text-vx-accent underline">{t("publish.f7.name")}</Link>
      <Link href="/app/publish/contacts" className="text-vx-accent underline">{t("app.publish.nav.contacts")}</Link>
      <Link href="/app/publish/workflows" className="text-vx-accent underline">{t("app.publish.inbox.workflows")}</Link>
    </nav>
    <h1 data-testid="publish-inbox-title" className="text-3xl font-black">{t("app.publish.inbox.title")}</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">{t("app.publish.inbox.intro")}</p>
    {account && <BrandSwitcher />}
    {account ? <InboxDashboard key={account} /> : <SignIn />}
  </Main></>;
}

function SignIn() {
  const { t } = useI18n();
  return <div><p className="mb-4 text-vx-fg-body">{t("app.publish.inbox.signIn")}</p>
    <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button></div>;
}

function InboxDashboard() {
  const { t, dateTime, label, kindLabel, priorityLabel, number } = useInboxI18n();
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
    }).catch(() => { if (active) setError(t("app.publish.inbox.loadFailed")); });
    return () => { active = false; };
  }, [t]);

  const load = useCallback(() => {
    if (paid !== true || enabled !== true) return;
    setError('');
    listSocialInbox({ accountId: accountId || undefined, state, kind: kind || undefined, search: search || undefined,
      assignee: assignee || undefined, priority: priority || undefined, tag: tag || undefined })
      .then((result) => setListing(result))
      .catch((nextError) => setError(errorText(nextError, t("app.publish.inbox.conversationsFailed"))));
  }, [accountId, assignee, enabled, kind, paid, priority, search, state, tag, t]);
  useEffect(() => { load(); }, [load, refresh]);

  if (error && error !== 'plan_required') return <p role="alert" className="text-sm text-vx-danger">{error}</p>;
  if (accounts === null || paid === null || enabled === null) return <p className="text-sm text-vx-fg-muted">{t("app.publish.inbox.loading")}</p>;
  if (!enabled) return <p className="text-sm text-vx-fg-muted">{t("app.publish.inbox.notOpen")}</p>;
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
    } catch { setError(t("app.publish.inbox.updateFailed")); }
  }

  return <div className="space-y-5">
    <InboxAnalytics accountId={accountId} />
    <section aria-label={t("app.publish.inbox.filters")} className="rounded-2xl border border-vx-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.analytics.account")}<select className={input} value={accountId} onChange={(event) => { setAccountId(event.target.value); setSelected(null); }}>
            <option value="">{t("app.publish.inbox.allAccounts")}</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{label(account.network)} · {account.display_name || account.external_account_id}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.nav.activity")}<select className={input} value={kind} onChange={(event) => { setKind(event.target.value); setSelected(null); }}>
            {kinds.map((item) => <option key={item.key} value={item.key}>{t(item.labelKey)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.inbox.assignee")}<select className={input} value={assignee} onChange={(event) => { setAssignee(event.target.value); setSelected(null); }}>
            <option value="">{t("app.publish.inbox.anyone")}</option><option value="unassigned">{t("app.publish.inbox.unassigned")}</option>
            {(listing?.members || []).map((member) => <option key={member.user_id} value={member.user_id}>{member.email}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.inbox.priority")}<select className={input} value={priority} onChange={(event) => { setPriority(event.target.value); setSelected(null); }}>
            <option value="">{t("app.publish.inbox.anyPriority")}</option><option value="normal">{t("app.publish.inbox.priority.normal")}</option><option value="high">{t("app.publish.inbox.priority.high")}</option><option value="urgent">{t("app.publish.inbox.priority.urgent")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.inbox.tag")}<select className={input} value={tag} onChange={(event) => { setTag(event.target.value); setSelected(null); }}>
            <option value="">{t("app.publish.inbox.anyTag")}</option>{(listing?.tags || []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setSelected(null); }}>
          <label className="grid min-w-52 flex-1 gap-1 text-xs font-bold text-vx-fg-muted">{t("ui.search")}<input className={input} value={searchDraft} maxLength={100} onChange={(event) => setSearchDraft(event.target.value)} data-testid="publish-inbox-query" placeholder={t("app.publish.inbox.searchPlaceholder")} />
          </label>
          <button data-testid="publish-inbox-search" className={`${button} self-end`} type="submit">{t("ui.search")}</button>
        </form>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("app.publish.inbox.conversationState")}>
        {states.map((item) => <button key={item.key} type="button" aria-pressed={state === item.key}
          className={`${button} ${state === item.key ? 'border-vx-accent bg-vx-accent text-black' : ''}`}
          onClick={() => { setState(item.key); setSelected(null); }}>{t(item.labelKey)}{listing?.counts?.[item.key] !== undefined ? ` (${number(listing.counts[item.key])})` : ''}</button>)}
      </div>
    </section>

    <div className="grid min-h-[520px] overflow-hidden rounded-2xl border border-vx-border md:grid-cols-[360px_1fr]">
      <section aria-label={t("app.publish.inbox.conversations")} className="border-b border-vx-border md:border-e md:border-b-0">
        {listing === null && <p className="p-5 text-sm text-vx-fg-muted">{t("app.publish.inbox.loadingConversations")}</p>}
        {listing?.threads?.length === 0 && <Empty accountId={accountId} />}
        <ul>{(listing?.threads || []).map((thread) => <li key={thread.id} className="border-b border-vx-border last:border-b-0">
          <button type="button" onClick={() => choose(thread)} className={`w-full p-4 text-start hover:bg-vx-panel focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent ${selected?.thread?.id === thread.id || selected?.summary?.id === thread.id ? 'bg-vx-panel' : ''}`}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5"><NetworkLogo network={thread.network} /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm">{thread.participant_name || t("app.publish.inbox.socialUser")}</strong>
                {thread.unread_count > 0 && <span className="rounded-full bg-vx-accent px-2 py-0.5 text-xs font-black text-black">{number(thread.unread_count)}</span>}</span>
                <span className="mt-1 block truncate text-xs text-vx-fg-muted">{label(thread.network)} · {kindLabel(thread.kind)} · {thread.account_name || t("app.publish.analytics.account")}</span>
                <span className="mt-2 block text-sm text-vx-fg-body line-clamp-2">{thread.preview || thread.subject || t("app.publish.inbox.mediaActivity")}</span>
                <span className="mt-2 flex flex-wrap gap-1">{thread.priority !== 'normal' && <span className="rounded-full border border-vx-border px-2 py-0.5 text-[11px] font-bold capitalize">{priorityLabel(thread.priority)}</span>}
                  {thread.assigned_email && <span className="rounded-full border border-vx-border px-2 py-0.5 text-[11px]">{thread.assigned_email}</span>}
                  {(thread.tags || []).map((item) => <span key={item} className="rounded-full bg-vx-panel px-2 py-0.5 text-[11px]">{item}</span>)}</span>
                <span className="mt-2 block text-xs text-vx-fg-muted">{dateTime.format(new Date(thread.latest_message_at))}{thread.status === 'resolved' ? t("app.publish.inbox.resolvedSuffix") : ''}</span>
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
  const { t } = useI18n();
  return <section className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6">
    <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">{t("publish.plan.colPlan")}</p>
    <h2 className="mt-2 text-2xl font-black">{t("app.publish.inbox.unlock")}</h2>
    <p className="mt-3 text-sm text-vx-fg-body">{t("app.publish.inbox.planIncludes")}</p>
    <Link href="/app/publish/plan" className="mt-5 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">{t("app.publish.smartlink.viewPlan")}</Link>
  </section>;
}

function Empty({ accountId }) {
  const { t } = useI18n();
  return <div className="p-6"><h2 data-testid="publish-inbox-empty" className="font-bold">{t("app.publish.inbox.emptyTitle")}</h2>
    <p className="mt-2 text-sm text-vx-fg-muted">{accountId ? t("app.publish.inbox.emptyAccount") : t("app.publish.inbox.emptyConnected")}</p></div>;
}

function Conversation({ selected, members, canTriage, canReply, onAction, onReplied }) {
  const { t, dateTime, label, kindLabel } = useInboxI18n();
  const [replyDraft, setReplyDraft] = useState('');
  if (!selected) return <section className="grid place-items-center p-8 text-center"><div><h2 className="font-bold">{t("app.publish.inbox.choose")}</h2><p className="mt-2 text-sm text-vx-fg-muted">{t("app.publish.inbox.chooseHelp")}</p></div></section>;
  if (selected.loading) return <p className="p-6 text-sm text-vx-fg-muted">{t("app.publish.inbox.loadingConversation")}</p>;
  if (selected.error) return <p role="alert" className="p-6 text-sm text-vx-danger">{t("app.publish.inbox.conversationFailed")}</p>;
  const { thread, messages } = selected;
  return <section className="flex min-h-[520px] flex-col" aria-label={t('app.publish.inbox.conversationWith', { name: thread.participant_name || t('app.publish.inbox.socialUserLower') })}>
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-vx-border p-4">
      <div><h2 className="flex items-center gap-2 font-bold"><NetworkLogo network={thread.network} />{thread.participant_name || t("app.publish.inbox.socialUser")}</h2>
        <p className="mt-1 text-xs text-vx-fg-muted">{label(thread.network)} · {kindLabel(thread.kind)} · {thread.account_name || t("app.publish.analytics.account")}</p></div>
      <div className="flex gap-2">{canTriage && <button type="button" className={button} onClick={() => onAction(thread.status === 'resolved' ? 'reopen' : 'resolve')}>{thread.status === 'resolved' ? t("app.publish.inbox.reopen") : t("app.publish.inbox.resolve")}</button>}
        {thread.provider_url && <a className={button} href={thread.provider_url} target="_blank" rel="noreferrer">{t('app.publish.inbox.openOn', { network: label(thread.network) })}</a>}</div>
    </header>
    {canTriage && <Workflow key={`${thread.id}:${(thread.tags || []).join('|')}`} thread={thread} members={members} onAction={onAction} />}
    <ol className="flex-1 space-y-3 overflow-y-auto p-4">{messages.map((message) => <li key={message.id} className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.direction === 'outbound' ? 'bg-vx-accent text-black' : 'bg-vx-panel text-vx-fg'}`}>
        <p className="whitespace-pre-wrap text-sm">{message.body || t("app.publish.inbox.attachment")}</p>
        <p className={`mt-2 text-xs ${message.direction === 'outbound' ? 'text-black/70' : 'text-vx-fg-muted'}`}>{dateTime.format(new Date(message.sent_at))}{message.delivery_status === 'failed' ? t("app.publish.inbox.failedSuffix") : ''}</p>
      </div>
    </li>)}</ol>
    {canReply && <InboxReplySuggestions threadId={thread.id} suggestions={selected.suggestions || []} onUse={setReplyDraft} onChanged={onReplied} />}
    <Notes thread={thread} notes={selected.notes || []} canWrite={canTriage} onAdded={onReplied} />
    {canReply ? <Reply thread={thread} body={replyDraft} onBodyChange={setReplyDraft} onReplied={onReplied} /> : <div className="border-t border-vx-border p-4"><p className="text-sm text-vx-fg-muted">{canTriage ? t('app.publish.inbox.triageRole') : t('app.publish.inbox.readOnlyRole')}</p></div>}
  </section>;
}

function Workflow({ thread, members, onAction }) {
  const { t } = useI18n();
  const [tags, setTags] = useState((thread.tags || []).join(', '));
  return <section aria-label={t("app.publish.inbox.workflow")} className="grid gap-3 border-b border-vx-border bg-vx-panel/40 p-4 sm:grid-cols-3">
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.inbox.assignee")}<select className={input} value={thread.assigned_user_id || ''} onChange={(event) => onAction(event.target.value ? 'assign' : 'unassign', event.target.value ? { userId: event.target.value } : undefined)}>
        <option value="">{t("app.publish.inbox.unassigned")}</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.email}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-xs font-bold text-vx-fg-muted">{t("app.publish.inbox.priority")}<select className={input} value={thread.priority || 'normal'} onChange={(event) => onAction('priority', { priority: event.target.value })}>
        <option value="normal">{t("app.publish.inbox.priority.normal")}</option><option value="high">{t("app.publish.inbox.priority.high")}</option><option value="urgent">{t("app.publish.inbox.priority.urgent")}</option>
      </select>
    </label>
    <form className="grid gap-1" onSubmit={(event) => { event.preventDefault(); onAction('tags', { tags: tags.split(',').map((item) => item.trim()).filter(Boolean) }); }}>
      <label className="text-xs font-bold text-vx-fg-muted" htmlFor={`tags-${thread.id}`}>{t("app.publish.inbox.tagsHint")}</label>
      <div className="flex gap-2"><input id={`tags-${thread.id}`} className={`${input} min-w-0 flex-1`} value={tags} maxLength={320} onChange={(event) => setTags(event.target.value)} />
        <button type="submit" className={button}>{t("app.publish.inbox.save")}</button></div>
    </form>
  </section>;
}

function Notes({ thread, notes, canWrite, onAdded }) {
  const { t, dateTime } = useInboxI18n();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); if (!note.trim() || busy) return;
    setBusy(true); setError('');
    try { await addSocialInboxNote(thread.id, note.trim()); setNote(''); await onAdded(); }
    catch { setError(t("app.publish.inbox.noteFailed")); }
    finally { setBusy(false); }
  }
  return <section aria-label={t("app.publish.inbox.notes")} className="border-t border-vx-border bg-vx-panel/30 p-4">
    <h3 className="text-sm font-black">{t("app.publish.inbox.notes")}</h3>
    {notes.length === 0 ? <p className="mt-2 text-xs text-vx-fg-muted">{t("app.publish.inbox.emptyNotes")}</p> : <ol className="mt-3 space-y-2">{notes.map((item) => <li key={item.id} className="rounded-xl border border-vx-border bg-vx-bg p-3"><p className="whitespace-pre-wrap text-sm">{item.body}</p><p className="mt-2 text-xs text-vx-fg-muted">{item.actor_email} · {dateTime.format(new Date(item.created_at))}</p></li>)}</ol>}
    {canWrite && <form onSubmit={submit} className="mt-3 flex gap-2"><input className={`${input} min-w-0 flex-1`} value={note} maxLength={2000} placeholder={t("app.publish.inbox.notePlaceholder")} onChange={(event) => setNote(event.target.value)} />
      <button type="submit" className={button} disabled={busy || !note.trim()}>{busy ? t("social.saving") : t("app.publish.inbox.addNote")}</button></form>}
    {error && <p role="alert" className="mt-2 text-sm text-vx-danger">{error}</p>}
  </section>;
}

function Reply({ thread, body, onBodyChange, onReplied }) {
  const { t, number } = useInboxI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!thread.can_reply) return <div className="border-t border-vx-border p-4"><p className="text-sm text-vx-fg-muted">{t("app.publish.inbox.readOnlyConnection")}</p></div>;
  async function submit(event) {
    event.preventDefault(); if (!body.trim() || busy) return;
    setBusy(true); setError('');
    try { await replyToSocialInboxThread(thread.id, body.trim()); onBodyChange(''); await onReplied(); }
    catch { setError(t("app.publish.inbox.replyFailed")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="border-t border-vx-border p-4">
    <label className="grid gap-2 text-sm font-bold">{t("app.publish.inbox.reply")}<textarea className={`${input} min-h-24 resize-y font-normal`} value={body} maxLength={8000} onChange={(event) => onBodyChange(event.target.value)} /></label>
    <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-vx-fg-muted">{number(body.length)}/{number(8000)}</span><button type="submit" className={`${button} border-vx-accent bg-vx-accent text-black`} disabled={busy || !body.trim()}>{busy ? t("app.publish.inbox.sending") : t("app.publish.inbox.sendReply")}</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-vx-danger">{error}</p>}
  </form>;
}
