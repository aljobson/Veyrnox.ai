'use client';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { useState } from 'react';
import { AdminPanel, AdminTable, adminControl, adminWhen } from '../_components/AdminPanel';
export default function Page() {
  const [days,setDays] = useState(30);
  return <><AppNav /><Main><AdminPanel title="Affiliates" endpoint={'/admin/affiliates?days=' + days + '&limit=50'}
    description="Referrals reward credits only, and this product has no applications queue.">
    {data => <>
      <label className="flex flex-wrap items-center gap-3">Reporting window
        <select className={adminControl} value={days} onChange={e => setDays(Number(e.target.value))}>{[7,30,90,365].map(d => <option key={d} value={d}>{d} days</option>)}</select>
      </label>
      <p className="mt-3 text-sm text-vx-fg-muted">Totals use records created in this window, with reward and reversal state recorded to date. Top referrers use the signup cohort.</p>
      <AdminTable title="Totals" rows={[data.totals]} columns={[
        {key:'codes',label:'Codes created'},{key:'signups',label:'Referred signups'},{key:'rewarded',label:'Rewarded'},
        {key:'clawed_back',label:'Clawed back'},{key:'credits_granted',label:'Credits granted'},
        {key:'credits_reversed',label:'Credits reversed'},{key:'clawback_shortfall',label:'Clawback shortfall (credits)'},
      ]} />
      <AdminTable title="Top referrers" rows={data.top_referrers} columns={[
        {key:'email',label:'Referrer'},{key:'signups',label:'Signups'},{key:'rewarded',label:'Rewarded'},
        {key:'credits',label:'Credits granted'},{key:'reversed',label:'Credits reversed'},
      ]} />
      <AdminTable title="Recent rewards" rows={data.recent_rewards} columns={[
        {key:'referrer_email',label:'Referrer'},{key:'status',label:'State'},{key:'credits',label:'Reward credits'},
        {key:'clawed_back_credits',label:'Reversed'},{key:'clawback_shortfall',label:'Shortfall'},
        {key:'cancel_reason',label:'Cancellation reason'},{key:'created_at',label:'Created (UTC)',render:adminWhen},
      ]} />
    </>}
  </AdminPanel></Main></>;
}
