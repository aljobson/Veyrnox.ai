'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { ConfirmDialog } from '../../../_components/ConfirmDialog';
import { Main } from '../../../_components/Main';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { createSocialApiKey, createSocialWebhook, listSocialApiKeys, listSocialApiLogs, listSocialWebhooks, revokeSocialApiKey, revokeSocialWebhook } from '../../../../lib/socialDeveloperClient';
import BrandSwitcher from '../BrandSwitcher';

const currentAccount=()=>getSession()?.user?.id||'';
const noAccount=()=>'';
const button='rounded-full border border-vx-border px-4 py-2 text-sm font-bold disabled:opacity-50 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const input='rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm';
const scopes=[['accounts:read','Read connected accounts'],['posts:read','Read posts and delivery status'],['posts:write','Create posts']];
const initial={label:'',expiresInDays:90,scopes:['accounts:read','posts:read']};
const webhookEvents=[['post.published','Post published'],['post.delivered','Draft delivered'],['post.failed','Post failed']];
const initialWebhook={label:'',url:'',events:['post.published','post.failed']};

export default function Developer(){
  const account=useSyncExternalStore(onSessionChange,currentAccount,noAccount);
  return <><AppNav/><Main className="mx-auto max-w-[900px] px-4 py-10 sm:px-8">
    <Link href="/app/publish" className="text-sm text-vx-accent underline">Veyrnox.ai Publish</Link>
    <h1 className="mt-3 text-3xl font-black">Developer tools</h1>
    <p className="mt-2 mb-4 text-sm text-vx-fg-muted">Create scoped API keys and signed webhook endpoints for your Publish integrations. Secrets are shown once.</p>
    {account&&<BrandSwitcher/>}
    {account?<div className="space-y-10"><ApiKeys key={`keys-${account}`}/><ApiLogs key={`logs-${account}`}/><Webhooks key={`webhooks-${account}`}/></div>:<p className="text-sm">Sign in to manage API keys. <button type="button" className={button} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button></p>}
  </Main></>;
}

