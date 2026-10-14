'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { ConfirmDialog } from '../../../_components/ConfirmDialog';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { createSocialApiKey, listSocialApiKeys, revokeSocialApiKey } from '../../../../lib/socialDeveloperClient';
import BrandSwitcher from '../BrandSwitcher';

const currentAccount=()=>getSession()?.user?.id||'';
const noAccount=()=>'';
const button='rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const input='rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm';
const scopes=[['accounts:read','Read connected accounts'],['posts:read','Read posts and delivery status'],['posts:write','Create posts']];
const initial={label:'',expiresInDays:90,scopes:['accounts:read','posts:read']};

export default function Developer(){
  const account=useSyncExternalStore(onSessionChange,currentAccount,noAccount);
  return <><AppNav/><Main className="mx-auto max-w-[900px] px-4 py-10 sm:px-8">
    <Link href="/app/publish" className="text-sm text-vx-accent underline">Veyrnox Publish</Link>
    <h1 className="mt-3 text-3xl font-black">Developer API</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">Create expiring, scoped keys for your own Publish integrations. Keys are shown once and stored only as hashes.</p>
    {account&&<BrandSwitcher/>}
    {account?<ApiKeys key={account}/>:<p className="text-sm">Sign in to manage API keys. <button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button></p>}
  </Main></>;
}

function ApiKeys(){
  const [keys,setKeys]=useState(null),[form,setForm]=useState(initial),[created,setCreated]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revokeTarget,setRevokeTarget]=useState(null);
  const load=useCallback(async()=>{setError('');try{const result=await listSocialApiKeys();setKeys(result.keys||[]);}catch(err){setKeys([]);setError(err?.code==='publish_plan_required'?'The Publish Plan is required for customer API access.':'Could not load API keys. Check your connection and try again.');}},[]);
  useEffect(()=>{void Promise.resolve().then(load);},[load]);
  async function create(event){event.preventDefault();setBusy(true);setError('');setCreated(null);try{const result=await createSocialApiKey(form);setCreated(result);setForm(initial);await load();}catch(err){setError(err?.code==='api_key_limit'?'Revoke an active key before creating another.':'Could not create the API key. Try again.');}finally{setBusy(false);}}
  async function revoke(id){setRevokeTarget(null);setBusy(true);setError('');try{await revokeSocialApiKey(id);await load();}catch{setError('Could not revoke the API key. Try again.');}finally{setBusy(false);}}
  function toggle(scope){setForm((value)=>({...value,scopes:value.scopes.includes(scope)?value.scopes.filter((item)=>item!==scope):[...value.scopes,scope]}));}
  if(keys===null)return <p className="text-sm text-vx-fg-muted">Loading API keys…</p>;
  return <div className="space-y-6">
    {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
    {created&&<section role="status" className="rounded-2xl border border-vx-accent bg-vx-panel p-5"><h2 className="font-black">Copy your API key now</h2><p className="mt-1 text-sm text-vx-fg-muted">It cannot be displayed again.</p><code className="mt-3 block overflow-x-auto rounded-lg bg-black/30 p-3 text-sm text-vx-accent">{created.api_key}</code><div className="mt-3 flex gap-3"><button type="button" className={`${button} bg-vx-accent text-black`} onClick={()=>navigator.clipboard.writeText(created.api_key)}>Copy key</button><button type="button" className={button} onClick={()=>setCreated(null)}>I have saved it</button></div></section>}
    <form onSubmit={create} className="space-y-4 rounded-2xl border border-vx-border p-5"><h2 className="text-lg font-black">Create API key</h2>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Key name<input required maxLength={80} placeholder="Production automation" className={`${input} mt-1 block w-full`} value={form.label} onChange={(event)=>setForm({...form,label:event.target.value})}/></label><label className="text-sm font-bold">Expires<select className={`${input} mt-1 block w-full`} value={form.expiresInDays} onChange={(event)=>setForm({...form,expiresInDays:Number(event.target.value)})}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></select></label></div>
      <fieldset><legend className="text-sm font-bold">Permissions</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{scopes.map(([scope,label])=><label key={scope} className="flex gap-2 rounded-xl border border-vx-border p-3 text-sm"><input type="checkbox" checked={form.scopes.includes(scope)} onChange={()=>toggle(scope)}/><span><strong className="block">{label}</strong><code className="text-xs text-vx-fg-muted">{scope}</code></span></label>)}</div></fieldset>
      <button type="submit" className={`${button} bg-vx-accent text-black`} disabled={busy||form.scopes.length===0}>{busy?'Creating…':'Create key'}</button>
    </form>
    <section className="rounded-2xl border border-vx-border p-5"><h2 className="text-lg font-black">API keys</h2>{!keys.length?<p className="mt-3 text-sm text-vx-fg-muted">No API keys yet.</p>:<ul className="mt-4 space-y-3">{keys.map((key)=>{const inactive=key.revoked_at||new Date(key.expires_at)<=new Date();return <li key={key.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-vx-border p-4"><div><h3 className="font-bold">{key.label}</h3><p className="mt-1 text-xs text-vx-fg-muted"><code>{key.key_prefix}…</code> · {key.scopes.join(', ')}</p><p className="mt-1 text-xs text-vx-fg-muted">{inactive?'Inactive':`Expires ${new Date(key.expires_at).toLocaleDateString()}`} · {key.last_used_at?`Last used ${new Date(key.last_used_at).toLocaleString()}`:'Never used'}</p></div>{!inactive&&<button type="button" className={`${button} text-vx-danger`} disabled={busy} onClick={()=>setRevokeTarget(key)}>Revoke</button>}</li>;})}</ul>}</section>
    <section className="rounded-2xl border border-vx-border p-5"><h2 className="text-lg font-black">Endpoints</h2><p className="mt-2 text-sm text-vx-fg-muted">Send <code>Authorization: Bearer YOUR_KEY</code> to <code>GET /api/publish/v1/accounts</code> and <code>GET or POST /api/publish/v1/posts</code>. Responses are JSON and keys are limited to 120 requests per minute.</p></section>
    {revokeTarget&&<ConfirmDialog title={`Revoke ${revokeTarget.label}?`} body="Requests using this key will stop immediately. This cannot be undone." confirmLabel="Revoke key" tone="danger" onCancel={()=>setRevokeTarget(null)} onConfirm={()=>revoke(revokeTarget.id)}/>} 
  </div>;
}
