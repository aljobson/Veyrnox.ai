'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { listSocialAccounts } from '../../../../lib/socialConnectClient';
import { getSocialSmartLink, saveSocialSmartLink } from '../../../../lib/socialSmartLinkClient';
import BrandSwitcher from '../BrandSwitcher';

const account=()=>getSession()?.user?.id||''; const none=()=>'';
const control='rounded-xl border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const button='rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50';
const empty={slug:'',title:'',bio:'',avatarUrl:'',theme:'midnight',published:false,items:[]};

export default function SmartLinkEditor(){const auth=useSyncExternalStore(onSessionChange,account,none);return <><AppNav/><Main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-8">
  <nav className="mb-2 flex gap-4 text-sm" aria-label="Publish"><Link href="/app/publish" className="text-vx-accent underline">Veyrnox Publish</Link><Link href="/app/publish/analytics" className="text-vx-accent underline">Analytics</Link></nav>
  <h1 className="text-3xl font-black">SmartLink</h1><p className="mt-2 mb-4 text-sm text-vx-fg-muted">One branded page for every place you want your audience to go, with click totals built in.</p>
  {auth && <BrandSwitcher/>}
  {auth?<Editor/>:<button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>}
  </Main></>}

function Editor(){const [form,setForm]=useState(empty);const [totals,setTotals]=useState({views:0,clicks:0});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [upgrade,setUpgrade]=useState(false);const [brandRole,setBrandRole]=useState('owner');
  const canWrite=brandRole==='owner';
  useEffect(()=>{Promise.all([getSocialSmartLink(),listSocialAccounts()]).then(([data,accounts])=>{if(data.smartlink)setForm({slug:data.smartlink.slug,title:data.smartlink.title,bio:data.smartlink.bio||'',avatarUrl:data.smartlink.avatar_url||'',theme:data.smartlink.theme,published:data.smartlink.published,items:data.items.map(i=>({label:i.label,url:i.url,enabled:i.enabled,clicks:i.clicks||0}))});setTotals(data.totals||{views:0,clicks:0});setBrandRole(accounts.brandRole||'owner');}).catch((e)=>{if(e?.status===402||e?.body?.error==='plan_required')setUpgrade(true);else setMessage('Could not load your SmartLink. Try again.');}).finally(()=>setLoading(false));},[]);
  if(loading)return <p className="text-sm text-vx-fg-muted">Loading your SmartLink…</p>;
  if(upgrade)return <section className="rounded-2xl border border-vx-accent/40 p-6"><h2 className="text-xl font-black">SmartLinks are in the Publish Plan</h2><p className="mt-2 text-sm text-vx-fg-body">Create a branded link page and measure visits and clicks.</p><Link href="/app/publish/plan" className="mt-4 inline-block rounded-full bg-vx-accent px-5 py-2.5 text-sm font-bold text-black">View Publish Plan</Link></section>;
  const change=(key,value)=>setForm((v)=>({...v,[key]:value}));const changeItem=(index,key,value)=>change('items',form.items.map((item,i)=>i===index?{...item,[key]:value}:item));
  async function save(event){event.preventDefault();setBusy(true);setMessage('');try{await saveSocialSmartLink(form);setMessage('SmartLink saved.');}catch(e){setMessage(e?.status===409?'That address is already taken.':'Could not save your SmartLink. Check every URL and try again.');}finally{setBusy(false)}}
  return <form onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_340px]">
    <fieldset disabled={!canWrite} className="contents"><div className="space-y-5">{!canWrite&&<p className="rounded-xl bg-vx-panel p-3 text-sm text-vx-fg-muted">Read-only team access. The brand owner manages this SmartLink.</p>}<section className="grid gap-4 rounded-2xl border border-vx-border p-5 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-bold">Page address<span className="flex items-center"><span className="rounded-l-xl border border-r-0 border-vx-border bg-vx-panel px-3 py-2 text-xs text-vx-fg-muted">veyrnox.ai/s/</span><input required pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]" maxLength={48} className={`${control} min-w-0 flex-1 rounded-l-none`} value={form.slug} onChange={e=>change('slug',e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,''))}/></span></label>
      <label className="grid gap-1 text-sm font-bold">Theme<select className={control} value={form.theme} onChange={e=>change('theme',e.target.value)}><option value="midnight">Midnight</option><option value="light">Light</option><option value="sunset">Sunset</option></select></label>
      <label className="grid gap-1 text-sm font-bold sm:col-span-2">Title<input required maxLength={80} className={control} value={form.title} onChange={e=>change('title',e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-bold sm:col-span-2">Bio<textarea maxLength={280} className={`${control} min-h-24`} value={form.bio} onChange={e=>change('bio',e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-bold sm:col-span-2">Avatar URL <span className="font-normal text-vx-fg-muted">optional HTTPS image</span><input type="url" className={control} value={form.avatarUrl} onChange={e=>change('avatarUrl',e.target.value)}/></label>
    </section>
    <section className="rounded-2xl border border-vx-border p-5"><div className="flex items-center justify-between"><h2 className="font-black">Links</h2><button type="button" className={button} disabled={form.items.length>=20} onClick={()=>change('items',[...form.items,{label:'',url:'',enabled:true,clicks:0}])}>Add link</button></div>
      <div className="mt-4 space-y-3">{form.items.length===0&&<p className="text-sm text-vx-fg-muted">Add your first destination.</p>}{form.items.map((item,index)=><fieldset key={index} className="grid gap-3 rounded-xl border border-vx-border p-4"><legend className="px-2 text-xs font-bold text-vx-fg-muted">Link {index+1}{item.clicks?` · ${item.clicks} clicks`:''}</legend><input aria-label={`Link ${index+1} label`} required maxLength={60} placeholder="Label" className={control} value={item.label} onChange={e=>changeItem(index,'label',e.target.value)}/><input aria-label={`Link ${index+1} URL`} required type="url" placeholder="https://" className={control} value={item.url} onChange={e=>changeItem(index,'url',e.target.value)}/><div className="flex justify-between"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.enabled} onChange={e=>changeItem(index,'enabled',e.target.checked)}/>Visible</label><button type="button" className="text-sm text-vx-danger underline" onClick={()=>change('items',form.items.filter((_,i)=>i!==index))}>Remove</button></div></fieldset>)}</div>
    </section>
    <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.published} onChange={e=>change('published',e.target.checked)}/>Publish this page</label>{canWrite&&<button className={`${button} border-vx-accent bg-vx-accent text-black`} disabled={busy}>{busy?'Saving…':'Save SmartLink'}</button>}{message&&<p role="status" className="text-sm">{message}</p>}</div></div></fieldset>
    <aside className="space-y-4"><dl className="grid grid-cols-2 gap-3"><Stat label="Views" value={totals.views}/><Stat label="Clicks" value={totals.clicks}/></dl><div className="rounded-2xl border border-vx-border p-5 text-sm"><h2 className="font-black">Public page</h2>{form.slug?<a href={`/s/${form.slug}`} target="_blank" rel="noreferrer" className="mt-2 block break-all text-vx-accent underline">veyrnox.ai/s/{form.slug}</a>:<p className="mt-2 text-vx-fg-muted">Choose an address to preview.</p>}<p className="mt-3 text-xs text-vx-fg-muted">Only enabled links appear. Turning Publish off hides the page immediately.</p></div></aside>
  </form>}
function Stat({label,value}){return <div className="rounded-2xl border border-vx-border p-4"><dt className="text-xs font-bold text-vx-fg-muted">{label}</dt><dd className="mt-1 text-2xl font-black">{Number(value||0).toLocaleString()}</dd></div>}
