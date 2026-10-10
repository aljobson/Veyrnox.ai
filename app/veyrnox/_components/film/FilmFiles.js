'use client';
import { useState } from 'react';
import { parseFilm, MAX_FILM_BYTES } from '../../_lib/filmStudioStorage';
import { filmFilename, studioZip } from '../../_lib/filmStudioExport';

const download=(bytes,name,type)=>{
  const url=URL.createObjectURL(new Blob([bytes],{type})); const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
export function FilmFiles({film,onImport}){
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [incoming,setIncoming]=useState(null);
  const exportFile=zip=>{try{setError('');setNotice('');if(zip)download(studioZip(film),`${filmFilename(film)}.zip`,'application/zip');else download(JSON.stringify(film,null,2),`${filmFilename(film)}.json`,'application/json');setNotice(zip?'Studio folder prepared for download.':'Studio JSON prepared for download.');}catch(e){setError(e.message);}};
  const read=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>MAX_FILM_BYTES)throw new Error('The studio file must be smaller than 1 MB.');setIncoming(parseFilm(await file.text()));setError('');}catch(e){setError(e.message);}};
  return <div className="mt-4 space-y-3"><div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-vx-accent">
    <button type="button" onClick={()=>exportFile(false)}>Export studio JSON</button><button type="button" onClick={()=>exportFile(true)}>Download studio folder</button>
    <label className="cursor-pointer">Import studio JSON<input aria-label="Import studio JSON" type="file" accept="application/json,.json" onChange={read} className="sr-only"/></label>
  </div>
  {incoming&&<div className="rounded-xl border border-vx-border p-4 text-sm"><p>Replace the current workspace with {incoming.name||'this studio'}? Export your current work first to keep it.</p><div className="mt-3 flex gap-4"><button type="button" onClick={()=>{onImport(incoming);setIncoming(null);}}>Use imported studio</button><button type="button" onClick={()=>setIncoming(null)}>Keep current studio</button></div></div>}
  {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
  </div>;
}
