'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../../_components/NavBar';
import { Button } from '../../../_components/Button';
import { Modal } from '../../../_components/Modal';
import { useProjectsPreview } from '../../../_lib/useProjectsPreview';
import { gatewayFetch, makeIdempotencyKey } from '../../../_lib/gateway';
import { equalProjectDocuments as same } from '../../../../../lib/projectDocument';

const field='w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent disabled:opacity-50';
const date=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
function message(e) {
  if(e.code==='account_changed'||e.status===401)return 'Your session changed. Sign in again to continue.';
  if(e.status===404||e.status===403)return 'This project is unavailable or you do not have permission to edit it.';
  if(e.status===409)return 'A newer version was saved elsewhere. Review it before saving your draft.';
  if(e.status===429)return 'Saving is paused. Wait a minute, then retry.';
  return 'Could not save your changes. Your draft is still here; retry when your connection is back.';
}
export default function ProjectPage(){
  const enabled=useProjectsPreview();
  const {id}=useParams();
  return <>{enabled ? <DocumentEditor key={id} id={id}/> : <><AppNav active="projects"/><main className="mx-auto max-w-6xl p-8"><h1 className="text-3xl font-black">Projects preview</h1><p className="mt-4">Projects are not available in this browser yet.</p><Link href="/app/projects" className="mt-5 inline-block text-vx-accent underline">Back to projects</Link></main></>}</>;
}
function DocumentEditor({id}){
  const [project,setProject]=useState(null), [draft,setDraft]=useState(null), [saved,setSaved]=useState(null);
  const [revision,setRevision]=useState(0), [history,setHistory]=useState([]), [next,setNext]=useState(null);
  const [busy,setBusy]=useState(false), [loading,setLoading]=useState(true), [error,setError]=useState('');
  const [conflict,setConflict]=useState(false), [remote,setRemote]=useState(null), [preview,setPreview]=useState(null);
  const [historyError,setHistoryError]=useState(''), [historyBusy,setHistoryBusy]=useState(false);
  const [savedAt,setSavedAt]=useState(null), [loadError,setLoadError]=useState('');
  const alive=useRef(true), writing=useRef(false), pending=useRef(null), draftRef=useRef(draft);
  draftRef.current=draft;
  const endpoint=`/projects/${encodeURIComponent(id)}`;
  const dirty=draft!==null&&!same(draft,saved);
  const historyRequest=useRef(0);
  const readHistory=useCallback(async(before=null)=>{
    const sequence=++historyRequest.current;setHistoryBusy(true);setHistoryError('');
    try{
      const r=await gatewayFetch(`${endpoint}/history${before?`?before=${before}`:''}`,{signal:AbortSignal.timeout(15000)});
      if(!alive.current||sequence!==historyRequest.current)return;
      setHistory(rows=>before?[...rows,...r.versions]:r.versions);setNext(r.next_before);
    }catch{if(alive.current&&sequence===historyRequest.current)setHistoryError('Could not load version history.');}
    finally{if(alive.current&&sequence===historyRequest.current)setHistoryBusy(false);}
  },[endpoint]);
  useEffect(()=>{
    alive.current=true;
    let cancelled=false;
    (async()=>{
      try{
        const [p,d]=await Promise.all([gatewayFetch(endpoint),gatewayFetch(`${endpoint}/document`)]);
        if(cancelled)return;
        setProject(p.project);setDraft(d.document);setSaved(d.document);setRevision(d.revision);setSavedAt(d.created_at);
        readHistory();
      }catch(e){if(!cancelled)setLoadError(e.status===404?'This project is no longer available.':'Could not load this project. Reload the page to try again.');}
      finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;alive.current=false;};
  },[endpoint,readHistory]);
  useEffect(()=>{
    const leave=e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',leave);
    return()=>window.removeEventListener('beforeunload',leave);
  },[dirty,busy]);

  const save=useCallback(async({restore=null,against=revision}={})=>{
    if(writing.current||!draftRef.current)return;
    writing.current=true;setBusy(true);setError('');
    const snapshot=draftRef.current;
    const body=JSON.stringify({expected_revision:against,...(restore?{restore_revision:restore}:{document:snapshot})});
    if(pending.current?.body!==body)pending.current={body,key:makeIdempotencyKey()};
    try{
      const r=await gatewayFetch(`${endpoint}/document`,{method:'PUT',body,headers:{'idempotency-key':pending.current.key},signal:AbortSignal.timeout(15000)});
      if(!alive.current)return;
      setSaved(r.document);setRevision(r.revision);setSavedAt(r.created_at);setConflict(false);setRemote(null);pending.current=null;
      if(restore){setDraft(r.document);setPreview(null);}
      readHistory();
    }catch(e){if(alive.current){setError(message(e));setConflict(e.status===409&&e.code!=='account_changed');}}
    finally{writing.current=false;if(alive.current)setBusy(false);}
  },[endpoint,revision,readHistory]);
  useEffect(()=>{
    if(!dirty||busy||error||conflict||preview)return;
    const timer=setTimeout(()=>save(),3000);
    return()=>clearTimeout(timer);
  },[draft,dirty,busy,error,conflict,preview,save]);
  async function reviewLatest(){
    if(writing.current)return;
    setBusy(true);writing.current=true;
    try{const r=await gatewayFetch(`${endpoint}/document`,{signal:AbortSignal.timeout(15000)});if(alive.current)setRemote(r);}
    catch(e){if(alive.current)setError(message(e));}
    finally{writing.current=false;if(alive.current)setBusy(false);}
  }
  async function viewVersion(number){
    setHistoryBusy(true);setHistoryError('');
    try{const r=await gatewayFetch(`${endpoint}/document?revision=${number}`,{signal:AbortSignal.timeout(15000)});if(alive.current)setPreview(r);}
    catch{if(alive.current)setHistoryError('Could not open this version. Try again.');}
    finally{if(alive.current)setHistoryBusy(false);}
  }
  function leave(event){
    if((dirty||busy)&&event.target.closest('a[href]')&&!window.confirm('Your latest changes are not saved yet. Leave this project?'))event.preventDefault();
  }
  function acceptRemote(){
    setDraft(remote.document);setSaved(remote.document);setRevision(remote.revision);setSavedAt(remote.created_at);
    setRemote(null);setConflict(false);setError('');pending.current=null;readHistory();
  }
  return <div onClickCapture={leave}>
    <AppNav active="projects"/>
    <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <Link href="/app/projects" className="text-sm text-vx-accent hover:underline">← All projects</Link>
      {loading?<p role="status" className="py-16">Loading project…</p>:loadError?<p role="alert" className="py-12">{loadError}</p>:<>
        <header className="my-7 flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="mb-2 font-vx-mono text-xs uppercase tracking-widest text-vx-fg-muted">Project brief</p><h1 className="break-words text-3xl font-black">{project.name}</h1></div>
          <div className="flex flex-wrap items-center gap-4"><span role="status" className="text-xs text-vx-fg-muted">{busy?'Saving…':error?'Changes not saved':dirty?'Unsaved changes':savedAt?`Saved · version ${revision}`:'No changes yet'}</span><Button size="sm" disabled={busy||conflict||(!dirty&&!error)} onClick={()=>save()}>{error?'Retry save':'Save now'}</Button></div></header>
        {error&&<section role="alert" className="mb-6 rounded-xl border border-vx-border bg-vx-panel p-5"><p className="text-sm">{error}</p>{conflict&&<Button variant="ghost" size="sm" className="mt-3" disabled={busy} onClick={reviewLatest}>Review latest version</Button>}</section>}
        {remote&&<section className="mb-6 rounded-xl border border-vx-accent p-5"><h2 className="font-bold">Saved version {remote.revision}</h2><p className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-vx-fg-muted">{remote.document.brief||'No brief'}</p><p className="mt-2 text-sm">{remote.document.canvas.aspect_ratio} · {remote.document.canvas.frame_rate} fps</p><p className="my-4 text-sm">Your draft is still below. Choose which version to keep; previous saved versions remain in history.</p><div className="flex flex-wrap gap-3"><Button variant="ghost" disabled={busy} onClick={acceptRemote}>Use saved version</Button><Button disabled={busy} onClick={()=>save({against:remote.revision})}>Save my draft instead</Button></div></section>}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0 rounded-2xl border border-vx-border p-5 sm:p-7">
            <label htmlFor="project-brief" className="text-lg font-bold">What are you creating?</label><p id="brief-help" className="mb-4 mt-2 text-sm text-vx-fg-muted">Capture the idea, audience, and direction. Your changes save automatically.</p>
            <textarea id="project-brief" aria-describedby="brief-help" className={`${field} min-h-64 resize-y leading-relaxed`} placeholder="Describe the story you want to tell…" maxLength={6000} value={draft.brief} onChange={e=>setDraft({...draft,brief:e.target.value})}/>
            <p className="mb-7 mt-2 text-right text-xs text-vx-fg-muted">{draft.brief.length} / 6,000</p>
            <h2 className="mb-4 font-bold">Output canvas</h2><div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">Aspect ratio<select className={`${field} mt-2`} value={draft.canvas.aspect_ratio} onChange={e=>setDraft({...draft,canvas:{...draft.canvas,aspect_ratio:e.target.value}})}><option value="16:9">Landscape · 16:9</option><option value="9:16">Portrait · 9:16</option><option value="1:1">Square · 1:1</option></select></label>
              <label className="text-sm">Frame rate<select className={`${field} mt-2`} value={draft.canvas.frame_rate} onChange={e=>setDraft({...draft,canvas:{...draft.canvas,frame_rate:Number(e.target.value)}})}>{[24,25,30,60].map(n=><option key={n} value={n}>{n} fps</option>)}</select></label>
            </div><p className="mt-5 text-xs text-vx-fg-muted">These settings belong to this project. They do not change existing media in your library.</p>
          </section>
          <aside className="rounded-2xl border border-vx-border p-5"><h2 className="text-lg font-bold">Version history</h2><p className="mb-5 mt-2 text-xs text-vx-fg-muted">Each save keeps a snapshot. Restore a previous version whenever you need.</p>
            {historyError&&<div role="alert" className="mb-4 text-sm"><p>{historyError}</p><Button variant="ghost" size="sm" disabled={historyBusy} onClick={()=>readHistory()}>Retry history</Button></div>}
            {!history.length&&!historyBusy&&<p className="text-sm text-vx-fg-muted">Your first save will appear here.</p>}
            <ol className="space-y-2">{history.map(v=><li key={v.revision}><button type="button" disabled={historyBusy||busy} onClick={()=>viewVersion(v.revision)} className="w-full rounded-xl border border-vx-border px-4 py-3 text-left hover:border-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent disabled:opacity-50"><span className="text-sm font-bold">Version {v.revision}{v.revision===revision?' · Current':''}</span><span className="mt-1 block text-xs text-vx-fg-muted">{date(v.created_at)}</span>{v.restored_from&&<span className="mt-1 block text-xs text-vx-fg-muted">Restored from version {v.restored_from}</span>}</button></li>)}</ol>
            {historyBusy&&<p role="status" className="mt-3 text-sm">Loading history…</p>}{next&&<Button variant="ghost" size="sm" className="mt-4" disabled={historyBusy} onClick={()=>readHistory(next)}>Older versions</Button>}
          </aside>
        </div>
        {preview&&<Modal aria-labelledby="version-title" onCancel={()=>!busy&&setPreview(null)} className="items-center justify-center p-4"><div className="max-h-[85dvh] w-full max-w-2xl overflow-auto rounded-2xl border border-vx-border bg-vx-base p-6"><h2 id="version-title" className="text-2xl font-black">Version {preview.revision}</h2><p className="mt-2 text-xs text-vx-fg-muted">{date(preview.created_at)} · {preview.document.canvas.aspect_ratio} · {preview.document.canvas.frame_rate} fps</p><p className="my-6 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">{preview.document.brief||'No brief'}</p><p role="alert" className="mb-3 text-sm">{error}</p><p className="mb-5 text-sm text-vx-fg-muted">{dirty?'Save your current draft before restoring.':'Restoring creates a new version. Your existing history is preserved.'}</p><div className="flex flex-wrap justify-end gap-3"><Button variant="ghost" disabled={busy} onClick={()=>setPreview(null)}>Close</Button><Button disabled={busy||dirty||conflict||preview.revision===revision} onClick={()=>save({restore:preview.revision})}>{busy?'Restoring…':'Restore as new version'}</Button></div></div></Modal>}
      </>}
    </main>
  </div>;
}
