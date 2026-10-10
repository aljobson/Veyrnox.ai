'use client';
import { useState } from 'react';
import { assetKey, isLocked, lockAsset, testMatrix, testPrompt } from '../../_lib/filmStudio';
import { FilmField, FilmSelect } from './FilmFields';
import { FilmPromptOutput } from './FilmPromptOutput';

export function FilmTests({film,update,models,live}){
  const [selected,setSelected]=useState('');const [error,setError]=useState('');
  const asset=film.assets.find(a=>assetKey(a)===selected)||film.assets[0];
  if(!asset)return null;
  const rows=testMatrix(film,asset),locked=isLocked(film,asset);
  const score=rows.filter(r=>asset.tests[r.id]?.verdict==='pass'&&asset.tests[r.id]?.result.trim()).length;
  const edit=(id,patch)=>update({...film,assets:film.assets.map(a=>a===asset?{...a,lock:null,tests:{...a.tests,[id]:{result:'',verdict:'pending',...a.tests[id],...patch}}}:a)});
  const lock=()=>{try{update(lockAsset(film,assetKey(asset)));setError('');}catch(e){setError(e.message);}};
  return <div className="space-y-5"><p className="text-sm text-vx-fg-muted">Use static images to test angles, sizes, real scene lighting and every shared-frame pairing. Record actual output files or Library job IDs and review them against the passport.</p>
    <FilmSelect label="Asset to test" value={assetKey(asset)} onChange={v=>{setSelected(v);setError('');}} options={film.assets.map(a=>[assetKey(a),`${assetKey(a)} · ${isLocked(film,a)?'locked':'draft'}`])}/>
    <p role="status" className="text-sm font-semibold">{assetKey(asset)} · {locked?'Locked':'Draft'} · {score}/{rows.length} tests passed</p>
    {asset.type==='character'&&<p className="text-xs text-vx-fg-muted">Ten of ten repeatability images must pass, plus every scene-lighting and pairing test. One miss keeps the asset draft.</p>}
    <div className="space-y-3">{rows.map((row,i)=><details key={row.id} className="rounded-xl border border-vx-border p-4" open={i===0||undefined}><summary data-testid={`film-test-toggle-${i+1}`} className="cursor-pointer text-sm font-semibold">Test {i+1}: {row.angle} · {row.size} · {row.shot}{row.pair?` · beside ${row.pair}`:''} · {asset.tests[row.id]?.verdict||'pending'}</summary>
      <div className="mt-4 space-y-4"><FilmPromptOutput title={`Static test ${i+1} prompt`} prompt={testPrompt(film,asset,row)} modelId={film.stack.image} access={film.stack.imageAccess} models={models} live={live}/>
        <FilmField label={`Test ${i+1} output`} value={asset.tests[row.id]?.result||''} onChange={result=>edit(row.id,{result})} disabled={locked} hint="Use a stable output file or Library job ID."/>
        <FilmSelect label={`Test ${i+1} verdict`} value={asset.tests[row.id]?.verdict||'pending'} onChange={verdict=>edit(row.id,{verdict})} disabled={locked} options={[['pending','Pending'],['pass','Pass'],['miss','Miss']]}/>
      </div></details>)}</div>
    {error&&<p role="alert" className="text-sm text-vx-danger">{error}</p>}
    <button type="button" disabled={locked||score!==rows.length} onClick={lock} className="rounded-full bg-vx-accent px-5 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-40">Record pass decision and lock {assetKey(asset)}</button>
  </div>;
}
