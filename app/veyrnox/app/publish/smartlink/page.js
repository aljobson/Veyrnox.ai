'use client';
import { pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { getSocialSmartLink, getSocialSmartLinkAccounts, saveSocialSmartLink } from '../../../../lib/socialSmartLinkClient';
import { onSocialBrandChange, getSocialBrandRevision, getSocialBrandSnapshot, assertSocialBrandSnapshot } from '../../../../lib/socialBrandSelection';
import BrandSwitcher from '../BrandSwitcher';

const account=()=>getSession()?.user?.id||''; const none=()=>'';
const control='rounded-xl border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const button='rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const empty={slug:'',title:'',bio:'',avatarUrl:'',theme:'midnight',published:false,items:[]};

export default function SmartLinkEditor(){
  const { t } = useI18n();const auth=useSyncExternalStore(onSessionChange,account,none);return <><AppNav/><Main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-8">
  <nav className="mb-2 flex gap-4 text-sm" aria-label={t("label.Publish")}><Link href="/app/publish" className="text-vx-accent underline">Veyrnox.ai Publish</Link><Link href="/app/publish/analytics" className="text-vx-accent underline">{t("publish.f7.name")}</Link></nav>
  <h1 className="text-3xl font-black">{t("publish.f8.name")}</h1><p className="mt-2 mb-4 text-sm text-vx-fg-muted">{t("app.publish.smartlink.intro")}</p>
  {auth && <BrandSwitcher/>}
  {auth?<Editor/>:<button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button>}
  </Main></>}

function Editor(){
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? value : Number(value).toLocaleString(localeTag(locale));const [form,setForm]=useState(empty);const [totals,setTotals]=useState({views:0,clicks:0});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [upgrade,setUpgrade]=useState(false);const [brandRole,setBrandRole]=useState(null);const [loaded,setLoaded]=useState(null);const [attempt,setAttempt]=useState(0);
  const brandRevision=useSyncExternalStore(onSocialBrandChange,getSocialBrandRevision,()=>0);
  let current=false;try{if(loaded){assertSocialBrandSnapshot(loaded);current=true;}}catch{/* The working brand changed; hide stale fields before the next effect. */}
  const canWrite=current&&['owner','manager','editor'].includes(brandRole);
  useEffect(()=>{
    let active=true;const snapshot=getSocialBrandSnapshot();
    Promise.resolve().then(()=>{
      if(!active)return null;
      setLoading(true);setLoaded(null);setBrandRole(null);setUpgrade(false);setMessage('');setBusy(false);
      return Promise.all([getSocialSmartLink(snapshot),getSocialSmartLinkAccounts(snapshot)]);
    }).then(result=>{
      if(!result)return;const [data,accounts]=result;
      if(!active)return;assertSocialBrandSnapshot(snapshot);
      setForm(data.smartlink?{slug:data.smartlink.slug,title:data.smartlink.title,bio:data.smartlink.bio||'',avatarUrl:data.smartlink.avatar_url||'',theme:data.smartlink.theme,published:data.smartlink.published,items:data.items.map(i=>({id:i.id,label:i.label,url:i.url,enabled:i.enabled,clicks:i.clicks||0}))}:empty);
      setTotals(data.totals||{views:0,clicks:0});setBrandRole(accounts.brandRole||null);setLoaded(snapshot);
    }).catch(e=>{if(!active)return;if(e?.status===402||e?.body?.error==='plan_required')setUpgrade(true);else setMessage(t("app.publish.smartlink.loadFailed"));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[brandRevision,attempt,t]);
  if(loading||(!current&&!message&&!upgrade))return <p className="text-sm text-vx-fg-muted">{t("app.publish.smartlink.loading")}</p>;
  if(upgrade)return <section className="rounded-2xl border border-vx-accent/40 p-6"><h2 className="text-xl font-black">{t("app.publish.smartlink.plan")}</h2><p className="mt-2 text-sm text-vx-fg-body">{t("app.publish.smartlink.planDescription")}</p><Link href="/app/publish/plan" className="mt-4 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">{t("app.publish.smartlink.viewPlan")}</Link></section>;
  if(!current)return <section className="space-y-3 rounded-2xl border border-vx-border p-5"><p role="status">{message}</p><button type="button" className={button} data-testid="smartlink-retry" onClick={()=>setAttempt(value=>value+1)}>{t("recovery.retry")}</button></section>;
  const change=(key,value)=>setForm((v)=>({...v,[key]:value}));const changeItem=(index,key,value)=>change('items',form.items.map((item,i)=>i===index?{...item,[key]:value}:item));
  async function save(event){event.preventDefault();if(!canWrite||busy)return;setBusy(true);setMessage('');try{assertSocialBrandSnapshot(loaded);await saveSocialSmartLink(form,loaded);const saved=await getSocialSmartLink(loaded);assertSocialBrandSnapshot(loaded);setForm(v=>({...v,items:saved.items.map(i=>({id:i.id,label:i.label,url:i.url,enabled:i.enabled,clicks:i.clicks||0}))}));setTotals(saved.totals);setMessage(t("app.publish.smartlink.saved"));}catch(e){try{assertSocialBrandSnapshot(loaded);}catch{return;}setMessage(e?.status===409?t("app.publish.smartlink.taken"):t("app.publish.smartlink.saveFailed"));}finally{try{assertSocialBrandSnapshot(loaded);setBusy(false);}catch{/* Never apply an old save result to a new brand. */}}}
  return <form onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_340px]">
    <fieldset disabled={!canWrite||busy} className="contents"><div className="space-y-5">{!canWrite&&<p className="rounded-xl bg-vx-panel p-3 text-sm text-vx-fg-muted">{t("app.publish.smartlink.readOnly")}</p>}<section className="grid gap-4 rounded-2xl border border-vx-border p-5 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-bold">{t("app.publish.smartlink.address")}<span className="flex items-center"><span className="rounded-s-xl border border-e-0 border-vx-border bg-vx-panel px-3 py-2 text-xs text-vx-fg-muted">veyrnox.ai/s/</span><input required pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]" maxLength={48} className={`${control} min-w-0 flex-1 rounded-s-none`} value={form.slug} onChange={e=>change('slug',e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))}/></span></label>
      <label className="grid gap-1 text-sm font-bold">{t("app.publish.smartlink.theme")}<select className={control} value={form.theme} onChange={e=>change('theme',e.target.value)}><option value="midnight">{t("app.publish.smartlink.midnight")}</option><option value="light">{t("app.publish.smartlink.light")}</option><option value="sunset">{t("app.publish.smartlink.sunset")}</option></select></label>
      <label className="grid gap-1 text-sm font-bold sm:col-span-2">{t("cinema.creatorWorkspace.title")}<input data-testid="smartlink-title" required maxLength={80} className={control} value={form.title} onChange={e=>change('title',e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-bold sm:col-span-2">{t("cinema.socialCinema.bio")}<textarea maxLength={280} className={`${control} min-h-24`} value={form.bio} onChange={e=>change('bio',e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-bold sm:col-span-2">{t("app.publish.smartlink.avatar")}{' '}<span className="font-normal text-vx-fg-muted">{t("app.publish.smartlink.optionalImage")}</span><input type="url" className={control} value={form.avatarUrl} onChange={e=>change('avatarUrl',e.target.value)}/></label>
    </section>
    <section className="rounded-2xl border border-vx-border p-5"><div className="flex items-center justify-between"><h2 className="font-black">{t("app.publish.smartlink.links")}</h2><button type="button" className={button} disabled={form.items.length>=20} onClick={()=>change('items',[...form.items,{label:'',url:'',enabled:true,clicks:0}])}>{t("app.publish.smartlink.add")}</button></div>
      <div className="mt-4 space-y-3">{form.items.length===0&&<p className="text-sm text-vx-fg-muted">{t("app.publish.smartlink.first")}</p>}{form.items.map((item,index)=><fieldset key={index} className="grid gap-3 rounded-xl border border-vx-border p-4"><legend className="px-2 text-xs font-bold text-vx-fg-muted">{t('app.publish.smartlink.link', { number: number(index+1) })}{item.clicks ? ` · ${t(pluralKey(t, locale, 'app.publish.smartlink.clickCount', item.clicks), { count: number(item.clicks) })}` : ''}</legend><input data-testid="smartlink-link-label" aria-label={t('app.publish.smartlink.linkLabel', { number: number(index+1) })} required maxLength={60} placeholder={t("app.publish.smartlink.label")} className={control} value={item.label} onChange={e=>changeItem(index,'label',e.target.value)}/><input aria-label={t('app.publish.smartlink.linkUrl', { number: number(index+1) })} required type="url" placeholder="https://" className={control} value={item.url} onChange={e=>changeItem(index,'url',e.target.value)}/><div className="flex justify-between"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.enabled} onChange={e=>changeItem(index,'enabled',e.target.checked)}/>{t("app.publish.smartlink.visible")}</label><button type="button" className="text-sm text-vx-danger underline" onClick={()=>change('items',form.items.filter((_,i)=>i!==index))}>{t("app.publish.smartlink.remove")}</button></div></fieldset>)}</div>
    </section>
    <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.published} onChange={e=>change('published',e.target.checked)}/>{t("app.publish.smartlink.publish")}</label>{canWrite&&<button data-testid="smartlink-save" className={`${button} border-vx-accent bg-vx-accent text-black`} disabled={busy}>{busy?t("social.saving"):t("app.publish.smartlink.save")}</button>}{message&&<p role="status" className="text-sm">{message}</p>}</div></div></fieldset>
    <aside className="space-y-4"><dl className="grid grid-cols-2 gap-3"><Stat label={t("app.publish.smartlink.views")} value={totals.views}/><Stat label={t("app.publish.smartlink.clicks")} value={totals.clicks}/></dl><div className="rounded-2xl border border-vx-border p-5 text-sm"><h2 className="font-black">{t("app.publish.smartlink.publicPage")}</h2>{form.slug?<a href={`/s/${form.slug}`} target="_blank" rel="noreferrer" className="mt-2 block break-all text-vx-accent underline">veyrnox.ai/s/{form.slug}</a>:<p className="mt-2 text-vx-fg-muted">{t("app.publish.smartlink.preview")}</p>}<p className="mt-3 text-xs text-vx-fg-muted">{t("app.publish.smartlink.visibility")}</p></div></aside>
  </form>}
function Stat({label,value}){const { locale } = useI18n(); return <div className="rounded-2xl border border-vx-border p-4"><dt className="text-xs font-bold text-vx-fg-muted">{label}</dt><dd className="mt-1 text-2xl font-black">{Number(value||0).toLocaleString(localeTag(locale))}</dd></div>}
