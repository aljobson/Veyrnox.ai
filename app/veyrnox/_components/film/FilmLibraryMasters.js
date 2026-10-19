'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useEffect, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient.js';
import { AssetRetention } from '../AssetRetention';

export function FilmLibraryMasters({ visible = true, fetcher = gatewayFetch }) {
  const { t } = useI18n();
  const [masters, setMasters] = useState([]), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(()=>onSessionChange(()=>{setMasters([]);setError('');setRevision(n=>n+1);}),[]);
  useEffect(() => {
    if(!getStoredUserId())return;
    let active=true;
    fetcher('/library/masters').then(response=>{if(active){setMasters(response.masters || []);setError('');}})
      .catch(e=>{if(active && e.code !== 'no_token' && e.code !== 'unauthenticated') setError(t("app.film.masters.failed"));});
    return ()=>{active=false;};
  },[fetcher,revision,t]);
  if(!visible || (!masters.length && !error)) return null;
  return <section aria-label={t("app.film.masters.title")} className="max-w-[1400px] mx-auto px-4 sm:px-8 py-6">
    <h2 className="text-xl font-semibold">{t("app.film.masters.title")}</h2>
    {error && <p role="alert" className="mt-3 text-sm">{error} <button type="button" className="underline" onClick={()=>setRevision(n=>n+1)}>{t("app.film.masters.retry")}</button></p>}
    <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{masters.map(master => <MasterCard key={master.id} master={master} fetcher={fetcher}/>)}</div>
  </section>;
}
function MasterCard({master,fetcher}) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const path=`/library/masters/${encodeURIComponent(master.id)}/asset`;
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;
    fetcher(path).then(asset=>{
      if(!asset.url?.startsWith('https://')) throw new Error('unavailable');
      if(active){setUrl(asset.url);setError('');}
    }).catch(()=>{if(active) setError(t("app.film.masters.videoFailed"));});
    return ()=>{active=false;};
  },[path,fetcher,revision,t]);
  async function download() {
    if(busy) return;
    setBusy(true);setError('');
    try { const asset=await fetcher(`${path}?download=1`); if(!asset.url?.startsWith('https://')) throw new Error('unavailable'); window.location.assign(asset.url); }
    catch { setError(t("app.editor.saved.downloadFailed")); }
    finally { setBusy(false); }
  }
  return <article id={`master-${master.id}`} aria-label={master.label} className="overflow-hidden rounded-xl border border-vx-border bg-vx-panel">
    {url && <video aria-label={t("app.editor.saved.preview", { name: master.label })} controls playsInline preload="metadata" src={url} className="aspect-video w-full bg-black" onError={()=>setError(t("app.film.masters.videoFailed"))}/>}
    <div className="p-4 space-y-2"><p className="text-xs font-semibold text-vx-accent">{t("app.film.masters.saved")}</p>
      <h3 className="font-semibold">{master.label}</h3><p className="text-sm text-vx-fg-muted">{t("app.film.masters.dimensions", { width:number(master.width), height:number(master.height), seconds:number(master.seconds), rate:number(master.frame_rate) })}</p>
      <p className="text-xs text-vx-fg-muted">{t("app.film.masters.help")}</p>
      <button type="button" disabled={busy} className="text-sm font-semibold text-vx-accent underline" onClick={download}>{busy?t("app.film.masters.preparing"):t("app.film.masters.download")}</button>
      <details className="text-xs text-vx-fg-muted"><summary>{t("app.film.masters.details")}</summary><p className="mt-2 break-all">{['SHA-256:', master.sha256].join(' ')}</p><p>{t("app.film.masters.source", {id:master.source_job_id})}</p><p>{t(pluralKey(t, locale, "app.film.masters.bytes", master.size_bytes), {count:number(master.size_bytes)})}</p></details>
      {error && <p role="alert" className="text-sm">{error} <button type="button" className="underline" onClick={()=>setRevision(n=>n+1)}>{t("app.film.masters.previewRetry")}</button></p>}
    </div><AssetRetention row={{state:'succeeded',has_asset:true,asset_expires_at:master.expires_at}}/>
  </article>;
}
