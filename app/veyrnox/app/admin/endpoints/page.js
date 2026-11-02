'use client';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { useState } from 'react';
import { AdminPanel, AdminTable, adminControl } from '../_components/AdminPanel';
export default function Page() {
  const [query,setQuery] = useState('');
  return <><AppNav /><Main><AdminPanel title="Endpoints" endpoint="/admin/endpoints"
    description="Build-time route patterns and exported methods. Gate classes describe routing, not a security audit.">
    {data => {
      const rows = data.inventory.filter(row => row.path.toLowerCase().includes(query.toLowerCase()));
      return <>
        <AdminTable title="Webhook deliveries (24 h)" rows={data.webhooks} columns={[
          {key:'source',label:'Source'},{key:'total',label:'Total'},{key:'accepted',label:'Accepted'},
          {key:'rejected_signature',label:'Rejected signature'},{key:'failed',label:'Failed'},
        ]} />
        <label className="mt-8 flex flex-wrap items-center gap-3">Filter route patterns
          <input className={adminControl} value={query} onChange={e => setQuery(e.target.value)} maxLength={200} />
        </label>
        {query && <div className="mt-3"><p role="status">Matches for “{query}”: {rows.length}. Try a shorter path or a feature name.</p><button type="button" className={adminControl + ' mt-3'} onClick={() => setQuery('')}>Clear filter</button></div>}
        <p>{data.telemetry&&<>Unknown route calls (cells with 5+ calls): {(data.usage||[]).filter(u=>u.route_pattern==='other').reduce((n,u)=>n+Number(u.calls),0).toLocaleString('en-US')}. </>}Counts are best-effort and undercount: later requests trigger flushes at least 60 seconds apart; isolate eviction or disabling telemetry loses buffered counts. Only hourly route/method/status cells with at least 5 calls contribute to these figures (small cells hidden for privacy); totals undercount. Suppression happens before grouping, so a displayed zero may include suppressed traffic. This reduces identification risk without guaranteeing anonymity. Calls cover the current UTC hour plus the previous 23 hours. Early redirects, edge refusals and responses served before this hook are excluded.</p>
        <AdminTable title="Route inventory" rows={rows} empty="No route patterns match. Clear the filter, try a shorter path, or search a feature name." columns={[
          {key:'path',label:'Path pattern'},{key:'methods',label:'Exported methods',render:v => v.join(', ')},
          {key:'gate',label:'Gate class'},{key:'calls',label:'Calls (24 h; cells with 5+ calls)',render:(_v,row) => data.telemetry ? (data.usage||[]).filter(u=>u.route_pattern===row.path.replace(/:[A-Za-z0-9_]+/g,':id')).reduce((n,u)=>n+Number(u.calls),0).toLocaleString('en-US') : 'telemetry off'},
        ]} />
      </>;
    }}
  </AdminPanel></Main></>;
}
