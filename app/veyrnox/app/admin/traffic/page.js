'use client';
import { useState } from 'react';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AdminPanel, AdminTable, adminControl } from '../_components/AdminPanel';
export default function Page() {
  const [days,setDays]=useState(30);
  return <><AppNav /><Main><AdminPanel title="Traffic" endpoint={'/admin/traffic?days='+days} description="Server-rendered page responses, aggregated hourly in UTC.">
    {data=><>
      <label className="grid gap-2">Window<select className={adminControl} value={days} onChange={e=>setDays(Number(e.target.value))}>{[1,7,30,90].map(d=><option key={d} value={d}>{d} days</option>)}</select></label>
      <p>{data.telemetry?'Telemetry enabled.':'Telemetry off. Stored history, if any, remains visible until retention removes it.'} Best-effort counts undercount: after a flush, another request at least 60 seconds later is needed to flush again; isolate eviction loses buffered counts. Turning telemetry off drops buffered counts. Only hourly cells with at least 5 views contribute to every figure, including views by day (small cells hidden for privacy); totals undercount. Smaller cells are suppressed before grouping to reduce identification risk; this is not a guarantee of anonymity. Counts exclude client navigation, prefetch and cached responses served before the Worker. These are page responses, not unique people. No cookies or client beacons are used. Data is retained for 90 days and pruned on the next ingest.</p>
      {[['days','Views by day','day'],['paths','Top 100 paths','path_pattern'],['countries','Countries','country'],['devices','Devices','device'],['referrers','Referrer hosts','referrer_host']].map(([key,title,column])=><AdminTable key={key} title={title} rows={data[key]} columns={[{key:column,label:title},{key:'views',label:'Views (cells with 5+ views)'}]}/>)}
    </>}
  </AdminPanel></Main></>;
}
