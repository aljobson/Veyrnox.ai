'use client';
import { useState } from 'react';
import { assetKey, isLocked, referenceSheet, shotAssets } from '../../_lib/filmStudio';
import { FilmField, FilmSelect } from './FilmFields';
import { FilmPromptOutput } from './FilmPromptOutput';

export function FilmPassports({ film, update, models, live }) {
  const required=[...new Set(film.shots.flatMap(shotAssets))];
  const [selected,setSelected]=useState(required[0]||'');
  const key=required.includes(selected)?selected:required[0];
  const board=film.boards.find(b=>b.name===key);
  const asset=film.assets.find(a=>assetKey(a)===key);
  const [draft,setDraft]=useState(null);
  const descriptor=draft?.key===key?draft.descriptor:asset?.descriptor||'';
  const refs=draft?.key===key?draft.references:asset?.references.join('\n')||board?.references.filter(r=>r.kind==='reference').map(r=>r.source).join('\n')||'';
  const edit=patch=>setDraft({key,descriptor,references:refs,...patch});
  const save=()=>{
    const [tag,version]=key.split(':v');
    const next={tag,version:Number(version),type:board.type,descriptor,references:refs.split('\n').map(r=>r.trim()).filter(Boolean),tests:{},lock:null};
    update({...film,assets:asset?film.assets.map(a=>a===asset?next:a):[...film.assets,next]}); setDraft(null);
  };
  const locked=isLocked(film,asset);
  return <div className="space-y-5"><p className="text-sm text-vx-fg-muted">One exact tag and version per asset, including every state variant. Define permanent identity in full; its descriptor is copied unchanged into tests and shot prompts.</p>
    <FilmSelect label="Asset to passport" value={key} onChange={v=>{setSelected(v);setDraft(null);}} options={required.map(k=>[k,k])}/>
    <FilmField label="Canonical descriptor" multiline value={descriptor} onChange={v=>edit({descriptor:v})} disabled={locked}
      hint={board?.type==='character'?'Resolve face, hair, age, build, skin, wardrobe, footwear, carried items, wear and distinguishing details.':board?.type==='location'?'Resolve layout, architecture, surfaces, fixed objects, scale, landmarks, palette, light sources and grade.':'Resolve form, scale, material, colour, finish, wear, markings, moving parts and distinguishing details.'}/>
    <FilmField label="Fixed reference files" multiline value={refs} onChange={v=>edit({references:v})} disabled={locked} hint="One stable file or Library job ID per line. Add the generated reference sheet once it exists. New versions use new filenames."/>
    <button type="button" onClick={save} disabled={locked||!descriptor.trim()||!refs.trim()} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-40">Save draft passport</button>
    {asset&&<><p role="status" className="text-sm">{key} · {locked?'Locked':'Draft'}</p>
      {locked?<p className="text-xs text-vx-fg-muted">To change this identity, give the revised asset a new version in its shot cards and boards.</p>:<FilmPromptOutput title="Reference-sheet prompt" prompt={referenceSheet(asset)} modelId={film.stack.image} access={film.stack.imageAccess} models={models} live={live} aspect={null}/>}</>}
  </div>;
}