function ApiLogs(){
  const [logs,setLogs]=useState(null),[filters,setFilters]=useState({status:'',route:'',q:''}),[query,setQuery]=useState(''),[live,setLive]=useState(false),[error,setError]=useState('');
  const load=useCallback(async()=>{setError('');try{const result=await listSocialApiLogs(filters);setLogs(result.logs||[]);}catch(err){if(err?.code==='customer_api_not_open'){setLogs(false);return;}setLogs([]);setError(err?.code==='publish_plan_required'?'The Publish Plan is required for request logs.':'Could not load request logs. Check your connection and try again.');}},[filters]);
  useEffect(()=>{void Promise.resolve().then(load);if(!live)return;const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[load,live]);
  function search(event){event.preventDefault();setFilters((value)=>({...value,q:query.trim()}));}
  function exportCsv(){const rows=[['Time','API key','Method','Route','Status','Error'],...(logs||[]).map((log)=>[log.requested_at,log.api_key_label,log.method,log.route,log.response_status||'Pending',log.error_code||''])];const cell=(value)=>`"${String(value??'').replaceAll('"','""')}"`;const blob=new Blob([rows.map((row)=>row.map(cell).join(',')).join('\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`veyrnox-api-logs-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(url);}
  if(logs===null)return <p className="text-sm text-vx-fg-muted">Loading request logs…</p>;
  if(logs===false)return null;
  return <section className="space-y-4 border-t border-vx-border pt-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">API request logs</h2><p className="mt-1 text-sm text-vx-fg-muted">Inspect recent customer API outcomes without exposing request bodies or credentials.</p></div><div className="flex gap-2"><button type="button" className={button} onClick={()=>void load()}>Refresh</button><button type="button" className={button} disabled={!logs.length} onClick={exportCsv}>Export CSV</button></div></div>
    {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
    <form onSubmit={search} className="grid gap-3 rounded-2xl border border-vx-border p-4 sm:grid-cols-[1fr_auto_auto_auto]">
      <label className="text-sm font-bold">Search<input className={`${input} mt-1 block w-full`} value={query} maxLength={80} placeholder="Key, route or error" onChange={(event)=>setQuery(event.target.value)}/></label>
      <label className="text-sm font-bold">Status<select className={`${input} mt-1 block w-full`} value={filters.status} onChange={(event)=>setFilters({...filters,status:event.target.value})}><option value="">All</option><option value="success">Success</option><option value="error">Errors</option><option value="pending">Pending</option></select></label>
      <label className="text-sm font-bold">Route<select className={`${input} mt-1 block w-full`} value={filters.route} onChange={(event)=>setFilters({...filters,route:event.target.value})}><option value="">All</option><option value="/api/publish/v1/accounts">Accounts</option><option value="/api/publish/v1/posts">Posts</option></select></label>
      <div className="flex items-end gap-3"><button type="submit" className={`${button} bg-vx-accent text-black`}>Apply</button><label className="mb-2 flex items-center gap-2 whitespace-nowrap text-sm"><input type="checkbox" checked={live} onChange={(event)=>setLive(event.target.checked)}/>Live</label></div>
    </form>
    <div className="overflow-x-auto rounded-2xl border border-vx-border p-5">{!logs.length?<p className="text-sm text-vx-fg-muted">No matching API requests yet.</p>:<table className="w-full text-left text-sm"><thead><tr className="border-b border-vx-border"><th className="py-2 pr-4">Time</th><th className="py-2 pr-4">API key</th><th className="py-2 pr-4">Request</th><th className="py-2 pr-4">Status</th><th className="py-2">Error</th></tr></thead><tbody>{logs.map((log)=><tr key={log.id} className="border-b border-vx-border/60"><td className="py-3 pr-4 whitespace-nowrap">{new Date(log.requested_at).toLocaleString()}</td><td className="py-3 pr-4">{log.api_key_label}<br/><code className="text-xs text-vx-fg-muted">{log.key_prefix}…</code></td><td className="py-3 pr-4"><code>{log.method} {log.route}</code></td><td className="py-3 pr-4">{log.response_status||'Pending'}</td><td className="py-3"><code>{log.error_code||'—'}</code></td></tr>)}</tbody></table>}</div>
  </section>;
}

function Webhooks(){
  const [data,setData]=useState(null),[form,setForm]=useState(initialWebhook),[created,setCreated]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revokeTarget,setRevokeTarget]=useState(null);
  const load=useCallback(async()=>{setError('');try{setData(await listSocialWebhooks());}catch(err){if(err?.code==='customer_webhooks_not_open'){setData({disabled:true});return;}setData({endpoints:[],deliveries:[]});setError(err?.code==='publish_plan_required'?'The Publish Plan is required for webhooks.':'Could not load webhooks. Check your connection and try again.');}},[]);
  useEffect(()=>{void Promise.resolve().then(load);},[load]);
  async function create(event){event.preventDefault();setBusy(true);setError('');setCreated(null);try{const result=await createSocialWebhook(form);setCreated(result);setForm(initialWebhook);await load();}catch(err){setError(err?.code==='webhook_limit'?'Revoke an active endpoint before creating another.':err?.code==='invalid_body'?'Enter a public HTTPS endpoint and select at least one event.':'Could not create the webhook. Try again.');}finally{setBusy(false);}}
  async function revoke(id){setRevokeTarget(null);setBusy(true);setError('');try{await revokeSocialWebhook(id);await load();}catch{setError('Could not revoke the webhook. Try again.');}finally{setBusy(false);}}
  function toggle(value){setForm((current)=>({...current,events:current.events.includes(value)?current.events.filter((item)=>item!==value):[...current.events,value]}));}
  if(data===null)return <p className="text-sm text-vx-fg-muted">Loading webhooks…</p>;
  if(data.disabled)return null;
  const endpoints=data.endpoints||[],deliveries=data.deliveries||[];
  return <section className="space-y-6 border-t border-vx-border pt-8">
    <div><h2 className="text-2xl font-black">Webhooks</h2><p className="mt-1 text-sm text-vx-fg-muted">Receive signed delivery events in your own system. Failed requests retry up to eight times.</p></div>
    {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
    {created&&<div role="status" className="rounded-2xl border border-vx-accent bg-vx-panel p-5"><h3 className="font-black">Copy your signing secret now</h3><p className="mt-1 text-sm text-vx-fg-muted">Use it to verify <code>X-Veyrnox-Signature</code>. It cannot be displayed again.</p><code className="mt-3 block overflow-x-auto rounded-lg bg-black/30 p-3 text-sm text-vx-accent">{created.signing_secret}</code><div className="mt-3 flex gap-3"><button type="button" className={`${button} bg-vx-accent text-black`} onClick={()=>navigator.clipboard.writeText(created.signing_secret)}>Copy secret</button><button type="button" className={button} onClick={()=>setCreated(null)}>I have saved it</button></div></div>}
    <form onSubmit={create} className="space-y-4 rounded-2xl border border-vx-border p-5"><h3 className="text-lg font-black">Add endpoint</h3><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Endpoint name<input required maxLength={80} placeholder="Production events" className={`${input} mt-1 block w-full`} value={form.label} onChange={(event)=>setForm({...form,label:event.target.value})}/></label><label className="text-sm font-bold">HTTPS URL<input required type="url" maxLength={2048} placeholder="https://example.com/webhooks/veyrnox" className={`${input} mt-1 block w-full`} value={form.url} onChange={(event)=>setForm({...form,url:event.target.value})}/></label></div>
      <fieldset><legend className="text-sm font-bold">Events</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{webhookEvents.map(([value,label])=><label key={value} className="flex gap-2 rounded-xl border border-vx-border p-3 text-sm"><input type="checkbox" checked={form.events.includes(value)} onChange={()=>toggle(value)}/><span><strong className="block">{label}</strong><code className="text-xs text-vx-fg-muted">{value}</code></span></label>)}</div></fieldset>
      <button type="submit" className={`${button} bg-vx-accent text-black`} disabled={busy||form.events.length===0}>{busy?'Adding…':'Add endpoint'}</button>
    </form>
    <div className="rounded-2xl border border-vx-border p-5"><h3 className="text-lg font-black">Endpoints</h3>{!endpoints.length?<p className="mt-3 text-sm text-vx-fg-muted">No webhook endpoints yet.</p>:<ul className="mt-4 space-y-3">{endpoints.map((endpoint)=><li key={endpoint.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-vx-border p-4"><div><h4 className="font-bold">{endpoint.label}</h4><p className="mt-1 break-all text-xs text-vx-fg-muted">{endpoint.url}</p><p className="mt-1 text-xs text-vx-fg-muted">{endpoint.events.join(', ')} · {endpoint.active?'Active':'Revoked'}</p></div>{endpoint.active&&<button type="button" className={`${button} text-vx-danger`} disabled={busy} onClick={()=>setRevokeTarget(endpoint)}>Revoke</button>}</li>)}</ul>}</div>
    <div className="rounded-2xl border border-vx-border p-5"><h3 className="text-lg font-black">Recent deliveries</h3>{!deliveries.length?<p className="mt-3 text-sm text-vx-fg-muted">No delivery attempts yet.</p>:<div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-vx-border"><th className="py-2 pr-4">Event</th><th className="py-2 pr-4">Endpoint</th><th className="py-2 pr-4">Status</th><th className="py-2">Attempts</th></tr></thead><tbody>{deliveries.map((delivery)=><tr key={delivery.id} className="border-b border-vx-border/60"><td className="py-3 pr-4"><code>{delivery.event_type}</code></td><td className="py-3 pr-4">{delivery.endpoint_label}</td><td className="py-3 pr-4">{delivery.outcome}{delivery.last_status?` · HTTP ${delivery.last_status}`:''}{delivery.last_error?` · ${delivery.last_error}`:''}</td><td className="py-3">{delivery.attempts}</td></tr>)}</tbody></table></div>}</div>
    {revokeTarget&&<ConfirmDialog title={`Revoke ${revokeTarget.label}?`} body="Pending events for this endpoint will stop immediately. This cannot be undone." confirmLabel="Revoke endpoint" tone="danger" onCancel={()=>setRevokeTarget(null)} onConfirm={()=>revoke(revokeTarget.id)}/>}
  </section>;
}

function ApiKeys(){
  const [keys,setKeys]=useState(null),[form,setForm]=useState(initial),[created,setCreated]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revokeTarget,setRevokeTarget]=useState(null);
  const load=useCallback(async()=>{setError('');try{const result=await listSocialApiKeys();setKeys(result.keys||[]);}catch(err){if(err?.code==='customer_api_not_open'){setKeys(false);return;}setKeys([]);setError(err?.code==='publish_plan_required'?'The Publish Plan is required for customer API access.':'Could not load API keys. Check your connection and try again.');}},[]);
  useEffect(()=>{void Promise.resolve().then(load);},[load]);
  async function create(event){event.preventDefault();setBusy(true);setError('');setCreated(null);try{const result=await createSocialApiKey(form);setCreated(result);setForm(initial);await load();}catch(err){setError(err?.code==='api_key_limit'?'Revoke an active key before creating another.':'Could not create the API key. Try again.');}finally{setBusy(false);}}
  async function revoke(id){setRevokeTarget(null);setBusy(true);setError('');try{await revokeSocialApiKey(id);await load();}catch{setError('Could not revoke the API key. Try again.');}finally{setBusy(false);}}
  function toggle(scope){setForm((value)=>({...value,scopes:value.scopes.includes(scope)?value.scopes.filter((item)=>item!==scope):[...value.scopes,scope]}));}
  if(keys===null)return <p className="text-sm text-vx-fg-muted">Loading API keys…</p>;
  if(keys===false)return null;
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
