'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import Link from 'next/link';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { Button } from '../../../_components/Button';
import { Modal } from '../../../_components/Modal';
import { useProjectsEnabled } from '../../../_components/ProjectsFlag';
import { gatewayFetch, makeIdempotencyKey } from '../../../_lib/gateway';
import { equalProjectDocuments as same } from '../../../../../lib/projectDocument';

const field='w-full rounded-xl border border-vx-border bg-vx-base px-4 py-3 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent disabled:opacity-50';
const date=(value,locale)=>new Date(value).toLocaleString(localeTag(locale),{dateStyle:'medium',timeStyle:'short'});
function message(e, t) {
  if(e.code==='account_changed'||e.status===401)return t("app.projects.sessionChanged");
  if(e.status===404||e.status===403)return t("app.projects.unavailableEdit");
  if(e.status===409)return t("app.projects.newerSaved");
  if(e.status===429)return t("app.projects.savePaused");
  return t("app.projects.saveFailed");
}
export default function ProjectPage(){
  const { t } = useI18n();
  const enabled=useProjectsEnabled();
  const {id}=useParams();
  return <>{enabled ? <DocumentEditor key={id} id={id}/> : <><AppNav active="projects"/><Main className="mx-auto max-w-6xl p-8"><h1 className="text-3xl font-black">{t("app.projects.preview")}</h1><p className="mt-4">{t("app.projects.notAvailable")}</p><Link href="/app/projects" className="mt-5 inline-block text-vx-accent underline">{t("app.projects.back")}</Link></Main></>}</>;
}
function DocumentEditor({id}){
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : value.toLocaleString(localeTag(locale));
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
    }catch{if(alive.current&&sequence===historyRequest.current)setHistoryError(t("app.projects.historyFailed"));}
    finally{if(alive.current&&sequence===historyRequest.current)setHistoryBusy(false);}
  },[endpoint, t]);
  useEffect(()=>{
    alive.current=true;
    let cancelled=false;
    (async()=>{
      try{
        const [p,d]=await Promise.all([gatewayFetch(endpoint),gatewayFetch(`${endpoint}/document`)]);
        if(cancelled)return;
        setProject(p.project);setDraft(d.document);setSaved(d.document);setRevision(d.revision);setSavedAt(d.created_at);
        readHistory();
      }catch(e){if(!cancelled)setLoadError(e.status===404?t("app.projects.gone"):t("app.projects.loadFailed"));}
      finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;alive.current=false;};
  },[endpoint,readHistory,t]);
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
    }catch(e){if(alive.current){setError(message(e, t));setConflict(e.status===409&&e.code!=='account_changed');}}
    finally{writing.current=false;if(alive.current)setBusy(false);}
  },[endpoint,revision,readHistory,t]);
  useEffect(()=>{
    if(!dirty||busy||error||conflict||preview)return;
    const timer=setTimeout(()=>save(),3000);
    return()=>clearTimeout(timer);
  },[draft,dirty,busy,error,conflict,preview,save]);
  async function reviewLatest(){
    if(writing.current)return;
    setBusy(true);writing.current=true;
    try{const r=await gatewayFetch(`${endpoint}/document`,{signal:AbortSignal.timeout(15000)});if(alive.current)setRemote(r);}
    catch(e){if(alive.current)setError(message(e, t));}
    finally{writing.current=false;if(alive.current)setBusy(false);}
  }
  async function viewVersion(number){
    setHistoryBusy(true);setHistoryError('');
    try{const r=await gatewayFetch(`${endpoint}/document?revision=${number}`,{signal:AbortSignal.timeout(15000)});if(alive.current)setPreview(r);}
    catch{if(alive.current)setHistoryError(t("app.projects.versionFailed"));}
    finally{if(alive.current)setHistoryBusy(false);}
  }
  function leave(event){
    if((dirty||busy)&&event.target.closest('a[href]')&&!window.confirm(t("app.projects.leave")))event.preventDefault();
  }
  function acceptRemote(){
    setDraft(remote.document);setSaved(remote.document);setRevision(remote.revision);setSavedAt(remote.created_at);
    setRemote(null);setConflict(false);setError('');pending.current=null;readHistory();
  }
  return <div onClickCapture={leave}>
    <AppNav active="projects"/>
    <Main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
      <Link href="/app/projects" className="text-sm text-vx-accent hover:underline">{t("app.projects.all")}</Link>
      {loading?<p role="status" className="py-16">{t("app.projects.loading")}</p>:loadError?<p role="alert" className="py-12">{loadError}</p>:<>
        <header className="my-7 flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="mb-2 font-vx-mono text-xs uppercase tracking-widest text-vx-fg-muted">{t("app.projects.brief")}</p><h1 className="wrap-break-word text-3xl font-black">{project.name}</h1></div>
          <div className="flex flex-wrap items-center gap-4"><span data-testid="project-save-status" role="status" className="text-xs text-vx-fg-muted">{busy?t("social.saving"):error?t("app.projects.notSaved"):dirty?t("app.projects.unsaved"):savedAt?t('app.projects.savedVersion', { version: number(revision) }):t("app.projects.noChanges")}</span><Button data-testid="project-save" size="sm" disabled={busy||conflict||(!dirty&&!error)} onClick={()=>save()}>{error?t("app.projects.retrySave"):t("app.projects.saveNow")}</Button></div></header>
        {error&&<section data-testid="project-save-error" role="alert" className="mb-6 rounded-xl border border-vx-border bg-vx-panel p-5"><p className="text-sm">{error}</p>{conflict&&<Button variant="ghost" size="sm" className="mt-3" disabled={busy} data-testid="project-review" onClick={reviewLatest}>{t("app.projects.reviewLatest")}</Button>}</section>}
        {remote&&<section className="mb-6 rounded-xl border border-vx-accent p-5"><h2 className="font-bold">{t('app.projects.remoteVersion', { version: number(remote.revision) })}</h2><p className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word text-sm text-vx-fg-muted">{remote.document.brief||t("app.projects.noBrief")}</p><p className="mt-2 text-sm">{remote.document.canvas.aspect_ratio} · {t('app.projects.fps', { count: number(remote.document.canvas.frame_rate) })}</p><p className="my-4 text-sm">{t("app.projects.keepVersion")}</p><div className="flex flex-wrap gap-3"><Button variant="ghost" disabled={busy} onClick={acceptRemote}>{t("app.projects.useSaved")}</Button><Button disabled={busy} data-testid="project-save-draft" onClick={()=>save({against:remote.revision})}>{t("app.projects.saveDraftInstead")}</Button></div></section>}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0 rounded-2xl border border-vx-border p-5 sm:p-7">
            <label htmlFor="project-brief" className="text-lg font-bold">{t("app.projects.creating")}</label><p id="brief-help" className="mb-4 mt-2 text-sm text-vx-fg-muted">{t("app.projects.briefHelp")}</p>
            <textarea data-testid="project-brief" id="project-brief" aria-describedby="brief-help" className={`${field} min-h-64 resize-y leading-relaxed`} placeholder={t("app.projects.briefPlaceholder")} maxLength={6000} value={draft.brief} onChange={e=>setDraft({...draft,brief:e.target.value})}/>
            <p className="mb-7 mt-2 text-end text-xs text-vx-fg-muted">{number(draft.brief.length)} / {locale === 'en' ? '6,000' : (6000).toLocaleString(localeTag(locale))}</p>
            <h2 className="mb-4 font-bold">{t("app.projects.canvas")}</h2><div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">{t("label.Aspect ratio")}<select className={`${field} mt-2`} value={draft.canvas.aspect_ratio} onChange={e=>setDraft({...draft,canvas:{...draft.canvas,aspect_ratio:e.target.value}})}><option value="16:9">{t("app.projects.landscape")}</option><option value="9:16">{t("app.projects.portrait")}</option><option value="1:1">{t("app.projects.square")}</option></select></label>
              <label className="text-sm">{t("app.projects.frameRate")}<select className={`${field} mt-2`} value={draft.canvas.frame_rate} onChange={e=>setDraft({...draft,canvas:{...draft.canvas,frame_rate:Number(e.target.value)}})}>{[24,25,30,60].map(n=><option key={n} value={n}>{t('app.projects.fps', { count: number(n) })}</option>)}</select></label>
            </div><p className="mt-5 text-xs text-vx-fg-muted">{t("app.projects.settingsHelp")}</p>
          </section>
          <aside className="rounded-2xl border border-vx-border p-5"><h2 className="text-lg font-bold">{t("app.projects.history")}</h2><p className="mb-5 mt-2 text-xs text-vx-fg-muted">{t("app.projects.historyHelp")}</p>
            {historyError&&<div role="alert" className="mb-4 text-sm"><p>{historyError}</p><Button variant="ghost" size="sm" disabled={historyBusy} onClick={()=>readHistory()}>{t("app.projects.retryHistory")}</Button></div>}
            {!history.length&&!historyBusy&&<p className="text-sm text-vx-fg-muted">{t("app.projects.firstSave")}</p>}
            <ol className="space-y-2">{history.map(v=><li key={v.revision}><button type="button" disabled={historyBusy||busy} data-testid={`project-version-${v.revision}`} onClick={()=>viewVersion(v.revision)} className="w-full rounded-xl border border-vx-border px-4 py-3 text-start hover:border-vx-accent focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent disabled:opacity-50"><span className="text-sm font-bold">{t('app.projects.version', { version: number(v.revision) })}{v.revision===revision?t("app.projects.current"):''}</span><span className="mt-1 block text-xs text-vx-fg-muted">{date(v.created_at,locale)}</span>{v.restored_from&&<span className="mt-1 block text-xs text-vx-fg-muted">{t('app.projects.restoredFrom', { version: number(v.restored_from) })}</span>}</button></li>)}</ol>
            {historyBusy&&<p role="status" className="mt-3 text-sm">{t("app.projects.loadingHistory")}</p>}{next&&<Button variant="ghost" size="sm" className="mt-4" disabled={historyBusy} data-testid="project-older" onClick={()=>readHistory(next)}>{t("app.projects.older")}</Button>}
          </aside>
        </div>
        {preview&&<Modal aria-labelledby="version-title" onCancel={()=>!busy&&setPreview(null)} className="items-center justify-center p-4"><div className="max-h-[85dvh] w-full max-w-2xl overflow-auto rounded-2xl border border-vx-border bg-vx-base p-6"><h2 id="version-title" className="text-2xl font-black">{t('app.projects.version', { version: number(preview.revision) })}</h2><p className="mt-2 text-xs text-vx-fg-muted">{date(preview.created_at,locale)} · {preview.document.canvas.aspect_ratio} · {t('app.projects.fps', { count: number(preview.document.canvas.frame_rate) })}</p><p className="my-6 max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word text-sm">{preview.document.brief||t("app.projects.noBrief")}</p><p role="alert" className="mb-3 text-sm">{error}</p><p className="mb-5 text-sm text-vx-fg-muted">{dirty?t("app.projects.saveBeforeRestore"):t("app.projects.restoreHelp")}</p><div className="flex flex-wrap justify-end gap-3"><Button variant="ghost" disabled={busy} onClick={()=>setPreview(null)}>{t("app.editor.workspace.close")}</Button><Button disabled={busy||dirty||conflict||preview.revision===revision} data-testid="project-restore" onClick={()=>save({restore:preview.revision})}>{busy?t("app.projects.restoring"):t("app.projects.restore")}</Button></div></div></Modal>}
      </>}
    </Main>
  </div>;
}
