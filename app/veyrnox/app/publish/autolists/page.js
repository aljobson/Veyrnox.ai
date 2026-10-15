'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import BrandSwitcher from '../BrandSwitcher';
import { deleteSocialAutolist, listSocialAutolists, saveSocialAutolist } from '../../../../lib/socialAutolistsClient';
import { listSocialQueues } from '../../../../lib/socialQueuesClient';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const blank = (queueId = '') => ({ id: null, name: '', feedUrl: '', queueId, captionTemplate: '{{title}}\n{{link}}', refreshIntervalMinutes: 360, enabled: true, autoSchedule: false });
const intervalLabels = new Map([[30, 'Every 30 minutes'], [60, 'Hourly'], [180, 'Every 3 hours'], [360, 'Every 6 hours'], [720, 'Every 12 hours'], [1440, 'Daily']]);

export default function PublishAutolists() {
  const [autolists, setAutolists] = useState(null), [queues, setQueues] = useState([]), [draft, setDraft] = useState(blank());
  const [brandRole, setBrandRole] = useState('owner'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const canWrite = ['owner', 'manager', 'editor'].includes(brandRole);
  const load = useCallback(async () => {
    try {
      const [a, q] = await Promise.all([listSocialAutolists(), listSocialQueues()]);
      const queueRows = (q.queues || []).filter((row) => row.enabled);
      setAutolists(a.autolists || []); setQueues(queueRows); setBrandRole(a.brandRole || 'owner');
      setDraft((current) => current.queueId || !queueRows[0] ? current : { ...current, queueId: queueRows[0].id });
    } catch { setError('Could not load your Autolists. Check your connection and try again.'); }
  }, []);
  useEffect(() => { const frame = requestAnimationFrame(load); return () => cancelAnimationFrame(frame); }, [load]);
  function edit(row) { setDraft({ id: row.id, name: row.name, feedUrl: row.feed_url, queueId: row.queue_id, captionTemplate: row.caption_template, refreshIntervalMinutes: row.refresh_interval_minutes, enabled: row.enabled, autoSchedule: row.auto_schedule }); setError(''); setMessage(''); }
  async function save() {
    if (!draft.name.trim() || !draft.feedUrl.trim() || !draft.queueId) { setError('Add a name, HTTPS feed URL and posting queue.'); return; }
    setBusy(true); setError(''); setMessage('');
    try { const result = await saveSocialAutolist(draft); await load(); setDraft((current) => ({ ...current, id: result.autolist_id })); setMessage(draft.id ? 'Autolist updated.' : 'Autolist saved. Its first refresh will run within five minutes.'); }
    catch (err) { setError(err?.body?.error === 'autolist_name_taken' ? 'An Autolist with that name already exists.' : 'Could not save that Autolist. Check the feed URL and try again.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!draft.id) return; setBusy(true); setError('');
    try { await deleteSocialAutolist(draft.id); await load(); setDraft(blank(queues[0]?.id)); setMessage('Autolist deleted. Existing scheduled posts remain in the calendar.'); }
    catch { setError('Could not delete that Autolist.'); } finally { setBusy(false); }
  }
  return <><AppNav/><Main className="mx-auto max-w-[980px] space-y-6 px-4 py-10 sm:px-8">
    <div><Link href="/app/publish" className="text-sm text-vx-accent underline">← Publish</Link><h1 className="mt-3 text-3xl font-black">RSS Autolists</h1><p className="mt-2 text-sm text-vx-fg-muted">Turn RSS or Atom feed items into queue-ready posts without copying feed HTML or media.</p></div><BrandSwitcher/>
    <section className="rounded-2xl border border-vx-border p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-bold">Your Autolists</h2>{canWrite&&<button type="button" className={button} onClick={()=>{setDraft(blank(queues[0]?.id));setError('');setMessage('');}}>New Autolist</button>}</div>
      {!canWrite&&<p className="mt-3 text-sm text-vx-fg-muted">Your team role can view Autolists but cannot change them.</p>}{autolists===null&&!error&&<p className="mt-3 text-sm text-vx-fg-muted">Loading…</p>}{autolists?.length===0&&<p className="mt-3 text-sm text-vx-fg-muted">No feeds connected yet.</p>}
      <ul className="mt-3 space-y-2">{(autolists||[]).map((row)=><li key={row.id}><button type="button" disabled={!canWrite} onClick={()=>edit(row)} className="w-full rounded-xl border border-vx-border p-3 text-left disabled:cursor-default"><span className="font-bold">{row.name}</span><span className="block text-xs text-vx-fg-muted">{row.queue_name} · {intervalLabels.get(row.refresh_interval_minutes)} · {row.enabled?'Active':'Paused'} · {row.auto_schedule?'Auto-schedule':'Review first'}</span>{row.last_error&&<span className="mt-1 block text-xs text-vx-danger">Last refresh: {row.last_error.replaceAll('_',' ')}</span>}</button></li>)}</ul>
    </section>
    {draft.id&&<section className="rounded-2xl border border-vx-border p-5"><h2 className="font-bold">Recent feed items</h2><div className="mt-3 divide-y divide-vx-border">{((autolists||[]).find((row)=>row.id===draft.id)?.items||[]).map((item)=><article key={item.id} className="py-3"><div className="flex flex-wrap justify-between gap-2"><a href={item.link} target="_blank" rel="noreferrer" className="font-bold text-vx-accent underline">{item.title}</a><span className="rounded-full bg-vx-panel px-2 py-1 text-xs capitalize">{item.status}</span></div>{item.summary&&<p className="mt-1 line-clamp-2 text-sm text-vx-fg-muted">{item.summary}</p>}</article>)}{!((autolists||[]).find((row)=>row.id===draft.id)?.items||[]).length&&<p className="py-3 text-sm text-vx-fg-muted">No items imported yet.</p>}</div></section>}
    {canWrite&&<section className="space-y-4 rounded-2xl border border-vx-border p-5"><h2 className="font-bold">{draft.id?'Edit Autolist':'Connect a feed'}</h2>
      {queues.length===0?<p role="alert" className="text-sm text-vx-danger">Create an active posting queue before connecting a feed.</p>:<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Name<input value={draft.name} maxLength={80} onChange={(e)=>setDraft({...draft,name:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" placeholder="Company news"/></label><label className="text-sm font-bold">Posting queue<select value={draft.queueId} onChange={(e)=>setDraft({...draft,queueId:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal">{queues.map((queue)=><option key={queue.id} value={queue.id}>{queue.name}</option>)}</select></label></div>}
      <label className="block text-sm font-bold">HTTPS RSS or Atom URL<input type="url" value={draft.feedUrl} maxLength={2048} onChange={(e)=>setDraft({...draft,feedUrl:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" placeholder="https://example.com/feed.xml"/></label>
      <label className="block text-sm font-bold">Caption template<textarea value={draft.captionTemplate} maxLength={4000} rows={4} onChange={(e)=>setDraft({...draft,captionTemplate:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-mono text-sm font-normal"/><span className="mt-1 block text-xs font-normal text-vx-fg-muted">Available fields: {'{{title}}'}, {'{{link}}'} and {'{{summary}}'}.</span></label>
      <label className="block text-sm font-bold">Refresh<select value={draft.refreshIntervalMinutes} onChange={(e)=>setDraft({...draft,refreshIntervalMinutes:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal">{[30,60,180,360,720,1440].map((value)=><option key={value} value={value}>{intervalLabels.get(value)}</option>)}</select></label>
      <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(e)=>setDraft({...draft,enabled:e.target.checked})}/>Refresh this feed</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.autoSchedule} onChange={(e)=>setDraft({...draft,autoSchedule:e.target.checked})}/>Automatically schedule new items</label></div>
      {draft.autoSchedule&&<p role="status" className="rounded-xl bg-vx-panel p-3 text-sm">New unique items become text-only posts in the next open slots for this queue. Feed HTML and media are never copied. Turn this off to review imported items first.</p>}
      <p className="text-xs text-vx-fg-muted">Feeds refresh on the five-minute worker cycle. Items are deduplicated by their feed ID or canonical link.</p>{error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}{message&&<p role="status" className="text-sm text-vx-accent">{message}</p>}
      <div className="flex gap-3"><button type="button" disabled={busy||queues.length===0} onClick={save} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy?'Saving…':'Save Autolist'}</button>{draft.id&&<button type="button" disabled={busy} onClick={remove} className={button}>Delete Autolist</button>}</div>
    </section>}
  </Main></>;
}
