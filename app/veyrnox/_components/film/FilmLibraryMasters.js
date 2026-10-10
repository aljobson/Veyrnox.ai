'use client';
import { useEffect, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { onSessionChange } from '../../../lib/authClient.js';
import { AssetRetention } from '../AssetRetention';

export function FilmLibraryMasters({ visible = true, fetcher = gatewayFetch }) {
  const [masters, setMasters] = useState([]), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(()=>onSessionChange(()=>{setMasters([]);setError('');setRevision(n=>n+1);}),[]);
  useEffect(() => {
    let active=true;
    fetcher('/library/masters').then(response=>{if(active){setMasters(response.masters || []);setError('');}})
      .catch(e=>{if(active && e.code !== 'no_token' && e.code !== 'unauthenticated') setError('Saved Film Studio masters could not be loaded.');});
    return ()=>{active=false;};
  },[fetcher,revision]);
  if(!visible || (!masters.length && !error)) return null;
  return <section aria-label="Saved Film Studio masters" className="max-w-[1400px] mx-auto px-4 sm:px-8 py-6">
    <h2 className="text-xl font-semibold">Saved Film Studio masters</h2>
    {error && <p role="alert" className="mt-3 text-sm">{error} <button type="button" className="underline" onClick={()=>setRevision(n=>n+1)}>Retry saved masters</button></p>}
    <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{masters.map(master => <MasterCard key={master.id} master={master} fetcher={fetcher}/>)}</div>
  </section>;
}
function MasterCard({master,fetcher}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const path=`/library/masters/${encodeURIComponent(master.id)}/asset`;
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;
    fetcher(path).then(asset=>{
      if(!asset.url?.startsWith('https://')) throw new Error('unavailable');
      if(active){setUrl(asset.url);setError('');}
    }).catch(()=>{if(active) setError('The saved video could not be loaded.');});
    return ()=>{active=false;};
  },[path,fetcher,revision]);
  async function download() {
    if(busy) return;
    setBusy(true);setError('');
    try { const asset=await fetcher(`${path}?download=1`); if(!asset.url?.startsWith('https://')) throw new Error('unavailable'); window.location.assign(asset.url); }
    catch { setError('The download could not be prepared. Try again.'); }
    finally { setBusy(false); }
  }
  return <article id={`master-${master.id}`} aria-label={master.label} className="overflow-hidden rounded-xl border border-vx-border bg-vx-panel">
    {url && <video aria-label={`${master.label} preview`} controls playsInline preload="metadata" src={url} className="aspect-video w-full bg-black" onError={()=>setError('The saved video could not be loaded.')}/>}
    <div className="p-4 space-y-2"><p className="text-xs font-semibold text-vx-accent">Film Studio master · saved</p>
      <h3 className="font-semibold">{master.label}</h3><p className="text-sm text-vx-fg-muted">{master.width}×{master.height} · 16:9 · {master.seconds}s · {master.frame_rate} fps</p>
      <p className="text-xs text-vx-fg-muted">Edited from your generated take. Saving uses no credits.</p>
      <button type="button" disabled={busy} className="text-sm font-semibold text-vx-accent underline" onClick={download}>{busy?'Preparing master download…':'Download master'}</button>
      <details className="text-xs text-vx-fg-muted"><summary>File details</summary><p className="mt-2 break-all">SHA-256: {master.sha256}</p><p>Source take: {master.source_job_id}</p><p>{master.size_bytes} bytes</p></details>
      {error && <p role="alert" className="text-sm">{error} <button type="button" className="underline" onClick={()=>setRevision(n=>n+1)}>Retry master preview</button></p>}
    </div><AssetRetention row={{state:'succeeded',has_asset:true,asset_expires_at:master.expires_at}}/>
  </article>;
}
