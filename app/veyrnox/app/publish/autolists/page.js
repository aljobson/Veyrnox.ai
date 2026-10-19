'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import BrandSwitcher from '../BrandSwitcher';
import { deleteSocialAutolist, listSocialAutolists, saveSocialAutolist } from '../../../../lib/socialAutolistsClient';
import { listSocialQueues } from '../../../../lib/socialQueuesClient';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { canEditPublishing } from '../../../_lib/publishPresentation';

const button = 'rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
// Canonical RSS template syntax, never translated or changed in saved drafts.
const FEED_FIELDS = Object.fromEntries(['title', 'link', 'summary'].map(field => [field, `{{${field}}}`]));
const blank = (queueId = '') => ({ id: null, name: '', feedUrl: '', queueId, captionTemplate: [FEED_FIELDS.title, FEED_FIELDS.link].join('\n'), refreshIntervalMinutes: 360, enabled: true, autoSchedule: false });
const INTERVALS = [30, 60, 180, 360, 720, 1440];

const currentAccount=()=>getSession()?.user?.id||'';
const noAccount=()=>'';

export default function PublishAutolists() {
  const { t } = useI18n();
  const account=useSyncExternalStore(onSessionChange,currentAccount,noAccount);
  return account?<Autolists key={account}/>:<><AppNav/><Main className="mx-auto max-w-[980px] space-y-4 px-4 py-10 sm:px-8"><h1 data-testid="publish-autolists-title" className="text-3xl font-black">{t("app.publish.nav.autolists")}</h1><p>{t("app.publish.autolists.signIn")}</p><button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button></Main></>;
}

