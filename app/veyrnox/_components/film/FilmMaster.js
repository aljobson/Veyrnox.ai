'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';

import { useI18n } from '../../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { FilmMasterSave } from './FilmMasterSave';

const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function masterError(t, error) {
  const code = error?.code || (/^[a-z][a-z0-9_]*(?::[a-z0-9_]+)?$/.test(error?.message || '') ? error.message : null);
  return code ? tOr(t, `app.film.master.error.${code}`, t('app.film.master.failed')) : error?.message || t('app.film.master.failed');
}
export function FilmMaster({film,attempt}) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale), {useGrouping:false, maximumFractionDigits:20}).format(value);
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
        if(loaded.kind!=='video') throw new Error(t("app.film.master.choose"));
        source=loaded.blob;
      }
      controller.signal.throwIfAborted();
      const {exportFilmMaster}=await import('../../_lib/filmMaster.mjs');
      const master=await exportFilmMaster(source,film,attempt,{signal:controller.signal,onProgress:p=>setProgress(p.total?Math.round(p.done/p.total*100):0)});
      if(!controller.signal.aborted) setResult({...master,fromLibrary:library&&!file,url:URL.createObjectURL(master.blob)});
    } catch(e) { if(!controller.signal.aborted) setError(masterError(t,e)); }
    finally {running.current=false;if(!controller.signal.aborted)setBusy(false);}
  }
  return <div className="mt-3 space-y-3 border-t border-vx-border pt-3">
    <p className="text-xs text-vx-fg-muted">{t("app.film.master.help")}</p>
    <label className="block text-xs">{library?t("app.film.master.optional"):t("app.film.master.file")}<input type="file" accept="video/mp4,video/quicktime,video/webm" disabled={busy} className="mt-1 block max-w-full text-xs" onChange={e=>{setFile(e.target.files?.[0]||null);setResult(null);setError('');}}/></label>
    {!busy&&<button type="button" disabled={!file&&!library} onClick={prepare} className="rounded-full border border-vx-accent px-4 py-2 text-xs font-semibold text-vx-accent disabled:opacity-40">{t("app.film.master.prepare")}</button>}
    {busy&&<><p role="status" className="text-xs">{t("app.film.master.preparing")}{' '}{number(progress)}%</p><button type="button" className="text-xs underline" onClick={()=>{abort.current?.abort();setBusy(false);}}>{t("app.film.master.cancel")}</button></>}
    {error&&<p role="alert" className="text-xs text-vx-danger">{error}</p>}
    {result&&<><p role="status" className="text-xs font-semibold">{t("app.film.master.ready")}{' '}{number(result.width)}×{number(result.height)} · {number(result.seconds)}s</p>
      {result.fromLibrary ? <FilmMasterSave key={result.url} master={result} jobId={attempt.result.trim()} label={t("app.film.master.label",{name:film.name,shot:attempt.shot,version:number(attempt.version)})}/> : <p className="text-xs text-vx-fg-muted">{t("app.film.master.saveHelp")}</p>}
      <a href={result.url} download={result.filename} className="inline-block rounded-full border border-vx-accent px-4 py-2 text-xs font-semibold text-vx-accent">{t("app.film.master.download")}</a></>}
  </div>;
}
