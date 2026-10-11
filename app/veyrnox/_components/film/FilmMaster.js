'use client';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { FilmMasterSave } from './FilmMasterSave';

const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function FilmMaster({film,attempt}) {
  const [file,setFile]=useState(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState(''),[result,setResult]=useState(null);
  const abort=useRef(null), running=useRef(false);
  useEffect(()=>()=>{abort.current?.abort();},[]);
  useEffect(()=>()=>{if(result) URL.revokeObjectURL(result.url);},[result]);
  if(film.stack.aspect!=='16:9'||attempt.verdict!=='accepted') return null;
  const library=JOB_ID.test(attempt.result.trim());
  async function prepare() {
    if(running.current) return;
    running.current=true;
    const controller=new AbortController();abort.current=controller;
    setBusy(true);setProgress(0);setError('');setResult(null);
    try {
      let source=file;
      if(!source) {
        const {loadLibraryBlob}=await import('../../_lib/editorLibrary.mjs');
        const loaded=await loadLibraryBlob(gatewayFetch,attempt.result.trim(),(url,init)=>fetch(url,{...init,signal:controller.signal}));
        if(loaded.kind!=='video') throw new Error('Choose the video for this take.');
        source=loaded.blob;
      }
      controller.signal.throwIfAborted();
      const {exportFilmMaster}=await import('../../_lib/filmMaster.mjs');
      const master=await exportFilmMaster(source,film,attempt,{signal:controller.signal,onProgress:p=>setProgress(p.total?Math.round(p.done/p.total*100):0)});
      if(!controller.signal.aborted) setResult({...master,fromLibrary:library&&!file,url:URL.createObjectURL(master.blob)});
    } catch(e) { if(!controller.signal.aborted) setError(e.message||'The master could not be prepared.'); }
    finally {running.current=false;if(!controller.signal.aborted)setBusy(false);}
  }
  return <div className="mt-3 space-y-3 border-t border-vx-border pt-3">
    <p className="text-xs text-vx-fg-muted">Create an exact 16:9 master at 1920×1080. The picture fills the frame with a centre crop, without stretching. The shot card sets the length. Export is free. Masters prepared from a Library take can be saved directly to your Library.</p>
    <label className="block text-xs">{library?'Video file for this take (optional)':'Video file for this take'}<input type="file" accept="video/mp4,video/quicktime,video/webm" disabled={busy} className="mt-1 block max-w-full text-xs" onChange={e=>{setFile(e.target.files?.[0]||null);setResult(null);setError('');}}/></label>
    {!busy&&<button type="button" disabled={!file&&!library} onClick={prepare} className="rounded-full border border-vx-accent px-4 py-2 text-xs font-semibold text-vx-accent disabled:opacity-40">Prepare 16:9 master</button>}
    {busy&&<><p role="status" className="text-xs">Preparing 16:9 master… {progress}%</p><button type="button" className="text-xs underline" onClick={()=>{abort.current?.abort();setBusy(false);}}>Cancel master export</button></>}
    {error&&<p role="alert" className="text-xs text-vx-danger">{error}</p>}
    {result&&<><p role="status" className="text-xs font-semibold">16:9 master ready · {result.width}×{result.height} · {result.seconds}s</p>
      {result.fromLibrary ? <FilmMasterSave key={result.url} master={result} jobId={attempt.result.trim()} label={`${film.name} — ${attempt.shot} v${attempt.version} — 16:9 master`}/> : <p className="text-xs text-vx-fg-muted">To save directly to Library, log a Library take ID and prepare its master without choosing a local file.</p>}
      <a href={result.url} download={result.filename} className="inline-block rounded-full border border-vx-accent px-4 py-2 text-xs font-semibold text-vx-accent">Download 16:9 master</a></>}
  </div>;
}
