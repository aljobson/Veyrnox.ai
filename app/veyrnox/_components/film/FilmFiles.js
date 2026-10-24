'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { useState } from 'react';
import { filmFilename, studioZip } from '../../_lib/filmStudioExport';

const download=(bytes,name,type)=>{
  const url=URL.createObjectURL(new Blob([bytes],{type})); const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
export function FilmFiles({film}){
  const { t } = useI18n();
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const downloadProject=()=>{try{setError('');setNotice('');download(studioZip(film),`${filmFilename(film)}.zip`,'application/zip');setNotice(t("app.film.files.folderReady"));}catch(e){setError(e.message);}};
  return <div className="mt-4 space-y-3">
  <button data-testid="film-download-project" type="button" onClick={downloadProject} className="min-h-11 rounded-full border border-vx-border px-4 py-2 text-sm font-semibold text-vx-accent hover:border-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">{t("app.film.files.download")}</button>
  {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
  </div>;
}
