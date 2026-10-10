'use client';
import { useState } from 'react';
import { STYLE_BOARDS, boardIssues, shotAssets } from '../../_lib/filmStudio';
import { FilmField, FilmIssues, FilmSelect } from './FilmFields';

function readReferences(text) {
  return text.split('\n').filter(s=>s.trim()).map(line=>{
    const [raw,...caption]=line.split('|'); const anti=raw.trim().startsWith('!');
    return {source:raw.trim().replace(/^!\s*/,''),caption:caption.join('|').trim(),kind:anti?'anti-reference':'reference'};
  });
}
export function FilmBoards({ film, update }) {
  const [selected,setSelected]=useState('');
  const board=film.boards.find(b=>b.id===selected)||film.boards[0];
  const edit=patch=>update({...film,boards:film.boards.map(b=>b===board?{...b,...patch}:b)});
  const scaffold=()=>{
    const keys=[...new Set(film.shots.flatMap(shotAssets))];
    const needed=[...keys.map(name=>({name,type:film.shots.some(s=>s.location===name)?'location':film.shots.some(s=>String(s.characters).split(',').map(s=>s.trim()).includes(name))?'character':'prop'})),...STYLE_BOARDS.map(name=>({name,type:'style'}))];
    const additions=needed.filter(n=>!film.boards.some(b=>b.name===n.name&&b.type===n.type)).map(n=>({...n,id:n.name,references:[],decision:'revise'}));
    update({...film,boards:[...film.boards,...additions]});
  };
  return <div className="space-y-5"><p className="text-sm text-vx-fg-muted">Supply existing images and describe exactly what each specifies. Lead characters need 10–20 references, locations 8–15 and props 3–5. Each style category gets its own board.</p>
    <button type="button" onClick={scaffold} className="rounded-lg border border-vx-accent px-4 py-2 text-sm text-vx-accent">Create required boards</button>
    {board&&<>
      <FilmSelect label="Reference board" value={board.id} onChange={setSelected} options={film.boards.map(b=>[b.id,`${b.name} · ${b.decision}`])}/>
      <FilmField label="Reference entries" multiline rows={10} value={board.references.map(r=>`${r.kind==='anti-reference'?'! ':''}${r.source} | ${r.caption}`).join('\n')}
        onChange={v=>edit({references:readReferences(v),decision:'revise'})} hint="One image per line: source file, Library job ID or link | precise caption. Prefix an anti-reference with ! and name the forbidden property."/>
      <FilmSelect label="Written board decision" value={board.decision} onChange={decision=>edit({decision})} options={[['revise','Revise'],['approved','Approved'],['rejected','Rejected']]}/>
      <FilmIssues issues={boardIssues(board)}/>
      {board.references.some(r=>r.kind==='anti-reference')&&<section><h3 className="text-sm font-bold">Ban list</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{board.references.filter(r=>r.kind==='anti-reference').map((r,i)=><li key={i}>{r.caption} · {r.source}</li>)}</ul></section>}
    </>}
  </div>;
}
