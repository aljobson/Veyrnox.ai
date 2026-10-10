'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient';
import { FILM_STAGES, accessibleStage, emptyFilm, stageIssues } from '../../_lib/filmStudio';
import { readFilm, writeFilm } from '../../_lib/filmStudioStorage';
import { useCatalog } from '../../_lib/useCatalog';
import { FilmIssues } from './FilmFields';
import { FilmInit, FilmSetup } from './FilmSetup';
import { FilmBreakdown } from './FilmBreakdown';
import { FilmBoards } from './FilmBoards';
import { FilmPassports } from './FilmPassports';
import { FilmFiles } from './FilmFiles';
import { FilmTests } from './FilmTests';
import { FilmPrompts } from './FilmPrompts';
import { filmStudioStore } from '../../_lib/filmStudioStore';

const storage = () => { try { return window.localStorage; } catch { return null; } };
const serverState={film:emptyFilm(),stage:0,ready:false,userId:null,error:null,saved:false};
export function FilmWorkspace() {
  const [state,setState]=useState(serverState);
  const {film,stage,ready,userId,error,saved}=state;
  useEffect(()=>{
    const sync=()=>setState(filmStudioStore.getState());
    const stop=filmStudioStore.subscribe(sync);sync();return stop;
  },[]);
  const setStage=stage=>filmStudioStore.set({stage});
  const {models,live} = useCatalog();
  useEffect(()=>{
    const load = (force=false) => {
      const id=getStoredUserId(); const loaded=readFilm(storage(),id);
      if(!force&&filmStudioStore.getState().ready&&filmStudioStore.getState().userId===id) {filmStudioStore.set({ready:true});return;}
      filmStudioStore.set({userId:id,film:loaded.film,error:loaded.error,saved:!!id&&!loaded.error,stage:accessibleStage(loaded.film),ready:true});
    };
    load(); return onSessionChange(()=>load(true));
  },[]);
  const update = next => {
    filmStudioStore.set({film:next,saved:false,error:null});
    try { filmStudioStore.set({saved:writeFilm(storage(),userId,next)}); }
    catch { filmStudioStore.set({error:'Changes are not saved. Export your studio before leaving this page.'}); }
  };
  const available=accessibleStage(film), current=Math.min(stage,available);
  const issues=stageIssues(film,current);
  if(!ready) return <p role="status" className="p-8">Loading Film Studio…</p>;
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
    <header className="mb-8"><p className="font-vx-mono text-xs tracking-widest text-vx-fg-muted">FILM STUDIO</p><h1 className="mt-2 text-3xl font-black">From story to consistent shots.</h1>
      <p className="mt-3 max-w-2xl text-sm text-vx-fg-muted">Seven stages keep the references, characters and direction consistent across your film.</p>
      <p role="status" className="mt-3 text-xs text-vx-fg-muted">{saved?'Saved in this browser. Export a copy to keep it when you sign out.':userId?'Changes are not saved.':'Sign in to save in this browser. You can work and export without signing in.'}</p>
      <FilmFiles film={film} onImport={next=>{update(next);setStage(accessibleStage(next));}}/>
    </header>
    {error&&<p role="alert" className="mb-5 text-sm text-vx-danger">{error}</p>}
    <div className="grid items-start gap-7 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Film Studio stages"><ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{FILM_STAGES.map(([id,title],i)=><li key={id}>
        <button type="button" onClick={()=>setStage(i)} disabled={i>available} aria-current={i===current?'step':undefined} className={`w-full rounded-xl border p-3 text-left text-sm disabled:opacity-40 ${i===current?'border-vx-accent bg-vx-panel':'border-vx-border'}`}>
          <span className="mr-2 font-vx-mono">{i+1}.</span>{title}<span className="mt-1 block text-xs text-vx-fg-muted">{i<available?'Ready':i===available?'In progress':'Complete the earlier stages'}</span>
        </button></li>)}</ol></nav>
      <section aria-label={FILM_STAGES[current][1]} className="min-w-0 rounded-2xl border border-vx-border p-5 sm:p-7">
        <h2 className="mb-5 text-xl font-bold">{current+1}. {FILM_STAGES[current][1]}</h2>
        <Link href={`/app/chat?skill=${['film-setup','film-studio-init','film-breakdown','film-reference-board','film-asset-passport','film-stress-test','film-shot-prompt'][current]}`} className="mb-5 inline-block text-sm font-semibold text-vx-accent">Get help from this stage’s assistant →</Link>
        {current===0&&<FilmSetup film={film} update={update} models={models}/>}
        {current===1&&<FilmInit film={film} update={update}/>}
        {current===2&&<FilmBreakdown film={film} update={update}/>}
        {current===3&&<FilmBoards film={film} update={update}/>}
        {current===4&&<FilmPassports film={film} update={update} models={models} live={live}/>}
        {current===5&&<FilmTests film={film} update={update} models={models} live={live}/>}
        {current===6&&<FilmPrompts film={film} update={update} models={models} live={live}/>}
        <FilmIssues issues={issues}/>
        {current<6&&<button type="button" disabled={issues.length>0} onClick={()=>setStage(current+1)} className="mt-5 rounded-full bg-vx-accent px-5 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-40">Continue to {FILM_STAGES[current+1][1].toLowerCase()}</button>}
      </section>
    </div>
  </div>;
}
