'use client';
import { useState } from 'react';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AdminPanel, AdminTable, adminControl, adminUsd, adminWhen } from '../_components/AdminPanel';
import { useAdminMutation } from '../_components/useAdminMutation';
import subscriptionCopy from '../../../../../lib/i18n/messages/app/en/credits-subscription.mjs';
export default function Page() {
  return <><AppNav /><Main><AdminPanel title="Plans and features" endpoint="/admin/plans" description="Recorded catalog values and availability history.">
    {(data,refresh,offline) => <Catalog data={data} refresh={refresh} offline={offline} />}
  </AdminPanel></Main></>;
}
const columns=[{key:'id',label:'ID'},{key:'price_usd_cents',label:'Price (USD)',render:adminUsd},{key:'credits',label:'Credits'},
  {key:'per_credit_cents',label:'Cents per credit'},{key:'active',label:'Active',render:v=>v?'Yes':'No'}];
function Catalog({data,refresh,offline}) {
  const [id,setId]=useState(''),[active,setActive]=useState(false),[reason,setReason]=useState(''),[touched,setTouched]=useState(false);
  const invalid=!reason.trim()||reason.trim().length>500||/[\x00-\x1f\x7f]/.test(reason);
  const mutation=useAdminMutation('/admin/plans',refresh);
  return <>
    <p>Subscription plans are effectively read-only in this build, including retired weekly plans. Store renewals require active plans; a local subscriber count cannot prove no purchase is in flight. Web and store packs are managed separately. Deactivating a web pack does not change store sales. Store packs and their active states are shown read-only. Web packs can be toggled, with a guard for pending purchases created in the last three hours (maximum checkout lifetime plus one hour). Refunded purchases do not block the toggle; late payments still settle from their recorded snapshot.</p>
    <p>Prices and credit amounts are not editable. They must match payment products and the catalog price floor. Pack listings refresh within their existing five-minute cache period (shared responses can have a further 60-second stale window). Subscription discovery is not cached.</p>
    <AdminTable title="Subscription plans — read-only" rows={data.plans} columns={[...columns,{key:'billing_interval',label:'Interval'},
      {key:'store_products',label:'Stored product mappings',render:v=>v?.map(s=>s.channel+': '+s.product).join('; ')||'None; Stripe uses checkout price data'}]} />
    <AdminTable title="Credit packs" rows={data.packs} columns={[...columns,{key:'sales_channel',label:'Channel'},{key:'store_product_id',label:'Store product'}, {key:'variant_id',label:'Legacy variant'},{key:'matching_store_packs',label:'Matching store packs — read-only',render:v=>v?.map(p=>p.channel+': '+p.id+' ('+(p.active?'active':'inactive')+')').join('; ')||'None'}]} />
    <h2 className="mt-6 text-xl font-bold">Existing subscription terms — read-only</h2>
    <p>No per-plan feature matrix is stored. All plans supply the catalog Credits shown above. Existing product terms:</p>
    <ul className="list-disc pl-6">{['stopHelp','coolingHelp'].map(key=><li key={key}>{subscriptionCopy['app.credits.subscription.'+key]}</li>)}</ul>
    {data.permissions.includes('plans.write') && <form className="mt-6 grid gap-4" onSubmit={e=>{e.preventDefault();setTouched(true);if(!invalid)mutation.save({kind:'pack',id,active,reason:reason.trim()});}}>
      <h2 className="text-xl font-bold">Change pack availability</h2>
      <label className="grid gap-2">Pack<select required value={id} onChange={e=>setId(e.target.value)} className={adminControl}><option value="">Select a current web pack</option>{data.packs.filter(p=>p.editable).map(p=><option key={p.id}>{p.id}</option>)}</select></label>
      <label className="grid gap-2">Availability<select value={String(active)} onChange={e=>setActive(e.target.value==='true')} className={adminControl}><option value="false">Inactive</option><option value="true">Active</option></select></label>
      <label className="grid gap-2">Reason — no secrets<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} onBlur={()=>setTouched(true)} aria-invalid={touched&&invalid} aria-describedby={touched&&invalid?'pack-reason-error':undefined} className={adminControl}/>{touched&&invalid&&<span id="pack-reason-error" className="text-vx-danger">Enter 1–500 characters without control characters.</span>}</label>
      <p>Requires authenticator verification within five minutes. Pending purchases created in the last three hours block deactivation; older payments can still settle.</p>
      <button className={adminControl+' min-h-13'} disabled={!id||invalid||offline||mutation.pending}>{mutation.pending?'Saving…':'Save pack availability'}</button>
      {mutation.signIn&&<button type="button" className={adminControl} onClick={()=>window.dispatchEvent(new CustomEvent('veyrnox:auth-required',{detail:{mode:'sign_in'}}))}>Sign in again</button>}
      <div aria-live="polite">{mutation.error&&<p role="alert">{mutation.error}</p>}{mutation.message&&<p role="status">{mutation.message}</p>}</div>
    </form>}
    <AdminTable title="Latest 100 catalog changes" rows={data.history} columns={[{key:'created_at',label:'When (UTC)',render:adminWhen},{key:'subject',label:'Catalog entry'},
      {key:'after',label:'Active after change',render:v=>v?.active?'Yes':'No'},{key:'actor_email',label:'Changed by'},{key:'reason',label:'Reason'}]} />
  </>;
}
