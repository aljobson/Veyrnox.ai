'use client';
import { useState } from 'react';
import { SHOT_LANES } from '../../_lib/filmStudio';
import { FilmField } from './FilmFields';

export function FilmBreakdown({ film, update }) {
  const [index,setIndex]=useState(0);
  const shot=film.shots[index] || film.shots[0];
  const edit=(key,value)=>update({...film,shots:film.shots.map(s=>s===shot?{...s,[key]:value}:s)});
  const add=()=>{
    let n=film.shots.length+1; while(film.shots.some(s=>s.id===`sc01-sh${String(n).padStart(2,'0')}`)) n++;
    const next=Object.fromEntries(SHOT_LANES.flatMap(([,fields])=>fields.map(([k])=>[k,''])));
    Object.assign(next,{id:`sc01-sh${String(n).padStart(2,'0')}`,seconds:film.stack.seconds,characters:'none',props:'none',dialogue:'none',oneAction:false,text:'',textPlacement:'',textContext:''});
    setIndex(film.shots.length); update({...film,shots:[...film.shots,next]});
  };
  return <div className="space-y-5"><FilmField label="Script, treatment or idea" multiline value={film.script} onChange={script=>update({...film,script})} hint="Keep supplied dialogue unchanged. Resolve gaps scene by scene."/>
    <div className="flex flex-wrap gap-2" aria-label="Shot cards">{film.shots.map((s,i)=><button key={s.id} type="button" aria-pressed={s===shot} onClick={()=>setIndex(i)} className="rounded-lg border border-vx-border px-3 py-2 text-sm">{s.id}</button>)}
      <button type="button" onClick={add} disabled={film.shots.length>=200} className="rounded-lg border border-vx-accent px-3 py-2 text-sm text-vx-accent">Add shot</button></div>
    {shot&&<>
      {SHOT_LANES.map(([lane,fields])=><fieldset key={lane} className="rounded-xl border border-vx-border p-4"><legend className="px-2 font-bold">{lane}</legend><div className="grid gap-4 sm:grid-cols-2">{fields.map(([key,label])=><FilmField key={key} label={label} value={shot[key]} onChange={v=>edit(key,key==='id'?v.replace(/[^a-zA-Z0-9_-]/g,''):v)}
        multiline={['description','dialogue','blocking','acting'].includes(key)} hint={['location','characters','props'].includes(key)?'Exact tag and version, e.g. @cal:v1. Separate tags with commas; use none for no characters or props.':key==='seconds'?'One clip, 10–15 seconds.':undefined}/>)}</div></fieldset>)}
      <label className="flex gap-3 text-sm"><input type="checkbox" checked={shot.oneAction} onChange={e=>edit('oneAction',e.target.checked)}/>This clip contains one action.</label>
      <fieldset className="space-y-4 rounded-xl border border-vx-border p-4"><legend className="px-2 font-bold">Text for the edit</legend><p className="text-xs text-vx-fg-muted">Titles, signs and screens are separate editing tasks. Keep their words out of the generation description.</p>
        <FilmField label="Exact in-frame text" value={shot.text||''} onChange={v=>edit('text',v)}/>
        {shot.text&&<><FilmField label="Text placement" value={shot.textPlacement||''} onChange={v=>edit('textPlacement',v)}/><FilmField label="Text context" value={shot.textContext||''} onChange={v=>edit('textContext',v)}/></>}
      </fieldset>
    </>}
  </div>;
}
