'use client';
import { pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import NetworkLogo from '../NetworkLogo';
import BrandSwitcher from '../BrandSwitcher';
import { listSocialAccounts } from '../../../../lib/socialConnectClient';
import { deleteSocialQueue, listSocialQueues, saveSocialQueue } from '../../../../lib/socialQueuesClient';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { canEditPublishing } from '../../../_lib/publishPresentation';

const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const button='rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const blank=()=>({id:null,name:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',accountIds:[],enabled:true,slots:[{weekday:1,time:'09:00'}]});
const toTime=(minute)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
const toMinute=(time)=>{const[h,m]=time.split(':').map(Number);return h*60+m;};

const currentAccount=()=>getSession()?.user?.id||'';
const noAccount=()=>'';

export default function PublishQueues(){
  const { t } = useI18n();
  const account=useSyncExternalStore(onSessionChange,currentAccount,noAccount);
  return account?<Queues key={account}/>:<><AppNav/><Main className="mx-auto max-w-[900px] space-y-4 px-4 py-10 sm:px-8"><h1 data-testid="publish-queues-title" className="text-3xl font-black">{t("app.publish.nav.queues")}</h1><p>{t("app.publish.queues.signIn")}</p><button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button></Main></>;
}

function Queues(){
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : Number(value).toLocaleString(localeTag(locale));
  const dayLabel = i => locale === 'en' ? DAYS[i] : new Intl.DateTimeFormat(localeTag(locale), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)));
  const[accounts,setAccounts]=useState([]),[queues,setQueues]=useState(null),[draft,setDraft]=useState(blank),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[brandRole,setBrandRole]=useState(null);
  const canWrite=canEditPublishing(brandRole);
  const load=useCallback(async()=>{setError('');try{const[a,q]=await Promise.all([listSocialAccounts(),listSocialQueues()]);setAccounts((a.accounts||[]).filter((item)=>item.status==='active'&&item.publishingEnabled!==false));setBrandRole(a.brandRole||'viewer');setQueues(q.queues||[]);}catch{setBrandRole(null);setError(t("app.publish.queues.loadFailed"));}},[t]);
  useEffect(()=>{void Promise.resolve().then(load);},[load]);
  function edit(queue){setDraft({id:queue.id,name:queue.name,timezone:queue.timezone,accountIds:queue.account_ids||[],enabled:queue.enabled,slots:(queue.slots||[]).map((slot)=>({weekday:slot.weekday,time:toTime(slot.minute)}))});setError('');setMessage('');}
  function toggleAccount(id){setDraft((current)=>({...current,accountIds:current.accountIds.includes(id)?current.accountIds.filter((value)=>value!==id):[...current.accountIds,id]}));}
  function updateSlot(index,patch){setDraft((current)=>({...current,slots:current.slots.map((slot,i)=>i===index?{...slot,...patch}:slot)}));}
  async function save(){if(!draft.name.trim()){setError(t("app.publish.queues.nameRequired"));return;}if(!draft.accountIds.length){setError(t("app.publish.queues.accountRequired"));return;}setBusy(true);setError('');setMessage('');try{const result=await saveSocialQueue({id:draft.id,name:draft.name,timezone:draft.timezone,accountIds:draft.accountIds,enabled:draft.enabled,slots:draft.slots.map((slot)=>({weekday:Number(slot.weekday),minute:toMinute(slot.time)}))});await load();setDraft((current)=>({...current,id:result.queue_id}));setMessage(draft.id?t("app.publish.queues.updated"):t("app.publish.queues.saved"));}catch(err){setError(err?.body?.error==='queue_name_taken'?t("app.publish.queues.nameTaken"):t("app.publish.queues.saveFailed"));}finally{setBusy(false);}}
  async function remove(){if(!draft.id)return;setBusy(true);setError('');try{await deleteSocialQueue(draft.id);await load();setDraft(blank());setMessage(t("app.publish.queues.deleted"));}catch{setError(t("app.publish.queues.deleteFailed"));}finally{setBusy(false);}}
  return <><AppNav/><Main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10 space-y-6"><div><Link href="/app/publish" className="text-sm text-vx-accent underline">{t("app.publish.autolists.back")}</Link><h1 data-testid="publish-queues-title" className="mt-3 text-3xl font-black">{t("app.publish.nav.queues")}</h1><p className="mt-2 text-sm text-vx-fg-muted">{t("app.publish.queues.intro")}</p></div><BrandSwitcher/>
    {error&&<p role="alert" className="text-sm text-vx-danger">{error} <button type="button" className={button} onClick={load}>{t("recovery.retry")}</button></p>}
    <section className="rounded-2xl border border-vx-border p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-bold">{t("app.publish.queues.yours")}</h2>{canWrite&&<button type="button" className={button} onClick={()=>{setDraft(blank());setError('');setMessage('');}}>{t("app.publish.queues.new")}</button>}</div>{brandRole&&!canWrite&&<p className="mt-3 text-sm text-vx-fg-muted">{t("app.publish.queues.readOnly")}</p>}{queues===null&&!error&&<p className="mt-3 text-sm text-vx-fg-muted">{t("cinema.titlePage.loading")}</p>}{queues?.length===0&&<p className="mt-3 text-sm text-vx-fg-muted">{t("app.publish.queues.empty")}</p>}<ul className="mt-3 space-y-2">{(queues||[]).map((queue)=><li key={queue.id}><button type="button" disabled={!canWrite} onClick={()=>edit(queue)} className="w-full rounded-xl border border-vx-border p-3 text-start disabled:cursor-default"><span className="font-bold">{queue.name}</span><span className="block text-xs text-vx-fg-muted">{t(pluralKey(t, locale, 'app.publish.queues.slots', queue.slots.length), { count: number(queue.slots.length) })} · {queue.timezone} · {queue.enabled?t("app.publish.plan.active"):t("app.publish.autolists.paused")}</span></button></li>)}</ul></section>
    {canWrite&&<section data-testid="publish-queues-form" className="rounded-2xl border border-vx-border p-5 space-y-4"><h2 className="font-bold">{draft.id?t("app.publish.queues.edit"):t("app.publish.queues.create")}</h2><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">{t("app.publish.autolists.name")}<input value={draft.name} maxLength={80} onChange={(e)=>setDraft({...draft,name:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal" placeholder={t("app.publish.queues.example")}/></label><label className="text-sm font-bold">{t("app.publish.queues.timezone")}<input value={draft.timezone} maxLength={64} onChange={(e)=>setDraft({...draft,timezone:e.target.value})} className="mt-1 w-full rounded-lg border border-vx-border bg-transparent px-3 py-2 font-normal"/></label></div>
      <fieldset><legend className="text-sm font-bold mb-2">{t("app.publish.composer.postTo")}</legend><div className="flex flex-wrap gap-2">{accounts.map((account)=><button key={account.id} type="button" aria-pressed={draft.accountIds.includes(account.id)} onClick={()=>toggleAccount(account.id)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold ${draft.accountIds.includes(account.id)?'border-vx-accent text-vx-accent':'border-vx-border'}`}><NetworkLogo network={account.network} className="h-4 w-4"/>{account.display_name||account.external_account_id}</button>)}</div></fieldset>
      <fieldset><legend className="sr-only">{t("app.publish.queues.weekly")}</legend><div className="mb-2 flex items-center justify-between"><span className="text-sm font-bold" aria-hidden="true">{t("app.publish.queues.weekly")}</span><button type="button" className={button} data-testid="publish-queue-add-time" disabled={draft.slots.length>=35} onClick={()=>setDraft({...draft,slots:[...draft.slots,{weekday:1,time:'09:00'}]})}>{t("app.publish.queues.addTime")}</button></div><div className="space-y-2">{draft.slots.map((slot,index)=><div key={index} className="flex gap-2"><select aria-label={t('app.publish.queues.day', { number: number(index + 1) })} value={slot.weekday} onChange={(e)=>updateSlot(index,{weekday:Number(e.target.value)})} className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm">{DAYS.map((day,i)=><option key={day} value={i+1}>{dayLabel(i)}</option>)}</select><input data-testid={`publish-queue-time-${index + 1}`} aria-label={t('app.publish.queues.time', { number: number(index + 1) })} type="time" value={slot.time} onChange={(e)=>updateSlot(index,{time:e.target.value})} className="rounded-lg border border-vx-border bg-transparent px-3 py-2 text-sm"/><button type="button" className={button} disabled={draft.slots.length===1} onClick={()=>setDraft({...draft,slots:draft.slots.filter((_,i)=>i!==index)})}>{t("app.publish.smartlink.remove")}</button></div>)}</div></fieldset>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(e)=>setDraft({...draft,enabled:e.target.checked})}/>{t("app.publish.queues.use")}</label>{message&&<p role="status" className="text-sm text-vx-accent">{message}</p>}<div className="flex gap-3"><button type="button" className="rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50" disabled={busy} onClick={save}>{busy?t("social.saving"):t("app.publish.queues.save")}</button>{draft.id&&<button type="button" className={button} disabled={busy} onClick={remove}>{t("app.publish.queues.delete")}</button>}</div></section>}
  </Main></>;
}