function Autolists() {
  const { t } = useI18n();
  const [autolists, setAutolists] = useState(null), [queues, setQueues] = useState([]), [draft, setDraft] = useState(blank());
  const [brandRole, setBrandRole] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const canWrite = canEditPublishing(brandRole);
  const load = useCallback(async () => {
    setError('');
    try {
      const [a, q] = await Promise.all([listSocialAutolists(), listSocialQueues()]);
      const queueRows = (q.queues || []).filter((row) => row.enabled);
      setAutolists(a.autolists || []); setQueues(queueRows); setBrandRole(a.brandRole||'viewer');
      setDraft((current) => current.queueId || !queueRows[0] ? current : { ...current, queueId: queueRows[0].id });
    } catch { setBrandRole(null); setError(t("app.publish.autolists.loadFailed")); }
  }, [t]);
  useEffect(() => { const frame = requestAnimationFrame(load); return () => cancelAnimationFrame(frame); }, [load]);
  function edit(row) { setDraft({ id: row.id, name: row.name, feedUrl: row.feed_url, queueId: row.queue_id, captionTemplate: row.caption_template, refreshIntervalMinutes: row.refresh_interval_minutes, enabled: row.enabled, autoSchedule: row.auto_schedule }); setError(''); setMessage(''); }
  async function save() {
    if (!draft.name.trim() || !draft.feedUrl.trim() || !draft.queueId) { setError(t("app.publish.autolists.required")); return; }
    setBusy(true); setError(''); setMessage('');
    try { const result = await saveSocialAutolist(draft); await load(); setDraft((current) => ({ ...current, id: result.autolist_id })); setMessage(draft.id ? t("app.publish.autolists.updated") : t("app.publish.autolists.saved")); }
    catch (err) { setError(err?.body?.error === 'autolist_name_taken' ? t("app.publish.autolists.nameTaken") : t("app.publish.autolists.saveFailed")); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!draft.id) return; setBusy(true); setError('');
    try { await deleteSocialAutolist(draft.id); await load(); setDraft(blank(queues[0]?.id)); setMessage(t("app.publish.autolists.deleted")); }
    catch { setError(t("app.publish.autolists.deleteFailed")); } finally { setBusy(false); }
  }
  return <><AppNav/><Main className="mx-auto max-w-[980px] space-y-6 px-4 py-10 sm:px-8">
    <div><Link href="/app/publish" className="text-sm text-vx-accent underline">{t("app.publish.autolists.back")}</Link><h1 data-testid="publish-autolists-title" className="mt-3 text-3xl font-black">{t("app.publish.nav.autolists")}</h1><p className="mt-2 text-sm text-vx-fg-muted">{t("app.publish.autolists.intro")}</p></div><BrandSwitcher/>
    <section className="rounded-2xl border border-vx-border p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-bold">{t("app.publish.autolists.yours")}</h2>{canWrite&&<button type="button" className={button} onClick={()=>{setDraft(blank(queues[0]?.id));setError('');setMessage('');}}>{t("app.publish.autolists.new")}</button>}</div>
      {brandRole&&!canWrite&&<p className="mt-3 text-sm text-vx-fg-muted">{t("app.publish.autolists.roleHelp")}</p>}{autolists===null&&!error&&<p className="mt-3 text-sm text-vx-fg-muted">{t("cinema.titlePage.loading")}</p>}{autolists?.length===0&&<p className="mt-3 text-sm text-vx-fg-muted">{t("app.publish.autolists.empty")}</p>}
      <ul className="mt-3 space-y-2">{(autolists||[]).map((row)=><li key={row.id}><button type="button" disabled={!canWrite} onClick={()=>edit(row)} className="w-full rounded-xl border border-vx-border p-3 text-start disabled:cursor-default"><span className="font-bold">{row.name}</span><span className="block text-xs text-vx-fg-muted">{row.queue_name} · {tOr(t, `app.publish.autolists.interval.${row.refresh_interval_minutes}`, '')} · {row.enabled?t("app.publish.plan.active"):t("app.publish.autolists.paused")} · {row.auto_schedule?t("app.publish.autolists.autoSchedule"):t("app.publish.autolists.reviewFirst")}</span>{row.last_error&&<span className="mt-1 block text-xs text-vx-danger">{t("app.publish.autolists.lastRefresh")}{' '}{tOr(t, `app.publish.autolists.error.${row.last_error}`, t('app.publish.autolists.refreshFailed'))}</span>}</button></li>)}</ul>
    </section>
    {error&&<p role="alert" className="text-sm text-vx-danger">{error} <button type="button" className={button} onClick={load}>{t("recovery.retry")}</button></p>}
    {draft.id&&<section className="rounded-2xl border border-vx-border p-5"><h2 className="font-bold">{t("app.publish.autolists.recent")}</h2><div className="mt-3 divide-y divide-vx-border">{((autolists||[]).find((row)=>row.id===draft.id)?.items||[]).map((item)=><article key={item.id} className="py-3"><div className="flex flex-wrap justify-between gap-2"><a href={item.link} target="_blank" rel="noreferrer" className="font-bold text-vx-accent underline">{item.title}</a><span className="rounded-full bg-vx-panel px-2 py-1 text-xs capitalize">{tOr(t, `app.publish.status.${item.status}`, item.status)}</span></div>{item.summary&&<p className="mt-1 line-clamp-2 text-sm text-vx-fg-muted">{item.summary}</p>}</article>)}{!((autolists||[]).find((row)=>row.id===draft.id)?.items||[]).length&&<p className="py-3 text-sm text-vx-fg-muted">{t("app.publish.autolists.noItems")}</p>}</div></section>}
    {canWrite&&<section data-testid="publish-autolists-form" className="space-y-4 rounded-2xl border border-vx-border p-5"><h2 className="font-bold">{draft.id?t("app.publish.autolists.edit"):t("app.publish.autolists.connect")}</h2>
      {queues.length===0?<p role="alert" className="text-sm text-vx-danger">{t("app.publish.autolists.queueRequired")}</p>:<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">{t("app.publish.autolists.name")}<input value={draft.name} maxLength={80} onChange={(e)=>setDraft({...draft,name:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" placeholder={t("app.publish.autolists.nameExample")}/></label><label className="text-sm font-bold">{t("app.publish.composer.queue")}<select value={draft.queueId} onChange={(e)=>setDraft({...draft,queueId:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal">{queues.map((queue)=><option key={queue.id} value={queue.id}>{queue.name}</option>)}</select></label></div>}
      <label className="block text-sm font-bold">{t("app.publish.autolists.url")}<input type="url" value={draft.feedUrl} maxLength={2048} onChange={(e)=>setDraft({...draft,feedUrl:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" placeholder={t("app.publish.autolists.urlExample")}/></label>
      <label className="block text-sm font-bold">{t("app.publish.autolists.caption")}<textarea value={draft.captionTemplate} maxLength={4000} rows={4} onChange={(e)=>setDraft({...draft,captionTemplate:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-mono text-sm font-normal"/><span className="mt-1 block text-xs font-normal text-vx-fg-muted">{t('app.publish.autolists.fields', FEED_FIELDS)}</span></label>
      <label className="block text-sm font-bold">{t("app.publish.developer.refresh")}<select value={draft.refreshIntervalMinutes} onChange={(e)=>setDraft({...draft,refreshIntervalMinutes:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal">{INTERVALS.map((value)=><option key={value} value={value}>{t(`app.publish.autolists.interval.${value}`)}</option>)}</select></label>
      <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(e)=>setDraft({...draft,enabled:e.target.checked})}/>{t("app.publish.autolists.refreshFeed")}</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.autoSchedule} onChange={(e)=>setDraft({...draft,autoSchedule:e.target.checked})}/>{t("app.publish.autolists.scheduleNew")}</label></div>
      {draft.autoSchedule&&<p role="status" className="rounded-xl bg-vx-panel p-3 text-sm">{t("app.publish.autolists.scheduleHelp")}</p>}
      <p className="text-xs text-vx-fg-muted">{t("app.publish.autolists.refreshHelp")}</p>{message&&<p role="status" className="text-sm text-vx-accent">{message}</p>}
      <div className="flex gap-3"><button type="button" disabled={busy||queues.length===0} onClick={save} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy?t("social.saving"):t("app.publish.autolists.save")}</button>{draft.id&&<button type="button" disabled={busy} onClick={remove} className={button}>{t("app.publish.autolists.delete")}</button>}</div>
    </section>}
  </Main></>;
}
