'use client';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { useState } from 'react';
import { AdminPanel, AdminTable, adminControl, adminUsd } from '../_components/AdminPanel';
export default function Page() {
  const [days,setDays] = useState(30);
  return <><AppNav /><Main><AdminPanel title="Payments and analytics" endpoint={'/admin/revenue?days=' + days}
    description="Recorded subscription MRR and credit-pack purchase cohorts. USD amounts are gross, before provider fees.">
    {data => <>
      <p className="text-vx-fg-body">MRR uses each active, paid-through subscription’s snapshotted price: monthly prices as recorded, yearly prices divided by 12 and rounded half up per subscription in the database. It includes deactivated plans. Stripe, iOS and Android are shown separately; store MRR is a catalog snapshot, not a report of cash received.</p>
      <p className="mt-3 text-vx-fg-body">Only active subscriptions with a future paid-through date and a recorded successful paid invoice or store purchase grant contribute. Trial state is not stored separately: this is not a trial count or a trial-exclusive MRR. Unsupported historical weekly intervals are excluded and counted below.</p>
      <AdminTable title="Current MRR by billing channel" rows={data.mrr_by_channel} columns={[
        {key:'channel',label:'Channel'},{key:'mrr_cents',label:'Snapshot MRR (USD)',render:adminUsd},
        {key:'excluded_interval_count',label:'Unsupported intervals excluded'},
      ]} />
      <AdminTable title="Current subscriptions by recorded status" rows={data.subscriptions_by_status} columns={[
        {key:'channel',label:'Channel'},{key:'status',label:'Recorded status'},
        {key:'paid_invoice_recorded',label:'Payment evidence',render:v => v ? 'Paid invoice recorded (store: paid grant)' : 'No paid invoice recorded yet (trial or awaiting first invoice)'},
        {key:'subscriptions',label:'Subscriptions'},
      ]} />
      <div className="mt-8"><label className="flex flex-wrap items-center gap-3">Pack purchase window
        <select className={adminControl} value={days} onChange={e => setDays(Number(e.target.value))}>{[7,30,90,365].map(d => <option key={d} value={d}>{d} days</option>)}</select>
      </label></div>
      <p className="mt-3 text-vx-fg-body">Stripe packs: net of refunds recorded to date, by purchase date (checkout creation date, UTC). This is a purchase-cohort view, not a daily refund series. Store cash revenue is not included: no actual store payment amount is recorded. Top-ups have no dispute-state column; an account Freeze is not a per-purchase dispute amount.</p>
      <AdminTable title="Pack purchase cohorts" rows={data.pack_purchase_cohorts} columns={[
        {key:'purchase_day',label:'Purchase date (UTC)'},{key:'purchases',label:'Purchases'},
        {key:'gross_cents',label:'Gross USD',render:adminUsd},{key:'refunded_to_date_cents',label:'Refunds to date USD',render:adminUsd},
        {key:'net_cents',label:'Cohort balance USD',render:adminUsd},
      ]} />
    </>}
  </AdminPanel></Main></>;
}
