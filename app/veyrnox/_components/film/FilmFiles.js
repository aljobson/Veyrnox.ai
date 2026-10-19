'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { useState } from 'react';
import { parseFilm, MAX_FILM_BYTES } from '../../_lib/filmStudioStorage';
import { filmFilename, studioZip } from '../../_lib/filmStudioExport';

const download=(bytes,name,type)=>{
  const url=URL.createObjectURL(new Blob([bytes],{type})); const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
export function FilmFiles({film,onImport}){
  const { t } = useI18n();
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [incoming,setIncoming]=useState(null);
  const exportFile=zip=>{try{setError('');setNotice('');if(zip)download(studioZip(film),`${filmFilename(film)}.zip`,'application/zip');else download(JSON.stringify(film,null,2),`${filmFilename(film)}.json`,'application/json');setNotice(zip?t("app.film.files.folderReady"):t("app.film.files.jsonReady"));}catch(e){setError(e.message);}};
  const read=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>MAX_FILM_BYTES)throw new Error(t("app.film.files.size"));setIncoming(parseFilm(await file.text()));setError('');}catch(e){setError(e.message);}};
  return <div className="mt-4 space-y-3"><div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-vx-accent">
    <button data-testid="film-export-json" type="button" onClick={()=>exportFile(false)}>{t("app.film.files.export")}</button><button type="button" onClick={()=>exportFile(true)}>{t("app.film.files.download")}</button>
    <label className="cursor-pointer">{t("app.film.files.import")}<input data-testid="film-import-json" aria-label={t("app.film.files.import")} type="file" accept="application/json,.json" onChange={read} className="sr-only"/></label>
  </div>
  {incoming&&<div className="rounded-xl border border-vx-border p-4 text-sm"><p>{t("app.film.files.replace",{name:incoming.name||t("app.film.files.unnamed")})}</p><div className="mt-3 flex gap-4"><button data-testid="film-use-import" type="button" onClick={()=>{onImport(incoming);setIncoming(null);}}>{t("app.film.files.use")}</button><button type="button" onClick={()=>setIncoming(null)}>{t("app.film.files.keep")}</button></div></div>}
  {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
  </div>;
}
