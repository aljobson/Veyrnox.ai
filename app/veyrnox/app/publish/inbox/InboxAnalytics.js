'use client';

import { useEffect, useState } from 'react';
import { NETWORKS } from '../../../../lib/socialConnectClient';
import { getSocialInboxAnalytics } from '../../../../lib/socialInboxClient';
import NetworkLogo from '../NetworkLogo';

const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const label = (network) => NETWORKS.find((item) => item.key === network)?.label || network;

export default function InboxAnalytics({ accountId, loadAnalytics = getSocialInboxAnalytics }) {
  const [days, setDays] = useState(30), [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; loadAnalytics({ accountId: accountId || undefined, days }).then((result) => { if (active) { setData(result); setError(''); } }).catch(() => { if (active) { setData(null); setError('Could not load inbox analytics.'); } }); return () => { active = false; }; }, [accountId, days, loadAnalytics]);
  const summary = data?.summary || {}, trend = data?.trend || [], platforms = data?.platforms || [], heatmap = data?.heatmap || [];
  const maximum = Math.max(1, ...trend.map((item) => Number(item.received || 0) + Number(item.sent || 0)));
  const arrival = new Map(heatmap.map((item) => [`${item.weekday}:${item.hour}`, Number(item.received || 0)]));
  const hottest = Math.max(1, ...arrival.values());
  const response = summary.median_response_seconds == null ? '—' : summary.median_response_seconds < 60 ? `${summary.median_response_seconds}s` : `${Math.round(summary.median_response_seconds / 60)}m`;
  return <section aria-label="Inbox analytics" className="min-w-0 max-w-full space-y-4 rounded-2xl border border-vx-border p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">Inbox analytics</h2><p className="mt-1 text-sm text-vx-fg-muted">Message volume and team response performance across this inbox.</p></div><label className="text-xs font-bold text-vx-fg-muted">Period<select className={`${input} ml-2`} value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label></div>
    {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    {!data && !error ? <p className="text-sm text-vx-fg-muted">Loading inbox analytics…</p> : data && <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[['Conversations',summary.conversations||0],['Received',summary.received||0],['Sent',summary.sent||0],['Failed',summary.failed||0],['Marked read',summary.read_actions||0],['Median response',response]].map(([name,value])=><div key={name} className="rounded-xl bg-vx-panel p-3"><p className="text-xs text-vx-fg-muted">{name}</p><p className="mt-1 text-xl font-black">{value}</p></div>)}</div>
      <div className="min-w-0"><h3 className="text-sm font-black">Daily activity</h3><div className="mt-3 min-w-0 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Daily received and sent activity"><div className="flex h-28 w-max min-w-full items-end gap-1">{trend.map((item)=>{const received=Number(item.received||0),sent=Number(item.sent||0);return <div key={item.date} className="flex w-3 shrink-0 flex-col justify-end" title={`${item.date}: ${received} received, ${sent} sent`}><div className="bg-vx-accent" style={{height:`${Math.max(received?2:0,received/maximum*88)}px`}}/><div className="bg-vx-fg-muted" style={{height:`${Math.max(sent?2:0,sent/maximum*88)}px`}}/></div>;})}</div></div><p className="mt-2 text-xs text-vx-fg-muted"><span className="text-vx-accent">■</span> Received · <span>■</span> Sent</p></div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2"><div className="min-w-0"><h3 className="text-sm font-black">Platforms</h3>{platforms.length?<ul className="mt-2 space-y-2">{platforms.map((item)=><li key={item.network} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-vx-panel px-3 py-2 text-sm"><span className="flex items-center gap-2"><NetworkLogo network={item.network}/>{label(item.network)}</span><span>{item.received} received · {item.sent} sent{item.failed?` · ${item.failed} failed`:''}</span></li>)}</ul>:<p className="mt-2 text-sm text-vx-fg-muted">No platform activity in this period.</p>}</div>
        <details className="min-w-0"><summary className="cursor-pointer text-sm font-black">Arrival heatmap (UTC)</summary><div className="mt-3 min-w-0 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Inbound messages by weekday and hour"><div className="grid min-w-[576px] grid-cols-24 gap-1">{Array.from({length:168},(_,index)=>{const weekday=Math.floor(index/24)+1,hour=index%24,count=arrival.get(`${weekday}:${hour}`)||0;return <span key={index} title={`Day ${weekday}, ${hour}:00 UTC: ${count} received`} className="h-4 rounded-sm bg-vx-accent" style={{opacity:count?0.2+0.8*count/hottest:0.05}}/>;})}</div></div></details></div>
    </>}
  </section>;
}
