'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialAccounts, NETWORKS } from '../../../../lib/socialConnectClient';
import { deleteSocialInboxWorkflow, listSocialInboxWorkflows, saveSocialInboxWorkflow } from '../../../../lib/socialInboxClient';
import BrandSwitcher from '../BrandSwitcher';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const blank = { id: null, name: '', accountId: '', kind: '', keyword: '', matchMode: 'contains', replyText: '', enabled: true };
const label = (network) => NETWORKS.find((item) => item.key === network)?.label || network;

export default function InboxWorkflowsPage() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  return <><AppNav /><Main className="mx-auto max-w-[980px] px-4 py-10 sm:px-8">
    <nav aria-label="Publish" className="mb-2 flex flex-wrap gap-4 text-sm"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox Publish</Link><Link href="/app/publish/inbox" className="text-vx-accent underline">Inbox</Link></nav>
    <h1 className="text-3xl font-black">Inbox workflows</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">Match incoming messages, comments or reviews and prepare a reply for your team. Nothing is sent until a person reviews and sends it.</p>
    {account && <BrandSwitcher />}{account ? <WorkflowManager key={account} /> : <p className="text-sm text-vx-fg-muted">Sign in to manage workflows.</p>}
  </Main></>;
}

function WorkflowManager() {
  const [accounts, setAccounts] = useState([]); const [items, setItems] = useState([]); const [role, setRole] = useState('viewer');
  const [enabled, setEnabled] = useState(null); const [form, setForm] = useState(blank); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const canEdit = ['owner', 'manager', 'editor'].includes(role);
  const load = useCallback(async () => {
    setError('');
    try {
      const accountResult = await listSocialAccounts();
      setAccounts((accountResult.accounts || []).filter((item) => item.status === 'active'));
      setEnabled(accountResult.inboxWorkflowsEnabled === true && accountResult.inboxEnabled === true && accountResult.planTier === 'publish');
      if (accountResult.inboxWorkflowsEnabled && accountResult.inboxEnabled && accountResult.planTier === 'publish') {
        const result = await listSocialInboxWorkflows(); setItems(result.workflows || []); setRole(result.brandRole || accountResult.brandRole || 'viewer');
      }
    } catch { setError('Could not load inbox workflows. Check your connection and try again.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function edit(item) { setForm({ id: item.id, name: item.name, accountId: item.account_id || '', kind: item.kind || '', keyword: item.keyword,
    matchMode: item.match_mode, replyText: item.reply_text, enabled: item.enabled }); }
  async function save(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await saveSocialInboxWorkflow(form); setForm(blank); await load(); }
    catch { setError('The workflow could not be saved. Check each field and try again.'); }
    finally { setBusy(false); }
  }
  async function remove(id) {
    if (busy) return; setBusy(true); setError('');
    try { await deleteSocialInboxWorkflow(id); if (form.id === id) setForm(blank); await load(); }
    catch { setError('The workflow could not be deleted. Try again.'); }
    finally { setBusy(false); }
  }
  if (error && enabled === null) return <p role="alert" className="text-sm text-vx-danger">{error}</p>;
  if (enabled === null) return <p className="text-sm text-vx-fg-muted">Loading workflows…</p>;
  if (!enabled) return <section className="rounded-2xl border border-vx-border p-6"><h2 className="font-bold">Workflows are not open yet</h2><p className="mt-2 text-sm text-vx-fg-muted">They require the Publish Plan and the inbox workflows rollout switch.</p></section>;
  return <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
    <section><h2 className="text-xl font-black">Your rules</h2>{items.length === 0 ? <p className="mt-3 text-sm text-vx-fg-muted">No workflows yet.</p> : <ul className="mt-3 space-y-3">{items.map((item) => <li key={item.id} className="rounded-2xl border border-vx-border p-4">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{item.name}</h3><p className="mt-1 text-xs text-vx-fg-muted">{item.account_id ? `${label(item.network)} · ${item.account_name || 'Account'}` : 'All connected accounts'} · {item.kind || 'All activity'} · {item.match_mode} “{item.keyword}”</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.enabled ? 'bg-vx-accent text-black' : 'bg-vx-panel text-vx-fg-muted'}`}>{item.enabled ? 'On' : 'Off'}</span></div>
      <p className="mt-3 whitespace-pre-wrap rounded-xl bg-vx-panel p-3 text-sm">{item.reply_text}</p><p className="mt-2 text-xs text-vx-fg-muted">{item.suggestion_count || 0} suggestions created</p>
      {canEdit && <div className="mt-3 flex gap-2"><button className={button} type="button" onClick={() => edit(item)}>Edit</button><button className={button} type="button" disabled={busy} onClick={() => remove(item.id)}>Delete</button></div>}
    </li>)}</ul>}</section>
    {canEdit ? <form onSubmit={save} className="h-fit rounded-2xl border border-vx-border p-5"><h2 className="text-lg font-black">{form.id ? 'Edit workflow' : 'New workflow'}</h2>
      <label className="mt-4 grid gap-1 text-xs font-bold">Name<input className={input} value={form.name} maxLength={80} required onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="mt-3 grid gap-1 text-xs font-bold">Account<select className={input} value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}><option value="">All connected accounts</option>{accounts.map((item) => <option key={item.id} value={item.id}>{label(item.network)} · {item.display_name || item.external_account_id}</option>)}</select></label>
      <label className="mt-3 grid gap-1 text-xs font-bold">Activity<select className={input} value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}><option value="">Messages, comments and reviews</option><option value="message">Messages</option><option value="comment">Comments</option><option value="review">Reviews</option></select></label>
      <div className="mt-3 grid grid-cols-[1fr_110px] gap-2"><label className="grid gap-1 text-xs font-bold">Keyword<input className={input} value={form.keyword} maxLength={100} required onChange={(event) => setForm({ ...form, keyword: event.target.value })} /></label><label className="grid gap-1 text-xs font-bold">Match<select className={input} value={form.matchMode} onChange={(event) => setForm({ ...form, matchMode: event.target.value })}><option value="contains">Contains</option><option value="exact">Exact</option></select></label></div>
      <label className="mt-3 grid gap-1 text-xs font-bold">Suggested reply<textarea className={`${input} min-h-32 resize-y font-normal`} value={form.replyText} maxLength={8000} required onChange={(event) => setForm({ ...form, replyText: event.target.value })} /></label>
      <label className="mt-3 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />Enabled</label>
      <div className="mt-4 flex gap-2"><button className={`${button} border-vx-accent bg-vx-accent text-black`} disabled={busy} type="submit">{busy ? 'Saving…' : 'Save workflow'}</button>{form.id && <button className={button} type="button" onClick={() => setForm(blank)}>Cancel</button>}</div>
      {error && <p role="alert" className="mt-3 text-sm text-vx-danger">{error}</p>}
    </form> : <p className="rounded-2xl border border-vx-border p-5 text-sm text-vx-fg-muted">Your team role can view workflows but cannot change them.</p>}
  </div>;
}
